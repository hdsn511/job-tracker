const { getGmailClient } = require('../gmailAuth');
const { listCandidateMessageIds, getMessage } = require('./gmail');
const { resolveMessage } = require('./resolve');
const { listConnections, setLastSyncedAt } = require('./gmailConnections');
const { loadCached, saveClassification } = require('./classificationCache');
const { getLlmStats, resetLlmStats, activeProvider, activeModel } = require('./llm');
const { getExistingJobs, getAllSignalMessages, upsertJobFromMessages, groupMessages } = require('./jobs');

// Used when a connection has no explicit start date — the historical default.
const DEFAULT_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;

// Gmail's per-user "units per minute" quota is easy to blow through on a
// large first-time backfill if messages.get calls fire back-to-back. Only
// paid on a cache miss, so a re-read of an already-classified window is fast.
const FETCH_DELAY_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The floor of the sync window, in epoch seconds.
 *
 * This is the whole window, every run — not "since we last looked". The sync
 * is a re-read: it re-examines everything back to the start date so that
 * classifier improvements apply retroactively and a stage that was wrong can
 * be corrected. The classification cache is what keeps that affordable.
 */
function windowFloorSeconds(syncStartDate) {
  if (syncStartDate) {
    return Math.floor(new Date(syncStartDate).getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_SECONDS;
}

/**
 * Syncs one connected Gmail account into the jobs table and returns a summary.
 * Shared by the scheduled CLI run and the app's "Resync inbox" endpoint.
 *
 * `log` is injectable so the CLI can print progress while the API stays quiet.
 */
async function syncConnection(
  { userId, gmailAddress, refreshToken, syncStartDate },
  { log = () => {} } = {},
) {
  const gmail = getGmailClient(refreshToken);
  const afterEpochSeconds = windowFloorSeconds(syncStartDate);
  const runStartedAt = Math.floor(Date.now() / 1000);

  log(`\n=== ${gmailAddress} (user ${userId}) — re-reading since ${new Date(afterEpochSeconds * 1000).toISOString().slice(0, 10)} ===`);

  resetLlmStats();
  const messageIds = await listCandidateMessageIds(gmail, { afterEpochSeconds });
  log(`Found ${messageIds.length} candidate message(s) in the window.`);

  const cache = await loadCached(userId, messageIds);
  log(`${cache.size} already classified, ${messageIds.length - cache.size} to classify.`);

  const summary = {
    inserted: 0,
    updated: 0,
    noise: 0,
    needsReview: 0,
    errors: 0,
    cacheHits: cache.size,
    classified: 0,
  };

  const classified = [];

  for (const id of messageIds) {
    const cached = cache.get(id);
    if (cached && cached.date) {
      if (cached.isNoise) summary.noise += 1;
      else classified.push(cached);
      continue;
    }

    await sleep(FETCH_DELAY_MS);

    let email;
    try {
      email = await getMessage(gmail, id);
    } catch (err) {
      log(`Failed to fetch message ${id}: ${err.message}`);
      summary.errors += 1;
      continue;
    }

    let result;
    // Whether the LLM failed while classifying THIS message, as opposed to
    // being absent entirely. The distinction decides whether the answer is
    // worth caching.
    const failuresBefore = getLlmStats().failed;
    try {
      result = await resolveMessage(email);
      result.date = new Date(email.date || Date.now());
      summary.classified += 1;
    } catch (err) {
      log(`Failed to classify message ${id} ("${email.subject}"): ${err.message}`);
      summary.errors += 1;
      continue;
    }
    const degraded = getLlmStats().failed > failuresBefore;

    if (degraded) {
      // The LLM was expected but errored (dead model, exhausted quota), so
      // this result came from the weaker rules path. Caching it would be a
      // trap: the cache is keyed only by message id, so once the quota is
      // restored the message would never be re-examined. Leave it uncached
      // and it is simply reclassified on the next run.
      summary.uncachedDegraded = (summary.uncachedDegraded || 0) + 1;
    } else {
      try {
        await saveClassification(userId, id, result);
      } catch (err) {
        // A cache write failure costs an LLM call next run but is not fatal.
        log(`Could not cache classification for ${id}: ${err.message}`);
      }
    }

    if (result.isNoise) {
      summary.noise += 1;
      continue;
    }
    classified.push(result);
  }

  const usable = classified.filter((r) => {
    if (!r.status || !r.company) {
      summary.needsReview += 1;
      log(`NEEDS REVIEW — company=${r.company} stage=${r.status} (source=${r.source})`);
      return false;
    }
    return true;
  });

  const existingJobs = await getExistingJobs(userId);
  // Grouping/upsert has to see this user's FULL signal history, not just
  // this run's OAuth-scoped `usable` -- a job with mail from both this path
  // and the forwarding/upload path would otherwise have its regroup
  // silently drop whatever the other path contributed, the next time
  // whichever path runs last wins. `usable` (above) still drives the
  // needsReview/noise counts, since those are specifically about what this
  // run classified.
  const allSignal = await getAllSignalMessages(userId);
  const groups = groupMessages(allSignal);
  log(`${usable.length} classified message(s) this run -> ${groups.length} job(s) across all signal.`);

  for (const group of groups) {
    try {
      const result = await upsertJobFromMessages(userId, existingJobs, group);
      summary[result.action === 'inserted' ? 'inserted' : 'updated'] += 1;
      log(`${result.action.toUpperCase()} — ${result.job.company_name} / ${result.job.job_title} -> ${result.job.status}`);
    } catch (err) {
      log(`Failed to upsert ${group.company} / ${group.jobTitle}: ${err.message}`);
      summary.errors += 1;
    }
  }

  const llm = getLlmStats();
  const provider = activeProvider();
  // Surfaced so the app (and whoever's reading the resync response) can see
  // which provider actually ran without having to go dig through Vercel's
  // environment-variable dashboard — env vars set locally and what's set on
  // the deployed backend are two different things, and this is the one
  // place they're both provable from the same run.
  summary.llmProvider = provider ? provider.name : null;
  summary.llmModel = provider ? activeModel() : null;
  summary.llmAttempted = llm.attempted;
  summary.llmFailed = llm.failed;
  summary.llmNotConfigured = llm.notConfigured;
  if (llm.notConfigured > 0) {
    // Distinct from a failed call and far more likely in a fresh deploy: the
    // key never made it into the environment. Silent otherwise, because
    // nothing is attempted and so nothing can fail.
    log(
      `WARNING: ${llm.notConfigured} messages were classified by the rules alone ` +
      `because no LLM provider is configured. Set LLM_PROVIDER and the matching ` +
      `API key (see server/.env.example); stage accuracy is materially worse without it.`,
    );
  }
  if (llm.failed > 0) {
    // Loud, because the pipeline degrades to rules silently by design. A
    // retired model or an exhausted quota otherwise looks like a good run.
    log(
      `WARNING: ${llm.failed}/${llm.attempted} LLM classifications failed — ` +
      `these fell back to the rule engine, which is less accurate on stage. ` +
      `Last error: ${llm.lastError}`,
    );
  }

  // `last_synced_at` is now purely informational — the window is anchored to
  // the start date, not to this timestamp — so it is safe to advance even
  // after errors. Anything that failed is simply retried on the next re-read.
  await setLastSyncedAt(userId, runStartedAt);
  log(`Summary: ${JSON.stringify(summary)}`);

  return { summary, syncedAt: runStartedAt };
}

/** Every connected account in turn — what the scheduled job runs. */
async function syncAllConnections({ log = () => {} } = {}) {
  const connections = await listConnections();

  if (connections.length === 0) {
    log('No Gmail connections found. Connect an account from the app, or run `npm run get-token`.');
    return [];
  }

  const results = [];
  for (const connection of connections) {
    try {
      results.push(await syncConnection(connection, { log }));
    } catch (err) {
      log(`Sync failed for user ${connection.userId} (${connection.gmailAddress}): ${err.message}`);
    }
  }
  return results;
}

module.exports = {
  syncConnection,
  syncAllConnections,
  windowFloorSeconds,
  DEFAULT_LOOKBACK_SECONDS,
};
