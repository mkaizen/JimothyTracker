/**
 * Ingestion pipeline for turning a "public post about Jimothy" into a sighting.
 *
 * ── Reality check ─────────────────────────────────────────────────────────
 * Directly scraping Instagram / TikTok / X violates their Terms of Service,
 * gets your IP blocked, and breaks whenever they change their markup. The
 * durable path is each platform's OFFICIAL API (developer key + app review):
 *   - Instagram Graph API (Hashtag Search) — business/creator accounts only
 *   - X (Twitter) API v2 — recent search, paid tiers
 *   - Reddit — no free API anymore; we scrape public pages with a headless
 *     browser instead (see lib/providers/reddit.js)
 *   - Mastodon / Bluesky — open APIs, easiest to start with
 *
 * Also: platforms STRIP EXIF GPS from uploaded photos, so you almost never
 * recover real camera coordinates from a downloaded social image. Location
 * therefore comes from, in order of reliability:
 *   1. A geotag / place attached to the post (if the API returns one)
 *   2. Text in the caption we can geocode ("spotted him at Gas Works Park")
 *   3. Nothing — in which case we SKIP rather than guess.
 *
 * This module is the seam. Each "provider" is a function that yields raw
 * posts in a normal shape; `ingestPosts` normalizes + geolocates + stores
 * them. Plug a real API-backed provider into `providers` when you have keys.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { addSighting } from '../db.js';
import { geocodeText, inSeattle } from './geo.js';
import redditProvider from './providers/reddit.js';

/**
 * @typedef {Object} RawPost
 * @property {string} id            Stable per-platform id (used to dedupe)
 * @property {string} source        'reddit' | 'instagram' | 'x' | 'mastodon' | ...
 * @property {string} url           Permalink to the original post
 * @property {string} text          Caption / body text
 * @property {string} createdAt     ISO datetime the post was made
 * @property {string} [author]      Display name / handle
 * @property {string} [photoUrl]    Displayable image URL (video poster/thumbnail for videos)
 * @property {'image'|'video'} [mediaType]  Defaults to 'image'
 * @property {{lat:number,lng:number}} [place]  Geotag from the platform, if any
 */

/**
 * Turn a batch of raw posts into stored sightings.
 * @param {RawPost[]} posts
 * @returns {Promise<{added:number, skipped:number, details:Array}>}
 */
export async function ingestPosts(posts) {
  let added = 0, skipped = 0;
  const details = [];

  for (const post of posts) {
    let loc = null;
    let locationNote = null;

    // 1. Prefer a real geotag from the platform.
    if (post.place && Number.isFinite(post.place.lat) && Number.isFinite(post.place.lng)) {
      loc = { lat: post.place.lat, lng: post.place.lng };
      locationNote = 'geotag';
    }

    // 2. Otherwise try to geocode a place named in the caption.
    if (!loc && post.text) {
      const guess = await geocodeText(guessPlacePhrase(post.text));
      if (guess) {
        loc = { lat: guess.lat, lng: guess.lng };
        locationNote = 'geocode';
      }
      await sleep(1100); // be polite to Nominatim (~1 req/sec)
    }

    // A trustworthy location must be inside Seattle to earn a map pin.
    const mapped = loc && inSeattle(loc.lat, loc.lng);

    // 3. No location AND no media → nothing to show anywhere; skip.
    if (!mapped && !post.photoUrl) {
      skipped++;
      details.push({ id: post.id, status: 'skipped', reason: loc ? 'outside-seattle' : 'no-location' });
      continue;
    }

    // Located posts get a pin; media-only posts are stored coord-less for the
    // feed (they won't appear on the map, which filters out null coordinates).
    const rowId = addSighting({
      lat: mapped ? loc.lat : null,
      lng: mapped ? loc.lng : null,
      seen_at: post.createdAt,
      notes: post.text?.slice(0, 500) ?? null,
      photo_url: post.photoUrl ?? null,
      media_type: post.mediaType ?? 'image',
      reporter: post.author ?? null,
      source: post.source,
      source_url: post.url,
      source_ref: post.id,
      location_note: mapped ? locationNote : 'feed-only',
    });

    if (rowId) {
      added++;
      details.push({ id: post.id, status: mapped ? 'added' : 'added (feed-only)', rowId });
    } else {
      skipped++;
      details.push({ id: post.id, status: 'duplicate' });
    }
  }

  return { added, skipped, details };
}

/**
 * Naive heuristic: pull a likely place phrase out of a caption so we can
 * geocode it. Looks for "at/near/by/@ <Place>" patterns; falls back to the
 * whole (short) caption. Replace with a real NER model if you want better.
 */
export function guessPlacePhrase(text) {
  const m = text.match(/\b(?:at|near|by|around|@)\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,4})/);
  if (m) return `${m[1]}, Seattle`;
  return text.length <= 60 ? `${text}, Seattle` : text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Provider registry. A provider is `async (opts) => RawPost[]`.
 *
 * - `reddit` searches Seattle-area subreddits via Reddit's public JSON API
 *   (no credentials needed; see lib/providers/reddit.js for env config).
 * - `sample` returns a couple of fixture posts so the pipeline is runnable
 *   even if Reddit is unreachable.
 *
 * Add more providers (Bluesky, Mastodon, official Instagram/X APIs) here and
 * `scripts/ingest.js` picks them up automatically.
 */
export const providers = {
  reddit: redditProvider,

  async sample() {
    const now = Date.now();
    return [
      {
        id: 'sample_1',
        source: 'sample',
        url: 'https://example.com/post/1',
        text: 'Jimothy spotted at Gas Works Park raiding a picnic! 🦝',
        createdAt: new Date(now - 2 * 3600e3).toISOString(),
        author: 'raccoonwatch',
      },
      {
        id: 'sample_2',
        source: 'sample',
        url: 'https://example.com/post/2',
        text: 'the legend himself near Pike Place Market tonight',
        createdAt: new Date(now - 26 * 3600e3).toISOString(),
        author: 'seattlecritters',
      },
    ];
  },
};
