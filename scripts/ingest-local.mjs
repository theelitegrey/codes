// Run the GDELT ingest once and write docs/data/*.json for local dev / GitHub Pages.
// Usage: npm run ingest
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchEvents, fetchWire } from '../ingest/gdelt.mjs';

const outDir = new URL('../docs/data/', import.meta.url);
await mkdir(outDir, { recursive: true });

const [events, wire] = await Promise.all([fetchEvents(), fetchWire()]);

await writeFile(new URL('events.geojson', outDir), JSON.stringify(events));
await writeFile(new URL('wire.json', outDir), JSON.stringify(wire));

console.log(`events: ${events.features.length} points  wire: ${wire.items.length} articles`);
console.log(`written to docs/data/ at ${events.meta.generatedAt}`);
