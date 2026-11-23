/**
 * Offline test for the discovery endpoint and the background run — no Gemini
 * key, no network.
 *
 * It boots a local Netlify Blobs server, stubs fetch for the listing pages,
 * for Gemini and for the background trigger, and calls the handlers directly:
 *
 *   1. auth: missing DISCOVER_KEY, wrong key, on both handlers
 *   2. POST starts a background run and answers 202 at once
 *   3. GET ?status=1 returns the report of the last run
 *   4. every source is read and reported (ok / blocked / empty / error)
 *   5. JSON-LD pages are parsed without asking the model
 *   6. plain HTML is read by Gemini with no tools and no grounding
 *   7. a 503 is retried, and the model chain falls back
 *   8. at most two Gemini calls run at once
 *   9. irrelevant events are dropped
 *  10. the cap keeps only MAX_EVENTS events, and the rest are reported
 *  11. the sources that need no AI run first, and Gemini only if needed
 *  12. the cities are each represented
 *  13. Diani and Ukunda become Diani
 *  14. duplicates across sites are merged, and against the store skipped
 *  15. one broken source never fails the run
 *  16. a dry run writes nothing
 *  17. the run deadline marks the unfinished sources
 *
 *   node scripts/test-discover.mjs
 */
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const endpoint = (await import('../netlify/functions/discover.mjs')).default;
const background = (await import('../netlify/functions/discover-background.mjs')).default;
const { SOURCES } = await import('../netlify/lib/sources.mjs');
const { runDiscovery } = await import('../netlify/lib/discovery.mjs');

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
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const inDays = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const ldPage = (events) => `<!DOCTYPE html><html><head>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  itemListElement: events.map((event, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Event',
      name: event.title,
      startDate: event.date,
      url: event.url,
      description: event.description || '',
      genre: event.genre || '',
      location: {
        '@type': 'Place',
        name: event.venue,
        address: { '@type': 'PostalAddress', streetAddress: event.address || '', addressLocality: event.city || '' }
      }
    }
  }))
})}</script></head><body><h1>Events</h1></body></html>`;

const textPage = (lines) => `<!DOCTYPE html><html><body>${lines
  .map((line) => `<div><a href="${line.href}">${line.title}</a> <span>${line.date} ${line.venue}</span></div>`)
  .join('')}</body></html>`;

