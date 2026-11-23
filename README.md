# Mitchell Nungari — portfolio

Static portfolio (HTML, CSS, vanilla JS) with a small Netlify backend that
serves the events line-up to `events.html`.

```
events.html            the events page (grid / list / calendar views)
index.html             home
gallery.html           gallery
data/events.json       sample events used as the seed + offline fallback
assets/css/base.css    shared foundation (tokens, nav, menu, footer)
assets/css/events.css  events page styles
assets/js/base.js      Lenis, menu, nav, scroll reveals
assets/js/events.js    data layer (fetchEvents), filters, lightbox, .ics
assets/js/stage.js     Three.js stage rig (shared with the home hero)
netlify/functions/     events.mjs + seed-events.mjs
scripts/seed-events.mjs  local script that pushes events into Netlify Blobs
```

## Local preview (no backend)

The events page falls back to `data/events.json` when the function is not
reachable, so a plain static server is enough:

```bash
python -m http.server 8899
# open http://localhost:8899/events.html
```

## Netlify backend

### 1. Install

```bash
npm install
```

### 2. Run the whole site with the function attached

```bash
netlify dev
```

`netlify dev` serves the published directory at **http://localhost:8888** and
mounts the functions under `/.netlify/functions/*`, so the page talks to the
real endpoint instead of the static fallback.

### 3. Test the endpoint

```bash
# offline test of the function logic (boots a local Blobs server, no account needed)
npm test

# list of approved events
curl -s http://localhost:8888/.netlify/functions/events

# pretty printed
curl -s http://localhost:8888/.netlify/functions/events | npx json-pretty

# just the count and where the data came from (blobs | file)
curl -s http://localhost:8888/.netlify/functions/events | npx json -q ".meta"

# CORS preflight
curl -s -i -X OPTIONS http://localhost:8888/.netlify/functions/events
```

Expected shape:

```json
{
  "events": [ { "id": "...", "title": "...", "date": "2027-02-19T20:00:00+03:00", "venue": "...", "city": "Nairobi", "poster": "...", "ticketUrl": "...", "source": "sample" } ],
  "meta": { "source": "blobs", "count": 6, "generatedAt": "2026-11-13T00:00:00.000Z" }
}
```

### 4. Seed the Blobs store

The store is `events`, the key is `approved`. Two ways to fill it:

**a. Protected function (works with `netlify dev` and on production)**

```bash
# locally, with SEED_KEY set in .env
netlify dev
curl -s -X POST http://localhost:8888/.netlify/functions/seed-events \
  -H "x-seed-key: $SEED_KEY"

# against production
curl -s -X POST https://<your-site>.netlify.app/.netlify/functions/seed-events \
  -H "x-seed-key: $SEED_KEY"
```

The function reads `data/events.json`, keeps only Nairobi / Mombasa / Diani
events and writes them to the store. Without a matching `SEED_KEY` it returns
`401` and changes nothing.

**b. Local script (pushes to a deployed site)**

```bash
SITE_ID=<your-site-id> NETLIFY_AUTH_TOKEN=<personal-access-token> \
  node scripts/seed-events.mjs

# or from the Netlify CLI
netlify env:import .env
netlify functions:invoke seed-events
```

### 5. Deploy

```bash
netlify deploy --prod
```

Set `SEED_KEY` in the site's environment before using the seed endpoint:

```bash
netlify env:set SEED_KEY="<a long random string>"
```

## AI discovery (step 2)

`POST /.netlify/functions/discover` collects upcoming events in Nairobi,
Mombasa and Diani over the next 120 days (about four months).

There is **no Gemini Search grounding** — the free tier does not cover it.
Instead the function fetches the listings and reads them:

- pages with **schema.org JSON-LD** are parsed directly, with no AI at all;
- pages that are **plain HTML** are stripped to text (capped at 12k
  characters, with the link targets kept so full titles can be recovered
  from slugs) and read by Gemini **with no tools**.

