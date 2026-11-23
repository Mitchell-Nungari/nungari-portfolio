/**
 * The discovery run itself — a Netlify background function.
 *
 * The file name carries the `-background` suffix, so Netlify answers 202
 * immediately and keeps running for up to 15 minutes. That is what lets the
 * scraping (several listings plus a Gemini pass over the plain-HTML ones)
 * finish without hitting the 60 second synchronous limit.
 *
 * It is triggered by:
 *   - POST /.netlify/functions/discover        (the thin endpoint)
 *   - the monthly scheduled function
 *
 * The report — per-source status, counts, accepted and skipped events and
 * the timestamps — is written to the Blobs store under "discover-last-run",
 * where the status endpoint reads it.
 *
 * Auth: x-discover-key: $DISCOVER_KEY
 * Query: ?runId=…&dryRun=1
 */
import { json, openStore, safeEqual } from '../lib/events.mjs';
import {
  REPORT_KEY,
  runDiscovery,
  writeState
} from '../lib/discovery.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Use POST to run discovery' }, 405);
  }

  const key = process.env.DISCOVER_KEY;
  if (!key) return json({ error: 'DISCOVER_KEY is not set on this site' }, 503);
  if (!safeEqual(req.headers.get('x-discover-key') || '', key)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const runId = url.searchParams.get('runId') || `run-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  console.log(`[discover-background] run ${runId} starting (dryRun=${dryRun})`);

  const store = openStore();

  // the sources that have finished so far, so the status endpoint can show
  // progress while the run is still going
  const onSource = async (result, completed) => {
    try {
      await store.setJSON(REPORT_KEY, {
        status: 'running',
        runId,
        startedAt,
        dryRun,
        sources: completed.map((source) => ({
          id: source.id,
          label: source.label,
          url: source.url,
          status: source.status,
          method: source.method,
          found: source.found || 0,
          dropped: source.dropped || 0,
          error: source.error || null
        }))
      });
    } catch {
      /* the interim report is a nicety, never a failure */
    }
  };

  let result;
  try {
    // the model gets 40s per attempt and the whole run stops after
    // DISCOVER_DEADLINE_MS
    result = await runDiscovery({ dryRun, prune: true, timeoutMs: 40000, onSource });
  } catch (err) {
    const error = String(err && err.message ? err.message : err);
    console.error(`[discover-background] run ${runId} failed: ${error}`);
    await store.setJSON(REPORT_KEY, {
      status: 'failed',
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      dryRun,
      error,
      sources: [],
      accepted: [],
      skipped: []
    });
    return json({ ok: false, runId, error }, 500);
  }

  const finishedAt = new Date().toISOString();
  const report = {
    status: 'done',
    runId,
    startedAt,
    finishedAt,
    durationMs: Date.now() - t0,
    dryRun,
    ok: result.ok,
    model: result.model,
    models: result.models,
    window: result.window,
    maxEvents: result.maxEvents,
    candidatesFound: result.candidatesFound,
    kept: result.kept,
    droppedByCap: result.droppedByCap,
    droppedIrrelevant: result.droppedIrrelevant,
    timedOut: result.timedOut,
    sources: result.sources,
    accepted: result.accepted,
    skipped: result.skipped,
    pendingCount: result.pendingCount,
    prunedCount: result.prunedCount,
    approvedUntouched: true,
    error: null
  };

  await store.setJSON(REPORT_KEY, report);

  if (!dryRun) {
    await writeState(store, {
      lastRun: startedAt,
      lastRunId: runId,
      lastResult: {
        accepted: result.kept,
        candidates: result.candidatesFound,
        droppedByCap: result.droppedByCap,
        skipped: result.skipped.length,
        pruned: result.prunedCount,
        pending: result.pendingCount,
        durationMs: report.durationMs,
        sources: result.sources.map((source) => ({
          id: source.id,
          status: source.status,
          found: source.found
        }))
      }
    });
  }

  console.log(
    `[discover-background] run ${runId} done in ${report.durationMs}ms — ` +
      `found=${result.candidatesFound} kept=${result.kept} overCap=${result.droppedByCap} ` +
      `pruned=${result.prunedCount} pending=${result.pendingCount} dryRun=${dryRun}`
  );

  return json({ ok: true, runId, durationMs: report.durationMs, kept: result.kept });
};
