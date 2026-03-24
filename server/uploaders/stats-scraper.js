// Stats scraper — scrapes video stats from YouTube Shorts, TikTok, and Instagram Reels
// using an existing Playwright page/context (reuses browser session from uploaders).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ─── YouTube Shorts Stats ───────────────────────────────────
async function scrapeYouTubeShortsStats(page, { maxVideos = 10 } = {}) {
  console.log('[Stats] Scraping YouTube Shorts stats...');
  try {
    // Navigate to YouTube Studio and resolve the real channel ID from the URL.
    // (The placeholder "/channel/UC" does not work — we need the actual ID.)
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Extract the channel ID from the Studio URL (format: /channel/UCXXXXXXX)
    const studioChannelId = await page.evaluate(() => {
      const m = window.location.href.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
      return m ? m[1] : '';
    }).catch(() => '');

    // Also grab the handle/vanity URL for the public Shorts page fallback
    const channelHandle = await page.evaluate(() => {
      // Look for the @handle link in the Studio sidebar or header
      const links = Array.from(document.querySelectorAll('a[href*="youtube.com/@"], a[href*="/@"]'));
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/@([^/?&]+)/);
        if (m) return '@' + m[1];
      }
      return '';
    }).catch(() => '');

    if (studioChannelId) {
      // Navigate to the Studio content page filtered to Shorts
      await page.goto(
        `https://studio.youtube.com/channel/${studioChannelId}/videos?filter=%5B%7B%22name%22%3A%22VIDEO_TYPE%22%2C%22value%22%3A%22VIDEO_TYPE_SHORT%22%7D%5D`,
        { waitUntil: 'networkidle', timeout: 30000 }
      ).catch(async () => {
        // Fallback: plain content page
        await page.goto(`https://studio.youtube.com/channel/${studioChannelId}/videos`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      });
      await page.waitForTimeout(3000);

      // Try to click "Shorts" tab if available
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[role="tab"], tp-yt-paper-tab, a');
        for (const tab of tabs) {
          const text = (tab.textContent || '').toLowerCase().trim();
          if (text === 'shorts') { tab.click(); return true; }
        }
        return false;
      });
      await page.waitForTimeout(2000);
    } else {
      // No channel ID found in URL — fall back to content page via sidebar click
      await page.evaluate(() => {
        const links = document.querySelectorAll('a, [role="tab"], tp-yt-paper-tab');
        for (const link of links) {
          const text = (link.textContent || '').toLowerCase();
          if (text.includes('content') || text.includes('videos')) { link.click(); return true; }
        }
        return false;
      });
      await page.waitForTimeout(3000);
    }

    // Extract stats from the video list table
    const stats = await page.evaluate((max) => {
      const results = [];
      const rows = document.querySelectorAll('ytcp-video-row, tr.video-row, [class*="video-row"], table tbody tr');

      for (const row of rows) {
        if (results.length >= max) break;

        const titleEl = row.querySelector('a#video-title, [id="video-title"], .video-title, a[href*="/video/"]');
        const title = (titleEl?.textContent || '').trim();
        if (!title) continue;

        const cells = row.querySelectorAll('td, .cell-content, [class*="cell"]');
        const allText = Array.from(cells).map(c => (c.textContent || '').trim());

        const numbers = [];
        for (const cellText of allText) {
          const cleaned = cellText.replace(/[,\s]/g, '');
          if (/^\d+(\.\d+)?[KMBkmb]?$/.test(cleaned)) numbers.push(cellText.trim());
        }

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

    if (stats.length > 0) {
      console.log(`[Stats] Found ${stats.length} YouTube videos (Studio)`);
      return stats;
    }

    // Studio table yielded nothing — fall back to public Shorts page
    return await scrapeYouTubeShortsPublic(page, maxVideos, channelHandle, studioChannelId);
  } catch (err) {
    console.error('[Stats] YouTube scrape error:', err.message);
    return [];
  }
}

async function scrapeYouTubeShortsPublic(page, maxVideos = 10, channelHandle = '', channelId = '') {
  try {
    // Build the public Shorts URL from available identifiers.
    // Prefer the @handle format; fall back to channel ID; fall back to detecting from Studio.
    let shortsUrl = '';

    if (channelHandle) {
      shortsUrl = `https://www.youtube.com/${channelHandle}/shorts`;
    } else if (channelId) {
      shortsUrl = `https://www.youtube.com/channel/${channelId}/shorts`;
    } else {
      // Last resort: navigate to Studio and pick up the channel link from the page
      await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);

      const detected = await page.evaluate(() => {
        // @handle links in the Studio sidebar / header
        const links = Array.from(document.querySelectorAll('a[href*="youtube.com/@"], a[href*="/@"]'));
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          if (href.startsWith('https://www.youtube.com/') || href.startsWith('https://studio.youtube.com/') || href.startsWith('/')) return href;
        }
        // Numeric channel ID links
        const chanLinks = document.querySelectorAll('a[href*="youtube.com/channel/"], a[href*="/channel/UC"]');
        for (const link of chanLinks) {
          const href = link.getAttribute('href') || '';
          if (href) return href;
        }
        return '';
      });

      if (detected) {
        const base = detected.startsWith('http') ? detected : `https://www.youtube.com${detected}`;
        shortsUrl = base.replace(/\/?$/, '/shorts');
      }
    }

    if (!shortsUrl) {
      console.warn('[Stats] Could not determine channel URL for public Shorts page');
      return [];
    }

    console.log(`[Stats] Navigating to public Shorts page: ${shortsUrl}`);
    await page.goto(shortsUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const results = await page.evaluate((max) => {
      const items = document.querySelectorAll(
        'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, ytd-shorts-item-renderer'
      );
      const out = [];
      for (const item of items) {
        if (out.length >= max) break;
        const titleEl = item.querySelector('#video-title, a#video-title, h3 a, [id="video-title"]');
        const title = (titleEl?.textContent || '').trim();
        if (!title) continue;

        // Views are shown below the title on the public page
        const viewsEl = item.querySelector(
          '#metadata-line span, .inline-metadata-item, ytd-video-meta-block span, [class*="metadata"] span'
        );
        const views = (viewsEl?.textContent || '').trim();

        const href = titleEl?.getAttribute('href') || item.querySelector('a')?.getAttribute('href') || '';
        const url = href.startsWith('http') ? href : href ? `https://www.youtube.com${href}` : '';

        out.push({ title, url, views: views || '—', comments: '—', likes: '—' });
      }
      return out;
    }, maxVideos);

    console.log(`[Stats] Found ${results.length} YouTube videos (public Shorts page)`);
    return results;
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