It **never approves anything**. Candidates are validated, de-duplicated and
written to the `pending` key; only the admin page (step 4) can move an event
into `approved`.

| | |
|---|---|
| Sources | `netlify/lib/sources.mjs` — one entry per site, each fetched once |
| Model | `gemini-3.8-flash` (free tier), override with `GEMINI_MODEL` |
| Fallbacks | `GEMINI_FALLBACK_MODELS` — `gemini-3.6-flash`, then `gemini-3.5-flash-lite` |
| Grounding | none — the pages are fetched by the function |
| Runs | every source in parallel, 15 s each; one failure never stops the rest |
| Gemini calls | at most 5 per run, and **at most 2 at a time** |
| Timeout | 40 s per attempt, 2 attempts per model |
| Cap | **6 new events per run** (`MAX_EVENTS`) |
| Deadline | **4 minutes** for the whole run (`DISCOVER_DEADLINE_MS`) |
| Window | 120 days by default, `?days=1..180` to change it |
| Auth | `x-discover-key: $DISCOVER_KEY` |

### One run, six events

The run is deliberately small so it finishes quickly and the line-up stays
curated:

1. the sources that need **no AI** (AllEvents, Eventbrite) are read first,
   in parallel;
2. the candidates are **ranked** — the most on-topic first, then the soonest
   date, and each city (Nairobi, Mombasa, Diani) is given a turn so all three
   are represented where events exist;
3. only the **top 6** are kept and written to `pending`; the rest are listed
   in the report as *over the cap of 6 events*;
4. the sources that **need Gemini** only run if fewer than 6 were found, and
   Gemini stops being called the moment the cap is reached — the sources left
   over are reported as `skipped`.

Nothing that is already approved or pending counts towards the cap: only new,
relevant, non-duplicate events do.

### Gemini reliability

The run happens in a background function with 15 minutes to work in, so the
model gets a generous budget:

- **40 s per attempt** (`GEMINI_TIMEOUT_MS`);
- **2 attempts per model** — a timeout, a `429` or a `503` is retried with
  exponential backoff and a little jitter;
- **a model chain** — `GEMINI_MODEL` first, then each name in
  `GEMINI_FALLBACK_MODELS`. The first model gets both attempts; each
  fallback gets one, so a broken model cannot eat the whole run;
- **at most 2 calls at a time**, so a slow model never holds up the others.

### The run deadline

The whole run stops after `DISCOVER_DEADLINE_MS` (4 minutes). No new call is
started after that, and any source still working is reported as `timeout`.
The run finishes with whatever it already has.

### What counts as an event

Only the kinds of show the site is about are kept, in two tiers:

**Core — things that happen on a stage.** Music, concerts, festivals, live
shows, club nights and parties, DJ sets, raves, gigs, theatre, comedy and
fashion shows — plus the words these listings actually use: *musik*,
*frequencies*, *party*, *rave*, *dj*, *live*, *gig*, *lounge*, *dhow*,
*ep release*, *tequila*, *cocktail party*.

**Secondary — corporate events and conferences.** They are only used to fill a
run that has fewer core events than the cap; once there are enough stage
events, they are left out and the report says so.

Dropped, with the reason given: **sports, volunteering, religious services,
classes and training, tours and trips, online-only events, giveaways, expos,
book fests, cat shows** and anything else that never happens on a stage.
JSON-LD pages are judged on their category, genre and keywords; text pages on
the title and description.

### Never a made up time

If a source gives only a date, the event keeps that date and is marked
`timeKnown: false` — the site shows **"Time TBA"** and the `.ics` export
writes an all-day entry (`DTSTART;VALUE=DATE`). A time is only ever shown
when the source gave one.

### The endpoint and the background run

Scraping several listings and reading them with Gemini takes longer than a
synchronous function may run, so the work happens in a **background
function** and the endpoint is only a trigger:

| | |
|---|---|
| `POST /.netlify/functions/discover` | starts the run, answers **202** with a run id |
| `GET /.netlify/functions/discover?status=1` | the report of the last run, or `running` |
| `/.netlify/functions/discover-background` | the run itself — Netlify gives it **15 minutes** |

