

## Plan: Integrate Browserbase for Cloud Browser Automation

### Overview
Add a **Cloud Mode** to the app that uses Browserbase's remote browsers for video uploads, so you don't need the local server running. Local mode remains unchanged.

### Architecture

```text
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Upload Job      │────▶│  process-uploads  │────▶│  Browserbase   │
│  (pending)       │     │  Edge Function    │     │  Remote Browser│
│  mode: cloud     │     │  Creates session  │     │  (Playwright)  │
└─────────────────┘     │  Sends CDP cmds   │     └───────────────┘
                        └──────────────────┘
```

### Steps

**1. Store Browserbase credentials as secrets**
- Add `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` as runtime secrets via the secrets tool
- These will be available in edge functions

**2. Add upload mode to database**
- Add `upload_mode` column (`local` or `cloud`) to `app_settings` table
- Default: `local` (current behavior)

**3. Update Settings UI**
- Add a mode toggle card at the top of Settings: **Local Mode** vs **Cloud Mode**
- Local mode: shows current setup (folder path, Playwright credentials info)
- Cloud mode: shows Browserbase connection status, no local server needed
- Both modes share the same platform credentials (YouTube/TikTok/Instagram login)

**4. Create `cloud-browser-upload` edge function**
- Uses Browserbase REST API to create a browser session (`POST https://api.browserbase.com/v1/sessions`)
- Connects to the browser via WebSocket CDP (Chrome DevTools Protocol)
- Implements upload automation for each platform using raw CDP commands:
  - Navigate to platform upload page
  - Fill in credentials if needed
  - Upload video file (download from Supabase storage, pass to browser)
  - Fill metadata (title, description, tags)
  - Click publish
- Returns success/failure with video URL
- Uses Browserbase's **Contexts** feature to persist login sessions between uploads

**5. Update `process-uploads` edge function**
- Check `upload_mode` from settings
- If `cloud`: invoke `cloud-browser-upload` function for each platform
- If `local`: keep current behavior (API-based uploads or wait for local server)

**6. Update AI assistant context**
- AI can tell user which mode is active
- AI can switch modes via tool calls

### Technical Details

**CDP over WebSocket in Deno:**
- Browserbase returns a `connectUrl` (WebSocket) when creating a session
- Use native Deno `WebSocket` to connect
- Send CDP commands: `Page.navigate`, `Runtime.evaluate`, `DOM.querySelector`, `Input.dispatchMouseEvent`, etc.
- Handle file uploads via `Page.setFileInputFiles` CDP method

**Session persistence with Browserbase Contexts:**
- Create a context per platform (YouTube, TikTok, Instagram)
- Store context IDs in `app_settings` so login sessions persist across uploads
- No need to re-login every time

**Platform upload flows (CDP-based):**
Each platform upload follows: navigate → check login → login if needed → upload file → fill metadata → publish. Same logic as local Playwright scripts but using CDP commands.

### Files to create/modify
- **New**: `supabase/functions/cloud-browser-upload/index.ts` — Browserbase CDP automation
- **Modify**: `supabase/functions/process-uploads/index.ts` — route to cloud or local
- **Modify**: `src/pages/SettingsPage.tsx` — add mode toggle
- **Modify**: `src/lib/storage.ts` — add upload_mode to AppSettings
- **Migration**: add `upload_mode` column to `app_settings`

