/**
 * /.netlify/functions/discover
 *
 * A thin endpoint in front of the discovery run:
 *
 *   POST            starts a background run and answers 202 immediately
 *   GET ?status=1   the report of the last run, or "running" while it works
 *
 * The run itself lives in discover-background.mjs, because scraping several
 * listings (and reading the plain-HTML ones with Gemini) takes longer than
 * the 60 second synchronous limit. The report is written to the Blobs store
 * under "discover-last-run".
 *
 * Auth: x-discover-key: $DISCOVER_KEY
 * Query: ?dryRun=1   report without writing
 *         ?force=1    ignore the 25 day run guard
 */
import { json, openStore, preflight, safeEqual } from '../lib/events.mjs';
import { readReport, triggerDiscoveryRun } from '../lib/discovery.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  /* ---- auth ---- */
  const expected = process.env.DISCOVER_KEY;
  if (!expected) {
    return json({ error: 'DISCOVER_KEY is not set on this site' }, 503);
  }
  const provided = req.headers.get('x-discover-key') || '';
  if (!safeEqual(provided, expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(req.url);

  /* ---- status ---- */
  if (req.method === 'GET') {
    if (url.searchParams.get('status') !== '1') {
      return json({ error: 'Use GET ?status=1 for the last run' }, 400);
    }
    const store = openStore();
    const report = await readReport(store);
    if (!report) {
      return json({ status: 'never-run', runId: null, startedAt: null, finishedAt: null });
    }
    return json(report);
  }

  /* ---- start a run ---- */
  if (req.method === 'POST') {
    const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';
    const force = url.searchParams.get('force') === '1';

    const result = await triggerDiscoveryRun({
      origin: url.origin,
      dryRun,
      force,
      key: expected
    });

    if (!result.started) {
      return json({ ok: false, status: 'not-started', ...result }, 409);
    }

    console.log(`[discover] started run ${result.runId} (dryRun=${dryRun})`);
    return json(
      {
        ok: true,
        status: 'running',
        runId: result.runId,
        startedAt: result.startedAt,
        dryRun,
        poll: '/.netlify/functions/discover?status=1'
      },
      202
    );
  }

  return json({ error: 'Use POST to start a run, or GET ?status=1 for the last one' }, 405);
};
