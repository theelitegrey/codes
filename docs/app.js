// World Monitor front end: MapLibre map/globe + wire panel.
// Data source: Firestore when config.js sets firebase, else static docs/data/*.json.

const cfg = window.MONITOR_CONFIG || {};
const statusEl = document.getElementById('status');
const wireList = document.getElementById('wire-list');
const projBtn = document.getElementById('projection');

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap &copy; CARTO — data: GDELT Project',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b0e13' } },
      { id: 'base', type: 'raster', source: 'carto' },
    ],
  },
  center: [15, 22],
  zoom: 1.7,
  projection: 'globe',
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

let globe = true;
projBtn.addEventListener('click', () => {
  globe = !globe;
  map.setProjection({ type: globe ? 'globe' : 'mercator' });
  projBtn.textContent = globe ? 'GLOBE' : 'FLAT';
});

// style.load (not load): layers go in as soon as the style parses, so events and
// the wire render even if base tiles are slow or unreachable.
map.on('style.load', () => {
  map.addSource('events', { type: 'geojson', data: lastEvents || { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'events-glow',
    type: 'circle',
    source: 'events',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'mentions']], 2, 6, 10, 14, 30, 26],
      'circle-color': ['case', ['get', 'validated'], '#ff4d4d', '#f5a623'],
      'circle-opacity': 0.15,
      'circle-blur': 0.6,
    },
  });
  map.addLayer({
    id: 'events-dot',
    type: 'circle',
    source: 'events',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'mentions']], 2, 2.5, 10, 5, 30, 9],
      'circle-color': ['case', ['get', 'validated'], '#ff4d4d', '#f5a623'],
      'circle-opacity': 0.9,
      'circle-stroke-width': 0.5,
      'circle-stroke-color': '#0b0e13',
    },
  });

  map.on('click', 'events-dot', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ closeButton: false })
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(
        `<div class="popup-name">${esc(p.name)}</div>` +
        `<div class="popup-meta">${p.mentions} mentions` +
        (p.validated === true || p.validated === 'true' ? ' · <span class="hot">VALIDATED</span>' : '') +
        `</div>`
      )
      .addTo(map);
  });
  map.on('mouseenter', 'events-dot', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'events-dot', () => (map.getCanvas().style.cursor = ''));
});

let lastEvents = null;

function renderEvents(fc) {
  lastEvents = fc;
  const src = map.getSource('events');
  if (src) src.setData(fc);
  const when = fc.meta?.generatedAt ? new Date(fc.meta.generatedAt).toLocaleTimeString() : '—';
  statusEl.innerHTML =
    `${fc.features.length} events · updated ${when}` +
    (fc.meta?.sample ? '<span class="badge">SAMPLE DATA</span>' : '');
}

function renderWire(wire) {
  wireList.innerHTML = '';
  for (const a of wire.items || []) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = a.title;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [timeAgo(a.ts), a.domain, a.sourcecountry].filter(Boolean).join(' · ');
    li.append(link, meta);
    wireList.append(li);
  }
}

async function start() {
  if (cfg.firebase) {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = getFirestore(initializeApp(cfg.firebase));
    const pull = async () => {
      try {
        const [ev, wi] = await Promise.all([getDoc(doc(db, 'monitor', 'events')), getDoc(doc(db, 'monitor', 'wire'))]);
        if (ev.exists()) renderEvents(JSON.parse(ev.data().geojson));
        if (wi.exists()) renderWire(wi.data());
      } catch (e) {
        statusEl.textContent = `firestore error: ${e.message}`;
      }
    };
    await pull();
    setInterval(pull, 60_000); // brief: one fetch per minute
  } else {
    const pull = async () => {
      try {
        const [ev, wi] = await Promise.all([
          fetch('data/events.geojson').then((r) => r.json()),
          fetch('data/wire.json').then((r) => r.json()),
        ]);
        renderEvents(ev);
        renderWire(wi);
      } catch (e) {
        statusEl.textContent = `data load failed: ${e.message} — run npm run ingest`;
      }
    };
    await pull();
    setInterval(pull, 60_000);
  }
}

start();

function timeAgo(ts) {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
