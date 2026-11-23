/**
 * Shared helpers for the Netlify functions.
 *
 * This file lives OUTSIDE netlify/functions on purpose: Netlify only turns
 * the top-level files of that folder into functions, so this module is
 * bundled into the functions that import it and never deployed on its own.
 */
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* Store keys                                                          */
/* ------------------------------------------------------------------ */

export const STORE_NAME = 'events';
export const KEY_APPROVED = 'approved';
export const KEY_PENDING = 'pending';
export const KEY_REJECTED = 'rejected';

export const ALLOWED_CITIES = ['Nairobi', 'Mombasa', 'Diani'];

export const CITIES = {
  nairobi: 'Nairobi',
  mombasa: 'Mombasa',
  diani: 'Diani'
};

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, x-discover-key, x-admin-token',
  'access-control-max-age': '86400'
};

export const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

/**
 * Constant-time comparison.
 *
 * Both sides are hashed first, so the comparison is constant time whatever
 * the length of the strings, and a length mismatch never short-circuits.
 */
export const safeEqual = (a, b) => {
  const left = createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const right = createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return timingSafeEqual(left, right);
};

/* ------------------------------------------------------------------ */
/* Blobs                                                               */
/* ------------------------------------------------------------------ */

/**
 * Opens the Blobs store. Inside Netlify this is the site's own store;
 * BLOBS_SITE_ID + NETLIFY_AUTH_TOKEN point it at another site instead.
 */
export const openStore = () => {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return getStore({ name: STORE_NAME, siteID, token });
  return getStore(STORE_NAME);
};

/** Opens a named store (used for uploaded posters). */
export const openNamedStore = (name) => {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
};

const readJson = async (store, key) => {
  try {
    // @netlify/blobs has no getJSON helper — ask for JSON directly.
    const value = await store.get(key, { type: 'json' });
    return value ?? null;
  } catch {
    try {
      const raw = await store.get(key, { type: 'text' });
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
};

/** Reads approved / pending / rejected in one go. */
export const loadLists = async () => {
  const store = openStore();
  const [approved, pending, rejected] = await Promise.all([
    readJson(store, KEY_APPROVED),
    readJson(store, KEY_PENDING),
    readJson(store, KEY_REJECTED)
  ]);
  return {
    store,
    approved: Array.isArray(approved) ? approved : [],
    pending: Array.isArray(pending) ? pending : [],
    rejected: rejected && typeof rejected === 'object' && !Array.isArray(rejected) ? rejected : {}
  };
};

export const saveList = async (store, key, list) => {
  await store.setJSON(key, list);
};

/* ------------------------------------------------------------------ */
/* East Africa Time (UTC+3, no daylight saving)                       */
/* ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;
export const EAT_OFFSET_MS = 3 * HOUR;

/** Wall-clock date in Nairobi, as a Date whose UTC parts read as EAT. */
export const eatWallClock = (d = new Date()) => new Date(d.getTime() + EAT_OFFSET_MS);

/** "2027-02-19" for a date, in Nairobi time. */
export const eatDateString = (d) => eatWallClock(d).toISOString().slice(0, 10);

/** ISO string in Nairobi time: 2027-02-19T20:00:00+03:00 */
export const toEAT = (d) => `${eatWallClock(d).toISOString().slice(0, 19)}+03:00`;

/**
 * Tolerant date parser for model output:
 *   2027-02-19  ·  2027-02-19T20:00:00Z  ·  19 February 2027  ·  Feb 19, 2027
 * A date without a time is the START of that day in Nairobi — no time is
 * invented. Use `hasTime()` to know whether the source gave one.
 */
export const parseEventDate = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (!s) return null;

  let d = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(`${s}T00:00:00+03:00`);
  } else {
    d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      const dayFirst = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
      const monthFirst = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
      if (dayFirst) d = new Date(`${dayFirst[1]} ${dayFirst[2]} ${dayFirst[3]} 00:00:00 GMT+0300`);
      else if (monthFirst) d = new Date(`${monthFirst[1]} ${monthFirst[2]} ${monthFirst[3]} 00:00:00 GMT+0300`);
    }
  }
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Does this date string carry a time of day? */
export const hasTime = (raw) => {
  if (typeof raw === 'number') return true;
  const s = String(raw ?? '').trim();
  if (!s) return false;
  return /T\d{1,2}:\d{2}/.test(s) || /\d{1,2}:\d{2}\s*(am|pm)/i.test(s);
};

