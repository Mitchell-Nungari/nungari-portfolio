/**
 * Pushes data/events.json into the Netlify Blobs store "events", key
 * "approved" — the list that /.netlify/functions/events serves.
 *
 * This talks straight to the Netlify API, so it works against a deployed
 * site without running a function:
 *
 *   SITE_ID=<site-id> NETLIFY_AUTH_TOKEN=<token> node scripts/seed-events.mjs
 *
 * For local work prefer the protected function (see README):
 *   curl -X POST http://localhost:8888/.netlify/functions/seed-events \
 *        -H "x-seed-key: $SEED_KEY"
 */
import { getStore } from '@netlify/blobs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const STORE_NAME = 'events';
const STORE_KEY = 'approved';
const ALLOWED_CITIES = ['nairobi', 'mombasa', 'diani'];

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.resolve(here, '..', 'data', 'events.json');

const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
const token = process.env.NETLIFY_AUTH_TOKEN;

if (!siteID || !token) {
  console.error('Missing credentials.\n');
  console.error('  SITE_ID             = the Netlify site id');
  console.error('  NETLIFY_AUTH_TOKEN = a personal access token');
  console.error('                        (https://app.netlify.com/user/settings/applications)');
  console.error('\nExample:\n');
  console.error('  SITE_ID=abc123 NETLIFY_AUTH_TOKEN=nfp_xxx node scripts/seed-events.mjs\n');
  process.exit(1);
}

const clean = (list) =>
  list
    .filter((ev) => ALLOWED_CITIES.includes(String(ev.city || '').trim().toLowerCase()))
    .map((ev) => ({
      id: String(ev.id),
      title: String(ev.title || ''),
      date: ev.date,
      end: ev.end || new Date(new Date(ev.date).getTime() + 3 * 60 * 60 * 1000).toISOString(),
      venue: String(ev.venue || ''),
      city: String(ev.city || ''),
      poster: String(ev.poster || ''),
      ticketUrl: String(ev.ticketUrl || ''),
      source: String(ev.source || 'seed')
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

const parsed = JSON.parse(await readFile(sourceFile, 'utf8'));
const list = Array.isArray(parsed) ? parsed : parsed.events;
const events = clean(list);

const store = getStore({ name: STORE_NAME, siteID, token });
await store.setJSON(STORE_KEY, events);

console.log(`Seeded ${events.length} events into store "${STORE_NAME}" (key "${STORE_KEY}").`);
events.forEach((ev) => console.log(`  ${ev.date}  ${ev.city.padEnd(8)} ${ev.title}`));
