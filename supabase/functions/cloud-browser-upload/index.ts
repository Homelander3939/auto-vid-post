import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BB_API = 'https://api.browserbase.com/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const BROWSERBASE_API_KEY = Deno.env.get('BROWSERBASE_API_KEY');
  const BROWSERBASE_PROJECT_ID = Deno.env.get('BROWSERBASE_PROJECT_ID');

  if (!BROWSERBASE_API_KEY) {
    return new Response(JSON.stringify({ success: false, error: 'BROWSERBASE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!BROWSERBASE_PROJECT_ID) {
    return new Response(JSON.stringify({ success: false, error: 'BROWSERBASE_PROJECT_ID not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { job_id, platform, credentials } = body;

    if (!job_id || !platform) {
      return new Response(JSON.stringify({ success: false, error: 'job_id and platform required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the job details
    const { data: job, error: jobErr } = await supabase
      .from('upload_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ success: false, error: 'Job not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get video public URL
    const videoUrl = job.video_storage_path
      ? supabase.storage.from('videos').getPublicUrl(job.video_storage_path).data.publicUrl
      : null;

    if (!videoUrl) {
      return new Response(JSON.stringify({ success: false, error: 'No video file attached to job' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create Browserbase session
    console.log(`Creating Browserbase session for ${platform}...`);
    const sessionResp = await fetch(`${BB_API}/sessions`, {
      method: 'POST',
      headers: {
        'x-bb-api-key': BROWSERBASE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: BROWSERBASE_PROJECT_ID,
        browserSettings: {
          blockAds: true,
        },
      }),
    });

    if (!sessionResp.ok) {
      const err = await sessionResp.text();
      throw new Error(`Browserbase session creation failed [${sessionResp.status}]: ${err}`);
    }

    const session = await sessionResp.json();
    const sessionId = session.id;
    const connectUrl = session.connectUrl;

    console.log(`Session created: ${sessionId}, connecting via CDP...`);

    // Connect via CDP WebSocket
    const result = await runBrowserAutomation(connectUrl, platform, {
      videoUrl,
      title: job.title || 'Untitled Video',
      description: job.description || '',
      tags: job.tags || [],
      email: credentials?.email || '',
      password: credentials?.password || '',
    });

    // Close the session
    try {
      await fetch(`${BB_API}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'x-bb-api-key': BROWSERBASE_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
      });
    } catch (e) {
      console.error('Failed to release session:', e);
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Cloud browser upload error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message || 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// CDP WebSocket automation
async function runBrowserAutomation(
  connectUrl: string,
  platform: string,
  params: {
    videoUrl: string;
    title: string;
    description: string;
    tags: string[];
    email: string;
    password: string;
  }
): Promise<{ url?: string; message: string }> {
  return new Promise((resolve, reject) => {
    let cmdId = 1;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    let timeoutHandle: number;

    const ws = new WebSocket(connectUrl);

    const sendCmd = (method: string, params?: any): Promise<any> => {
      return new Promise((res, rej) => {
        const id = cmdId++;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

    ws.onopen = async () => {
      try {
        // Set a global timeout
        timeoutHandle = setTimeout(() => {
          ws.close();
          reject(new Error('Browser automation timed out after 120s'));
        }, 120000);

        // Enable page events
        await sendCmd('Page.enable');
        await sendCmd('Runtime.enable');

        let result: { url?: string; message: string };

        switch (platform) {
          case 'youtube':
            result = await automateYouTube(sendCmd, wait, params);
            break;
          case 'tiktok':
            result = await automateTikTok(sendCmd, wait, params);
            break;
          case 'instagram':
            result = await automateInstagram(sendCmd, wait, params);
            break;
          default:
            throw new Error(`Unsupported platform: ${platform}`);
        }

        clearTimeout(timeoutHandle);
        ws.close();
        resolve(result);
      } catch (e) {
        clearTimeout(timeoutHandle);
        ws.close();
        reject(e);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = (e) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`WebSocket error: ${e}`));
    };

    ws.onclose = () => {
      clearTimeout(timeoutHandle);
      // Reject any pending commands
      for (const [, p] of pending) {
        p.reject(new Error('WebSocket closed'));
      }
      pending.clear();
    };
  });
}

type SendCmd = (method: string, params?: any) => Promise<any>;
type Wait = (ms: number) => Promise<void>;

async function evaluateJS(sendCmd: SendCmd, expression: string): Promise<any> {
  const result = await sendCmd('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result?.result?.value;
}

// --- YouTube Studio Automation ---
async function automateYouTube(
  sendCmd: SendCmd,
  wait: Wait,
  params: { videoUrl: string; title: string; description: string; tags: string[]; email: string; password: string }
): Promise<{ url?: string; message: string }> {
  // Navigate to YouTube Studio upload
  await sendCmd('Page.navigate', { url: 'https://studio.youtube.com/channel/UC/videos/upload' });
  await wait(5000);

  // Check if we need to log in
  const currentUrl = await evaluateJS(sendCmd, 'window.location.href');

  if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
    if (!params.email || !params.password) {
      throw new Error('YouTube login required but no credentials provided. Please log in manually first or provide credentials.');
    }

    // Type email
    await evaluateJS(sendCmd, `
      const emailInput = document.querySelector('input[type="email"]');
      if (emailInput) { emailInput.value = '${params.email}'; emailInput.dispatchEvent(new Event('input', {bubbles: true})); }
    `);
    await wait(1000);
    await evaluateJS(sendCmd, `
      const nextBtn = document.querySelector('#identifierNext button') || document.querySelector('[data-primary-action-label] button');
      if (nextBtn) nextBtn.click();
    `);
    await wait(3000);

    // Type password
    await evaluateJS(sendCmd, `
      const passInput = document.querySelector('input[type="password"]');
      if (passInput) { passInput.value = '${params.password}'; passInput.dispatchEvent(new Event('input', {bubbles: true})); }
    `);
    await wait(1000);
    await evaluateJS(sendCmd, `
      const passNext = document.querySelector('#passwordNext button');
      if (passNext) passNext.click();
    `);
    await wait(5000);
  }

  // Download the video and trigger file input
  await evaluateJS(sendCmd, `
    (async () => {
      const resp = await fetch('${params.videoUrl}');
      const blob = await resp.blob();
      const file = new File([blob], 'video.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('input[type="file"]');
      if (input) {
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);
  await wait(8000);

  // Fill title
  await evaluateJS(sendCmd, `
    const titleInput = document.querySelector('#textbox[aria-label*="title"], ytcp-social-suggestions-textbox #textbox');
    if (titleInput) {
      titleInput.textContent = '';
      titleInput.innerText = '${params.title.replace(/'/g, "\\'")}';
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await wait(1000);

  // Fill description
  if (params.description) {
    await evaluateJS(sendCmd, `
      const descInputs = document.querySelectorAll('#textbox');
      const descInput = descInputs[1] || descInputs[0];
      if (descInput) {
        descInput.textContent = '';
        descInput.innerText = '${params.description.replace(/'/g, "\\'")}';
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
  }
  await wait(2000);

  // Click through the wizard (Next buttons) 
  for (let i = 0; i < 3; i++) {
    await evaluateJS(sendCmd, `
      const nextBtn = document.querySelector('#next-button button, ytcp-button#next-button');
      if (nextBtn) nextBtn.click();
    `);
    await wait(2000);
  }

  // Set to public
  await evaluateJS(sendCmd, `
    const publicRadio = document.querySelector('tp-yt-paper-radio-button[name="PUBLIC"]');
    if (publicRadio) publicRadio.click();
  `);
  await wait(1000);

  // Click done/publish
  await evaluateJS(sendCmd, `
    const doneBtn = document.querySelector('#done-button button, ytcp-button#done-button');
    if (doneBtn) doneBtn.click();
  `);
  await wait(5000);

  // Try to get the video URL
  const videoLink = await evaluateJS(sendCmd, `
    const link = document.querySelector('a.style-scope.ytcp-video-info[href*="youtu"]');
    link ? link.href : '';
  `);

  return {
    url: videoLink || undefined,
    message: videoLink ? `YouTube upload complete: ${videoLink}` : 'YouTube upload initiated — check Studio for status.',
  };
}

// --- TikTok Automation ---
async function automateTikTok(
  sendCmd: SendCmd,
  wait: Wait,
  params: { videoUrl: string; title: string; description: string; tags: string[]; email: string; password: string }
): Promise<{ url?: string; message: string }> {
  await sendCmd('Page.navigate', { url: 'https://www.tiktok.com/creator#/upload?scene=creator_center' });
  await wait(5000);

  const currentUrl = await evaluateJS(sendCmd, 'window.location.href');

  if (currentUrl.includes('login') || currentUrl.includes('signin')) {
    throw new Error('TikTok login required. Please log in via the cloud browser first, then retry. Session will persist for future uploads.');
  }

  // Upload file via fetch + file input
  await evaluateJS(sendCmd, `
    (async () => {
      const resp = await fetch('${params.videoUrl}');
      const blob = await resp.blob();
      const file = new File([blob], 'video.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('input[type="file"][accept*="video"]') || document.querySelector('input[type="file"]');
      if (input) {
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);
  await wait(10000);

  // Fill caption
  const caption = `${params.title} ${params.description} ${params.tags.map(t => `#${t}`).join(' ')}`.trim();
  await evaluateJS(sendCmd, `
    const editor = document.querySelector('[contenteditable="true"]') || document.querySelector('.DraftEditor-root [contenteditable]');
    if (editor) {
      editor.focus();
      editor.textContent = '${caption.replace(/'/g, "\\'")}';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await wait(2000);

  // Click post button
  await evaluateJS(sendCmd, `
    const postBtn = document.querySelector('button[data-e2e="post_video_button"]') || 
                    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Post'));
    if (postBtn) postBtn.click();
  `);
  await wait(5000);

  return { message: 'TikTok upload initiated — check your TikTok profile for the new video.' };
}

// --- Instagram Automation ---
async function automateInstagram(
  sendCmd: SendCmd,
  wait: Wait,
  params: { videoUrl: string; title: string; description: string; tags: string[]; email: string; password: string }
): Promise<{ url?: string; message: string }> {
  await sendCmd('Page.navigate', { url: 'https://www.instagram.com/' });
  await wait(5000);

  const currentUrl = await evaluateJS(sendCmd, 'window.location.href');

  if (currentUrl.includes('login') || currentUrl.includes('accounts/login')) {
    if (!params.email || !params.password) {
      throw new Error('Instagram login required but no credentials provided.');
    }

    await evaluateJS(sendCmd, `
      const userInput = document.querySelector('input[name="username"]');
      if (userInput) { userInput.value = '${params.email}'; userInput.dispatchEvent(new Event('input', {bubbles: true})); }
    `);
    await wait(500);
    await evaluateJS(sendCmd, `
      const passInput = document.querySelector('input[name="password"]');
      if (passInput) { passInput.value = '${params.password}'; passInput.dispatchEvent(new Event('input', {bubbles: true})); }
    `);
    await wait(500);
    await evaluateJS(sendCmd, `
      const loginBtn = document.querySelector('button[type="submit"]');
      if (loginBtn) loginBtn.click();
    `);
    await wait(5000);
  }

  // Click create/new post button
  await evaluateJS(sendCmd, `
    const createBtn = document.querySelector('[aria-label="New post"]') || 
                      document.querySelector('svg[aria-label="New post"]')?.closest('div[role="button"]');
    if (createBtn) createBtn.click();
  `);
  await wait(2000);

  // Upload file
  await evaluateJS(sendCmd, `
    (async () => {
      const resp = await fetch('${params.videoUrl}');
      const blob = await resp.blob();
      const file = new File([blob], 'video.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('input[type="file"][accept*="video"]') || document.querySelector('input[type="file"]');
      if (input) {
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);
  await wait(8000);

  // Click Next (crop step)
  await evaluateJS(sendCmd, `
    const nextBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(b => b.textContent?.trim() === 'Next');
    if (nextBtn) nextBtn.click();
  `);
  await wait(2000);

  // Click Next again (filter step)
  await evaluateJS(sendCmd, `
    const nextBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(b => b.textContent?.trim() === 'Next');
    if (nextBtn) nextBtn.click();
  `);
  await wait(2000);

  // Fill caption
  const caption = `${params.title}\n\n${params.description}\n\n${params.tags.map(t => `#${t}`).join(' ')}`.trim();
  await evaluateJS(sendCmd, `
    const captionArea = document.querySelector('textarea[aria-label="Write a caption..."]') || document.querySelector('[contenteditable="true"]');
    if (captionArea) {
      captionArea.value = '${caption.replace(/'/g, "\\'").replace(/\n/g, '\\n')}';
      captionArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await wait(1000);

  // Click Share
  await evaluateJS(sendCmd, `
    const shareBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(b => b.textContent?.trim() === 'Share');
    if (shareBtn) shareBtn.click();
  `);
  await wait(5000);

  return { message: 'Instagram upload initiated — check your Instagram profile for the new reel.' };
}
