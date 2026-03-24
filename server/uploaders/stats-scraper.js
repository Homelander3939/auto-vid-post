// Stats scraper — scrapes video stats from YouTube Shorts, TikTok, and Instagram Reels
// using an existing Playwright page/context (reuses browser session from uploaders).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ─── YouTube Shorts Stats ───────────────────────────────────
async function scrapeYouTubeShortsStats(page, { maxVideos = 10 } = {}) {
  console.log('[Stats] Scraping YouTube Shorts stats...');
  try {
    // Navigate to YouTube Studio content page filtered to Shorts
    await page.goto('https://studio.youtube.com/channel/UC/videos/short', { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
      // Fallback: go to content page and filter
      await page.goto('https://studio.youtube.com/channel/UC/videos/upload', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    });
    await page.waitForTimeout(3000);

    // If the filtered URL didn't work, try the main content page
    const currentUrl = page.url();
    if (!currentUrl.includes('studio.youtube.com')) {
      await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      // Click Content in sidebar
      await page.evaluate(() => {
        const links = document.querySelectorAll('a, [role="tab"], tp-yt-paper-tab');
        for (const link of links) {
          const text = (link.textContent || '').toLowerCase();
          if (text.includes('content') || text.includes('videos')) {
            link.click();
            return true;
          }
        }
        return false;
      });
      await page.waitForTimeout(3000);
    }

    // Try to click "Shorts" tab if available
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"], tp-yt-paper-tab, a');
      for (const tab of tabs) {
        const text = (tab.textContent || '').toLowerCase().trim();
        if (text === 'shorts') {
          tab.click();
          return true;
        }
      }
      return false;
    });
    await page.waitForTimeout(2000);

    // Extract stats from the video list table
    const stats = await page.evaluate((max) => {
      const results = [];
      // YouTube Studio uses a table with rows for each video
      const rows = document.querySelectorAll('ytcp-video-row, tr.video-row, [class*="video-row"], table tbody tr');
      
      for (const row of rows) {
        if (results.length >= max) break;
        
        const titleEl = row.querySelector('a#video-title, [id="video-title"], .video-title, a[href*="/video/"]');
        const title = (titleEl?.textContent || '').trim();
        if (!title) continue;

        // Extract metrics - YouTube Studio shows views, comments, likes in columns
        const cells = row.querySelectorAll('td, .cell-content, [class*="cell"]');
        const allText = Array.from(cells).map(c => (c.textContent || '').trim());
        
        // Try to find numeric values that represent views, comments, likes
        const numbers = [];
        for (const cellText of allText) {
          const cleaned = cellText.replace(/[,\s]/g, '');
          if (/^\d+(\.\d+)?[KMBkmb]?$/.test(cleaned)) {
            numbers.push(cellText.trim());
          }
        }

        // Also try aria-labels or tooltips which often have exact counts
        const ariaValues = Array.from(row.querySelectorAll('[aria-label]'))
          .map(el => el.getAttribute('aria-label') || '')
          .filter(v => /\d/.test(v));

        const href = titleEl?.getAttribute('href') || '';
        const videoId = href.match(/\/video\/([a-zA-Z0-9_-]+)/)?.[1] || '';
        const url = videoId ? `https://youtube.com/shorts/${videoId}` : '';

        results.push({
          title,
          url,
          views: numbers[0] || '—',
          comments: numbers[1] || '—',
          likes: numbers[2] || '—',
          rawNumbers: numbers,
          ariaHints: ariaValues.slice(0, 5),
        });
      }
      return results;
    }, maxVideos);

    // If Studio table didn't yield results, try the public channel page
    if (stats.length === 0) {
      return await scrapeYouTubeShortsPublic(page, maxVideos);
    }

    console.log(`[Stats] Found ${stats.length} YouTube videos`);
    return stats;
  } catch (err) {
    console.error('[Stats] YouTube scrape error:', err.message);
    return [];
  }
}

