const sql = require('../db');
const { getSignalMessages: getInboundSignalMessages } = require('./inboundClassifications');

// Placeholder written when no role could be extracted. Treated as "no title
// yet" everywhere else, so a later email carrying the real role can match the
// row and fill it in.
const UNKNOWN_TITLE = 'Unknown title';

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'at']);
const COMPANY_SUFFIXES = /\b(inc|llc|corp|corporation|co|company|ltd)\b/g;

function normalizeStr(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companiesMatch(a, b) {
  const na = normalizeStr(a);
  const nb = normalizeStr(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function tokenize(s) {
  return normalizeStr(s)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

function titleSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union;
}

const REF_PATTERN = /\(ref:\s*([A-Za-z0-9-]+)\)/i;

function existingJobRef(job) {
  const match = (job.notes || '').match(REF_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

function findExistingJob(existingJobs, { company, jobTitle, jobId }) {
  if (jobId) {
    const byRef = existingJobs.find((job) => existingJobRef(job) === String(jobId).toLowerCase());
    if (byRef) return byRef;
  }

  if (!company) return null;

  return (
    existingJobs.find((job) => {
      // A row that already carries a DIFFERENT job id is a different
      // requisition, full stop -- however similar the titles read. Two
      // distinct Amazon postings both titled "Software Development
      // Engineer ..." collided here before this check existed: the second
      // one's applied/rejected messages got fuzzy-matched into the first
      // one's row and silently overwrote it, one incoming group at a time,
      // for every generic title Amazon (and similar large employers) reuse
      // across many reqs. Confirmed against real Gmail data auditing 6
      // Amazon applications where 2 vanished from the jobs table this way.
      // Only a row with NO ref of its own -- pre-dating job-id extraction,
      // or from a source that never had one -- is eligible for the fuzzy
      // fallback below.
      if (jobId) {
        const ref = existingJobRef(job);
        if (ref && ref !== String(jobId).toLowerCase()) return false;
      }
      if (!companiesMatch(company, job.company_name)) return false;
      if (!jobTitle || !job.job_title || job.job_title === UNKNOWN_TITLE) return true;
      return titleSimilarity(jobTitle, job.job_title) >= 0.4;
    }) || null
  );
}

// ---------------------------------------------------------------------------
// Authoritative stage derivation
// ---------------------------------------------------------------------------

const STAGES = ['Applied', 'Assessment', 'Interviewing', 'Offer', 'Rejected'];

// Assessment sits between Applied and Interviewing: real progress, but not a
// conversation with a human. Offer and Rejected share the top rank because
// both are terminal -- which of them wins is decided by date, not by rank.
const STATUS_RANK = { Applied: 1, Assessment: 2, Interviewing: 3, Offer: 4, Rejected: 4 };
const TERMINAL_STAGES = new Set(['Offer', 'Rejected']);

/**
 * The stage a job is actually at, given every classified message for it.
 *
 * This replaces the old "only ever ratchet upwards" rule. That rule is what
 * pinned a wrongly-Interviewing row in place forever: re-reading the mail
 * could never walk a status back down. Deriving from the whole set instead
 * means a re-read corrects itself.
 *
 * A terminal outcome wins outright, because you can be rejected after an
 * interview and the rejection is the answer. Between two terminal outcomes
 * the most recent one wins.
 */
function deriveStage(messages) {
  const staged = (messages || []).filter((m) => m.status);
  if (staged.length === 0) return null;

  const terminal = staged.filter((m) => TERMINAL_STAGES.has(m.status));
  if (terminal.length > 0) {
    return terminal.reduce((latest, m) => (m.date > latest.date ? m : latest)).status;
  }

  return staged.reduce((best, m) =>
    (STATUS_RANK[m.status] || 0) > (STATUS_RANK[best.status] || 0) ? m : best,
  ).status;
}

// ---------------------------------------------------------------------------
// Notes / timeline
// ---------------------------------------------------------------------------

// Calendar-day attribution (this timeline, application_date below) uses this
// fixed zone rather than raw UTC. `.toISOString().slice(0, 10)` was the
// original approach, but that dates anything sent after ~7pm Central as
// "tomorrow" the moment UTC rolls over -- a real, systemic off-by-one for
// evening applications, which are most of them. Single-user tool today; if
// this ever serves users in other timezones, this needs to become a
// per-user setting rather than a constant.
const LOCAL_TIMEZONE = 'America/Chicago';
const localDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TIMEZONE });

/** A Date's calendar day in LOCAL_TIMEZONE, as YYYY-MM-DD. */
function localDay(date) {
  return localDayFormatter.format(date);
}

function buildNoteLine({ date, status, detail, jobId, isThirdParty }) {
  const day = localDay(date);
  let line = `[${day}] ${status}`;
  if (detail && detail !== status) line += ` — ${detail}`;
  if (jobId) line += ` (ref: ${jobId})`;
  if (isThirdParty) line += ' [via third-party screener]';
  return line;
}

// A line this sync wrote looks like "[2026-08-29] Assessment — Assessment/OA".
// Hand-written notes essentially never take that shape, which is what lets a
// re-read replace its own output without touching the user's writing.
const SYNC_LINE_PATTERN = new RegExp(`^\\[\\d{4}-\\d{2}-\\d{2}\\]\\s*(?:${STAGES.join('|')})\\b`);

function isSyncAuthoredLine(line) {
  return SYNC_LINE_PATTERN.test(line.trim());
}

/**
 * Rebuilds the timeline: every sync-authored line is replaced with the freshly
 * derived set, while anything the user typed is preserved in place at the top.
 *
 * Appending instead would leave a stale, wrong line sitting next to its
 * correction after a re-classification -- the timeline would accumulate both
 * "Interviewing — Assessment/OA" and "Assessment — Assessment/OA" for the same
 * email.
 */
function rebuildNotes(existingNotes, syncLines) {
  const manual = String(existingNotes || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isSyncAuthoredLine(l));

  const fresh = [...new Set(syncLines)].sort();
  return [...manual, ...fresh].join('\n');
}

// ---------------------------------------------------------------------------
// Grouping messages into jobs
// ---------------------------------------------------------------------------

/**
 * Whether a classified message belongs to a group already being built.
 *
 * Job id is checked first and decides on its own: two Amazon applications can
 * have near-identical titles and are only told apart by their requisition id,
 * so a title heuristic would merge them.
 */
function belongsToGroup(group, message) {
  if (group.jobId && message.jobId) {
    return String(group.jobId).toLowerCase() === String(message.jobId).toLowerCase();
  }
  if (!companiesMatch(group.company, message.company)) return false;
  if (!group.jobTitle || !message.jobTitle) return true;
  return titleSimilarity(group.jobTitle, message.jobTitle) >= 0.4;
}

/**
 * Collects classified messages into one group per job. A group takes the best
 * available title and job id from any of its messages, so a confirmation that
 * named the role fills in for a later email that did not.
 */
function groupMessages(messages) {
  const groups = [];
  for (const message of messages) {
    if (!message.company) continue;
    let group = groups.find((g) => belongsToGroup(g, message));
    if (!group) {
      group = {
        company: message.company,
        jobTitle: message.jobTitle || null,
        jobId: message.jobId || null,
        isThirdParty: false,
        messages: [],
      };
      groups.push(group);
    }
    if (!group.jobTitle && message.jobTitle) group.jobTitle = message.jobTitle;
    if (!group.jobId && message.jobId) group.jobId = message.jobId;
    if (message.isThirdParty) group.isThirdParty = true;
    group.messages.push(message);
  }
  return groups;
}

async function getExistingJobs(userId) {
  return sql`select * from jobs where user_id = ${userId}`;
}

/**
 * Gmail OAuth's own signal messages -- the message_classifications-side
 * counterpart to inboundClassifications.js's getSignalMessages(), which
 * covers the forwarding/upload path's inbound_message_classifications
 * table. Kept separate for the same reason the two tables are separate: no
 * Gmail message id on the inbound side to key a shared table on.
 */
async function getOAuthSignalMessages(userId) {
  const rows = await sql`
    select message_date, stage, detail, company, job_title, job_id, is_third_party
      from message_classifications
     where user_id = ${userId}
       and is_noise = false
       and stage is not null
       and company is not null
  `;

  return rows.map((row) => ({
    date: row.message_date ? new Date(row.message_date) : new Date(),
    status: row.stage,
    detail: row.detail,
    company: row.company,
    jobTitle: row.job_title,
    jobId: row.job_id,
    isThirdParty: row.is_third_party,
  }));
}

/**
 * Every non-noise, staged signal message this user has, across BOTH
 * ingestion paths -- Gmail OAuth (message_classifications) and forwarding/
 * upload (inbound_message_classifications). Regrouping a job must see the
 * full picture regardless of which path triggered it: a regroup driven by
 * only one path's table silently erases the other path's contribution to a
 * shared job the next time it runs, since rebuildNotes() replaces every
 * sync-authored line with whatever the current call computed. Confirmed
 * against real data before this fix existed: an upload-derived rejection
 * for a job Gmail OAuth also had assessment mail for was one Gmail resync
 * away from being silently reverted, because the resync's regroup step only
 * ever considered message_classifications.
 */
async function getAllSignalMessages(userId) {
  const [oauth, inbound] = await Promise.all([
    getOAuthSignalMessages(userId),
    getInboundSignalMessages(userId),
  ]);
  return [...oauth, ...inbound];
}

/**
 * Writes one job from the full set of classified messages that belong to it.
 *
 * Unlike the old incremental upsert, this is authoritative: company, title,
 * stage and timeline are all re-derived from `messages`, so a re-read repairs
 * rows the previous classifier got wrong. The one thing it will not touch is a
 * row the user has edited by hand.
 */
async function upsertJobFromMessages(userId, existingJobs, group) {
  const { company, jobTitle, jobId, isThirdParty, messages } = group;

  const stage = deriveStage(messages);
  const syncLines = messages
    .filter((m) => m.status)
    .map((m) =>
      buildNoteLine({
        date: m.date,
        status: m.status,
        detail: m.detail,
        jobId: m.jobId || jobId,
        isThirdParty: m.isThirdParty,
      }),
    );

  const earliest = messages.reduce((min, m) => (m.date < min ? m.date : min), messages[0].date);
  const applicationDate = localDay(earliest);
  const existing = findExistingJob(existingJobs, { company, jobTitle, jobId });

  if (!existing) {
    const [row] = await sql`
      insert into jobs (company_name, job_title, status, application_date, notes, user_id)
      values (${company}, ${jobTitle || UNKNOWN_TITLE}, ${stage},
              ${applicationDate}, ${rebuildNotes('', syncLines)}, ${userId})
      returning *
    `;
    existingJobs.push(row);
    return { action: 'inserted', job: row };
  }

  // A hand-edited row (manual_override) is now frozen entirely -- status,
  // title, AND notes -- not just status/title. Notes used to always rebuild
  // regardless of the flag: rebuildNotes() replaces every sync-authored line
  // with what this job's classified messages currently say, on every
  // regroup, so a manually corrected or deleted timeline line (e.g. a false
  // "Interviewing" entry that never happened) was silently regenerated by
  // the very next resync. The user becomes the authority for a job the
  // moment they hand-edit it; new mail for that company after that point
  // needs a fresh correction by hand too -- the same tradeoff manual_override
  // already made for status, just applied consistently to notes as well.
  const notes = existing.manual_override ? existing.notes : rebuildNotes(existing.notes, syncLines);

  const nextStatus = existing.manual_override ? existing.status : stage || existing.status;
  const nextTitle = existing.manual_override
    ? existing.job_title
    : jobTitle || existing.job_title || UNKNOWN_TITLE;

  // application_date is re-derived every re-read, same as notes/stage --
  // it was previously frozen at whatever the first insert computed, which is
  // how a UTC-vs-local off-by-one from before this fix would have stayed
  // wrong forever even after the fix shipped.
  const [row] = await sql`
    update jobs
       set notes = ${notes}, status = ${nextStatus}, job_title = ${nextTitle}, application_date = ${applicationDate}
     where id = ${existing.id} and user_id = ${userId}
     returning *
  `;
  Object.assign(existing, row);
  return { action: 'updated', job: row };
}

module.exports = {
  UNKNOWN_TITLE,
  STAGES,
  STATUS_RANK,
  TERMINAL_STAGES,
  getExistingJobs,
  getAllSignalMessages,
  upsertJobFromMessages,
  groupMessages,
  belongsToGroup,
  normalizeStr,
  companiesMatch,
  titleSimilarity,
  findExistingJob,
  buildNoteLine,
  deriveStage,
  rebuildNotes,
  isSyncAuthoredLine,
  LOCAL_TIMEZONE,
  localDay,
};
