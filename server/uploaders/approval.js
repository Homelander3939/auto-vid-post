const fetch = require('node-fetch');
const { sendTelegram, sendTelegramPhoto } = require('../telegram');

function parseApprovalCommand(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const normalized = text.toLowerCase();
  const compact = normalized.replace(/\s+/g, ' ').trim();
  const approvedWords = ['approve', 'approved', 'ok', 'done', 'yes', 'continue'];
  if (approvedWords.some((w) => normalized === w || normalized.includes(` ${w}`) || normalized.startsWith(`${w} `))) {
    return { approved: true };
  }

  const codePatterns = [
    /\bcode\s*[:=\-]?\s*([a-zA-Z0-9\-]{4,12})\b/i,
    /\botp\s*[:=\-]?\s*([0-9]{4,8})\b/i,
    /\b([0-9]{4,8})\b/,
  ];

  for (const pattern of codePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return { approved: true, code: match[1] };
  }

  const phoneMethodWords = ['method phone', 'method device', 'google prompt', 'use phone', 'phone', 'device'];
  if (phoneMethodWords.some((w) => compact === w || compact.includes(w))) {
    return { method: 'phone' };
  }

  const codeMethodWords = ['method code', 'method otp', 'use code', 'verification code', 'otp', 'code'];
  if (codeMethodWords.some((w) => compact === w || compact.includes(w))) {
    return { method: 'code' };
  }

  return null;
}

async function fetchApprovalFromTelegramUpdates({ telegram, startedAt, seenUpdateIds }) {
  if (!telegram?.botToken || !telegram?.chatId) return null;

  const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/getUpdates`, { method: 'GET' });
  if (!response.ok) return null;

  const data = await response.json();
  const updates = Array.isArray(data?.result) ? data.result : [];

  for (const update of updates) {
    if (!update?.update_id || seenUpdateIds.has(update.update_id)) continue;
    seenUpdateIds.add(update.update_id);

    const message = update.message;
    if (!message?.text) continue;
    if (String(message.chat?.id) !== String(telegram.chatId)) continue;

    const msgTsMs = Number(message.date || 0) * 1000;
    if (msgTsMs && msgTsMs < startedAt - 10000) continue;

    const parsed = parseApprovalCommand(message.text);
    if (parsed) return parsed;
  }

  return null;
}

async function fetchApprovalFromBackendMessages({ telegram, backend, sinceIso }) {
  if (!backend?.supabaseUrl || !backend?.supabaseKey || !telegram?.chatId) return null;

  const params = new URLSearchParams({
    select: 'text,created_at',
    is_bot: 'eq.false',
    chat_id: `eq.${String(telegram.chatId).trim()}`,
    created_at: `gte.${sinceIso}`,
    order: 'created_at.desc',
    limit: '30',
  });

  const response = await fetch(`${backend.supabaseUrl}/rest/v1/telegram_messages?${params.toString()}`, {
    method: 'GET',
    headers: {
      apikey: backend.supabaseKey,
      Authorization: `Bearer ${backend.supabaseKey}`,
    },
  });

  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const parsed = parseApprovalCommand(row?.text || '');
    if (parsed) return parsed;
  }

  return null;
}

async function requestTelegramApproval({ telegram, platform, customMessage, timeoutMs = 240000, screenshotBuffer, screenshotCaption, backend }) {
  if (!telegram?.enabled || !telegram?.chatId) return null;

  const startedAt = Date.now();
  const sinceIso = new Date(startedAt - 3000).toISOString();
  const seenUpdateIds = new Set();

  // Send the notification — use custom message if provided, otherwise default
  const message = customMessage || (
    `🔐 <b>${platform}</b> login needs verification.\n` +
    `Please approve sign-in on your phone.\n` +
    `Then reply here with:\n` +
    `• APPROVED\n` +
    `or\n` +
    `• CODE 123456`
  );

  await sendTelegram(telegram.botToken, telegram.chatId, message, backend)
    .catch((e) => console.error('[Approval] Telegram notify failed:', e?.message || e));

  if (screenshotBuffer) {
    const caption = screenshotCaption || `📸 <b>${platform}</b> screen captured — review and reply in Telegram to continue`;
    await sendTelegramPhoto(
      telegram.botToken,
      telegram.chatId,
      screenshotBuffer,
      caption,
      backend,
    ).catch((e) => console.error('[Approval] Telegram screenshot failed:', e?.message || e));
  }

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const parsedViaBot = await fetchApprovalFromTelegramUpdates({ telegram, startedAt, seenUpdateIds });
      if (parsedViaBot) return parsedViaBot;

      const parsedViaBackend = await fetchApprovalFromBackendMessages({ telegram, backend, sinceIso });
      if (parsedViaBackend) return parsedViaBackend;
    } catch (e) {
      console.error('[Approval] Polling failed:', e?.message || e);
    }

    await new Promise((r) => setTimeout(r, 4000));
  }

  return null;
}

async function tryFillVerificationCode(page, code) {
  if (!code) return false;

  const inputSelectors = [
    'input[type="tel"]',
    'input[autocomplete="one-time-code"]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[aria-label*="code" i]',
    'input[name="verificationCode"]',
    'input[name="security_code"]',
  ];

  let filled = false;
  for (const selector of inputSelectors) {
    const el = await page.$(selector);
    if (!el) continue;
    await el.click().catch(() => {});
    await el.fill(code).catch(() => {});
    filled = true;
    break;
  }

  if (!filled) return false;

  const nextSelectors = [
    '#totpNext button',
    '#idvPreregisteredPhoneNext button',
    '#idvAnyPhonePinNext button',
    '#next button',
    'button[type="submit"]',
    'button:has-text("Next")',
    'button:has-text("Verify")',
    'button:has-text("Confirm")',
  ];

  for (const selector of nextSelectors) {
    const btn = await page.$(selector);
    if (!btn) continue;
    await btn.click().catch(() => {});
    await page.waitForTimeout(800);
    break;
  }

  return true;
}

module.exports = { requestTelegramApproval, tryFillVerificationCode };
