/**
 * POST /.netlify/functions/seed-events
 *
 * Loads data/events.json into the Netlify Blobs store "events", key
 * "approved" — the list that /.netlify/functions/events serves.
 *
 * Protected: requires the SEED_KEY environment variable and a matching
 * `x-seed-key` header. Without it the request is rejected and nothing is
 * written.
 *
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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, x-seed-key'
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const here = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  path.resolve(here, '..', '..', 'data', 'events.json'),
  path.resolve(process.cwd(), 'data', 'events.json'),
  path.resolve(process.cwd(), '..', 'data', 'events.json'),
  path.resolve(process.cwd(), '..', '..', 'data', 'events.json')
];

const readSourceFile = async () => {
  for (const file of CANDIDATES) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : parsed.events;
      if (Array.isArray(list)) return list;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('data/events.json not found');
};

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

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return json({ error: 'Use POST to seed the store' }, 405);
  }

  const expected = process.env.SEED_KEY;
  const provided = req.headers.get('x-seed-key');

  if (!expected) {
    return json({ error: 'SEED_KEY is not set on this site' }, 503);
  }
  if (!provided || provided !== expected) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const source = await readSourceFile();
    const events = clean(source);
    const store = getStore(STORE_NAME);
    await store.setJSON(STORE_KEY, events);

    return json({
      ok: true,
      seeded: events.length,
      store: STORE_NAME,
      key: STORE_KEY
    });
  } catch (error) {
    return json({ error: String(error && error.message ? error.message : error) }, 500);
  }
};
