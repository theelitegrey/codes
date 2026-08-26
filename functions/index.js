// Firebase Scheduled Function: pull GDELT every 15 min, write pre-bucketed docs to Firestore.
// gdelt.mjs is copied here from ingest/ by the predeploy hook in firebase.json.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchEvents, fetchWire } from './gdelt.mjs';

initializeApp();

export const gdeltIngest = onSchedule(
  { schedule: 'every 15 minutes', timeoutSeconds: 120, memory: '256MiB', region: 'us-central1' },
  async () => {
    const db = getFirestore();
    const [events, wire] = await Promise.all([fetchEvents(), fetchWire()]);
    // GeoJSON stored as a string: Firestore rejects nested arrays (coordinates).
    await db.doc('monitor/events').set({
      generatedAt: events.meta.generatedAt,
      count: events.meta.count,
      geojson: JSON.stringify(events),
    });
    await db.doc('monitor/wire').set(wire);
    console.log(`ingested ${events.meta.count} events, ${wire.items.length} wire items`);
  }
);
