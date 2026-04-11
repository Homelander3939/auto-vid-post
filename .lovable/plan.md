

## Plan: Fix Instagram Caption Not Persisting After Share

### Problem
The caption text visually appears in the Instagram caption field during upload, but disappears from the published post. This indicates the text is rendered in the DOM but **not properly registered in Instagram's internal DraftJS/React state**. When "Share" is clicked, Instagram reads from its internal state (which is empty) and publishes without caption.

### Root Cause Analysis
Instagram's caption field is a **DraftJS contenteditable** editor. DraftJS maintains its own internal `EditorState` that is separate from the DOM. Methods like `element.textContent = ...` or even `ClipboardEvent` dispatch can update the visible DOM without updating DraftJS's internal model. When Share is clicked, Instagram serializes from its internal state, not the DOM.

The current code tries multiple strategies but likely hits false-positive verification: it checks if `textContent` or `value` has content, but that only proves the DOM was updated — not that DraftJS accepted the input.

### Fix Strategy

**File: `server/uploaders/instagram.js` (Phase 5 caption filling)**

1. **Use Playwright's clipboard API for reliable paste** — Instead of manually constructing a `ClipboardEvent` (which DraftJS may ignore because `clipboardData` is read-only in some browsers), use Playwright's built-in clipboard:
   - Focus the caption field
   - Use `page.evaluate(() => navigator.clipboard.writeText(text))` to set clipboard
   - Then use `page.keyboard.press('Control+v')` to trigger a real paste that DraftJS processes natively

2. **Add a post-fill settle + re-verify step** — After filling, wait 1.5s, then click somewhere neutral in the dialog (e.g. the video preview area), then click back on the caption field and check its content. This forces DraftJS to flush any pending state updates and reveals whether the text was actually persisted in internal state.

3. **Improve keyboard.type fallback** — Increase the per-character delay from 20ms to 35ms, and add intermediate verification every ~500 chars to ensure DraftJS is keeping up. If text stops appearing, re-focus and continue.

4. **Add a final caption verification before Share** — Right before clicking Share, read the caption field content one more time. If it's empty despite earlier success, retry the fill with keyboard.type as a last resort.

### Technical Details

- The primary change targets lines ~1686-1760 (ClipboardEvent paste strategy) and adds a pre-Share verification around line ~1855
- The `page.keyboard.press('Control+v')` approach generates real browser-level keyboard events that DraftJS handles through its native paste handler, unlike synthetic `ClipboardEvent` which can be rejected
- No changes to any other uploader (YouTube, TikTok) or to the upload flow phases (login, create, crop, share)
- Caption length limit (2200 chars) remains unchanged

