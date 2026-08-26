# World Monitor — GDELT

Live world map + news wire, GDELT as the sole data backbone. Static front end
(GitHub Pages) + one scheduled ingest function. Milestone 1–3 of the project
brief: GEO 2.0 map layer, DOC 2.0 wire, 15-min server-side polling.

## Quick start

```sh
npm run ingest   # pull GDELT GEO + DOC, write docs/data/*.json (Node 18+, no deps)
npm run serve    # http://localhost:8080
```

The repo ships with sample data (flagged `SAMPLE DATA` in the header) so the
page renders before the first ingest.

## Layout

```
ingest/gdelt.mjs         fetch + normalize (shared by everything below)
scripts/ingest-local.mjs one-shot ingest -> docs/data/
functions/index.js       Firebase Scheduled Function, every 15 min -> Firestore
docs/                    static site: MapLibre globe + wire panel
```

Normalized schema per event: `{name, mentions, validated, cameo, goldstein, tone}` —
the last three are null until the Event CSV ingest lands (next milestone).
Events need ≥5 mentions to show; >30 marks them validated (red).

## Deploy

**Front end (GitHub Pages):** Settings → Pages → deploy from branch, folder `/docs`.
Re-run `npm run ingest` + push to refresh data, or wire up Firestore below.

**Live data (Firebase):**

1. `firebase init` in an existing project (functions + firestore already configured
   here; it just writes `.firebaserc`).
2. `cd functions && npm install`
3. `firebase deploy --only functions,firestore:rules`
4. Put your web app's Firebase config in `docs/config.js`.

The function writes `monitor/events` (GeoJSON, stringified) and `monitor/wire`
every 15 min; rules are public-read, function-only write. The front end polls
Firestore once a minute when configured, static JSON otherwise.

## GDELT usage

- GEO 2.0, `theme:PROTEST` + conflict terms, `timespan=7d` → map points
  (size = mentions, amber = unvalidated, red = validated)
- DOC 2.0 `artlist`, same query, `timespan=24h`, `sort=hybridrel` → wire
- Polling is server-side only, once per 15 min — GDELT throttles aggressive
  clients and doesn't send CORS headers, so the browser never hits it directly.

## Next

1. Event 2.0 CSV ingest (15-min files) → real CAMEO/Goldstein/tone
   classification instead of keyword matching
2. Bilateral tension pairs (GDELT GPR)
3. Timeline volume charts (DOC `timelinevol`)
4. Access gating via existing Firebase plan-guard pattern
