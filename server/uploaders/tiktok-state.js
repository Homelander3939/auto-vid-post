function normalizeUrl(url = '') {
  return String(url || '').toLowerCase();
}

function isTikTokUploadUrl(url = '') {
  const lowerUrl = normalizeUrl(url);
  return (
    lowerUrl.includes('tiktok.com/tiktokstudio/upload') ||
    lowerUrl.includes('tiktok.com/creator-center/upload') ||
    lowerUrl.includes('tiktok.com/upload')
  );
}

function isTikTokManageUrl(url = '') {
  const lowerUrl = normalizeUrl(url);
  return lowerUrl.includes('tiktok.com/tiktokstudio/content') || lowerUrl.includes('/manage');
}

function isTikTokVideoUrl(url = '') {
  return /tiktok\.com\/@[^/]+\/video\/\d+/i.test(String(url || ''));
}

function isTikTokPublishedUrl(url = '') {
  return isTikTokManageUrl(url) || isTikTokVideoUrl(url);
}

function getTikTokPageDescription(url = '') {
  const lowerUrl = normalizeUrl(url);

  if (isTikTokVideoUrl(url)) return 'TikTok published video page';
  if (isTikTokManageUrl(url)) return 'TikTok Studio content page';
  if (isTikTokUploadUrl(url)) return 'TikTok Studio upload page';
  if (lowerUrl.includes('tiktok.com/tiktokstudio')) return 'TikTok Studio dashboard';
  return 'TikTok page';
}

module.exports = {
  getTikTokPageDescription,
  isTikTokManageUrl,
  isTikTokPublishedUrl,
  isTikTokUploadUrl,
  isTikTokVideoUrl,
};
