import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getTikTokPageDescription,
  isTikTokPublishedUrl,
  isTikTokUploadUrl,
} = require('../../server/uploaders/tiktok-state.js');

describe('tiktok-state helpers', () => {
  it('recognizes TikTok Studio content and video URLs as published states', () => {
    expect(isTikTokPublishedUrl('https://www.tiktok.com/tiktokstudio/content')).toBe(true);
    expect(isTikTokPublishedUrl('https://www.tiktok.com/@creator/video/7495959595959595959')).toBe(true);
    expect(getTikTokPageDescription('https://www.tiktok.com/tiktokstudio/content')).toBe('TikTok Studio content page');
  });

  it('recognizes TikTok Studio upload URLs', () => {
    expect(isTikTokUploadUrl('https://www.tiktok.com/tiktokstudio/upload')).toBe(true);
    expect(getTikTokPageDescription('https://www.tiktok.com/tiktokstudio/upload')).toBe('TikTok Studio upload page');
  });
});
