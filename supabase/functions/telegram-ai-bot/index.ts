import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_GATEWAY = 'https://connector-gateway.lovable.dev/telegram';
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

  // Get offset
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

    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

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
      if (!update.message?.text) continue;
      const chatId = update.message.chat.id;
      const userText = update.message.text;

      // Get recent conversation context from DB
      const { data: history } = await supabase
        .from('telegram_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(10);

      const contextMessages = (history || []).reverse().map((m: any) => ({
        role: m.is_bot ? 'assistant' : 'user',
        content: m.text,
      }));

      contextMessages.push({ role: 'user', content: userText });

      // Store user message
      await supabase.from('telegram_messages').upsert({
        update_id: update.update_id,
        chat_id: chatId,
        text: userText,
        is_bot: false,
        raw_update: update,
      }, { onConflict: 'update_id' });

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
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are a helpful AI assistant for a Video Uploader app. You help users manage video uploads to YouTube, TikTok, and Instagram. Be concise and friendly. You can help with writing titles, descriptions, tags, scheduling strategies, and troubleshooting. Keep responses short for Telegram format.`,
              },
              ...contextMessages,
            ],
          }),
        });

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          aiReply = aiData.choices?.[0]?.message?.content || aiReply;
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
