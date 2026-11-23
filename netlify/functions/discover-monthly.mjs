/**
 * Monthly discovery run.
 *
 * Scheduled by Netlify: `0 5 1 * *` is 05:00 UTC on the first of the month,
 * which is 08:00 in Nairobi. Scheduled functions only run on published
 * deploys and cannot be called by URL in production — use
 * `netlify functions:invoke discover-monthly` locally, or POST
 * /.netlify/functions/discover with the DISCOVER_KEY for a manual run.
 *
 * A scheduled function only lives for 30 seconds, so it does not do the
 * work itself: it hands the run to the background function
 * (discover-background.mjs), which Netlify lets run for up to 15 minutes,
 * and answers straight away.
 *
 * The 25 day guard keeps a run from being repeated inside the month, and
 * ?force=1 ignores it.
 */
import { json } from '../lib/events.mjs';
import { triggerDiscoveryRun } from '../lib/discovery.mjs';

export const config = {
  schedule: '0 5 1 * *'
};

export default async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';
  const force = url.searchParams.get('force') === '1';

  let nextRun = null;
  try {
    const body = await req.json();
    if (body && body.next_run) nextRun = body.next_run;
  } catch {
    // not a scheduled invocation (manual call)
  }

  const result = await triggerDiscoveryRun({
    origin: url.origin,
    dryRun,
    force,
    key: process.env.DISCOVER_KEY
  });

  if (!result.started) {
    console.log(`[discover-monthly] not started — ${result.reason}`);
    return json({ ok: false, started: false, reason: result.reason, nextRun });
  }

  console.log(`[discover-monthly] started run ${result.runId} (dryRun=${dryRun})`);
  return json({ ok: true, started: true, runId: result.runId, startedAt: result.startedAt, dryRun, nextRun });
};
