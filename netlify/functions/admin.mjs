/**
 * /.netlify/functions/admin
 *
 * The approval API behind admin.html.
 *
 *   POST ?action=login    { password }                -> { token, expiresAt }
 *   GET  ?action=list                              (token) -> pending / approved / rejected
 *   POST ?action=save     { list, id, event }        (token)
 *   POST ?action=approve  { id }                     (token)
 *   POST ?action=reject   { id, reason }             (token)
 *   POST ?action=delete   { list, id }               (token)
 *   POST ?action=add      { event }                  (token)
 *   POST ?action=upload   { filename, contentType, data } (token)
 *
 * The token is HMAC-SHA256 signed with ADMIN_SECRET and expires after an
 * hour. Passwords and signatures are compared in constant time, and failed
 * logins are rate limited in the Blobs store (5 tries, then a 15 minute
 * lockout) so the limit survives a cold start.
 */
import { createHmac } from 'node:crypto';
import {
  KEY_APPROVED,
  KEY_PENDING,
  KEY_REJECTED,
  canonicalCity,
  cleanText,
  cleanUrl,
  dedupeKey,
  json,
  loadLists,
  openNamedStore,
  openStore,
  parseEventDate,
  preflight,
  safeEqual,
  saveList,
  toEAT
} from '../lib/events.mjs';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const LOGIN_KEY = 'admin-login';
const POSTER_STORE = 'posters';
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

const secret = () => process.env.ADMIN_SECRET || '';

