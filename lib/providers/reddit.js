/**
 * Reddit ingestion provider — headless-browser scraper.
 *
 * Reddit shut down free API access, so this drives a real (headless) Chromium
 * via Playwright to read PUBLIC subreddit search pages, the same ones you'd see
 * in a browser. Design goals: low volume, robust parsing, graceful failure.
 *
 * ── Honest caveats ─────────────────────────────────────────────────────────
 *  - Automated access is against Reddit's User Agreement. This is built for a
 *    low-volume (twice-a-day) community project; run it from your own machine
 *    and don't crank up the frequency. Worst case Reddit rate-limits your IP.
 *  - Scraping breaks when Reddit changes their markup. To stay robust we first
 *    ask the browser to fetch the *JSON* listing (a stable, documented shape);
 *    only if that's blocked do we fall back to scraping old.reddit HTML.
 *  - Datacenter IPs are often blocked outright; a residential IP (your home
 *    machine) works far more reliably.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Config via env (all optional):
 *   REDDIT_SUBREDDITS  comma list, default "Seattle,SeattleWA"
 *   REDDIT_QUERY       search terms, default "jimothy raccoon"
 *   REDDIT_LIMIT       max posts per subreddit (default 25)
 *   REDDIT_USER_AGENT  browser UA string
 *   REDDIT_HEADFUL=1   show the browser window (useful for debugging blocks)
 */
import { chromium } from 'playwright';

const UA = process.env.REDDIT_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
   + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_SUBS = (process.env.REDDIT_SUBREDDITS || 'Seattle,SeattleWA')
  .split(',').map((s) => s.trim()).filter(Boolean);

const QUERY = process.env.REDDIT_QUERY || 'jimothy raccoon';
const LIMIT = Number(process.env.REDDIT_LIMIT) || 25;
const HEADFUL = process.env.REDDIT_HEADFUL === '1';

// Only keep posts that actually look like they're about the raccoon.
const RELEVANCE = /\b(jimothy|raccoon|racoon|trash panda)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @returns {Promise<import('../ingest.js').RawPost[]>}
 */
export default async function redditProvider({
  subreddits = DEFAULT_SUBS,
  query = QUERY,
  limit = LIMIT,
} = {}) {
  const browser = await chromium.launch({ headless: !HEADFUL });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();
  // Don't waste bandwidth on fonts/media while scraping text listings.
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'font' || type === 'media') return route.abort();
    return route.continue();
  });

  const seen = new Set();
  const posts = [];

  try {
    for (const sub of subreddits) {
      let batch = [];
      try {
        batch = await scrapeSubreddit(page, sub, query, limit);
      } catch (err) {
        console.warn(`  reddit r/${sub}: ${err.message}`);
      }
      for (const p of batch) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        posts.push(p);
      }
      await sleep(1500 + Math.random() * 1500); // jittered pause between subs
    }
  } finally {
    await browser.close();
  }

  return posts;
}

/**
 * Scrape one subreddit. Tries the JSON listing first (robust), then falls back
 * to scraping the HTML search results if JSON is blocked or empty.
 */
async function scrapeSubreddit(page, sub, query, limit) {
  // Land on the subreddit first so the in-page fetch carries real browser
  // context (cookies, headers) instead of looking like a bare bot request.
  const landing = `https://old.reddit.com/r/${encodeURIComponent(sub)}/`;
  const resp = await page.goto(landing, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (resp && resp.status() === 403) {
    throw new Error('HTTP 403 (blocked — try a residential IP or REDDIT_HEADFUL=1)');
  }
  if (await isBlocked(page)) {
    throw new Error('hit a login/robot wall');
  }

  // 1. Preferred: fetch the JSON search listing from inside the page.
  const jsonUrl = `${landing}search.json?q=${encodeURIComponent(query)}`
    + `&restrict_sr=1&sort=new&limit=${limit}&t=all`;
  const result = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { headers: { Accept: 'application/json' } });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: 0, body: String(e) };
    }
  }, jsonUrl);

  if (result.status === 200) {
    try {
      const json = JSON.parse(result.body);
      const parsed = parseListing(json);
      if (parsed.length) return parsed;
    } catch { /* fall through to HTML scrape */ }
  }

  // 2. Fallback: scrape the rendered HTML search page.
  const htmlUrl = `${landing}search?q=${encodeURIComponent(query)}`
    + '&restrict_sr=on&sort=new&t=all';
  await page.goto(htmlUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (await isBlocked(page)) throw new Error('search page blocked');
  return scrapeHtml(page, limit);
}