// Two pages carry the same show (AllEvents + Eventbrite) to test the merge.
// The Nairobi page also carries the kinds of event the line-up is not about.
const PAGES = {
  'allevents.in/nairobi': ldPage([
    { title: 'Kilimanjaro Sessions', date: inDays(20), venue: 'KICC Auditorium', city: 'Nairobi', url: 'https://allevents.in/nairobi/kilimanjaro', description: 'An evening of live music at the KICC' },
    { title: 'Ukunda Jazz Night', date: inDays(30), venue: 'Diani Beach Club, Ukunda', city: '', url: 'https://allevents.in/nairobi/ukunda-jazz', description: 'Jazz on the sand' },
    { title: 'Corporate Leadership Summit', date: inDays(32), venue: 'KICC', city: 'Nairobi', url: 'https://allevents.in/nairobi/leadership-summit', description: 'A one day conference for business leaders' },
    { title: 'Nairobi Fashion Week', date: inDays(45), venue: 'Kenyatta International Convention Centre', city: 'Nairobi', url: 'https://allevents.in/nairobi/fashion-week', description: 'A fashion show of designers and labels' },
    { title: 'Femme Frequencies', date: inDays(46), venue: 'MUZE', city: 'Nairobi', url: 'https://allevents.in/nairobi/femme-frequencies', description: 'A late night set' },
    { title: 'Keinemusik Nairobi', date: inDays(47), venue: 'KICC', city: 'Nairobi', url: 'https://allevents.in/nairobi/keinemusik', description: 'A live set' },
    { title: 'Nairobi City Marathon', date: inDays(12), venue: 'Nyayo National Stadium', city: 'Nairobi', url: 'https://allevents.in/nairobi/marathon', description: 'The annual marathon race' },
    { title: 'Sunday Worship Service', date: inDays(14), venue: 'St Johns Church', city: 'Nairobi', url: 'https://allevents.in/nairobi/worship', description: 'A church service with a choir' },
    { title: 'Beadwork Masterclass', date: inDays(16), venue: 'Village Market', city: 'Nairobi', url: 'https://allevents.in/nairobi/beadwork', description: 'A craft class for beginners' },
    { title: 'Mombasa Speedboat Tour', date: inDays(18), venue: 'Nyali', city: 'Mombasa', url: 'https://allevents.in/nairobi/speedboat', description: 'A boat tour of the harbour' },
    { title: 'Design Week Online Summit', date: inDays(22), venue: 'Online', city: 'Nairobi', url: 'https://allevents.in/nairobi/design-week', description: 'Join us online for a virtual conference' },
    { title: 'Free Concert Ticket Giveaway', date: inDays(26), venue: 'Online', city: 'Nairobi', url: 'https://allevents.in/nairobi/giveaway', description: 'Enter for a chance to win two tickets' },
    { title: 'Beauty Expo Kenya', date: inDays(27), venue: 'KICC', city: 'Nairobi', url: 'https://allevents.in/nairobi/beauty-expo', description: 'A trade exhibition of brands' },
    { title: 'Mama Africa Book Box BookFest', date: inDays(28), venue: 'Nairobi Pentecostal Bible College', city: 'Nairobi', url: 'https://allevents.in/nairobi/bookfest', description: 'A festival of books' },
    { title: 'PAW Kenya Purrfest Cat Show', date: inDays(29), venue: 'Mombasa', city: 'Mombasa', url: 'https://allevents.in/nairobi/purrfest', description: 'A cat show' },
    { title: 'Day Without A Date', date: inDays(31), venue: 'KICC', city: 'Nairobi', url: 'https://allevents.in/nairobi/day-without-a-date', description: 'A gathering' }
  ]),
  'allevents.in/mombasa': ldPage([
    { title: 'Harbour Lights', date: inDays(40) + 'T20:00:00+03:00', venue: 'Fort Jesus Amphitheatre', city: 'Mombasa', url: 'https://allevents.in/mombasa/harbour-lights', description: 'A festival of lights and music by the waterfront' }
  ]),
  'eventbrite.com/d/kenya--nairobi': ldPage([
    { title: 'Kilimanjaro Sessions', date: inDays(20), venue: 'KICC Auditorium', city: 'Nairobi', url: 'https://eventbrite.com/e/kilimanjaro', description: 'An evening of live music at the KICC' }
  ]),
  'exploringmombasa.com/events/mombasa': textPage([
    { title: 'Swahili Festival', href: 'https://exploringmombasa.com/event/swahili-festival/', date: inDays(50), venue: 'Old Town' }
  ]),
  'exploringmombasa.com/events/diani': textPage([
    { title: 'Ha Gwaan Diani', href: 'https://exploringmombasa.com/event/ha-gwaan-diani/', date: inDays(60), venue: 'Diani' }
  ]),
  'hustle.events': textPage([
    { title: 'NCBA KMI Motorshow', href: 'https://www.hustle.events/events/ncba-kmi', date: inDays(70), venue: 'Sarit Expo Centre, Nairobi' }
  ]),
  'ticketsasa.com/events': textPage([
    { title: 'RX Fest Round 3', href: 'https://ticketsasa.com/events/rx-fest-round-3', date: inDays(25), venue: 'Kasarani Safari Rally Ground' }
  ]),
  'mookh.com': textPage([
    { title: 'Lets get your money in order', href: 'https://mookh.com/letsgetyourmoneyinorder/', date: inDays(35), venue: 'Nairobi' }
  ])
};

