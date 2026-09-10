require('dotenv').config();

// Checks what fraction of the messages that actually produced a status-event
// in this user's job history a candidate forwarding filter would have
// forwarded. Read-only against Gmail (via the existing OAuth connection,
// used purely as an oracle here) and against the DB -- writes nothing.
//
// This only tests the shared-personal-inbox cohort: a dedicated job-search
// inbox using Gmail's native "Forward a copy of incoming mail" setting has
// no filter criteria to miss and gets 100% recall by construction.
//
// Ground truth comes from `message_classifications`, not from fuzzy-matching
// the `jobs` table: that cache already stores, keyed exactly by
// gmail_message_id, the stage/company/job_title this app derived for every
// message the real sync has ever fetched in-window -- including noise. So
// "which message produced which status-event" is an exact lookup, not an
// approximation.
//
// Usage:
//   node scripts/test-filter-recall.js --user-id=3
//   TEST_FILTER_USER_ID=3 node scripts/test-filter-recall.js
//   TARGET_USER_EMAIL=you@example.com node scripts/test-filter-recall.js

const sql = require('../db');
const { getGmailClient } = require('../gmailAuth');
const { getConnection, getUserIdByEmail } = require('../sync/gmailConnections');
const { listCandidateMessageIds } = require('../sync/gmail');
const { windowFloorSeconds } = require('../sync/index');
const { CANDIDATE_FILTERS } = require('../sync/forwardingPredicates');

// Gmail's per-user quota applies just as much to a read-only script as to the
// real sync -- same courtesy delay as sync/index.js's FETCH_DELAY_MS.
const FETCH_DELAY_MS = 150;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);

function parseUserIdFlag() {
  const eqArg = process.argv.find((a) => a.startsWith('--user-id='));
  if (eqArg) return Number(eqArg.split('=')[1]);
  const idx = process.argv.indexOf('--user-id');
  if (idx !== -1 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return null;
}

async function resolveUserId() {
  const flagged = parseUserIdFlag();
  if (flagged) return flagged;
  if (process.env.TEST_FILTER_USER_ID) return Number(process.env.TEST_FILTER_USER_ID);
  if (process.env.TARGET_USER_EMAIL) return getUserIdByEmail(process.env.TARGET_USER_EMAIL);
  throw new Error(
    'No user specified. Pass --user-id=<id>, set TEST_FILTER_USER_ID, or set TARGET_USER_EMAIL.',
  );
}

/** Metadata-only fetch: just enough to evaluate a filter predicate, without
 * the full-body cost of sync/gmail.js's getMessage(). */
async function getMessageMeta(gmail, id) {
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'metadata',
    metadataHeaders: ['From', 'Subject'],
  });
  const headers = (data.payload && data.payload.headers) || [];
  const header = (name) => {
    const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : '';
  };
  return {
    from: header('From'),
    subject: header('Subject'),
    snippet: data.snippet || '',
    labelIds: data.labelIds || [],
  };
}

function categoryLabel(labelIds) {
  const known = (labelIds || []).filter((l) => l.startsWith('CATEGORY_'));
  return known.length ? known.map((l) => l.replace('CATEGORY_', '')).join(',') : '-';
}

async function main() {
  const userId = await resolveUserId();
  const connection = await getConnection(userId);
  if (!connection) {
    throw new Error(`No Gmail connection found for user ${userId}. Connect one from the app first.`);
  }

  const gmail = getGmailClient(connection.refreshToken);
  const afterEpochSeconds = windowFloorSeconds(connection.syncStartDate);

  console.log(
    `Testing filter recall for user ${userId} (${connection.gmailAddress}), ` +
      `window since ${new Date(afterEpochSeconds * 1000).toISOString().slice(0, 10)}\n`,
  );

  const messageIds = await listCandidateMessageIds(gmail, { afterEpochSeconds });
  console.log(`${messageIds.length} candidate message(s) in the sync window.`);

  const [{ count: totalJobs }] = await sql`
    select count(*)::int as count from jobs where user_id = ${userId} and archived = false
  `;

  const classifiedRows = await sql`
    select gmail_message_id, message_date, is_noise, stage, detail, company, job_title
      from message_classifications
     where user_id = ${userId}
       and gmail_message_id = any(${messageIds})
  `;
  const classifiedById = new Map(classifiedRows.map((r) => [r.gmail_message_id, r]));

  const uncached = messageIds.filter((id) => !classifiedById.has(id));
  if (uncached.length > 0) {
    console.log(
      `${uncached.length} candidate message(s) have no cached classification yet -- ` +
        `run \`npm run sync\` first so this test covers the full window. Continuing with what's cached.`,
    );
  }

  const signalRows = classifiedRows.filter((r) => !r.is_noise && r.stage);
  console.log(
    `${totalJobs} tracked application(s); ${signalRows.length} classified status-event(s) to check recall against.\n`,
  );

  if (signalRows.length === 0) {
    console.log('Nothing to check -- no classified status-events in this window.');
    return;
  }

  const messages = [];
  for (const row of signalRows) {
    await sleep(FETCH_DELAY_MS);
    let meta;
    try {
      meta = await getMessageMeta(gmail, row.gmail_message_id);
    } catch (err) {
      console.log(`Failed to fetch metadata for ${row.gmail_message_id}: ${err.message}`);
      continue;
    }
    messages.push({ ...meta, row });
  }

  const filterNames = Object.keys(CANDIDATE_FILTERS);

  for (const name of filterNames) {
    const wouldForward = CANDIDATE_FILTERS[name];
    const results = messages.map((m) => ({ m, forwarded: wouldForward(m) }));
    const caught = results.filter((r) => r.forwarded).length;
    const misses = results.filter((r) => !r.forwarded);

    console.log('='.repeat(100));
    console.log(`${name} -- recall: ${caught}/${results.length} (${((caught / results.length) * 100).toFixed(1)}%)`);

    const byStage = {};
    for (const { m, forwarded } of results) {
      const stage = m.row.stage;
      byStage[stage] = byStage[stage] || { n: 0, caught: 0 };
      byStage[stage].n += 1;
      if (forwarded) byStage[stage].caught += 1;
    }
    console.log('  by stage:');
    for (const [stage, v] of Object.entries(byStage)) {
      console.log(`    ${pad(stage, 14)} ${v.caught}/${v.n}`);
    }

    if (misses.length > 0) {
      console.log('\n  misses:');
      console.log(
        '  ' + pad('COMPANY', 22) + pad('STAGE', 14) + pad('CATEGORY', 12) +
          pad('DATE', 12) + 'SUBJECT',
      );
      for (const { m } of misses) {
        const date = m.row.message_date ? new Date(m.row.message_date).toISOString().slice(0, 10) : '-';
        console.log(
          '  ' + pad(m.row.company, 22) + pad(m.row.stage, 14) + pad(categoryLabel(m.labelIds), 12) +
            pad(date, 12) + String(m.subject || '').slice(0, 70),
        );
      }
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