async function scrapeYouTubeShortsPublic(page, maxVideos = 10) {
  try {
    // Try navigating to channel's Shorts tab via YouTube (not Studio)
    // First get the channel URL from Studio
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    const channelUrl = await page.evaluate(() => {
      // Look for channel link in Studio
      const links = document.querySelectorAll('a[href*="youtube.com/channel/"], a[href*="youtube.com/@"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (href.includes('youtube.com')) return href;
      }
      // Try getting from avatar/profile area
      const avatar = document.querySelector('#avatar-btn, .channel-header a, a[href*="/@"]');
      return avatar?.getAttribute('href') || '';
    });

    if (channelUrl) {
      const shortsUrl = channelUrl.replace(/\/?$/, '/shorts');
      await page.goto(shortsUrl.startsWith('http') ? shortsUrl : `https://www.youtube.com${shortsUrl}`, {
        waitUntil: 'networkidle',
        timeout: 20000,
      });
      await page.waitForTimeout(3000);

      return await page.evaluate((max) => {
        const results = [];
        const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer');
        
        for (const item of items) {
          if (results.length >= max) break;
          const titleEl = item.querySelector('#video-title, a#video-title, h3 a, [id="video-title"]');
          const title = (titleEl?.textContent || '').trim();
          if (!title) continue;

          const viewsEl = item.querySelector('#metadata-line span, .inline-metadata-item, ytd-video-meta-block span');
          const views = (viewsEl?.textContent || '').trim();

          const href = (titleEl?.getAttribute('href') || item.querySelector('a')?.getAttribute('href') || '');
          const url = href.startsWith('http') ? href : href ? `https://www.youtube.com${href}` : '';

          results.push({ title, url, views: views || '—', comments: '—', likes: '—' });
        }
        return results;
      }, maxVideos);
    }

    return [];
  } catch (err) {
    console.error('[Stats] YouTube public scrape error:', err.message);
    return [];
  }
}

// ─── TikTok Stats ───────────────────────────────────────────
async function scrapeTikTokStats(page, { maxVideos = 10 } = {}) {
  console.log('[Stats] Scraping TikTok stats...');
  try {
    // Navigate to TikTok analytics/profile
    await page.goto('https://www.tiktok.com/creator-center/analytics', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // If analytics page loaded, try to get video stats
    let stats = await page.evaluate((max) => {
      const results = [];
      // Try analytics content tab
      const videoItems = document.querySelectorAll('[class*="video-card"], [class*="VideoCard"], [data-e2e*="video"]');
      
      for (const item of videoItems) {
        if (results.length >= max) break;
        const title = (item.querySelector('[class*="title"], [class*="desc"], p, span')?.textContent || '').trim();
        const viewsEl = item.querySelector('[class*="views"], [class*="play"]');
        const views = (viewsEl?.textContent || '').trim();
        
        if (title || views) {
          results.push({ title: title || '(untitled)', views: views || '—', likes: '—', comments: '—', url: '' });
        }
      }
      return results;
    }, maxVideos);

    // Fallback: go to profile page
    if (stats.length === 0) {
      await page.goto('https://www.tiktok.com/profile', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(3000);

      stats = await page.evaluate((max) => {
        const results = [];
        const videoItems = document.querySelectorAll('[data-e2e="user-post-item"], [class*="DivItemContainer"], [class*="video-feed-item"]');
        
        for (const item of videoItems) {
          if (results.length >= max) break;
          const desc = (item.getAttribute('aria-label') || item.querySelector('[class*="desc"]')?.textContent || '').trim();
          const viewsEl = item.querySelector('[data-e2e="video-views"], [class*="video-count"], strong');
          const views = (viewsEl?.textContent || '').trim();
          const link = item.querySelector('a')?.getAttribute('href') || '';
          const url = link.startsWith('http') ? link : link ? `https://www.tiktok.com${link}` : '';

          results.push({ title: desc || '(untitled)', views: views || '—', likes: '—', comments: '—', url });
        }
        return results;
      }, maxVideos);
    }

    console.log(`[Stats] Found ${stats.length} TikTok videos`);
    return stats;
  } catch (err) {
    console.error('[Stats] TikTok scrape error:', err.message);
    return [];
  }
}

// ─── Instagram Reels Stats ──────────────────────────────────
async function scrapeInstagramReelsStats(page, { maxVideos = 10 } = {}) {
  console.log('[Stats] Scraping Instagram Reels stats...');
  try {
    // Navigate to profile reels tab
    // First get username
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Click profile
    await page.evaluate(() => {
      const profileLink = document.querySelector('a[href*="/"][role="link"] img[alt*="profile"]')?.closest('a') 
        || document.querySelector('[aria-label="Profile"]')
        || Array.from(document.querySelectorAll('a[role="link"]')).find(a => {
          const svg = a.querySelector('svg[aria-label="Profile"]');
          return !!svg;
        });
      if (profileLink) profileLink.click();
    });
    await page.waitForTimeout(3000);

    // Click Reels tab
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('a[role="tab"], a[href*="/reels/"]');
      for (const tab of tabs) {
        const text = (tab.textContent || '').toLowerCase();
        const href = tab.getAttribute('href') || '';
        if (text.includes('reels') || href.includes('/reels')) {
          tab.click();
          return true;
        }
      }
      // Also try SVG-based tab
      const svgTab = document.querySelector('svg[aria-label="Reels"]')?.closest('a');
      if (svgTab) svgTab.click();
      return false;
    });
    await page.waitForTimeout(3000);

    const stats = await page.evaluate((max) => {
      const results = [];
      const items = document.querySelectorAll('article a[href*="/reel/"], div[class*="reel"] a, a[href*="/p/"]');
      
      for (const item of items) {
        if (results.length >= max) break;
        const href = item.getAttribute('href') || '';
        if (!href.includes('/reel/') && !href.includes('/p/')) continue;
        
        const url = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
        
        // Instagram shows play count on hover - try to get from aria/overlay
        const overlay = item.querySelector('[class*="overlay"], [class*="count"]');
        const views = (overlay?.textContent || '').trim();
        
        const img = item.querySelector('img');
        const title = img?.getAttribute('alt') || '(reel)';

        results.push({ title: title.slice(0, 80), url, views: views || '—', likes: '—', comments: '—' });
      }
      return results;
    }, maxVideos);

    console.log(`[Stats] Found ${stats.length} Instagram reels`);
    return stats;
  } catch (err) {
    console.error('[Stats] Instagram scrape error:', err.message);
    return [];
  }
}

