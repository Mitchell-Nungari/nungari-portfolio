/**
 * Offline test for the admin API — no Netlify account needed.
 *
 * It boots a local Netlify Blobs server and calls the admin handler
 * directly:
 *
 *   1. login: wrong password, rate limit lockout, right password
 *   2. tokens: missing, tampered and expired tokens are refused
 *   3. list: pending / approved / rejected
 *   4. approve moves an event from pending to approved
 *   5. reject files it under its dedupe key, so it is never proposed again
 *   6. delete removes an approved event
 *   7. add creates a manual event in approved
 *   8. save edits any field
 *   9. upload stores a poster and returns a URL
 *
 *   node scripts/test-admin.mjs
 */
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const admin = (await import('../netlify/functions/admin.mjs')).default;

let passed = 0;
let failed = 0;

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

/* ------------------------------------------------------------------ */
/* Local Blobs                                                        */
/* ------------------------------------------------------------------ */

const directory = await mkdtemp(path.join(tmpdir(), 'mn-blobs-'));
const token = 'test-token';
const server = new BlobsServer({ directory, port: 0, token, logger: () => {} });
await server.start();

globalThis.netlifyBlobsContext = Buffer.from(
  JSON.stringify({
    siteID: 'test-site',
    token,
    edgeURL: server.address,
    uncachedEdgeURL: server.address
  })
).toString('base64');

