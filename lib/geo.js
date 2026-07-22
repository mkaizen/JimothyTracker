import exifr from 'exifr';

// Rough bounding box for the Seattle metro area. Used to sanity-check
// coordinates so we don't drop a pin in the wrong hemisphere.
export const SEATTLE_BOUNDS = {
  minLat: 47.40, maxLat: 47.78,
  minLng: -122.46, maxLng: -122.22,
};

export const SEATTLE_CENTER = { lat: 47.6062, lng: -122.3321 };

export function inSeattle(lat, lng) {
  return (
    lat >= SEATTLE_BOUNDS.minLat && lat <= SEATTLE_BOUNDS.maxLat &&
    lng >= SEATTLE_BOUNDS.minLng && lng <= SEATTLE_BOUNDS.maxLng
  );
}

/**
 * Pull GPS coordinates out of a photo's EXIF metadata, if present.
 * Note: most social platforms STRIP EXIF GPS on upload, so this only
 * yields a result for original files (e.g. direct user uploads).
 * @param {Buffer|string} input - image buffer or file path
 * @returns {Promise<{lat:number,lng:number}|null>}
 */
export async function extractExifLocation(input) {
  try {
    const gps = await exifr.gps(input);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      return { lat: gps.latitude, lng: gps.longitude };
    }
  } catch {
    // Unreadable/absent EXIF — fall through to null.
  }
  return null;
}

/**
 * Forward-geocode a free-text place ("Cal Anderson Park, Seattle") to
 * coordinates using OpenStreetMap's Nominatim service (free, rate-limited
 * to ~1 req/sec — do not hammer it). Results are biased to the Seattle box.
 * @param {string} query
 * @returns {Promise<{lat:number,lng:number,display:string}|null>}
 */
export async function geocodeText(query) {
  if (!query || !query.trim()) return null;
  const b = SEATTLE_BOUNDS;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  // viewbox = left,top,right,bottom ; bounded=1 restricts results to the box
  url.searchParams.set('viewbox', `${b.minLng},${b.maxLat},${b.maxLng},${b.minLat}`);
  url.searchParams.set('bounded', '1');

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'JimothyTracker/0.1 (community raccoon map)' },
    });
    if (!res.ok) return null;
    const hits = await res.json();
    if (!hits.length) return null;
    const hit = hits[0];
    return {
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      display: hit.display_name,
    };
  } catch {
    return null;
  }
}