// ─── Format stats for Telegram message ──────────────────────
function formatStatsForTelegram(platform, stats) {
  if (!stats || stats.length === 0) return `📊 ${platform}: No videos found`;

  const sectionName = platform === 'YouTube' ? 'Shorts' : platform === 'Instagram' ? 'Reels' : 'Videos';
  let msg = `📊 <b>${platform} ${sectionName} (last ${stats.length})</b>\n\n`;
  
  stats.forEach((v, i) => {
    const title = (v.title || '(untitled)').slice(0, 50);
    msg += `${i + 1}. ${title}\n`;
    msg += `   👁 ${v.views}`;
    if (v.likes !== '—') msg += ` | ❤️ ${v.likes}`;
    if (v.comments !== '—') msg += ` | 💬 ${v.comments}`;
    msg += '\n';
    if (v.url) msg += `   🔗 ${v.url}\n`;
    msg += '\n';
  });

  return msg.trim();
}

// ─── Standalone stats checker (opens its own browser) ───────
async function checkPlatformStats(platform, credentials) {
  const sessionDirs = {
    youtube: path.join(__dirname, '..', 'data', 'browser-sessions', 'youtube'),
    tiktok: path.join(__dirname, '..', 'data', 'browser-sessions', 'tiktok'),
    instagram: path.join(__dirname, '..', 'data', 'browser-sessions', 'instagram'),
  };

  const sessionDir = sessionDirs[platform];
  if (!sessionDir) throw new Error(`Unknown platform: ${platform}`);
  
  fs.mkdirSync(sessionDir, { recursive: true });

  console.log(`[Stats] Opening browser for ${platform} stats check...`);
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    let stats = [];
    
    if (platform === 'youtube') {
      stats = await scrapeYouTubeShortsStats(page, { maxVideos: 20 });
    } else if (platform === 'tiktok') {
      stats = await scrapeTikTokStats(page, { maxVideos: 20 });
    } else if (platform === 'instagram') {
      stats = await scrapeInstagramReelsStats(page, { maxVideos: 20 });
    }

    await context.close();
    return stats;
  } catch (err) {
    console.error(`[Stats] ${platform} stats check failed:`, err.message);
    await context.close();
    throw err;
  }
}

module.exports = {
  scrapeYouTubeShortsStats,
  scrapeTikTokStats,
  scrapeInstagramReelsStats,
  checkPlatformStats,
  formatStatsForTelegram,
};