/* ------------------------------------------------------------------ */
/* Text + urls                                                         */
/* ------------------------------------------------------------------ */

/** Strips control characters and caps the length of untrusted strings. */
export const cleanText = (value, max = 200) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
};

/** Only http(s) URLs are allowed through. */
export const cleanUrl = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
};

/** Lowercase, punctuation-free key for titles. */
export const slugify = (value) =>
  cleanText(value, 240)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** title + date + city, the key used to detect duplicates. */
export const dedupeKey = (event) =>
  [slugify(event.title), String(event.date).slice(0, 10), String(event.city).toLowerCase()].join('|');

/* ------------------------------------------------------------------ */
/* Event validation                                                    */
/* ------------------------------------------------------------------ */

export const canonicalCity = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return CITIES[key] || (ALLOWED_CITIES.find((c) => c.toLowerCase() === key) || '');
};

/**
 * Validates and normalises one event.
 * Returns { ok: true, event } or { ok: false, reason }.
 */
export const validateEvent = (raw, options = {}) => {
  const { now = new Date(), days = 90, expectedCity = '' } = options;

  const title = cleanText(raw && raw.title, 200);
  const venue = cleanText(raw && raw.venue, 200);
  const city = canonicalCity(raw && raw.city);

  if (!title) return { ok: false, reason: 'missing title', title };
  if (!venue) return { ok: false, reason: 'missing venue', title };
  if (!city) return { ok: false, reason: 'city not allowed', title };
  if (expectedCity && city !== expectedCity) {
    return { ok: false, reason: `city is ${city}, expected ${expectedCity}`, title };
  }

  const parsed = parseEventDate(raw && raw.date);
  if (!parsed) return { ok: false, reason: 'unparseable date', title };
  if (parsed.getTime() <= now.getTime()) return { ok: false, reason: 'date is in the past', title };
  if (parsed.getTime() > now.getTime() + days * 24 * HOUR) {
    return { ok: false, reason: 'date is outside the window', title };
  }

  const sourceUrl = cleanUrl(raw && raw.sourceUrl);
  if (!sourceUrl) return { ok: false, reason: 'missing source url', title };

  const ticketUrl = cleanUrl(raw && raw.ticketUrl);
  const rawPoster = String((raw && raw.poster) || '').trim();
  // A poster is either a path inside images/ or an absolute http(s) URL.
  const poster = rawPoster.startsWith('images/') ? rawPoster : cleanUrl(rawPoster);

  const date = toEAT(parsed);
  const id = raw && raw.id
    ? cleanText(raw.id, 120)
    : `dis-${slugify(title).slice(0, 48)}-${date.slice(0, 10)}`;

  const sources = [];
  const rawSources = Array.isArray(raw && raw.sources) ? raw.sources : [];
  rawSources.slice(0, 6).forEach((s) => {
    const url = cleanUrl(s && s.url);
    if (url) sources.push({ title: cleanText(s && s.title, 160), url });
  });

  return {
    ok: true,
    event: {
      id,
      title,
      date,
      end: toEAT(new Date(parsed.getTime() + 3 * HOUR)),
      venue,
      city,
      poster,
      ticketUrl,
      source: cleanText((raw && raw.source) || 'gemini', 40) || 'gemini',
      sourceUrl,
      sources,
      // a source that gives no time means a time TBA, never a made up one
      timeKnown: raw && raw.timeKnown === false ? false : true,
      allDay: Boolean(raw && raw.allDay),
      status: cleanText((raw && raw.status) || 'pending', 20) || 'pending',
      discoveredAt: new Date().toISOString()
    }
  };
};
