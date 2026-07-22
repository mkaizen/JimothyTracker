// Run an ingestion pass: pull posts from each configured provider and store
// any that resolve to a Seattle location.
//
//   node scripts/ingest.js            # runs all providers
//   node scripts/ingest.js sample     # runs one provider by name
//
// Out of the box only the `sample` provider exists (no credentials needed).
// Add real API-backed providers in lib/ingest.js and they'll be picked up.
import { ingestPosts, providers } from '../lib/ingest.js';

const only = process.argv[2];
const names = only ? [only] : Object.keys(providers);

let totalAdded = 0, totalSkipped = 0;
for (const name of names) {
  const provider = providers[name];
  if (!provider) { console.warn(`No provider named "${name}".`); continue; }
  console.log(`\n▶ ${name}…`);
  try {
    const posts = await provider();
    const { added, skipped, details } = await ingestPosts(posts);
    totalAdded += added; totalSkipped += skipped;
    console.log(`  ${added} added, ${skipped} skipped`);
    for (const d of details) console.log(`   - ${d.id}: ${d.status}${d.reason ? ` (${d.reason})` : ''}`);
  } catch (err) {
    console.error(`  provider "${name}" failed:`, err.message);
  }
}

console.log(`\nDone. ${totalAdded} added, ${totalSkipped} skipped total.`);

// Let the process exit on its own once fetch's keep-alive sockets time out,
// rather than calling process.exit(), which can trigger a libuv teardown
// assertion on Windows when connections are still open. `unref`-ing nothing
// is needed; the event loop drains within a few seconds.
