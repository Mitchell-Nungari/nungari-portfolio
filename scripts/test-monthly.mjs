/**
 * Offline test for the monthly scheduled run — no Gemini key, no network.
 *
 * A scheduled function only lives for 30 seconds, so it does not do the work
 * itself: it hands the run to the background function. This test checks that
 * it triggers it, that the 25 day guard holds, and that ?force=1 overrides
 * the guard.
 *
 *   node scripts/test-monthly.mjs
 */
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const monthly = (await import('../netlify/functions/discover-monthly.mjs')).default;
const { config } = await import('../netlify/functions/discover-monthly.mjs');

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
/* The background trigger is recorded, not run                        */
/* ------------------------------------------------------------------ */

let triggered = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : String(input && input.url);
  if (url.includes('/.netlify/functions/discover-background')) {
    triggered.push(url);
    return Promise.resolve(new Response('', { status: 202 }));
  }
  return realFetch(input, init);
};

const run = (query = '') =>
  monthly(
    new Request('http://localhost/.netlify/functions/discover-monthly' + (query ? '?' + query : ''), {
      method: 'POST',
      body: JSON.stringify({ next_run: '2026-12-01T05:00:00.000Z' }),
      headers: { 'content-type': 'application/json' }
    })
  );

try {
  console.log('\n1. the schedule');
  {
    check('config exported', !!config, JSON.stringify(config));
    check('cron expression set', typeof config.schedule === 'string' && config.schedule.length > 0, config.schedule);
    check('runs on the first of the month', /^[^ ]+ [^ ]+ 1 \* \*$/.test(config.schedule || ''), config.schedule);
  }

  console.log('\n2. it only triggers the background run');
  {
    process.env.DISCOVER_KEY = 'discover-key';
    await store.setJSON('discovery-state', {});
    await store.setJSON('pending', []);
    triggered = [];

    const res = await run();
    const body = await res.json();
    const pending = (await readJson('pending')) || [];

    check('status 200', res.status === 200, `got ${res.status}`);
    check('the background function was triggered', triggered.length === 1, String(triggered.length));
    check('a run id comes back', typeof body.runId === 'string' && body.runId.length > 4, body.runId);
    check('the run was started', body.started === true);
    check('the scheduled function did no work itself', pending.length === 0, String(pending.length));
    check('the trigger carries the key', (triggered[0] || '').indexOf('runId=') !== -1, triggered[0]);
  }

  console.log('\n3. the 25 day guard');
  {
    await store.setJSON('discover-last-run', {});
    await store.setJSON('discovery-state', { lastRun: new Date().toISOString(), lastRunId: 'x' });
    triggered = [];

    const res = await run();
    const body = await res.json();

    check('the run was not started', body.started === false, JSON.stringify(body));
    check('the reason is the guard', /already ran this month/.test(body.reason || ''), body.reason);
    check('nothing was triggered', triggered.length === 0, String(triggered.length));
  }

  console.log('\n4. a run older than 25 days is allowed again');
  {
    await store.setJSON('discover-last-run', {});
    const old = new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString();
    await store.setJSON('discovery-state', { lastRun: old, lastRunId: 'x' });
    triggered = [];

    const res = await run();
    const body = await res.json();

    check('the run was started', body.started === true, JSON.stringify(body));
    check('the background function was triggered', triggered.length === 1, String(triggered.length));
  }

  console.log('\n5. force=1 runs again');
  {
    await store.setJSON('discover-last-run', {});
    await store.setJSON('discovery-state', { lastRun: new Date().toISOString(), lastRunId: 'x' });
    triggered = [];

    const res = await run('force=1');
    const body = await res.json();

    check('the run was started', body.started === true, JSON.stringify(body));
    check('the background function was triggered', triggered.length === 1, String(triggered.length));
  }
} finally {
  await server.stop?.();
  await rm(directory, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