The report — per-source status, counts, the accepted and skipped lists and
the timestamps — is written to the Blobs store under `discover-last-run`,
where the status endpoint reads it.

```bash
# start a run (dry: reports without writing anything)
curl -s -X POST "https://nungari.netlify.app/.netlify/functions/discover?dryRun=1" \
  -H "x-discover-key: $DISCOVER_KEY"

# poll for the report
curl -s "https://nungari.netlify.app/.netlify/functions/discover?status=1" \
  -H "x-discover-key: $DISCOVER_KEY"
```

Two scripts do both, reading the key from a masked prompt:

```powershell
.\scripts\discover-dryrun.ps1   # dry run — nothing is written
.\scripts\discover-run.ps1     # a real run — candidates go to pending
```

Both start the run and then poll `?status=1` every 5 seconds for up to 8
minutes — waiting for the report to say `done` or `failed`, and printing the
sources that have finished so far while it works. Then they print the full
per-source table (status, method, found, dropped, error), the counts
(cap, candidates found, kept, dropped by the cap, dropped as irrelevant) and
the accepted and skipped lists. If the run came back with no sources at all,
they print the state and the error instead.

### Sources

Each was checked against its `robots.txt` first; only public pages are read.

| Source | Page | Data |
|---|---|---|
| AllEvents — Nairobi | `/nairobi` | JSON-LD |
| AllEvents — Mombasa | `/mombasa` | JSON-LD |
| Eventbrite — Nairobi | `/d/kenya--nairobi/events/` | JSON-LD, text fallback |
| Exploring Mombasa | `/events/` | text |
| Exploring Mombasa — Diani | `/events/diani/` | text |
| Hustlesasa | `hustle.events` | text |
| Ticketsasa | `/events` | text |
| Mookh | home page | text |

Dropped during the survey: `kujivinjari.com` (the domain does not resolve),
`discoverpwani.com` (parked), `mtickets.com` (needs JavaScript and its API
is robots-disallowed), `hustlesasa.com/events` (404 — the listing moved to
`hustle.events`), the Eventbrite Mombasa city page (404) and Mookh's
`/events` and `/calendar` (they time out).

Check them at any time — it prints the status and how much each page holds:

```bash
node scripts/check-sources.mjs
```

### Rules

- only Nairobi, Mombasa and Diani are kept; a Mombasa-area listing whose
  venue or address mentions **Diani or Ukunda** becomes Diani;
- dates are normalised to Nairobi time (`2027-02-19T20:00:00+03:00`);
- the same show on two sites is **merged into one event that keeps every
  source link**;
- duplicates against `approved`, `pending` and `rejected` are skipped, using
  the `slug(title) | date | city` key;
- scraped content is untrusted data — never followed, never executed, never
  written to `approved`.

```bash
# set the secrets on the site
netlify env:set GEMINI_API_KEY="<your gemini key>"
netlify env:set DISCOVER_KEY="<a long random string>"

# locally, with the same values in .env
netlify dev

# all three cities
curl -s -X POST http://localhost:8888/.netlify/functions/discover `
  -H "x-discover-key: $DISCOVER_KEY"

# one city, and a dry run that writes nothing
curl -s -X POST "http://localhost:8888/.netlify/functions/discover?city=nairobi&dryRun=1" `
  -H "x-discover-key: $DISCOVER_KEY"
```

Query parameters: `city=nairobi|mombasa|diani`, `days=1..180` (default 120),
`dryRun=1`.

What the function does with every candidate:

- keeps it only if the city is Nairobi, Mombasa or Diani, the date parses and
  falls inside the window, the title and venue are not empty, and there is an
  `http(s)` `sourceUrl`;
- normalises the date to Nairobi time (`2027-02-19T20:00:00+03:00`);
- skips anything whose `slug(title) | date | city` key is already in
  `approved`, `pending` or `rejected`;
