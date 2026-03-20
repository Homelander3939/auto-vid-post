

## Problem Analysis

1. **Campaign "Saving..." hangs**: The `CampaignScheduler.saveAll()` uploads the video file to storage first (`uploadVideoFile`), which can be slow for large files. But the real issue is that after saving to `scheduled_uploads`, nothing triggers immediate processing — scheduled uploads only run when their `scheduled_at` time passes and the local server's cron picks them up. The user expected them to appear in the Upload Queue immediately, but they go to `scheduled_uploads` table (separate from `upload_jobs`).

2. **Schedule page is disconnected**: The `/schedule` page only configures a global recurring cron schedule (frequency/platforms). It has no way to plan individual scheduled uploads with folder paths, duration controls, or specific timing. The `CampaignScheduler` component (which does individual scheduling) lives only in the Dashboard's "Campaign" tab.

3. **Missing duration controls**: No way to set how long a recurring schedule runs (X days/hours/weeks). The cron just runs forever once enabled.

## Plan

### 1. Fix Campaign Scheduler — ensure jobs appear in Upload Queue

- When a campaign entry's `scheduled_at` is in the past or within 1 minute, create the `upload_job` immediately (same as single upload) instead of only saving to `scheduled_uploads`.
- For future-dated entries, save to `scheduled_uploads` as now — the local server cron already converts them to `upload_jobs` when due.
- After saving, trigger local server `/api/process-pending` (same as single upload does) so immediate jobs start right away.
- Add error handling and timeout feedback so "Saving..." doesn't hang forever.

### 2. Merge Schedule page with Campaign Scheduler

- Restructure the Schedule page into two sections:
  - **Recurring Schedule**: the existing frequency/platform/cron config (keep as-is).
  - **Scheduled Uploads**: embed the `CampaignScheduler` component here so users can plan individual uploads with specific dates from this page too.
- Add duration controls to the recurring schedule: "Run for X days/hours/weeks" with an optional end date, stored in `schedule_config`. The local server cron checks this and stops processing after the end date.

### 3. Add folder path support to Schedule page recurring cron

- Add a folder path input to the recurring schedule config (stored in `schedule_config` table).
- When the cron fires, the local server reads the folder path from schedule config, scans for latest video + txt, creates an upload job automatically.
- Migration: add `folder_path` and `end_at` columns to `schedule_config`.

### 4. Local server — handle both scheduled_uploads and recurring cron with folder

- `processScheduledUploads()`: already works, no major changes needed.
- Add `processRecurringSchedule()`: reads `schedule_config`, checks if enabled + not past end date, scans folder, creates job, processes it.
- Both run in the existing 1-minute cron loop.

### 5. Campaign saveAll reliability

- Add a timeout wrapper around `uploadVideoFile` with user feedback.
- Show progress state ("Uploading video 1/3...", "Creating schedule...") instead of just "Saving...".
- If video upload fails, show clear error and don't hang.

### Files to modify

- `src/pages/Schedule.tsx` — add CampaignScheduler embed + duration controls + folder path
- `src/components/CampaignScheduler.tsx` — fix immediate-job creation for past/near-future entries, add progress feedback
- `src/lib/storage.ts` — add `folder_path` and `end_at` to ScheduleConfig, update save/get
- `server/index.js` — add `processRecurringSchedule()` using folder from schedule_config
- Migration: add `folder_path` (text) and `end_at` (timestamptz) columns to `schedule_config`

