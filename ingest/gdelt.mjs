// Shared GDELT fetch + normalize logic.
// Used by scripts/ingest-local.mjs and functions/index.js (copied in on predeploy).

export const QUERY =
  '(theme:PROTEST OR "protest" OR "riot" OR "clashes" OR "airstrike" OR "shelling")';

const GEO_BASE = 'https://api.gdeltproject.org/api/v2/geo/geo';
const DOC_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Events with >= MIN_MENTIONS make the map; > VALIDATED_MENTIONS are marked validated.
// Same thresholds worldmonitor uses for its GDELT protest layer.
export const MIN_MENTIONS = 5;
export const VALIDATED_MENTIONS = 30;
export const MAX_EVENTS = 1000; // keep Firestore doc well under the 1 MB limit
export const MAX_WIRE = 100;

export function geoUrl(query = QUERY, timespan = '7d') {
  const p = new URLSearchParams({ query, format: 'geojson', timespan });
  return `${GEO_BASE}?${p}`;
}

export function docUrl(query = QUERY, timespan = '24h', maxrecords = MAX_WIRE) {
  const p = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(maxrecords),
    timespan,
    sort: 'hybridrel',
  });
  return `${DOC_BASE}?${p}`;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GDELT ${res.status} for ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GDELT returned non-JSON (${text.slice(0, 120)}...)`);
  }
}

// GEO 2.0 geojson -> normalized FeatureCollection.
// Properties per feature: { name, mentions, validated }.
// cameo/goldstein/tone arrive with the Event CSV ingest (next milestone) — null for now.
export function normalizeGeo(raw, now = new Date()) {
  const features = (raw.features || [])
    .filter((f) => f?.geometry?.type === 'Point' && (f.properties?.count ?? 0) >= MIN_MENTIONS)
    .sort((a, b) => (b.properties.count || 0) - (a.properties.count || 0))
    .slice(0, MAX_EVENTS)
    .map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        name: f.properties.name || '',
        mentions: f.properties.count || 0,
        validated: (f.properties.count || 0) > VALIDATED_MENTIONS,
        cameo: null,
        goldstein: null,
        tone: null,
      },
    }));
  return {
    type: 'FeatureCollection',
    meta: { generatedAt: now.toISOString(), query: QUERY, count: features.length },
    features,
  };
}

// DOC 2.0 artlist -> wire items, newest first.
export function normalizeArticles(raw, now = new Date()) {
  const items = (raw.articles || [])
    .map((a) => ({
      id: hash(a.url || ''),
      ts: parseSeendate(a.seendate),
      title: (a.title || '').trim(),
      url: a.url || '',
      domain: a.domain || '',
      sourcecountry: a.sourcecountry || '',
      language: a.language || '',
    }))
    .filter((a) => a.title && a.url)
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    .slice(0, MAX_WIRE);
  return { generatedAt: now.toISOString(), query: QUERY, items };
}

export async function fetchEvents() {
  return normalizeGeo(await getJson(geoUrl()));
}

export async function fetchWire() {
  return normalizeArticles(await getJson(docUrl()));
}

// "20260826T120000Z" -> "2026-08-26T12:00:00Z"
function parseSeendate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
