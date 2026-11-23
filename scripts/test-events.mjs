/**
 * Offline test for the events function — no Netlify account needed.
 *
 * It boots a local Netlify Blobs server, points the blobs client at it and
 * calls the function handler directly, so it covers the real code paths:
 *
 *   1. an empty store falls back to data/events.json
 *   2. approved events are served from the store
 *   3. events outside Nairobi / Mombasa / Diani are dropped
 *   4. CORS headers and the ~5 minute cache header are present
 *   5. OPTIONS returns 204
 *   6. the seed function rejects a wrong key and writes with the right one
 *
 *   node scripts/test-events.mjs
 */
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const eventsHandler = (await import('../netlify/functions/events.mjs')).default;
const seedHandler = (await import('../netlify/functions/seed-events.mjs')).default;

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

const get = (url = 'http://localhost/.netlify/functions/events') =>
  eventsHandler(new Request(url, { method: 'GET' }));

/* ------------------------------------------------------------------ */

const directory = await mkdtemp(path.join(tmpdir(), 'mn-blobs-'));
const token = 'test-token';
const server = new BlobsServer({ directory, port: 0, token, logger: () => {} });
await server.start();

// The blobs client reads its configuration from this global (base64 JSON).
globalThis.netlifyBlobsContext = Buffer.from(
  JSON.stringify({
    siteID: 'test-site',
    token,
    edgeURL: server.address,
    uncachedEdgeURL: server.address
  })
).toString('base64');

const store = getStore('events');

try {
  console.log('\n1. empty store falls back to data/events.json');
  {
    const res = await get();
    const body = await res.json();
    check('status 200', res.status === 200, `got ${res.status}`);
    check('source is "file"', body.meta.source === 'file', body.meta.source);
    check('events are returned', body.events.length > 0, `${body.events.length} events`);
    check(
      'only Nairobi, Mombasa and Diani',
      body.events.every((ev) => ['Nairobi', 'Mombasa', 'Diani'].includes(ev.city)),
      body.events.map((ev) => ev.city).join(', ')
    );
    check('sorted by date', body.events.every((ev, i, arr) => i === 0 || new Date(arr[i - 1].date) <= new Date(ev.date)));
  }

  console.log('\n2. approved events are served from the store');
  {
    await store.setJSON('approved', [
      {
        id: 'a',
        title: 'Test Show',
        date: '2027-06-01T20:00:00+03:00',
        venue: 'Test Hall',
        city: 'Nairobi',
        poster: 'images/site/bg.jpg',
        ticketUrl: 'https://example.com',
        source: 'test'
      },
      {
        id: 'b',
        title: 'Earlier Show',
        date: '2027-01-01T19:00:00+03:00',
        venue: 'Other Hall',
        city: 'Mombasa',
        poster: 'images/site/bg.jpg',
        ticketUrl: 'https://example.com',
        source: 'test'
      }
    ]);

    const res = await get();
    const body = await res.json();
    check('status 200', res.status === 200, `got ${res.status}`);
    check('source is "blobs"', body.meta.source === 'blobs', body.meta.source);
    check('count is 2', body.meta.count === 2, String(body.meta.count));
    check('sorted by date', body.events[0].id === 'b', body.events.map((e) => e.id).join(','));
  }

  console.log('\n3. cities outside the three allowed are dropped');
  {
    await store.setJSON('approved', [
      { id: 'x', title: 'Nakuru Show', date: '2027-02-01T20:00:00+03:00', venue: 'V', city: 'Nakuru', poster: '', ticketUrl: '', source: 'test' },
      { id: 'y', title: 'Diani Show', date: '2027-03-01T20:00:00+03:00', venue: 'V', city: 'Diani', poster: '', ticketUrl: '', source: 'test' }
    ]);
    const res = await get();
    const body = await res.json();
    check('Nakuru dropped', !body.events.some((ev) => ev.city === 'Nakuru'));
    check('Diani kept', body.events.some((ev) => ev.city === 'Diani'));
    check('count is 1', body.meta.count === 1, String(body.meta.count));
  }

  console.log('\n4. headers');
  {
    const res = await get();
    check('CORS origin', res.headers.get('access-control-allow-origin') === '*');
    check('cache-control s-maxage=300', (res.headers.get('cache-control') || '').includes('s-maxage=300'), res.headers.get('cache-control'));
    check('json content type', (res.headers.get('content-type') || '').includes('application/json'));
  }

  console.log('\n5. OPTIONS preflight');
  {
    const res = await eventsHandler(new Request('http://localhost/.netlify/functions/events', { method: 'OPTIONS' }));
    check('status 204', res.status === 204, `got ${res.status}`);
    check('CORS origin', res.headers.get('access-control-allow-origin') === '*');
  }

  console.log('\n6. the seed function');
  {
    process.env.SEED_KEY = 'test-key';

    const rejected = await seedHandler(
      new Request('http://localhost/.netlify/functions/seed-events', { method: 'POST', headers: { 'x-seed-key': 'wrong' } })
    );
    check('wrong key rejected', rejected.status === 401, `got ${rejected.status}`);

    const noKey = await seedHandler(
      new Request('http://localhost/.netlify/functions/seed-events', { method: 'POST' })
    );
    check('missing key rejected', noKey.status === 401, `got ${noKey.status}`);

    const seeded = await seedHandler(
      new Request('http://localhost/.netlify/functions/seed-events', { method: 'POST', headers: { 'x-seed-key': 'test-key' } })
    );
    const body = await seeded.json();
    check('right key accepted', seeded.status === 200, `got ${seeded.status}`);
    check('events seeded', body.seeded > 0, JSON.stringify(body));

    const res = await get();
    const served = await res.json();
    check('store is now the source', served.meta.source === 'blobs', served.meta.source);
    check('only allowed cities', served.events.every((ev) => ['Nairobi', 'Mombasa', 'Diani'].includes(ev.city)));
  }
} finally {
  await server.stop?.();
  await rm(directory, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
