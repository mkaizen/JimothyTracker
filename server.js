import express from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { addSighting, listSightings } from './db.js';
import { extractExifLocation, geocodeText, inSeattle, SEATTLE_CENTER } from './lib/geo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = join(__dirname, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB (allow short clips)
  fileFilter: (_req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

const app = express();
app.use(express.json({ limit: '1mb' })); // ingest batches are small, but give headroom
app.use(express.static(join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// --- API ------------------------------------------------------------------

app.get('/api/config', (_req, res) => {
  res.json({ center: SEATTLE_CENTER });
});

// Map sightings: only rows with coordinates (media-only posts live in the feed).
app.get('/api/sightings', (req, res) => {
  const { since, until, has_media } = req.query;
  res.json(listSightings({
    since, until,
    hasMedia: has_media === '1' || has_media === 'true',
    hasCoords: true,
  }));
});

// Media feed: every sighting that has an image/video, newest first.
app.get('/api/feed', (_req, res) => {
  res.json(listSightings({ hasMedia: true }));
});

app.get('/feed', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'feed.html'));
});

/**
 * Ingest endpoint for the off-server scraper (e.g. your home PC). The scraper
 * does the geocoding and POSTs finished sightings here so the server just
 * stores them. Protected by a shared secret in the INGEST_TOKEN env var; if
 * that isn't set, the endpoint is disabled entirely.
 *
 * POST JSON: { "sightings": [ { seen_at, source, source_ref, lat?, lng?,
 *   notes?, photo_url?, media_type?, reporter?, source_url?, location_note? } ] }
 * Header:    X-Ingest-Token: <secret>
 */
app.post('/api/ingest', (req, res) => {
  const secret = process.env.INGEST_TOKEN;
  if (!secret) return res.status(503).json({ error: 'Ingest disabled: INGEST_TOKEN not set on server.' });
  if (req.get('X-Ingest-Token') !== secret) return res.status(401).json({ error: 'Invalid ingest token.' });

  const sightings = Array.isArray(req.body?.sightings) ? req.body.sightings : null;
  if (!sightings) return res.status(400).json({ error: 'Body must be { sightings: [...] }.' });

  let added = 0, duplicates = 0, invalid = 0;
  for (const s of sightings) {
    if (!s || typeof s.seen_at !== 'string' || !s.source || !s.source_ref) { invalid++; continue; }

    const lat = Number.isFinite(s.lat) ? s.lat : null;
    const lng = Number.isFinite(s.lng) ? s.lng : null;
    const mapped = lat != null && lng != null && inSeattle(lat, lng);

    const id = addSighting({
      lat: mapped ? lat : null,
      lng: mapped ? lng : null,
      seen_at: s.seen_at,
      notes: typeof s.notes === 'string' ? s.notes.slice(0, 500) : null,
      photo_url: typeof s.photo_url === 'string' ? s.photo_url : null,
      media_type: s.media_type === 'video' ? 'video' : 'image',
      reporter: typeof s.reporter === 'string' ? s.reporter.slice(0, 120) : null,
      source: String(s.source).slice(0, 40),
      source_url: typeof s.source_url === 'string' ? s.source_url : null,
      source_ref: String(s.source_ref).slice(0, 200),
      location_note: mapped ? (s.location_note || 'geocode') : 'feed-only',
    });
    if (id) added++; else duplicates++;
  }

  res.json({ received: sightings.length, added, duplicates, invalid });
});

/**
 * Report a sighting. Accepts multipart/form-data:
 *   photo      (file, optional)
 *   seen_at    (ISO datetime, required)
 *   notes, reporter, location_text  (optional)
 *   lat, lng   (optional — from clicking the map)
 *
 * Location resolution order: explicit map coords > photo EXIF GPS > geocoded
 * text. Rejects the report if none of those land inside the Seattle box.
 */
app.post('/api/sightings', upload.single('photo'), async (req, res) => {
  try {
    const { seen_at, notes, reporter, location_text } = req.body;
    if (!seen_at) return res.status(400).json({ error: 'seen_at is required' });

    let lat = req.body.lat ? parseFloat(req.body.lat) : null;
    let lng = req.body.lng ? parseFloat(req.body.lng) : null;
    let location_note = lat != null && lng != null ? 'map' : null;

    const isVideo = req.file ? /^video\//.test(req.file.mimetype) : false;

    // Try EXIF GPS from the uploaded photo (images only — video has no EXIF GPS here).
    if ((lat == null || lng == null) && req.file && !isVideo) {
      const exif = await extractExifLocation(req.file.path);
      if (exif) { ({ lat, lng } = exif); location_note = 'exif'; }
    }

    // Fall back to geocoding the typed location.
    if ((lat == null || lng == null) && location_text) {
      const geo = await geocodeText(location_text);
      if (geo) { lat = geo.lat; lng = geo.lng; location_note = 'geocode'; }
    }

    if (lat == null || lng == null) {
      return res.status(422).json({
        error: 'Could not determine a location. Click the map, upload a geotagged photo, or type a place.',
      });
    }
    if (!inSeattle(lat, lng)) {
      return res.status(422).json({ error: 'That spot is outside the Seattle area.' });
    }

    const photo_url = req.file ? `/uploads/${req.file.filename}` : (req.body.photo_url || null);
    const media_type = isVideo ? 'video' : 'image';

    const id = addSighting({
      lat, lng, seen_at, notes, reporter, photo_url, media_type,
      source: 'user', location_note,
    });

    res.status(201).json({ id, lat, lng, location_note });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong saving the sighting.' });
  }
});

app.listen(PORT, () => {
  console.log(`🦝 Jimothy Tracker running at http://localhost:${PORT}`);
});