/** Detect Reddit's "you're a robot" / login interstitials. */
async function isBlocked(page) {
  const text = (await page.title()) + ' ' + page.url();
  if (/\/login|blocked|whoa there/i.test(text)) return true;
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '');
  return /whoa there, pardner|you'?re a robot|too many requests/i.test(body);
}

/**
 * Map a Reddit listing JSON object to RawPost[]. Pure/testable — no browser.
 * @param {any} json  parsed response of a Reddit `.json` listing
 * @returns {import('../ingest.js').RawPost[]}
 */
export function parseListing(json) {
  const out = [];
  for (const child of json?.data?.children ?? []) {
    const d = child?.data;
    if (!d || d.id == null) continue;
    const text = `${d.title ?? ''} ${d.selftext ?? ''}`.trim();
    if (!RELEVANCE.test(text)) continue;
    out.push({
      id: `reddit_${d.id}`,
      source: 'reddit',
      url: `https://www.reddit.com${d.permalink}`,
      text,
      createdAt: new Date((d.created_utc ?? Date.now() / 1000) * 1000).toISOString(),
      author: d.author,
      photoUrl: extractImage(d),
      mediaType: isVideo(d) ? 'video' : 'image',
    });
  }
  return out;
}

/** Scrape old.reddit HTML search results as a fallback. Runs in the page. */
async function scrapeHtml(page, limit) {
  const raw = await page.$$eval('.search-result-link, div.link[data-fullname]', (els) => els.map((el) => {
    const a = el.querySelector('a.search-title, a.title');
    const timeEl = el.querySelector('time');
    const authorEl = el.querySelector('.author');
    const img = el.querySelector('.thumbnail img');
    const thumbHref = el.querySelector('a.thumbnail')?.getAttribute('href') || '';
    return {
      fullname: el.getAttribute('data-fullname') || '',
      title: a?.textContent?.trim() || '',
      href: a?.getAttribute('href') || '',
      datetime: timeEl?.getAttribute('datetime') || '',
      author: authorEl?.textContent?.trim() || '',
      thumb: img?.getAttribute('src') || '',
      classes: el.className,
      thumbHref,
    };
  }));

  const out = [];
  for (const r of raw.slice(0, limit)) {
    if (!RELEVANCE.test(r.title)) continue;
    const id = r.fullname ? r.fullname.replace(/^t3_/, 'reddit_') : `reddit_${hash(r.href)}`;
    let thumb = r.thumb;
    if (thumb && thumb.startsWith('//')) thumb = 'https:' + thumb;
    const video = /video|youtube|youtu\.be|v\.redd\.it|tiktok/i.test(r.classes + ' ' + r.thumbHref);
    out.push({
      id,
      source: 'reddit',
      url: absolute(r.href),
      text: r.title,
      createdAt: r.datetime ? new Date(r.datetime).toISOString() : new Date().toISOString(),
      author: r.author || undefined,
      photoUrl: thumb && thumb.startsWith('http') ? thumb : undefined,
      mediaType: video ? 'video' : 'image',
    });
  }
  return out;
}

// --- shared pure helpers ---------------------------------------------------

/** Does this Reddit post carry a video (v.redd.it, gifv, or embedded)? */
export function isVideo(d) {
  if (d.is_video) return true;
  if (d.post_hint === 'rich:video' || d.post_hint === 'hosted:video') return true;
  if (typeof d.url === 'string'
      && /\.(mp4|gifv)(\?|$)|v\.redd\.it|youtube\.com|youtu\.be|tiktok\.com/i.test(d.url)) {
    return true;
  }
  return false;
}

/** Best-effort displayable image/poster URL from a Reddit post's many shapes. */
export function extractImage(d) {
  if (typeof d.url === 'string' && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(d.url)) {
    return d.url;
  }
  const preview = d.preview?.images?.[0]?.source?.url;
  if (preview) return decodeHtml(preview);
  if (d.is_gallery && d.media_metadata) {
    const first = Object.values(d.media_metadata)[0];
    const u = first?.s?.u || first?.s?.gif;
    if (u) return decodeHtml(u);
  }
  if (typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http')) {
    return d.thumbnail;
  }
  return undefined;
}

function decodeHtml(s) { return s.replace(/&amp;/g, '&'); }
function absolute(href) {
  if (!href) return 'https://www.reddit.com';
  if (href.startsWith('http')) return href;
  return `https://www.reddit.com${href}`;
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
