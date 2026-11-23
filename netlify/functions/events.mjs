/**
 * GET /.netlify/functions/events
 *
 * Serves the APPROVED events for the portfolio page.
 *
 * Source of truth: the Netlify Blobs store "events", key "approved".
 * If that store is empty (or unreachable) it falls back to the repository
 * file data/events.json, so the site still works before anything is seeded.
 *
 * Only Nairobi, Mombasa and Diani are ever returned.
 */
import { getStore } from '@netlify/blobs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const STORE_NAME = 'events';
const STORE_KEY = 'approved';
const ALLOWED_CITIES = ['nairobi', 'mombasa', 'diani'];
const MAX_AGE_SECONDS = 300; // ~5 minutes

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-max-age': '86400'
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=60, s-maxage=${MAX_AGE_SECONDS}, stale-while-revalidate=600`
    }
  });

const here = path.dirname(fileURLToPath(import.meta.url));

// The function bundle keeps the repository layout, so both the relative and
// the process-relative locations are tried before giving up.
const FALLBACK_PATHS = [
  path.resolve(here, '..', '..', 'data', 'events.json'),
  path.resolve(process.cwd(), 'data', 'events.json'),
  path.resolve(process.cwd(), '..', 'data', 'events.json'),
  path.resolve(process.cwd(), '..', '..', 'data', 'events.json')
];

const isAllowedCity = (city) => ALLOWED_CITIES.includes(String(city || '').trim().toLowerCase());

const toDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Keeps the fields the page needs, in the shape the page expects. */
const normalise = (raw, index) => {
  const date = toDate(raw.date);
  if (!date) return null;
  const end = toDate(raw.end) || new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return {
    id: String(raw.id || `ev-${index + 1}`),
    title: String(raw.title || 'Untitled show'),
    date: raw.date,
    end: end.toISOString(),
    venue: String(raw.venue || ''),
    city: String(raw.city || ''),
    poster: String(raw.poster || ''),
    ticketUrl: String(raw.ticketUrl || ''),
    source: String(raw.source || 'unknown')
  };
};

/** Drops anything that is not an approved Kenyan show, and sorts by date. */
const filterEvents = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((raw, index) => normalise(raw, index))
    .filter((ev) => ev && isAllowedCity(ev.city))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
};

/** Reads data/events.json from wherever the function ended up. */
const readFallbackFile = async () => {
  for (const file of FALLBACK_PATHS) {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.events;
      if (Array.isArray(list)) return list;
    } catch {
      // try the next candidate
    }
  }
  return [];
};

/**
 * Opens the Blobs store.
 *
 * Inside Netlify this is the site's own store. Setting BLOBS_SITE_ID and
 * NETLIFY_AUTH_TOKEN points the function at another site's store instead
 * (handy for a staging feed, and for testing locally).
 */
const openStore = () => {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return getStore({ name: STORE_NAME, siteID, token });
  return getStore(STORE_NAME);
};

/** Reads the approved list out of Blobs. Returns null when there is nothing. */
const readBlobs = async () => {
  try {
    const store = openStore();
    let parsed = null;
    try {
      // @netlify/blobs has no getJSON helper — ask for JSON directly.
      parsed = await store.get(STORE_KEY, { type: 'json' });
    } catch {
      const raw = await store.get(STORE_KEY, { type: 'text' });
      parsed = raw ? JSON.parse(raw) : null;
    }
    if (!parsed) return null;
    const list = Array.isArray(parsed) ? parsed : parsed.events;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/* handler                                                             */
/* ------------------------------------------------------------------ */

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const fromBlobs = await readBlobs();
  const source = fromBlobs ? 'blobs' : 'file';
  const raw = fromBlobs || (await readFallbackFile());
  const events = filterEvents(raw);

  return json({
    events,
    meta: {
      source,
      count: events.length,
      store: STORE_NAME,
      key: STORE_KEY,
      generatedAt: new Date().toISOString()
    }
  });
};