const signToken = (data) => {
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

const verifyToken = (token) => {
  if (!token || !secret()) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || !data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/* Login rate limit                                                    */
/* ------------------------------------------------------------------ */

const readState = async (store, key) => {
  try {
    const value = await store.get(key, { type: 'json' });
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

const writeState = async (store, key, value) => {
  await store.setJSON(key, value);
};

const login = async (req) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return json({ error: 'ADMIN_PASSWORD is not set on this site' }, 503);
  if (!secret()) return json({ error: 'ADMIN_SECRET is not set on this site' }, 503);

  const store = openStore();
  const state = await readState(store, LOGIN_KEY);
  const now = Date.now();

  if (state.lockedUntil && state.lockedUntil > now) {
    const minutes = Math.ceil((state.lockedUntil - now) / 60000);
    return json({ error: `Too many failed attempts. Try again in ${minutes} minute(s).` }, 429);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (!safeEqual(body.password, password)) {
    const within = state.firstAt && now - state.firstAt < LOCK_MS;
    const fails = within ? (state.fails || 0) + 1 : 1;
    const firstAt = within ? state.firstAt : now;
    const lockedUntil = fails >= MAX_FAILS ? now + LOCK_MS : 0;
    await writeState(store, LOGIN_KEY, { fails, firstAt, lockedUntil });
    console.warn(`[admin] failed login (${fails}/${MAX_FAILS})`);
    return json({ error: 'Wrong password' }, 401);
  }

  await writeState(store, LOGIN_KEY, { fails: 0, firstAt: 0, lockedUntil: 0 });
  const expiresAt = now + TOKEN_TTL_MS;
  return json({ token: signToken({ iat: now, exp: expiresAt }), expiresAt });
};

/* ------------------------------------------------------------------ */
/* Event helpers                                                       */
/* ------------------------------------------------------------------ */

/** Normalises an event that came from the admin form. */
const cleanEvent = (raw) => {
  const title = cleanText(raw && raw.title, 200);
  const venue = cleanText(raw && raw.venue, 200);
  const city = canonicalCity(raw && raw.city);
  const parsed = parseEventDate(raw && raw.date);
  const rawPoster = String((raw && raw.poster) || '').trim();
  const poster = rawPoster.startsWith('images/') || rawPoster.startsWith('/')
    ? rawPoster
    : cleanUrl(rawPoster);

  return {
    ok: Boolean(title && venue && city && parsed),
    reason: !title ? 'missing title' : !venue ? 'missing venue' : !city ? 'unknown city' : !parsed ? 'bad date' : null,
    event: {
      title,
      venue,
      city,
      date: parsed ? toEAT(parsed) : '',
      end: parsed ? toEAT(new Date(parsed.getTime() + 3 * 60 * 60 * 1000)) : '',
      poster,
      ticketUrl: cleanUrl(raw && raw.ticketUrl),
      sourceUrl: cleanUrl(raw && raw.sourceUrl)
    }
  };
};

const findEvent = (list, id) => list.find((event) => event && event.id === id);

const saveListAnd = async (store, key, list) => {
  await saveList(store, key, list);
  return list;
};

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const url = new URL(req.url);
  const action = (url.searchParams.get('action') || '').trim();

  /* ---- login is the only unauthenticated action ---- */
  if (action === 'login') {
    if (req.method !== 'POST') return json({ error: 'Use POST to log in' }, 405);
    return login(req);
  }

  /* ---- everything else needs a valid token ---- */
  const token = req.headers.get('x-admin-token') || '';
  const session = verifyToken(token);
  if (!session) {
    return json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const { store, approved, pending, rejected } = await loadLists();

  /* ---- list ---- */
  if (action === 'list') {
    return json({
      ok: true,
      pending,
      approved,
      rejected: Object.values(rejected || {}).map((entry) => ({
        key: entry.key,
        reason: entry.reason,
        at: entry.at,
        event: entry.event
      })),
      expiresAt: session.exp
    });
  }

  /* ---- edit an event ---- */
  if (action === 'save') {
    const listName = body.list === 'approved' ? KEY_APPROVED : KEY_PENDING;
    const list = listName === KEY_APPROVED ? approved : pending;
    const current = findEvent(list, body.id);
    if (!current) return json({ error: 'Event not found' }, 404);

    const checked = cleanEvent({ ...current, ...(body.event || {}) });
    if (!checked.ok) return json({ error: checked.reason }, 400);

    const updated = {
      ...current,
      ...checked.event,
      id: current.id,
      // a time the editor typed wins; otherwise the event stays "time TBA"
      timeKnown: checked.event.date.slice(11, 16) !== '00:00' ? true : current.timeKnown !== false,
      allDay: checked.event.date.slice(11, 16) === '00:00' ? Boolean(current.allDay) : false,
      status: listName === KEY_APPROVED ? 'approved' : current.status || 'pending',
      source: current.source || 'manual'
    };

    const next = list.map((event) => (event.id === current.id ? updated : event));
    await saveListAnd(store, listName, next);
    return json({ ok: true, event: updated });
  }

  /* ---- approve: pending -> approved ---- */
  if (action === 'approve') {
    const current = findEvent(pending, body.id);
    if (!current) return json({ error: 'Event not found' }, 404);

    const approvedEvent = {
      ...current,
      status: 'approved',
      approvedAt: new Date().toISOString()
    };

    await saveListAnd(store, KEY_APPROVED, [...approved, approvedEvent]);
    await saveListAnd(store, KEY_PENDING, pending.filter((event) => event.id !== current.id));
    return json({ ok: true, event: approvedEvent });
  }

  /* ---- reject: pending -> rejected (never proposed again) ---- */
  if (action === 'reject') {
    const current = findEvent(pending, body.id);
    if (!current) return json({ error: 'Event not found' }, 404);

    const key = dedupeKey(current);
    const nextRejected = {
      ...(rejected || {}),
      [key]: {
        key,
        reason: cleanText(body.reason, 200) || 'rejected by the editor',
        at: new Date().toISOString(),
        event: current
      }
    };

    await saveListAnd(store, KEY_REJECTED, nextRejected);
    await saveListAnd(store, KEY_PENDING, pending.filter((event) => event.id !== current.id));
    return json({ ok: true, key });
  }

  /* ---- delete ---- */
  if (action === 'delete') {
    const listName = body.list === 'approved' ? KEY_APPROVED : KEY_PENDING;
    const list = listName === KEY_APPROVED ? approved : pending;
    if (!findEvent(list, body.id)) return json({ error: 'Event not found' }, 404);
    await saveListAnd(store, listName, list.filter((event) => event.id !== body.id));
    return json({ ok: true });
  }

  /* ---- add a manual event straight to approved ---- */
  if (action === 'add') {
    const checked = cleanEvent(body.event || {});
    if (!checked.ok) return json({ error: checked.reason }, 400);

    const event = {
      ...checked.event,
      id: `man-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      source: 'manual',
      status: 'approved',
      timeKnown: checked.event.date.slice(11, 16) !== '00:00',
      allDay: checked.event.date.slice(11, 16) === '00:00',
      approvedAt: new Date().toISOString(),
      discoveredAt: new Date().toISOString()
    };

    await saveListAnd(store, KEY_APPROVED, [...approved, event]);
    return json({ ok: true, event });
  }

  /* ---- upload a poster ---- */
  if (action === 'upload') {
    const contentType = cleanText(body.contentType, 60) || 'image/jpeg';
    if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(contentType)) {
      return json({ error: 'Only images can be uploaded' }, 400);
    }

    let buffer;
    try {
      buffer = Buffer.from(String(body.data || ''), 'base64');
    } catch {
      buffer = Buffer.alloc(0);
    }
    if (!buffer.length) return json({ error: 'No image data' }, 400);
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return json({ error: 'Image is too large (max 4 MB)' }, 413);
    }

    const extension = contentType.split('/')[1].replace('jpeg', 'jpg');
    const key = `poster-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const posterStore = openNamedStore(POSTER_STORE);
    await posterStore.set(key, buffer, { metadata: { contentType } });

    return json({ ok: true, key, url: `/posters/${key}` });
  }

  return json({ error: `Unknown action "${action}"` }, 400);
};