- web content is treated as untrusted data — never followed, never executed,
  never written to `approved`.

Response:

```json
{
  "status": "done",
  "runId": "run-mwex5vy8-4fmys2",
  "startedAt": "2026-11-13T12:00:00.000Z",
  "finishedAt": "2026-11-13T12:00:06.000Z",
  "durationMs": 6084,
  "dryRun": true,
  "ok": true,
  "model": "gemini-3.8-flash",
  "models": ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
  "window": { "from": "2026-11-13", "to": "2027-03-13", "days": 120 },
  "maxEvents": 6,
  "candidatesFound": 24,
  "kept": 6,
  "droppedByCap": 18,
  "droppedIrrelevant": 39,
  "timedOut": 0,
  "sources": [
    { "id": "allevents-nairobi", "label": "AllEvents — Nairobi", "status": "ok", "method": "jsonld", "found": 25, "dropped": 39, "error": null },
    { "id": "mookh", "label": "Mookh", "status": "skipped", "method": "text", "found": 0, "dropped": 0, "error": "the cap of 6 events was already reached" }
  ],
  "accepted": [ { "id": "dis-…", "title": "…", "status": "pending", "discoveredAt": "…", "sources": [ { "title": "AllEvents — Nairobi", "url": "https://…" } ] } ],
  "skipped": [ { "title": "…", "source": "eventbrite-nairobi", "reason": "duplicate" } ],
  "pendingCount": 7
}
```

A source that fails or times out is marked `blocked`, `error` or `timeout` in
`sources` and the run carries on; a Gemini quota problem is reported the same
way.

## The monthly run (step 3)

`netlify/functions/discover-monthly.mjs` is a **scheduled function**:

```js
export const config = { schedule: '0 5 1 * *' };   // 05:00 UTC on the 1st = 08:00 in Nairobi
```

Cron runs in UTC. A scheduled function only lives for **30 seconds**, so it
does not do the work itself: it hands the run to the background function
(which Netlify lets run for up to **15 minutes**) and answers straight
away. On the first of every month it:

1. checks the 25 day guard — a run is not repeated inside the month (the
   marker lives in the `discovery-state` key), which protects the free
   Gemini quota if the function is triggered twice;
2. starts a background run — which prunes the pending list of past events,
   reads every source and merges the new candidates into `pending`.

Things worth knowing:

- scheduled functions only run on **published deploys** — not on deploy
  previews or branch deploys;
- they **cannot be called by URL** in production, so the endpoint is not a
  public way to burn quota;
- `netlify dev` shows a note instead of running them, because the local
  server has no scheduler. Use the CLI to trigger one by hand:

```powershell
# with `netlify dev` running on 8888
netlify functions:invoke discover-monthly --port 8888

# report without writing anything
netlify functions:invoke discover-monthly --port 8888 --querystring "dryRun=1"

# ignore the 25 day guard
netlify functions:invoke discover-monthly --port 8888 --querystring "force=1"
```

The schedule can also live in `netlify.toml` instead of the function:

```toml
[functions."discover-monthly"]
  schedule = "0 5 1 * *"
```

The manual endpoint (`POST /.netlify/functions/discover`, needs
`x-discover-key`) stays available for a one-off run at any time — and
`scripts\discover-dryrun.ps1` runs it against production with the key read
from a masked prompt:

```powershell
.\scripts\discover-dryrun.ps1
```

## The event desk (step 4)

`admin.html` is the private approval page. It is **not linked from anywhere**
on the site and is marked `noindex, nofollow`.

| | |
|---|---|
| URL | `https://<your-site>.netlify.app/admin.html` (or `/admin`) |
| Sign in | `ADMIN_PASSWORD` from the site environment |
| Token | HMAC-SHA256 signed with `ADMIN_SECRET`, valid for one hour |
| Rate limit | 5 failed logins, then a 15 minute lockout (kept in Blobs, so it survives a cold start) |
| Comparison | passwords and signatures are compared in constant time |

