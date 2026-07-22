/* global L */

let map;
let markers = L.layerGroup();
let pickMarker = null;       // the pin the user drops while reporting
let picked = null;           // { lat, lng } chosen on the map

const raccoonIcon = L.icon({
  iconUrl: '/jimothy-pin.svg',
  iconSize: [52, 39],
  iconAnchor: [26, 36],   // roughly Jimothy's feet, on the spot
  popupAnchor: [0, -30],
});

init();

async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json());
  map = L.map('map').setView([cfg.center.lat, cfg.center.lng], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  markers.addTo(map);

  // Clicking the map while the report form is open sets the location.
  map.on('click', (e) => {
    if (!isModalOpen()) return;
    setPicked(e.latlng.lat, e.latlng.lng);
  });

  wireModal();
  await loadSightings();
}

async function loadSightings() {
  const list = await fetch('/api/sightings').then((r) => r.json());
  markers.clearLayers();
  const ul = document.getElementById('sightings-list');
  ul.innerHTML = '';
  document.getElementById('count').textContent = `${list.length} spotted`;

  const byId = new Map();
  for (const s of list) {
    const marker = L.marker([s.lat, s.lng], { icon: raccoonIcon })
      .bindPopup(popupHtml(s));
    marker.addTo(markers);
    ul.appendChild(listItem(s, marker));
    byId.set(s.id, { s, marker });
  }

  // Deep link from the feed: /?focus=<id> centers and opens that sighting.
  const focus = Number(new URLSearchParams(location.search).get('focus'));
  if (focus && byId.has(focus)) {
    const { s, marker } = byId.get(focus);
    map.setView([s.lat, s.lng], 16);
    marker.openPopup();
  }
}

function popupHtml(s) {
  const when = fmtDate(s.seen_at);
  const play = s.media_type === 'video' ? '<span class="popup-play">▶ video</span>' : '';
  const photo = s.photo_url
    ? `<div class="popup-media">${play}<img src="${esc(s.photo_url)}" alt="Jimothy" /></div>` : '';
  const src = s.source && s.source !== 'user'
    ? `<div class="badge">${esc(s.source)}</div>` : '';
  const link = s.source_url ? ` · <a href="${esc(s.source_url)}" target="_blank" rel="noopener">source</a>` : '';
  return `
    <strong>${when}</strong> ${src}
    <div>${esc(s.notes || 'Jimothy was here.')}</div>
    ${photo}
    <div style="color:#999;margin-top:4px">${esc(s.reporter || 'anonymous')}${link}</div>
  `;
}

function listItem(s, marker) {
  const li = document.createElement('li');
  const thumb = s.photo_url ? `<img class="li-thumb" src="${esc(s.photo_url)}" alt="" />` : '';
  const badge = s.source && s.source !== 'user' ? `<span class="badge">${esc(s.source)}</span>` : '';
  li.innerHTML = `
    <div class="li-when">${fmtDate(s.seen_at)} ${badge}</div>
    <p class="li-notes">${esc(s.notes || 'Jimothy was here.')}</p>
    ${thumb}
    <div class="li-meta">${esc(s.reporter || 'anonymous')} · via ${esc(s.location_note || 'map')}</div>
  `;
  li.addEventListener('click', () => {
    map.setView([s.lat, s.lng], 15);
    marker.openPopup();
  });
  return li;
}

// --- Report modal ----------------------------------------------------------

function wireModal() {
  const modal = document.getElementById('modal');
  document.getElementById('report-btn').addEventListener('click', () => {
    modal.classList.remove('hidden');
    // Default the datetime to now.
    const dt = document.querySelector('input[name="seen_at"]');
    if (!dt.value) dt.value = new Date().toISOString().slice(0, 16);
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('report-form').addEventListener('submit', onSubmit);
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  clearPicked();
  document.getElementById('form-error').classList.add('hidden');
}

function isModalOpen() {
  return !document.getElementById('modal').classList.contains('hidden');
}

function setPicked(lat, lng) {
  picked = { lat, lng };
  const out = document.getElementById('loc-display');
  out.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  out.classList.add('set');
  if (pickMarker) pickMarker.setLatLng([lat, lng]);
  else pickMarker = L.marker([lat, lng], { icon: raccoonIcon, opacity: 0.7 }).addTo(map);
}

function clearPicked() {
  picked = null;
  if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
  const out = document.getElementById('loc-display');
  out.textContent = 'Click the map to set a spot…';
  out.classList.remove('set');
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('form-error');
  errEl.classList.add('hidden');

  const fd = new FormData(form);
  if (picked) { fd.set('lat', picked.lat); fd.set('lng', picked.lng); }
  // datetime-local has no timezone; store as-is (local) in ISO-ish form.
  const dt = fd.get('seen_at');
  if (dt) fd.set('seen_at', new Date(dt).toISOString());

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/sightings', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit.');
    form.reset();
    closeModal();
    await loadSightings();
    map.setView([data.lat, data.lng], 15);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit sighting';
  }
}

// --- utils -----------------------------------------------------------------

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
