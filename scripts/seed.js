// Seed the map with a handful of demo sightings around Seattle so the app
// isn't empty on first run. Safe to run repeatedly (uses source_ref dedupe).
import { addSighting } from '../db.js';

const now = Date.now();
const hrs = (h) => new Date(now - h * 3600e3).toISOString();

const demo = [
  { lat: 47.6456, lng: -122.3344, seen_at: hrs(3),  notes: 'Raiding a picnic table at Gas Works Park.', reporter: 'raccoonwatch',
    photo_url: '/jimothy-placeholder.svg', media_type: 'image' },
  { lat: 47.6097, lng: -122.3422, seen_at: hrs(20), notes: 'Strolling past Pike Place like he owns it.', reporter: 'marketvendor',
    photo_url: '/jimothy-placeholder.svg', media_type: 'video', source: 'reddit', source_url: 'https://www.reddit.com/r/Seattle/' },
  { lat: 47.6205, lng: -122.3212, seen_at: hrs(45), notes: 'Napping in a tree by Cal Anderson Park.', reporter: 'capitolhillian' },
  { lat: 47.6684, lng: -122.3835, seen_at: hrs(70), notes: 'Spotted near the Ballard Locks at dusk.', reporter: 'anonymous' },
  { lat: 47.6205, lng: -122.3493, seen_at: hrs(96), notes: 'Under the Space Needle, unbothered.', reporter: 'touristcam',
    photo_url: '/jimothy-placeholder.svg', media_type: 'image' },
];

let added = 0;
demo.forEach((d, i) => {
  const id = addSighting({ ...d, source: d.source ?? 'seed', source_ref: `demo_${i}`, location_note: 'map' });
  if (id) added++;
});

console.log(`Seeded ${added} demo sighting(s).`);
