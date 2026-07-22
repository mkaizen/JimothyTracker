// Scrape social posts and POST the results to the LIVE site's /api/ingest.
//
// Runs on the machine that can drive Chromium (your PC), NOT on the shared
// host. It does the geocoding locally, then ships finished sightings up so the
// server just has to store them.
//
//   node scripts/ingest-remote.js            # default: reddit
//   node scripts/ingest-remote.js reddit     # a specific provider
//
// Requires two env vars (put them in .env — auto-loaded via `npm run ingest:remote`):
//   INGEST_URL    e.g. https://jimothytracker.com/api/ingest
//   INGEST_TOKEN  the same secret you set in the server's environment
import { providers, resolvePosts } from '../lib/ingest.js';

const INGEST_URL = process.env.INGEST_URL;
const INGEST_TOKEN = process.env.INGEST_TOKEN;

if (!INGEST_URL || !INGEST_TOKEN) {
  console.error('Missing INGEST_URL and/or INGEST_TOKEN. Set them in .env (see .env.example).');
  process.exit(1);
}

const only = process.argv[2];
const names = only ? [only] : ['reddit']; // don't post the `sample` fixtures by default

const allSightings = [];
let scraped = 0, skipped = 0;

for (const name of names) {
  const provider = providers[name];
  if (!provider) { console.warn(`No provider named "${name}".`); continue; }
  console.log(`▶ scraping ${name}…`);
  try {
    const posts = await provider();
    const { sightings, skipped: sk } = await resolvePosts(posts);
    scraped += posts.length;
    skipped += sk;
    allSightings.push(...sightings);
    console.log(`  ${posts.length} scraped → ${sightings.length} resolved, ${sk} skipped`);
  } catch (err) {
    console.error(`  provider "${name}" failed: ${err.message}`);
  }
}

if (!allSightings.length) {
  console.log('Nothing to post.');
  process.exit(0);
}

console.log(`\nPosting ${allSightings.length} sighting(s) to ${INGEST_URL} …`);
try {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': INGEST_TOKEN },
    body: JSON.stringify({ sightings: allSightings }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Ingest failed: HTTP ${res.status} ${data.error || ''}`);
    process.exit(1);
  }
  console.log(`Done. Server added ${data.added}, duplicates ${data.duplicates}, invalid ${data.invalid} (of ${data.received}).`);
} catch (err) {
  console.error(`Could not reach ${INGEST_URL}: ${err.message}`);
  process.exit(1);
}