```powershell
netlify env:set ADMIN_PASSWORD="<a long password>"
netlify env:set ADMIN_SECRET="<a long random string>"
netlify deploy --prod
```

What the desk does:

- **Pending** — every discovered event, with the page it came from. Edit any
  field (title, date, venue, city, ticket URL, source URL), then **Approve**,
  **Reject** (with a reason — rejected events are filed under their dedupe key
  and are never proposed again) or **Delete**.
- **Approved** — the live line-up. Edit or delete anything, and add a manual
  event.
- **Rejected** — what was turned down, and why.
- **Poster** — optional. Paste a URL, or upload an image: it is resized in the
  browser, stored in the `posters` Blobs store and served from `/posters/<key>`
  through the `posters` function.

Approved events appear on `events.html` through the same
`/.netlify/functions/events` endpoint as before — nothing else changes.

### Events without a poster

A poster is optional, so an event without one gets a **generated card** in
its city's accent colour (Nairobi blue, Mombasa amber, Diani teal) with the
event title set in the display serif. The 4:5 box, the date badge and the
city tag stay exactly where they were — only the artwork is drawn instead of
photographed. The same component (`assets/css/citycard.css`) is used by the
admin thumbnails and the lightbox.

## How the page talks to the backend

`assets/js/events.js` keeps one function for all data:

```js
const EVENTS_SOURCE = {
  url: '/.netlify/functions/events',
  staticFallback: 'data/events.json'
};
```

`fetchEvents()` tries the function first and falls back to the static file if
the request fails (no network, 404, function not deployed). The UI never
changes when the data source changes — only `EVENTS_SOURCE.url` does.

The function itself does the same thing one level down: it serves the Blobs
store `events` / key `approved`, and falls back to `data/events.json` when
that store is empty. So there are two safe defaults in a row — the page never
ends up empty.

## Layout of the backend

```
netlify.toml
netlify/lib/events.mjs                 shared helpers (never deployed as a function)
netlify/lib/discovery.mjs               the discovery pipeline used by both entry points
netlify/lib/sources.mjs                 the listing sources, the fetcher and the extractors
netlify/functions/events.mjs           GET  /.netlify/functions/events
netlify/functions/discover.mjs          POST starts a background run, GET ?status=1 reports
netlify/functions/discover-background.mjs  the run itself (background function)
netlify/functions/discover-monthly.mjs   scheduled run - the 1st of every month, 05:00 UTC
netlify/functions/seed-events.mjs       POST /.netlify/functions/seed-events (needs x-seed-key)
netlify/functions/admin.mjs             the approval API behind admin.html
netlify/functions/posters.mjs           GET  /.netlify/functions/posters/<key>
admin.html                              the private event desk (noindex)
scripts/seed-events.mjs                 node script, pushes to a deployed site
scripts/discover-dryrun.ps1             dry run against production, key read from a masked prompt
scripts/discover-run.ps1                a real run against production, same key handling
scripts/check-sources.mjs               checks every listing source against the live sites
scripts/test-events.mjs                 npm test — offline test of the events function
scripts/test-discover.mjs               npm test — offline test of the discovery function
scripts/test-monthly.mjs                npm test — offline test of the scheduled run
scripts/test-admin.mjs                  npm test — offline test of the admin API
```

| Endpoint | Method | Auth | What it does |
|---|---|---|---|
| `/.netlify/functions/events` | GET | none | serves `{events:[…], meta:{…]}` |
| `/.netlify/functions/discover` | POST | `x-discover-key: $DISCOVER_KEY` | starts a background run, answers 202 |
| `/.netlify/functions/discover` | GET `?status=1` | `x-discover-key: $DISCOVER_KEY` | the report of the last run |
| `/.netlify/functions/discover-background` | POST | `x-discover-key: $DISCOVER_KEY` | the run itself — up to 15 minutes |
| `/.netlify/functions/discover-monthly` | scheduled | — | triggers the background run monthly |
| `/.netlify/functions/seed-events` | POST | `x-seed-key: $SEED_KEY` | writes `data/events.json` into Blobs |
| `/.netlify/functions/admin` | GET/POST | `x-admin-token` (HMAC) | login, list, approve, reject, delete, save, upload |
| `/.netlify/functions/posters/<key>` | GET | none | serves an uploaded poster |

