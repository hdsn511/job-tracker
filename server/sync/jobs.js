const sql = require('../db');

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

function findExistingJob(existingJobs, { company, jobTitle, jobId }) {
  if (jobId) {
    const byRef = existingJobs.find((job) => {
      const match = (job.notes || '').match(REF_PATTERN);
      return match && match[1].toLowerCase() === String(jobId).toLowerCase();
    });
    if (byRef) return byRef;
  }

  if (!company) return null;

  return (
    existingJobs.find((job) => {
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

function buildNoteLine({ date, status, detail, jobId, isThirdParty }) {
  const day = date.toISOString().slice(0, 10);
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
  const existing = findExistingJob(existingJobs, { company, jobTitle, jobId });

  if (!existing) {
    const [row] = await sql`
      insert into jobs (company_name, job_title, status, application_date, notes, user_id)
      values (${company}, ${jobTitle || UNKNOWN_TITLE}, ${stage},
              ${earliest.toISOString().slice(0, 10)}, ${rebuildNotes('', syncLines)}, ${userId})
      returning *
    `;
    existingJobs.push(row);
    return { action: 'inserted', job: row };
  }

  const notes = rebuildNotes(existing.notes, syncLines);

  // A hand-edited row keeps its stage and title; only the timeline is
  // refreshed, so the user still sees new mail arriving without having their
  // decision overwritten.
  const nextStatus = existing.manual_override ? existing.status : stage || existing.status;
  const nextTitle = existing.manual_override
    ? existing.job_title
    : jobTitle || existing.job_title || UNKNOWN_TITLE;

  const [row] = await sql`
    update jobs
       set notes = ${notes}, status = ${nextStatus}, job_title = ${nextTitle}
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
};
