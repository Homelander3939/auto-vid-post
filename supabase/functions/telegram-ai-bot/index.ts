import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_GATEWAY = 'https://connector-gateway.lovable.dev/telegram';
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MAX_RUNTIME_MS = 20_000;
const MIN_REMAINING_MS = 3_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function getAppContext(supabase: any): Promise<string> {
  const [
    { data: jobs },
    { data: scheduled },
    { data: settings },
    { data: scheduleConfig },
  ] = await Promise.all([
    supabase.from('upload_jobs').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('scheduled_uploads').select('*').order('scheduled_at', { ascending: true }).limit(20),
    supabase.from('app_settings').select('*').eq('id', 1).single(),
    supabase.from('schedule_config').select('*').eq('id', 1).single(),
  ]);

  const pendingJobs = (jobs || []).filter((j: any) => j.status === 'pending');
  const processingJobs = (jobs || []).filter((j: any) => j.status === 'processing');
  const completedJobs = (jobs || []).filter((j: any) => j.status === 'completed');
  const failedJobs = (jobs || []).filter((j: any) => j.status === 'failed');

  const upcomingScheduled = (scheduled || []).filter((s: any) => s.status === 'scheduled');

  const formatJob = (j: any) =>
    `• "${j.title || j.video_file_name}" → ${j.target_platforms?.join(', ') || 'none'} [${j.status}]`;

  const formatScheduled = (s: any) =>
    `• "${s.title || s.video_file_name}" → ${new Date(s.scheduled_at).toLocaleString()} [${s.status}]`;

  const platformStatus = [];
  if (settings) {
    if (settings.youtube_enabled) platformStatus.push('YouTube ✓');
    if (settings.tiktok_enabled) platformStatus.push('TikTok ✓');
    if (settings.instagram_enabled) platformStatus.push('Instagram ✓');
  }

  return `
=== LIVE APP DATA ===
Platforms: ${platformStatus.join(', ') || 'None'}
Queue: ${pendingJobs.length} pending, ${processingJobs.length} processing, ${completedJobs.length} done, ${failedJobs.length} failed
${pendingJobs.length > 0 ? `Pending:\n${pendingJobs.map(formatJob).join('\n')}` : 'No pending jobs.'}
${failedJobs.length > 0 ? `Failed:\n${failedJobs.map(formatJob).join('\n')}` : ''}
${completedJobs.length > 0 ? `Recent done:\n${completedJobs.slice(0, 3).map(formatJob).join('\n')}` : ''}
Scheduled: ${upcomingScheduled.length} upcoming
${upcomingScheduled.length > 0 ? upcomingScheduled.map(formatScheduled).join('\n') : ''}
===`;
}

