let all = [];

init();

async function init() {
  document.getElementById('videos-only').addEventListener('change', render);
  all = await fetch('/api/feed').then((r) => r.json());
  render();
}

function render() {
  const videosOnly = document.getElementById('videos-only').checked;
  const items = all.filter((s) => !videosOnly || s.media_type === 'video');

  const grid = document.getElementById('feed-grid');
  const empty = document.getElementById('feed-empty');
  document.getElementById('feed-count').textContent =
    `${items.length} ${items.length === 1 ? 'post' : 'posts'}`;

  grid.innerHTML = '';
  empty.classList.toggle('hidden', items.length > 0);

  for (const s of items) grid.appendChild(card(s));
}

function card(s) {
  const el = document.createElement('article');
  el.className = 'feed-card';

  const isVideo = s.media_type === 'video';
  const src = s.source && s.source !== 'user' ? s.source : null;
  const onMap = s.lat != null && s.lng != null;
  const link = s.source_url || (onMap ? `/?focus=${s.id}` : '#');

  // Media: images render inline; videos show the poster with a play badge and
  // link out to the original post (we don't rehost social video).
  const media = document.createElement('a');
  media.className = 'feed-media';
  media.href = link;
  if (s.source_url) { media.target = '_blank'; media.rel = 'noopener'; }
  media.innerHTML = `
    <img src="${esc(s.photo_url)}" alt="Jimothy sighting" loading="lazy"
         onerror="this.closest('.feed-card').classList.add('media-broken')" />
    ${isVideo ? '<span class="play-badge">▶</span>' : ''}
    ${src ? `<span class="src-badge">${esc(src)}</span>` : ''}
  `;

  const body = document.createElement('div');
  body.className = 'feed-body';
  body.innerHTML = `
    <p class="feed-notes">${esc(s.notes || 'Jimothy was here.')}</p>
    <div class="feed-meta">
      <span>${fmtDate(s.seen_at)}</span>
      <span>·</span>
      <span>${esc(s.reporter || 'anonymous')}</span>
    </div>
    <div class="feed-links">
      ${onMap ? `<a href="/?focus=${s.id}">📍 On the map</a>` : ''}
      ${s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener">↗ Original post</a>` : ''}
    </div>
  `;

  el.append(media, body);
  return el;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
