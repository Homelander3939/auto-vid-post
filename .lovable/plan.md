

## Cloud Resource Analysis & Optimization Plan

### What's Consuming Your $13.65 / $25 Free Cloud Balance

Your Lovable Cloud costs come from three categories:

#### 1. **AI Gateway calls (~$0.44 of $1 AI balance used)**
These edge functions call `ai.gateway.lovable.dev`:
- **`ai-chat`** — AI Chat page in the web UI
- **`telegram-ai-bot`** — Telegram bot AI responses (tool-calling, multi-turn)
- **`cloud-browser-upload`** — AI vision for cloud-mode browser automation

#### 2. **Edge Function invocations + compute (~main Cloud cost driver)**
Every edge function call costs compute time:
- **`process-uploads`** — triggered automatically from Dashboard on each upload
- **`send-telegram`** — every notification (upload success, test messages)
- **`cloud-browser-upload`** — long-running cloud browser sessions (biggest cost per call)
- **`cloud-browser-status`** — polling for Browserbase session status
- **`telegram-ai-bot`** — webhook for every Telegram message

#### 3. **Database + Storage**
- Database reads/writes for `upload_jobs`, `scheduled_uploads`, `schedule_config`, `app_settings`, `telegram_messages`
- Video file storage in the `videos` bucket (used by AI Chat file uploads)

---

### How to Stay Within $25/month Even at 300 Videos

Since you use **Local Mode** (Playwright on your PC), the most expensive cloud features are already bypassed. Here's the breakdown:

| Resource | Current Use | Cost Impact | Action Needed |
|----------|------------|-------------|---------------|
| Cloud browser uploads | Only in cloud mode | **HIGH** | You already use local mode — no change needed |
| AI Chat (web UI) | Each message = AI call | **MEDIUM** | Minimal use, or move to LM Studio |
| Telegram AI bot | Each Telegram msg = AI call | **MEDIUM** | Already uses Gemini Flash (cheapest). Consider routing to LM Studio |
| send-telegram | Per notification | **LOW** | ~$0.001 per call, 300/mo = negligible |
| process-uploads | Polls for pending jobs | **LOW** | Only runs in cloud mode |
| Database ops | CRUD on job tables | **VERY LOW** | Negligible even at 300 videos |
| Storage | Only for AI Chat file uploads | **LOW** | Videos go direct to platforms, not stored in cloud |

### Recommended Changes

1. **Route Telegram AI bot through LM Studio instead of Lovable AI Gateway**
   - The `telegram-ai-bot` edge function currently calls `ai.gateway.lovable.dev` (costs AI credits)
   - Change it to call your local LM Studio (`http://192.168.50.33:1234`) directly
   - Problem: Edge functions run in the cloud and can't reach your local network
   - Solution: Either (a) expose LM Studio via a tunnel (Cloudflare Tunnel / ngrok) or (b) move Telegram bot processing to your local server which already has LM Studio access

2. **Move AI Chat to use LM Studio locally**
   - The `ai-chat` edge function also calls the AI Gateway
   - Same solution: route through your local server's LM Studio endpoint

3. **Keep `send-telegram` as-is** — it's cheap (just forwards messages via the Telegram connector gateway, no AI involved)

4. **Keep database as-is** — reads/writes are negligible cost

5. **Never use Cloud Mode** — Browserbase sessions are by far the most expensive resource. Local Playwright is free.

### Projected Cost at 300 Videos/Month (After Optimization)

| Resource | Monthly Cost |
|----------|-------------|
| Edge function calls (send-telegram × ~900 calls) | ~$0.50–1.00 |
| Database operations | ~$0.10–0.30 |
| Storage | ~$0 (videos not stored in cloud) |
| AI Gateway | ~$0 (routed to LM Studio) |
| **Total** | **~$1–2/month** |

### Implementation Steps

1. **Move Telegram AI bot logic to local server** — your `server/index.js` already has LM Studio integration. Add a Telegram webhook handler there that processes AI conversations locally instead of through the edge function. The edge function would just forward incoming webhooks to your local server.

2. **Move AI Chat to call LM Studio** — update the web UI's AI Chat page to call your local server's LM Studio endpoint directly (or via a simple proxy endpoint on your local server) instead of invoking the `ai-chat` edge function.

3. **No other changes needed** — everything else (uploads, scheduling, notifications) already runs locally or costs negligibly.

