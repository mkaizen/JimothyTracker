# 🦝 Jimothy Tracker

A community map of sightings of **Jimothy**, Seattle's viral raccoon. Drop a
pin where you saw him with a date/time, notes, and a photo — and browse
everywhere he's been spotted.

## Features

- 🗺️ **Interactive Seattle map** (Leaflet + OpenStreetMap — no paid API keys).
- 📍 **Report a sighting** by clicking the map, typing a place name, or
  uploading a photo.
- 🧭 **Automatic location resolution**, in order of trust:
  1. Coordinates from clicking the map
  2. **GPS from the photo's EXIF metadata** (works on original files)
  3. **Geocoding** a typed place via OpenStreetMap Nominatim
- 🧾 **Recent sightings** list, synced with the map.
- 🖼️ **Media feed** (`/feed`) — a grid of every photo & video of Jimothy, with
  a "Videos only" filter, source badges, links to the original post, and a
  "📍 On the map" deep link (shown only for posts that have a location).

### Map vs. feed

A scraped post only lands on the **map** if a place it names geocodes inside
Seattle. But most Jimothy content is fan art and news with no location — so
those posts are stored **coord-less** and appear in the **feed only** (the map
filters out rows without coordinates). In short: everything with media shows in
the feed; only located posts get a pin.
- 🔌 **Pluggable ingestion pipeline** for pulling in public social posts
  (see [Ingesting social posts](#ingesting-social-posts) — read the caveats).

## Stack

| Piece    | Choice                                                    |
|----------|-----------------------------------------------------------|
| Server   | Node.js + Express                                         |
| Database | **Built-in `node:sqlite`** (no native build step)         |
| Uploads  | multer → `uploads/`                                       |
| EXIF     | `exifr`                                                   |
| Scraper  | Playwright (headless Chromium)                            |
| Frontend | Vanilla JS + Leaflet (CDN)                                |

> Uses Node's built-in SQLite, so **no C++ compiler / Visual Studio needed** —
> requires **Node 22.5+** (developed on Node 24).

## Getting started

```bash
npm install
npm run seed      # optional: add a few demo sightings
npm start         # http://localhost:3000
```

For live-reload during development:

```bash
npm run dev
```

## How location works

When someone reports a sighting, the server resolves coordinates like this:

1. **Map click** → exact coordinates (`location_note: "map"`).
2. **Photo EXIF GPS** → read from the uploaded file (`location_note: "exif"`).
3. **Typed place** → forward-geocoded, biased to the Seattle bounding box
   (`location_note: "geocode"`).

Anything that resolves outside the Seattle box is rejected. See
[`lib/geo.js`](lib/geo.js).

## Ingesting social posts

> **Read this before expecting Instagram/TikTok magic.**

The original goal was to scrape public posts of Jimothy and auto-place them.
Two hard realities shape how this is built:

1. **Direct scraping of Instagram/TikTok/X breaks their ToS**, gets your IP
   blocked, and shatters whenever they change their HTML. The durable path is
   each platform's **official API** (developer key + app review). The easiest
   to start with are **Reddit** (great for r/Seattle), **Mastodon**, and
   **Bluesky**, which have open-ish APIs.
2. **Platforms strip EXIF GPS on upload.** You almost never recover real
   camera coordinates from a downloaded social image. So ingested location
   comes from a post's **geotag** (if the API returns one) or a **place named
   in the caption** that we can geocode — and if neither exists, we **skip the
   post rather than guess**.

The pipeline is a clean seam in [`lib/ingest.js`](lib/ingest.js). A "provider"
is `async () => RawPost[]`. Two ship in the box:

```bash
npm run ingest            # run all providers
npm run ingest reddit     # run one by name
npm run ingest sample     # credential-free fixtures, always works
```

### Reddit provider (headless-browser scraper)

Reddit shut down free API access, so [`lib/providers/reddit.js`](lib/providers/reddit.js)
drives a **headless Chromium** (via Playwright) to read public Seattle-subreddit
search pages — no API keys, no login. One-time browser download:

```bash
npm run setup        # downloads Chromium (~120 MB)
npm run ingest reddit
```

It's built to be robust and low-impact:

- **Robust parsing first.** It asks the real browser to fetch Reddit's JSON
  listing (a stable, documented shape) and only falls back to scraping
  old.reddit HTML if that's blocked.
- **Gets past the datacenter block.** A real browser fingerprint on a
  residential IP reads pages that a plain server-side `fetch` gets 403'd on.
- **Fails gracefully.** Login/robot walls are detected and logged, not crashed
  on. Set `REDDIT_HEADFUL=1` to watch the browser if you're debugging a block.

Tune `REDDIT_SUBREDDITS`, `REDDIT_QUERY`, `REDDIT_LIMIT` via `.env`
(`cp .env.example .env`).

> ⚠️ **Etiquette & ToS.** Automated access is against Reddit's User Agreement.
> This is intended for a low-volume (twice-a-day) community project run from
> your own machine — please don't crank up the frequency. Reddit posts also
> carry no lat/lng, so a post only lands on the **map** if a place it names
> (e.g. "spotted at Green Lake") geocodes inside Seattle; otherwise it's
> skipped. Most Jimothy posts are fan art / news with no location.

### Run it twice a day (Windows)

```bash
npm run setup   # once
powershell -ExecutionPolicy Bypass -File scripts\schedule-windows.ps1
```

That registers a **Task Scheduler** job ("JimothyTracker Ingest") that runs the
Reddit scraper at 8 AM and 8 PM daily. Edit the times in the script if you like;
remove it with `Unregister-ScheduledTask -TaskName "JimothyTracker Ingest"`.

Add more providers (Bluesky, Mastodon) the same way and `scripts/ingest.js`
picks them up automatically.

## API

| Method | Route             | Purpose                                        |
|--------|-------------------|------------------------------------------------|
| GET    | `/api/config`     | Map center                                     |
| GET    | `/api/sightings`  | List sightings (`?since=&until=` ISO, `?has_media=1`) |
| GET    | `/api/feed`       | Sightings that have an image/video, newest first |
| POST   | `/api/sightings`  | Report a sighting (multipart/form-data)        |

Pages: `/` (map) and `/feed` (media feed).

## Project layout

```
server.js            Express app + routes
db.js                node:sqlite schema & queries
lib/geo.js           EXIF extraction, geocoding, Seattle bounds
lib/ingest.js        pluggable social-post ingestion pipeline
scripts/seed.js      demo data
scripts/ingest.js    ingestion runner
public/              Frontend
  index.html/app.js    Leaflet map
  feed.html/feed.js    media feed
  styles.css           shared styles
```

### A note on videos in the feed

Photos render inline. **Videos are shown as a poster frame with a ▶ badge that
links out to the original post** — the app doesn't rehost social video (that's
a bandwidth/rights minefield). User-uploaded clips (≤60 MB) are stored locally
and treated the same way.

## Roadmap ideas

- Time-range slider to watch Jimothy's movements over days.
- Heatmap layer for his favorite haunts.
- Upvotes / confirmations to filter out mis-sightings.
- Reddit/Bluesky providers wired to a scheduled ingest.
- Light content moderation on notes and photos before they go public.

## Notes & etiquette

- Nominatim geocoding is rate-limited to ~1 req/sec — the ingest pipeline
  already sleeps between calls. Don't hammer it.
- This is a community-run fan project. Be kind to Jimothy: observe, don't feed
  or chase. 🦝