All responses are CORS-safe (`access-control-allow-origin: *`) and the
events endpoint is cached for about five minutes
(`s-maxage=300`, `stale-while-revalidate=600`).

### Function limits (Netlify, free plan)

| Kind | Limit | Used for |
|---|---|---|
| Synchronous | 60 s | the events, admin and poster endpoints |
| Scheduled | 30 s | `discover-monthly` — it only triggers the run |
| Background | 15 min | `discover-background` — the scraping and the Gemini pass |

None of them are configurable, which is why the discovery run lives in a
background function and the scheduled function only starts it.

## Event shape

```json
{
  "id": "ev-nairobi-kilimanjaro-2027",
  "title": "Kilimanjaro Sessions",
  "date": "2027-02-19T20:00:00+03:00",
  "end": "2027-02-19T23:30:00+03:00",
  "venue": "KICC Auditorium",
  "city": "Nairobi",
  "poster": "images/site/jazz-festival-2017.jpg",
  "ticketUrl": "https://example.com/tickets/kilimanjaro-sessions",
  "source": "sample",
  "sourceUrl": "https://example.org/kilimanjaro",
  "status": "approved",
  "discoveredAt": "2026-11-13T04:51:13.918Z",
  "timeKnown": true,
  "allDay": false
}
```

`city` must be one of `Nairobi`, `Mombasa`, `Diani`; anything else is dropped
by the function before it reaches the page. `end` is optional — it defaults to
three hours after `date` and is used for the generated `.ics` file.
`sourceUrl`, `status` and `discoveredAt` are added by discovery; `status` is
one of `pending`, `approved`, `rejected`.

`timeKnown` is `false` when the source gave no time (the site shows "Time TBA"
and the `.ics` is an all-day entry); `allDay` says the source called it an
all-day event.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `discover` function | Google Gemini API key (free tier) |
| `GEMINI_MODEL` | `discover` function | optional model override (default `gemini-3.8-flash`) |
| `GEMINI_FALLBACK_MODELS` | `discover` function | fallback models, in order (default `gemini-3.6-flash,gemini-3.5-flash-lite`) |
| `GEMINI_TIMEOUT_MS` | `discover` function | one attempt may take this long (default `40000`) |
| `MAX_EVENTS` | `discover` function | new events one run may add (default `6`) |
| `DISCOVER_DEADLINE_MS` | `discover` function | how long the whole run may take (default `240000`) |
| `GEMINI_TIMEOUT_MS` | `discover` function | optional per-call timeout (default `35000`) |
| `DISCOVER_KEY` | `discover` function | shared secret for the discovery endpoint |
| `SEED_KEY` | `seed-events` function | shared secret for the seed endpoint |
| `ADMIN_PASSWORD` | admin page (step 4) | admin login password |
| `ADMIN_SECRET` | admin page (step 4) | secret used to sign admin tokens |
| `SITE_ID` | `scripts/seed-events.mjs` | Netlify site id for the API client |
| `NETLIFY_AUTH_TOKEN` | `scripts/seed-events.mjs` | personal access token |

Set them on the site (never in the client code):

```bash
netlify env:set GEMINI_API_KEY="<your gemini key>"
netlify env:set DISCOVER_KEY="<a long random string>"
netlify env:set SEED_KEY="<a long random string>"
netlify env:set ADMIN_PASSWORD="<a long password>"
netlify env:set ADMIN_SECRET="<a long random string>"
```

Copy `.env.example` to `.env` for local work — `.env` is git-ignored, and
`netlify dev` picks it up automatically.

## Not built yet

Nothing outstanding: the site, the events backend, the monthly discovery run
and the private approval desk are all in place.
