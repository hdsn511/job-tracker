require('dotenv').config();

const { getGmailClient } = require('./gmailAuth');
const { listCandidateMessageIds, getMessage } = require('./gmail');
const { classifyEmail } = require('./classifier');
const { classifyWithGemini } = require('./gemini');
const { listConnections, setLastSyncedAt } = require('./gmailConnections');
const { getExistingJobs, upsertClassifiedEmail } = require('./jobs');

// First sync for a newly connected account: how far back to look, since
// there's no prior watermark yet.
const DEFAULT_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;

// Gmail's per-user "units per minute" quota is easy to blow through on a
// large first-time backfill if messages.get calls fire back-to-back.
const FETCH_DELAY_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function syncConnection({ userId, gmailAddress, refreshToken, lastSyncedAt }) {
  const gmail = getGmailClient(refreshToken);
  const afterEpochSeconds = lastSyncedAt || Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_SECONDS;
  const runStartedAt = Math.floor(Date.now() / 1000);

  console.log(
    `\n=== ${gmailAddress} (user ${userId}) — since ${new Date(afterEpochSeconds * 1000).toISOString()} ===`,
  );

  const messageIds = await listCandidateMessageIds(gmail, { afterEpochSeconds });
  console.log(`Found ${messageIds.length} candidate message(s).`);

  const existingJobs = await getExistingJobs(userId);
  const summary = { inserted: 0, updated: 0, noise: 0, needsReview: 0, errors: 0 };

  for (const id of messageIds) {
    await sleep(FETCH_DELAY_MS);

    let email;
    try {
      email = await getMessage(gmail, id);
    } catch (err) {
      console.error(`Failed to fetch message ${id}: ${err.message}`);
      summary.errors += 1;
      continue;
    }

    let classified;
    try {
      classified = classifyEmail(email);
    } catch (err) {
      console.error(`Failed to classify message ${id} ("${email.subject}"): ${err.message}`);
      summary.errors += 1;
      continue;
    }

    if (classified.isNoise) {
      summary.noise += 1;
      continue;
    }

    if (classified.needsFallback) {
      const fallback = await classifyWithGemini(email);
      if (fallback) {
        classified.status = classified.status || fallback.status;
        classified.company = classified.company || fallback.company;
        classified.jobTitle = classified.jobTitle || fallback.jobTitle;
        if (!classified.detail && classified.status) classified.detail = classified.status;
      }
    }

    if (!classified.status || !classified.company) {
      summary.needsReview += 1;
      console.log(
        `NEEDS REVIEW — "${email.subject}" from ${email.from} (status=${classified.status}, company=${classified.company})`,
      );
      continue;
    }

    try {
      const result = await upsertClassifiedEmail(userId, existingJobs, classified, {
        date: new Date(email.date || Date.now()),
      });
      summary[result.action === 'inserted' ? 'inserted' : 'updated'] += 1;
      console.log(
        `${result.action.toUpperCase()} — ${classified.company} / ${result.job.job_title} -> ${result.job.status}`,
      );
    } catch (err) {
      console.error(`Failed to upsert for message ${id}: ${err.message}`);
      summary.errors += 1;
    }
  }

  if (summary.errors > 0) {
    // Some messages in this window weren't actually processed (e.g. a
    // quota error mid-run) — leave the watermark where it was so the next
    // run retries the same window instead of silently skipping them.
    // Already-inserted/updated jobs are safe to see again: upsert matches
    // by ref/company+title, and noise/needsReview emails just get
    // reclassified the same way.
    console.log(`Summary: ${JSON.stringify(summary)} — watermark NOT advanced due to errors, will retry this window next run.`);
  } else {
    await setLastSyncedAt(userId, runStartedAt);
    console.log('Summary:', summary);
  }
}

async function main() {
  const connections = await listConnections();

  if (connections.length === 0) {
    console.log('No Gmail connections found. Run `npm run get-token` to connect an account.');
    return;
  }

  for (const connection of connections) {
    try {
      await syncConnection(connection);
    } catch (err) {
      console.error(`Sync failed for user ${connection.userId} (${connection.gmailAddress}):`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
