import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'jimothy.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS sightings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lat           REAL,                        -- nullable: media-only posts (feed) have no location
    lng           REAL,                        -- a row shows on the MAP only when both are set
    seen_at       TEXT NOT NULL,              -- ISO 8601 datetime of the sighting
    notes         TEXT,                        -- free-text description
    photo_url     TEXT,                        -- displayable media (image, or video poster/thumbnail)
    media_type    TEXT NOT NULL DEFAULT 'image',-- 'image' | 'video'
    reporter      TEXT,                        -- optional display name
    source        TEXT NOT NULL DEFAULT 'user',-- 'user' | 'instagram' | 'x' | ...
    source_url    TEXT,                        -- link back to the original post, if scraped
    source_ref    TEXT,                        -- external id, used to dedupe ingested posts
    location_note TEXT,                        -- how location was derived: 'map' | 'exif' | 'geocode'
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source, source_ref)
  );

  CREATE INDEX IF NOT EXISTS idx_sightings_seen_at ON sightings(seen_at);
`);

// Migrate databases created before media_type existed.
const info0 = db.prepare('PRAGMA table_info(sightings)').all();
if (!info0.some((c) => c.name === 'media_type')) {
  db.exec("ALTER TABLE sightings ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'");
}

// Migrate databases where lat/lng were NOT NULL (before media-only feed rows).
// SQLite can't drop a NOT NULL constraint in place, so rebuild the table.
const latCol = db.prepare('PRAGMA table_info(sightings)').all().find((c) => c.name === 'lat');
if (latCol && latCol.notnull === 1) {
  db.exec(`
    BEGIN;
    CREATE TABLE sightings_rebuild (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL, lng REAL,
      seen_at TEXT NOT NULL, notes TEXT, photo_url TEXT,
      media_type TEXT NOT NULL DEFAULT 'image', reporter TEXT,
      source TEXT NOT NULL DEFAULT 'user', source_url TEXT, source_ref TEXT,
      location_note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, source_ref)
    );
    INSERT INTO sightings_rebuild
      (id, lat, lng, seen_at, notes, photo_url, media_type, reporter, source, source_url, source_ref, location_note, created_at)
    SELECT
      id, lat, lng, seen_at, notes, photo_url, media_type, reporter, source, source_url, source_ref, location_note, created_at
    FROM sightings;
    DROP TABLE sightings;
    ALTER TABLE sightings_rebuild RENAME TO sightings;
    CREATE INDEX IF NOT EXISTS idx_sightings_seen_at ON sightings(seen_at);
    COMMIT;
  `);
}

export function addSighting(s) {
  const stmt = db.prepare(`
    INSERT INTO sightings
      (lat, lng, seen_at, notes, photo_url, media_type, reporter, source, source_url, source_ref, location_note)
    VALUES
      (@lat, @lng, @seen_at, @notes, @photo_url, @media_type, @reporter, @source, @source_url, @source_ref, @location_note)
    ON CONFLICT(source, source_ref) DO NOTHING
  `);
  const info = stmt.run({
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    seen_at: s.seen_at,
    notes: s.notes ?? null,
    photo_url: s.photo_url ?? null,
    media_type: s.media_type ?? 'image',
    reporter: s.reporter ?? null,
    source: s.source ?? 'user',
    source_url: s.source_url ?? null,
    source_ref: s.source_ref ?? null,
    location_note: s.location_note ?? null,
  });
  return info.changes > 0 ? info.lastInsertRowid : null;
}

export function listSightings({ since, until, hasMedia, hasCoords } = {}) {
  let sql = 'SELECT * FROM sightings';
  const clauses = [];
  const params = {};
  if (since) { clauses.push('seen_at >= @since'); params.since = since; }
  if (until) { clauses.push('seen_at <= @until'); params.until = until; }
  if (hasMedia) clauses.push("photo_url IS NOT NULL AND photo_url != ''");
  if (hasCoords) clauses.push('lat IS NOT NULL AND lng IS NOT NULL');
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY seen_at DESC';
  return db.prepare(sql).all(params);
}

export function getSighting(id) {
  return db.prepare('SELECT * FROM sightings WHERE id = ?').get(id);
}

export default db;