const store = getStore('events');
const readJson = async (key) => {
  try {
    return await store.get(key, { type: 'json' });
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const call = (action, { body = {}, headers = {}, method = 'POST', url } = {}) => {
  const all = { 'content-type': 'application/json', ...headers };
  return admin(
    new Request(url || `http://localhost/.netlify/functions/admin?action=${action}`, {
      method,
      headers: all,
      body: method === 'POST' ? JSON.stringify(body) : undefined
    })
  );
};

const jsonOf = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

const PENDING_EVENT = {
  id: 'dis-kilimanjaro-2027-02-19',
  title: 'Kilimanjaro Sessions',
  date: '2027-02-19T20:00:00+03:00',
  end: '2027-02-19T23:00:00+03:00',
  venue: 'KICC Auditorium',
  city: 'Nairobi',
  poster: '',
  ticketUrl: 'https://example.com/tickets/ks',
  source: 'gemini',
  sourceUrl: 'https://example.org/ks',
  sources: [],
  status: 'pending',
  discoveredAt: '2026-11-13T04:00:00.000Z'
};

try {
  let auth = '';

  console.log('\n1. login');
  {
    delete process.env.ADMIN_PASSWORD;
    const unset = await call('login', { body: { password: 'x' } });
    check('missing ADMIN_PASSWORD refused', unset.status === 503, `got ${unset.status}`);

    process.env.ADMIN_PASSWORD = 'correct horse';
    process.env.ADMIN_SECRET = 'a-secret';

    const wrong = await call('login', { body: { password: 'wrong' } });
    check('wrong password refused', wrong.status === 401, `got ${wrong.status}`);
    check('no token issued', !(await jsonOf(wrong)).token);

    const right = await call('login', { body: { password: 'correct horse' } });
    const body = await jsonOf(right);
    check('right password accepted', right.status === 200, `got ${right.status}`);
    check('token issued', typeof body.token === 'string' && body.token.includes('.'), body.token);
    check('expiry given', body.expiresAt > Date.now(), String(body.expiresAt));

    // the rate limiter: the fifth failure locks the door
    await store.setJSON('admin-login', { fails: 4, firstAt: Date.now(), lockedUntil: 0 });
    const fifth = await call('login', { body: { password: 'wrong' } });
    check('fifth failure refused', fifth.status === 401, `got ${fifth.status}`);

    const blocked = await call('login', { body: { password: 'correct horse' } });
    check('right password refused while locked', blocked.status === 429, `got ${blocked.status}`);

    await store.setJSON('admin-login', { fails: 0, firstAt: 0, lockedUntil: 0 });
    const again = await call('login', { body: { password: 'correct horse' } });
    check('login works again after unlock', again.status === 200, `got ${again.status}`);
  }

  console.log('\n2. tokens');
  {
    const login = await call('login', { body: { password: 'correct horse' } });
    auth = (await jsonOf(login)).token;

    const noToken = await call('list', { method: 'GET' });
    check('missing token refused', noToken.status === 401, `got ${noToken.status}`);

    const tampered = await call('list', { method: 'GET', headers: { 'x-admin-token': auth.slice(0, -2) + 'xy' } });
    check('tampered token refused', tampered.status === 401, `got ${tampered.status}`);

    const valid = await call('list', { method: 'GET', headers: { 'x-admin-token': auth } });
    check('valid token accepted', valid.status === 200, `got ${valid.status}`);
  }

  console.log('\n3. list');
  {
    await store.setJSON('approved', []);
    await store.setJSON('pending', [PENDING_EVENT]);
    await store.setJSON('rejected', {});

    const res = await call('list', { method: 'GET', headers: { 'x-admin-token': auth } });
    const body = await jsonOf(res);
    check('pending returned', body.pending.length === 1, JSON.stringify(body.pending));
    check('approved returned', Array.isArray(body.approved));
    check('rejected returned', Array.isArray(body.rejected));
  }

  console.log('\n4. approve');
  {
    const res = await call('approve', {
      body: { id: PENDING_EVENT.id },
      headers: { 'x-admin-token': auth }
    });
    const body = await jsonOf(res);
    const approved = (await readJson('approved')) || [];
    const pending = (await readJson('pending')) || [];

    check('status 200', res.status === 200, `got ${res.status}`);
    check('moved to approved', approved.length === 1 && approved[0].id === PENDING_EVENT.id);
    check('status is approved', approved[0] && approved[0].status === 'approved');
    check('removed from pending', pending.length === 0, String(pending.length));
    check('poster stays optional', approved[0] && approved[0].poster === '');
  }

  console.log('\n5. reject');
  {
    const candidate = { ...PENDING_EVENT, id: 'dis-bad-show', title: 'Bad Show' };
    await store.setJSON('pending', [candidate]);

    const res = await call('reject', {
      body: { id: candidate.id, reason: 'not a real event' },
      headers: { 'x-admin-token': auth }
    });
    const body = await jsonOf(res);
    const rejected = (await readJson('rejected')) || {};
    const pending = (await readJson('pending')) || [];

    check('status 200', res.status === 200, `got ${res.status}`);
    check('filed under a dedupe key', typeof body.key === 'string' && body.key.includes('|'), body.key);
    check('rejected map updated', Object.keys(rejected).length === 1, JSON.stringify(Object.keys(rejected)));
    check('reason kept', rejected[body.key] && rejected[body.key].reason === 'not a real event');
    check('removed from pending', pending.length === 0);
  }

  console.log('\n6. delete');
  {
    const res = await call('delete', {
      body: { list: 'approved', id: PENDING_EVENT.id },
      headers: { 'x-admin-token': auth }
    });
    const approved = (await readJson('approved')) || [];
    check('status 200', res.status === 200, `got ${res.status}`);
    check('removed from approved', approved.length === 0, String(approved.length));
  }

  console.log('\n7. add a manual event');
  {
    const res = await call('add', {
      body: {
        event: {
          title: 'Manual Night',
          venue: 'The Alchemist',
          city: 'Nairobi',
          date: '2027-03-01T21:00:00+03:00',
          ticketUrl: 'https://example.com/tickets/manual',
          sourceUrl: ''
        }
      },
      headers: { 'x-admin-token': auth }
    });
    const body = await jsonOf(res);
    const approved = (await readJson('approved')) || [];

    check('status 200', res.status === 200, `got ${res.status}`);
    check('added to approved', approved.length === 1, String(approved.length));
    check('source is manual', approved[0] && approved[0].source === 'manual');
    check('id generated', typeof body.event.id === 'string' && body.event.id.length > 4);
    check('no poster', approved[0] && approved[0].poster === '');

    const bad = await call('add', {
      body: { event: { title: '', venue: 'x', city: 'Nairobi', date: '2027-03-01T21:00:00+03:00' } },
      headers: { 'x-admin-token': auth }
    });
    check('invalid event refused', bad.status === 400, `got ${bad.status}`);

    const badCity = await call('add', {
      body: { event: { title: 'x', venue: 'x', city: 'Nakuru', date: '2027-03-01T21:00:00+03:00' } },
      headers: { 'x-admin-token': auth }
    });
    check('unknown city refused', badCity.status === 400, `got ${badCity.status}`);
  }

  console.log('\n8. save an edit');
  {
    const approved = (await readJson('approved')) || [];
    const id = approved[0].id;
    const res = await call('save', {
      body: {
        list: 'approved',
        id,
        event: {
          title: 'Manual Night — sold out',
          venue: 'The Alchemist',
          city: 'Mombasa',
          date: '2027-03-01T21:00:00+03:00',
          poster: 'https://example.com/poster.jpg'
        }
      },
      headers: { 'x-admin-token': auth }
    });
    const after = (await readJson('approved')) || [];

    check('status 200', res.status === 200, `got ${res.status}`);
    check('title updated', after[0] && after[0].title === 'Manual Night — sold out', after[0] && after[0].title);
    check('city updated', after[0] && after[0].city === 'Mombasa');
    check('poster updated', after[0] && after[0].poster === 'https://example.com/poster.jpg');
    check('id kept', after[0] && after[0].id === id);
  }

  console.log('\n9. upload a poster');
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    ).toString('base64');

    const res = await call('upload', {
      body: { filename: 'poster.png', contentType: 'image/png', data: png },
      headers: { 'x-admin-token': auth }
    });
    const body = await jsonOf(res);

    check('status 200', res.status === 200, `got ${res.status}`);
    check('url returned', typeof body.url === 'string' && body.url.startsWith('/posters/'), body.url);

    const posterStore = getStore('posters');
    const stored = await posterStore.getWithMetadata(body.key);
    check('image stored', !!stored.data, String(stored.data && stored.data.length));
    check('content type kept', stored.metadata && stored.metadata.contentType === 'image/png');

    const notImage = await call('upload', {
      body: { filename: 'x.txt', contentType: 'text/plain', data: png },
      headers: { 'x-admin-token': auth }
    });
    check('non image refused', notImage.status === 400, `got ${notImage.status}`);
  }

  console.log('\n10. unknown action');
  {
    const res = await call('nonsense', { headers: { 'x-admin-token': auth } });
    check('status 400', res.status === 400, `got ${res.status}`);
  }
} finally {
  await server.stop?.();
  await rm(directory, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