/** Download a Telegram file by file_id → returns a data URL or null */
async function downloadTelegramFile(
  fileId: string,
  lovableKey: string,
  telegramKey: string,
): Promise<{ url: string; mimeType: string } | null> {
  try {
    // Step 1: getFile to get file_path
    const fileResp = await fetch(`${TELEGRAM_GATEWAY}/getFile`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': telegramKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (!fileResp.ok) return null;
    const fileData = await fileResp.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return null;

    // Step 2: Download via gateway /file/ endpoint
    const dlResp = await fetch(`${TELEGRAM_GATEWAY}/file/${filePath}`, {
      headers: {
        'Authorization': `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': telegramKey,
      },
    });
    if (!dlResp.ok) return null;

    const contentType = dlResp.headers.get('content-type') || 'application/octet-stream';
    const arrayBuf = await dlResp.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    
    // Convert to base64 data URL
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);
    const mimeType = contentType.split(';')[0].trim();
    return { url: `data:${mimeType};base64,${b64}`, mimeType };
  } catch (e) {
    console.error('File download failed:', e);
    return null;
  }
}

/** Extract message content from a Telegram update, handling text, photos, voice, docs */
async function extractMessageContent(
  message: any,
  lovableKey: string,
  telegramKey: string,
): Promise<{ text: string; images: { url: string }[]; hasMedia: boolean }> {
  const text = message.text || message.caption || '';
  const images: { url: string }[] = [];
  let hasMedia = false;

  // Handle photos (array of sizes, pick largest)
  if (message.photo && message.photo.length > 0) {
    hasMedia = true;
    const largest = message.photo[message.photo.length - 1];
    const file = await downloadTelegramFile(largest.file_id, lovableKey, telegramKey);
    if (file && file.mimeType.startsWith('image/')) {
      images.push({ url: file.url });
    }
  }

  // Handle document (could be image or other file)
  if (message.document) {
    hasMedia = true;
    const doc = message.document;
    if (doc.mime_type?.startsWith('image/')) {
      const file = await downloadTelegramFile(doc.file_id, lovableKey, telegramKey);
      if (file) images.push({ url: file.url });
    }
  }

  // Handle voice/audio
  if (message.voice || message.audio) {
    hasMedia = true;
    // We can't transcribe here, but we note it
  }

  // Handle sticker
  if (message.sticker) {
    hasMedia = true;
  }

  return { text, images, hasMedia };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return errResp('LOVABLE_API_KEY not configured');

  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!TELEGRAM_API_KEY) return errResp('TELEGRAM_API_KEY not configured');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let totalProcessed = 0;

  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state')
    .select('update_offset')
    .eq('id', 1)
    .single();

  if (stateErr) return errResp(stateErr.message);

  let currentOffset = state.update_offset;

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = MAX_RUNTIME_MS - elapsed;
    if (remainingMs < MIN_REMAINING_MS) break;

    const timeout = Math.min(5, Math.floor(remainingMs / 1000) - 3);
    if (timeout < 1) break;
    console.log(`Polling with offset=${currentOffset}, timeout=${timeout}s, remaining=${Math.round(remainingMs/1000)}s`);

    const response = await fetch(`${TELEGRAM_GATEWAY}/getUpdates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        offset: currentOffset,
        timeout,
        allowed_updates: ['message'],
      }),
    });

    const data = await response.json();
    if (!response.ok) return errResp(JSON.stringify(data), 502);

    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    for (const update of updates) {
      const message = update.message;
      if (!message) continue;

      const chatId = message.chat.id;

      // Extract content (text, photos, voice, docs)
      const { text: userText, images, hasMedia } = await extractMessageContent(
        message, LOVABLE_API_KEY, TELEGRAM_API_KEY
      );

      // Skip if truly empty (no text, no media)
      if (!userText && !hasMedia) continue;

      const displayText = userText || (images.length > 0 ? '📷 [Photo]' : hasMedia ? '📎 [File]' : '');

      // Store user message
      await supabase.from('telegram_messages').upsert({
        update_id: update.update_id,
        chat_id: chatId,
        text: displayText,
        is_bot: false,
        raw_update: update,
      }, { onConflict: 'update_id' });

      // Get conversation history
      const { data: history } = await supabase
        .from('telegram_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(10);

      const contextMessages = (history || []).reverse().map((m: any) => ({
        role: m.is_bot ? 'assistant' : 'user',
        content: m.text || '',
      }));

      // Build the current message for AI (with image support)
      const currentAiMsg: any = {
        role: 'user',
        content: userText || (images.length > 0 ? 'What do you see in this image?' : 'I sent a file.'),
      };

      if (images.length > 0) {
        // Use multimodal format
        const contentParts: any[] = [];
        if (userText) contentParts.push({ type: 'text', text: userText });
        else contentParts.push({ type: 'text', text: 'What do you see in this image? Describe it.' });
        for (const img of images) {
          contentParts.push({ type: 'image_url', image_url: { url: img.url } });
        }
        currentAiMsg.content = contentParts;
      }

      contextMessages.push(currentAiMsg);

      // Get live app context for AI
      const appContext = await getAppContext(supabase);

      // Pick model: use vision model if images present
      const model = images.length > 0 ? 'google/gemini-2.5-flash' : 'google/gemini-3-flash-preview';

      // Call AI
      let aiReply = "Sorry, I couldn't process your message right now.";
      try {
        const aiResp = await fetch(AI_GATEWAY, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: `You are a helpful AI assistant for the Video Uploader app. You have FULL ACCESS to the app's live data.

${appContext}

You help users manage video uploads to YouTube, TikTok, and Instagram. Be concise for Telegram format.
When users ask about queued jobs, scheduled uploads, or settings — USE THE LIVE DATA ABOVE to answer accurately.
When users send images, analyze them and describe what you see.
NEVER say you don't have access to the data. You DO have access.
Keep responses short and formatted for Telegram (use simple markdown).`,
              },
              ...contextMessages,
            ],
          }),
        });

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          aiReply = aiData.choices?.[0]?.message?.content || aiReply;
        } else {
          console.error('AI response error:', aiResp.status, await aiResp.text());
        }
      } catch (e) {
        console.error('AI call failed:', e);
      }

      // Send reply via Telegram
      await fetch(`${TELEGRAM_GATEWAY}/sendMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': TELEGRAM_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: aiReply,
          parse_mode: 'Markdown',
        }),
      });

      // Store bot reply
      await supabase.from('telegram_messages').insert({
        update_id: update.update_id + 1000000000,
        chat_id: chatId,
        text: aiReply,
        is_bot: true,
        raw_update: { bot_reply: true },
      });

      totalProcessed++;
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase
      .from('telegram_bot_state')
      .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);

    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed: totalProcessed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function errResp(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