// Each plain-HTML source gets its own answer, matched by the label in the prompt.
const GEMINI_BY_LABEL = {
  'Exploring Mombasa': [
    { title: 'Swahili Festival', date: inDays(50), time: '18:00', venue: 'Old Town', city: 'Mombasa', description: 'The annual festival of music and food', sourceUrl: 'https://exploringmombasa.com/event/swahili-festival/', ticketUrl: '' }
  ],
  'Exploring Mombasa — Diani': [
    { title: 'Ha Gwaan Diani', date: inDays(60), time: '16:00', venue: 'Diani', city: 'Diani', description: 'An arts and music festival in Diani', sourceUrl: 'https://exploringmombasa.com/event/ha-gwaan-diani/', ticketUrl: '' }
  ],
  Hustlesasa: [
    { title: 'Benga Night Live', date: inDays(70), time: '10:00', venue: 'Sarit Expo Centre, Nairobi', city: 'Nairobi', description: 'Live music by a celebrated band', sourceUrl: 'https://www.hustle.events/events/benga-night', ticketUrl: '' },
    { title: 'NCBA KMI Motorshow', date: inDays(71), time: '10:00', venue: 'Sarit Expo Centre, Nairobi', city: 'Nairobi', description: 'A three day motor show', sourceUrl: 'https://www.hustle.events/events/ncba-kmi', ticketUrl: '' }
  ],
  Ticketsasa: [
    { title: 'RX Fest Round 3', date: inDays(25), time: '07:00', venue: 'Kasarani Safari Rally Ground', city: 'Nairobi', description: 'A festival of live music and racing', sourceUrl: 'https://ticketsasa.com/events/rx-fest-round-3', ticketUrl: 'https://ticketsasa.com/events/rx-fest-round-3' }
  ],
  Mookh: [
    { title: 'Nairobi Jazz Night', date: inDays(35), time: '14:00', venue: 'Nairobi', city: 'Nairobi', description: 'Live jazz in the afternoon', sourceUrl: 'https://mookh.com/nairobijazznight/', ticketUrl: '' },
    { title: 'Lets get your money in order', date: inDays(36), time: '14:00', venue: 'Nairobi', city: 'Nairobi', description: 'A practical money guide', sourceUrl: 'https://mookh.com/letsgetyourmoneyinorder/', ticketUrl: '' }
  ]
};

const geminiReplyFor = (prompt) => {
  for (const [label, events] of Object.entries(GEMINI_BY_LABEL)) {
    if (String(prompt).includes(`"${label}"`)) return { events };
  }
  return { events: [] };
};

/* ------------------------------------------------------------------ */
/* Fetch stub: listings, Gemini and the background trigger            */
/* ------------------------------------------------------------------ */

let geminiCalls = [];
let geminiStatus = 200;
let geminiFail = null;      // { model, status, times }
let geminiDelay = 0;
let inFlight = 0;
let maxInFlight = 0;
let triggered = [];
const broken = new Set();

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input && input.url);

  // the trigger of the background function: run it here, right now
  if (url.includes('/.netlify/functions/discover-background')) {
    triggered.push(url);
    await background(
      new Request(url, {
        method: 'POST',
        headers: (init && init.headers) || {},
        body: (init && init.body) || '{}'
      })
    );
    return new Response('', { status: 202 });
  }

  if (url.includes('generativelanguage.googleapis.com')) {
    const body = init && init.body ? JSON.parse(init.body) : null;
    geminiCalls.push({ url, body });

    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (geminiDelay) await new Promise((r) => setTimeout(r, geminiDelay));
    inFlight -= 1;

    // a model that is made to fail, to test the chain
    const model = (url.match(/models\/([^:]+):/) || [])[1] || '';
    if (geminiFail && geminiFail.model === model && geminiFail.times > 0) {
      geminiFail.times -= 1;
      return new Response(JSON.stringify({ error: { message: 'nope' } }), {
        status: geminiFail.status,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (geminiStatus !== 200) {
      return new Response(JSON.stringify({ error: { message: 'quota' } }), {
        status: geminiStatus,
        headers: { 'content-type': 'application/json' }
      });
    }

    const prompt = body && body.contents && body.contents[0] && body.contents[0].parts[0].text;
    const reply = geminiReplyFor(prompt);
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  for (const [key, html] of Object.entries(PAGES)) {
    if (!url.includes(key)) continue;
    if (broken.has(key)) return new Response('nope', { status: 403 });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  }

  // a page that takes longer than the run deadline
  if (url.includes('slow-source')) {
    await new Promise((r) => setTimeout(r, 300));
    return new Response(
      ldPage([
        { title: 'Slow Gig', date: inDays(20), venue: 'Hall', city: 'Nairobi', url: 'https://example.com/slow', description: 'Live music' }
      ]),
      { status: 200, headers: { 'content-type': 'text/html' } }
    );
  }

  return realFetch(input, init);
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const call = (opts = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (opts.key !== undefined) headers['x-admin-token'] = undefined;
  if (opts.key !== undefined) headers['x-discover-key'] = opts.key;
  const query = opts.query ? '?' + opts.query : '';
  return endpoint(
    new Request('http://localhost/.netlify/functions/discover' + query, {
      method: opts.method || 'POST',
      headers,
      body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body || {})
    })
  );
};

const runBackground = (query = '') =>
  background(
    new Request('http://localhost/.netlify/functions/discover-background' + (query ? '?' + query : ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-discover-key': 'discover-key' },
      body: '{}'
    })
  );

const jsonOf = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

const resetStore = async () => {
  await store.setJSON('approved', []);
  await store.setJSON('pending', []);
  await store.setJSON('rejected', {});
  await store.setJSON('discover-last-run', {});
  await store.setJSON('discovery-state', {});
  delete process.env.MAX_EVENTS;
};

try {
  console.log('\n1. auth');
  {
    delete process.env.DISCOVER_KEY;
    const unset = await call({ key: 'x' });
    check('missing DISCOVER_KEY refused', unset.status === 503, `got ${unset.status}`);

    process.env.DISCOVER_KEY = 'discover-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    const wrong = await call({ key: 'nope' });
    check('wrong key refused', wrong.status === 401, `got ${wrong.status}`);

    const bgWrong = await background(
      new Request('http://localhost/.netlify/functions/discover-background', {
        method: 'POST',
        headers: { 'x-discover-key': 'nope' }
      })
    );
    check('the background function is protected too', bgWrong.status === 401, `got ${bgWrong.status}`);
  }

  console.log('\n2. POST starts a background run');
  {
    await resetStore();
    triggered = [];
    geminiCalls = [];

    const res = await call({ key: 'discover-key' });
    const body = await jsonOf(res);

    check('status 202', res.status === 202, `got ${res.status}`);
    check('a run id is returned', typeof body.runId === 'string' && body.runId.length > 4, body.runId);
    check('the status is running', body.status === 'running', body.status);
    check('the background function was triggered', triggered.length === 1, String(triggered.length));
    check('the report was written', !!(await readJson('discover-last-run')));
  }

  console.log('\n3. GET ?status=1 returns the report');
  {
    const res = await call({ key: 'discover-key', method: 'GET', query: 'status=1' });
    const body = await jsonOf(res);
    check('status 200', res.status === 200, `got ${res.status}`);
    check('the report is done', body.status === 'done', body.status);
    check('the sources are listed', Array.isArray(body.sources) && body.sources.length === SOURCES.length, String(body.sources && body.sources.length));
    check('the timestamps are there', !!body.startedAt && !!body.finishedAt);
    check('the duration is there', typeof body.durationMs === 'number');
    check('the cap is reported', body.maxEvents === 6, String(body.maxEvents));

    const noStatus = await call({ key: 'discover-key', method: 'GET' });
    check('GET without ?status=1 refused', noStatus.status === 400, `got ${noStatus.status}`);
  }

  console.log('\n4. every source is read and reported');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    geminiCalls = [];
    await runBackground();
    const report = await readJson('discover-last-run');

    check('the run finished', report.status === 'done', report.status);
    check('every source reported', report.sources.length === SOURCES.length, `${report.sources.length} of ${SOURCES.length}`);
    check('source ids match the config', report.sources.map((s) => s.id).join() === SOURCES.map((s) => s.id).join());
    check('all sources ok', report.sources.every((s) => s.status === 'ok' || s.status === 'skipped'), JSON.stringify(report.sources.map((s) => `${s.id}:${s.status}`)));
    check('the sources that need no AI are ok', report.sources.filter((s) => s.method === 'jsonld').every((s) => s.status === 'ok'), JSON.stringify(report.sources.filter((s) => s.method === 'jsonld').map((s) => `${s.id}:${s.status}`)));
    check('found counts reported', report.sources.every((s) => typeof s.found === 'number'), '');
    check('jsonld source found its events', report.sources.find((s) => s.id === 'allevents-nairobi').found === 6, String(report.sources.find((s) => s.id === 'allevents-nairobi').found));
    check('text source found its events', report.sources.find((s) => s.id === 'mookh').found === 1, String(report.sources.find((s) => s.id === 'mookh').found));
    check('the method is reported', report.sources.find((s) => s.id === 'mookh').method === 'text', report.sources.find((s) => s.id === 'mookh').method);
    delete process.env.MAX_EVENTS;
  }

  console.log('\n5. JSON-LD is parsed without the model');
  {
    geminiCalls = [];
    await runBackground();
    const calls = geminiCalls.filter((c) => c.url.includes('gemini'));
    check('Gemini called for the text sources only', calls.length === 5, String(calls.length));
    check('no grounding tools', calls.every((c) => !c.body.tools), JSON.stringify(calls[0] && calls[0].body.tools));
    check('no search tool', !calls.some((c) => JSON.stringify(c.body).includes('google_search')));
    check('model is the configured one', calls[0].url.includes('gemini-'), calls[0].url);
  }

  console.log('\n6. a 503 is retried');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    geminiCalls = [];
    geminiFail = { model: 'gemini-3.8-flash', status: 503, times: 2 };
    await runBackground();
    const report = await readJson('discover-last-run');
    const calls = geminiCalls.filter((c) => c.url.includes('gemini'));

    check('the run still produced events', report.kept > 0, String(report.kept));
    check('the model was called again', calls.length > 5, String(calls.length));
    check('the source is not in error', report.sources.every((s) => s.status !== 'error'), JSON.stringify(report.sources.map((s) => `${s.id}:${s.status}`)));
    geminiFail = null;
    delete process.env.MAX_EVENTS;
  }

  console.log('\n7. the model chain falls back');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    geminiCalls = [];
    geminiFail = { model: 'gemini-3.8-flash', status: 404, times: 99 };
    await runBackground();
    const report = await readJson('discover-last-run');
    const models = [...new Set(geminiCalls.map((c) => (c.url.match(/models\/([^:]+):/) || [])[1]).filter(Boolean))];

    check('the fallback model was used', models.includes('gemini-3.6-flash'), models.join(', '));
    check('the chain is in the report', Array.isArray(report.models) && report.models.length >= 2, JSON.stringify(report.models));
    check('the run still produced events', report.kept > 0, String(report.kept));
    geminiFail = null;
    delete process.env.MAX_EVENTS;
  }

  console.log('\n8. at most two Gemini calls run at once');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    geminiCalls = [];
    maxInFlight = 0;
    geminiDelay = 30;
    await runBackground();
    geminiDelay = 0;

    check('never more than two at once', maxInFlight <= 2, String(maxInFlight));
    check('more than one ran', maxInFlight === 2, String(maxInFlight));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n9. irrelevant events are dropped');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    await runBackground();
    const report = await readJson('discover-last-run');
    const nairobi = report.sources.find((s) => s.id === 'allevents-nairobi');
    const dropped = (title) => report.skipped.find((s) => s.title === title);

    check('the drop count is reported', typeof nairobi.dropped === 'number' && nairobi.dropped > 0, String(nairobi.dropped));
    check('the marathon is dropped', dropped('Nairobi City Marathon') && /irrelevant/.test(dropped('Nairobi City Marathon').reason), JSON.stringify(dropped('Nairobi City Marathon')));
    check('the worship service is dropped', dropped('Sunday Worship Service') && /irrelevant/.test(dropped('Sunday Worship Service').reason));
    check('the class is dropped', dropped('Beadwork Masterclass') && /irrelevant/.test(dropped('Beadwork Masterclass').reason));
    check('the tour is dropped', dropped('Mombasa Speedboat Tour') && /irrelevant/.test(dropped('Mombasa Speedboat Tour').reason));
    check('the online event is dropped', dropped('Design Week Online Summit') && /irrelevant/.test(dropped('Design Week Online Summit').reason));
    check('the giveaway is dropped', dropped('Free Concert Ticket Giveaway') && /irrelevant/.test(dropped('Free Concert Ticket Giveaway').reason));
    check('the expo is dropped', dropped('Beauty Expo Kenya') && /irrelevant/.test(dropped('Beauty Expo Kenya').reason), JSON.stringify(dropped('Beauty Expo Kenya')));
    check('the book fest is dropped', dropped('Mama Africa Book Box BookFest') && /irrelevant/.test(dropped('Mama Africa Book Box BookFest').reason), JSON.stringify(dropped('Mama Africa Book Box BookFest')));
    check('the cat show is dropped', dropped('PAW Kenya Purrfest Cat Show') && /irrelevant/.test(dropped('PAW Kenya Purrfest Cat Show').reason), JSON.stringify(dropped('PAW Kenya Purrfest Cat Show')));
    check('the motor show is dropped', dropped('NCBA KMI Motorshow') && /irrelevant/.test(dropped('NCBA KMI Motorshow').reason));
    check('the money guide is dropped', dropped('Lets get your money in order') && /irrelevant/.test(dropped('Lets get your money in order').reason));
    check('every drop has a reason', report.skipped.every((s) => !!s.reason));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n9b. the stage events are kept, and rank first');
  {
    await resetStore();
    await runBackground();
    const report = await readJson('discover-last-run');
    const titles = report.accepted.map((e) => e.title);

    check('the concert is kept', titles.includes('Kilimanjaro Sessions'), titles.join(' | '));
    check('the jazz night is kept', titles.includes('Ukunda Jazz Night'));
    check('the fashion show is kept', titles.includes('Nairobi Fashion Week'));
    check('"frequencies" counts as a stage event', titles.includes('Femme Frequencies'), titles.join(' | '));
    check('"musik" counts as a stage event', titles.includes('Keinemusik Nairobi'), titles.join(' | '));
    check('the conference is not in a full run', !titles.includes('Corporate Leadership Summit'), titles.join(' | '));
    check('it says why', report.skipped.some((s) => s.title === 'Corporate Leadership Summit' && /corporate or conference/.test(s.reason)), JSON.stringify(report.skipped.filter((s) => s.title === 'Corporate Leadership Summit')));
  }

  console.log('\n9c. corporate events come in when there are not enough stage events');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    await runBackground();
    const report = await readJson('discover-last-run');
    const titles = report.accepted.map((e) => e.title);

    check('the conference was allowed in', titles.includes('Corporate Leadership Summit'), titles.join(' | '));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n9d. a missing time stays TBA');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    await runBackground();
    const report = await readJson('discover-last-run');
    const withoutTime = report.accepted.find((e) => e.title === 'Ukunda Jazz Night');
    const withTime = report.accepted.find((e) => e.title === 'Kilimanjaro Sessions');
    const fromJsonLd = report.accepted.find((e) => e.title === 'Harbour Lights');

    check('the date is kept', withoutTime && withoutTime.date.slice(0, 10) === inDays(30), withoutTime && withoutTime.date);
    check('the time is not invented', withoutTime && withoutTime.timeKnown === false, JSON.stringify(withoutTime && withoutTime.timeKnown));
    check('the day starts at midnight', withoutTime && withoutTime.date.slice(11, 16) === '00:00', withoutTime && withoutTime.date);
    check('it is marked as all day', withoutTime && withoutTime.allDay === true, JSON.stringify(withoutTime && withoutTime.allDay));
    check('a real time from JSON-LD is kept', withTime && withTime.timeKnown === false, JSON.stringify(withTime && withTime.timeKnown));
    check('the real time survived', fromJsonLd && fromJsonLd.timeKnown === true, JSON.stringify(fromJsonLd && fromJsonLd.timeKnown));
    check('and the clock is right', fromJsonLd && fromJsonLd.date.slice(11, 16) === '20:00', fromJsonLd && fromJsonLd.date);
    delete process.env.MAX_EVENTS;
  }

  console.log('\n10. the cap keeps only MAX_EVENTS events');
  {
    await resetStore();
    process.env.MAX_EVENTS = '3';
    await runBackground();
    const report = await readJson('discover-last-run');
    const pending = (await readJson('pending')) || [];

    check('the cap is reported', report.maxEvents === 3, String(report.maxEvents));
    check('more candidates were found', report.candidatesFound > 3, String(report.candidatesFound));
    check('only the cap was kept', report.kept === 3, String(report.kept));
    check('the rest were dropped by the cap', report.droppedByCap + report.kept <= report.candidatesFound, `${report.droppedByCap} + ${report.kept} of ${report.candidatesFound}`);
    check('the dropped are listed', report.skipped.some((s) => /over the cap/.test(s.reason)));
    check('pending holds only the cap', pending.length === 3, String(pending.length));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n11. the sources that need no AI run first');
  {
    await resetStore();
    process.env.MAX_EVENTS = '2';
    geminiCalls = [];
    await runBackground();
    const report = await readJson('discover-last-run');
    const textSources = report.sources.filter((s) => s.method === 'text');

    check('no Gemini call was made', geminiCalls.filter((c) => c.url.includes('gemini')).length === 0, String(geminiCalls.length));
    check('the text sources were skipped', textSources.every((s) => s.status === 'skipped'), JSON.stringify(textSources.map((s) => `${s.id}:${s.status}`)));
    check('they say why', textSources.every((s) => /cap/.test(s.error || '')), JSON.stringify(textSources.map((s) => s.error)));
    check('the JSON-LD sources still ran', report.sources.filter((s) => s.method === 'jsonld').every((s) => s.status === 'ok'));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n12. the cities are each represented');
  {
    await resetStore();
    process.env.MAX_EVENTS = '3';
    await runBackground();
    const report = await readJson('discover-last-run');
    const cities = report.accepted.map((e) => e.city);

    check('three were kept', report.kept === 3, String(report.kept));
    check('Nairobi is there', cities.includes('Nairobi'), cities.join(', '));
    check('Mombasa is there', cities.includes('Mombasa'), cities.join(', '));
    check('Diani is there', cities.includes('Diani'), cities.join(', '));
    check('the first is Nairobi', cities[0] === 'Nairobi', cities.join(', '));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n13. Diani and Ukunda become Diani');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    await runBackground();
    const report = await readJson('discover-last-run');
    const ukunda = report.accepted.find((e) => e.title.includes('Ukunda'));
    const mombasa = report.accepted.find((e) => e.title === 'Harbour Lights');
    const diani = report.accepted.find((e) => e.title.includes('Gwaan'));

    check('Ukunda venue became Diani', ukunda && ukunda.city === 'Diani', ukunda && ukunda.city);
    check('Mombasa stayed Mombasa', mombasa && mombasa.city === 'Mombasa', mombasa && mombasa.city);
    check('Diani event stayed Diani', diani && diani.city === 'Diani', diani && diani.city);
    delete process.env.MAX_EVENTS;
  }

  console.log('\n14. duplicates across sites are merged');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    await runBackground();
    const report = await readJson('discover-last-run');
    const kilo = report.accepted.find((e) => e.title === 'Kilimanjaro Sessions');

    check('one event for both listings', report.accepted.filter((e) => e.title === 'Kilimanjaro Sessions').length === 1);
    check('both links kept', kilo && kilo.sources.length === 2, JSON.stringify(kilo && kilo.sources.map((s) => s.url)));
    check('the duplicate is reported', report.skipped.some((s) => s.reason === 'duplicate' && s.source === 'eventbrite-nairobi'));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n15. duplicates against the store are skipped');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    await store.setJSON('approved', [
      { id: 'a1', title: 'Harbour Lights', date: `${inDays(40)}T20:00:00+03:00`, venue: 'Fort Jesus', city: 'Mombasa', poster: '', ticketUrl: '', source: 'manual' }
    ]);
    await store.setJSON('rejected', {
      [`nairobi-jazz-night|${inDays(35)}|nairobi`]: { reason: 'not a real event', at: new Date().toISOString() }
    });

    await runBackground();
    const report = await readJson('discover-last-run');
    check('approved duplicate skipped', report.skipped.some((s) => s.title === 'Harbour Lights' && s.reason === 'duplicate'));
    check('rejected duplicate skipped', report.skipped.some((s) => s.title.includes('Jazz Night') && s.reason === 'duplicate'));
    check('approved event not accepted again', !report.accepted.some((e) => e.title === 'Harbour Lights'));
    delete process.env.MAX_EVENTS;
  }

  console.log('\n16. one broken source never fails the run');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    broken.add('mookh.com');
    await runBackground();
    const report = await readJson('discover-last-run');
    const mookh = report.sources.find((s) => s.id === 'mookh');

    check('the run still finished', report.status === 'done', report.status);
    check('blocked source reported', mookh && mookh.status === 'blocked', mookh && mookh.status);
    check('the other sources still ran', report.sources.filter((s) => s.status === 'ok').length === SOURCES.length - 1);
    check('the run still produced events', report.kept > 0, String(report.kept));
    broken.delete('mookh.com');
    delete process.env.MAX_EVENTS;
  }

  console.log('\n17. a dry run writes nothing');
  {
    await resetStore();
    await runBackground('dryRun=1');
    const report = await readJson('discover-last-run');
    const pending = (await readJson('pending')) || [];

    check('the report says dry run', report.dryRun === true);
    check('pending still empty', pending.length === 0, String(pending.length));
    check('the sources are still reported', report.sources.length === SOURCES.length);
  }

  console.log('\n18. the run deadline marks the unfinished sources');
  {
    await resetStore();
    const result = await runDiscovery({
      dryRun: true,
      deadlineMs: 60,
      maxEvents: 6,
      sources: [
        { id: 'slow', label: 'A slow source', url: 'https://example.com/slow-source', kind: 'jsonld', city: 'Nairobi' }
      ]
    });
    check('the source timed out', result.sources[0] && result.sources[0].status === 'timeout', JSON.stringify(result.sources));
    check('the timeouts are counted', result.timedOut === 1, String(result.timedOut));
    check('nothing was kept', result.kept === 0, String(result.kept));
  }

  console.log('\n19. a Gemini quota error is reported');
  {
    await resetStore();
    process.env.MAX_EVENTS = '20';
    geminiStatus = 429;
    await runBackground();
    const report = await readJson('discover-last-run');
    check('the run still finished', report.status === 'done', report.status);
    check('the sources report the quota error', report.sources.some((s) => /quota/i.test(s.error || '')), JSON.stringify(report.sources.map((s) => s.error)));
    check('the run is not ok', report.ok === false);
    geminiStatus = 200;
    delete process.env.MAX_EVENTS;
  }
} finally {
  await server.stop?.();
  await rm(directory, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
