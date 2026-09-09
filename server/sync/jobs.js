const sql = require('../db');

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
      if (!jobTitle || !job.job_title) return true;
      return titleSimilarity(jobTitle, job.job_title) >= 0.4;
    }) || null
  );
}

const STATUS_RANK = { Applied: 1, Interviewing: 2, Offer: 3, Rejected: 3 };

function buildNoteLine({ date, status, detail, jobId, isThirdParty }) {
  const day = date.toISOString().slice(0, 10);
  let line = `[${day}] ${status}`;
  if (detail && detail !== status) line += ` — ${detail}`;
  if (jobId) line += ` (ref: ${jobId})`;
  if (isThirdParty) line += ' [via third-party screener]';
  return line;
}

function appendNote(existingNotes, newLine) {
  if (!existingNotes) return newLine;
  if (existingNotes.includes(newLine)) return existingNotes;
  return `${existingNotes}\n${newLine}`;
}

async function getExistingJobs(userId) {
  return sql`select * from jobs where user_id = ${userId}`;
}

/**
 * Inserts a new job row or updates an existing one for a classified,
 * non-noise email. Mutates `existingJobs` in place so later emails in the
 * same run can match against rows created earlier in the run.
 */
async function upsertClassifiedEmail(userId, existingJobs, classified, emailMeta) {
  const { company, jobTitle, jobId, status, detail, isThirdParty } = classified;
  const date = emailMeta.date instanceof Date ? emailMeta.date : new Date(emailMeta.date);
  const noteLine = buildNoteLine({ date, status, detail, jobId, isThirdParty });

  const existing = findExistingJob(existingJobs, { company, jobTitle, jobId });

  if (!existing) {
    const [row] = await sql`
      insert into jobs (company_name, job_title, status, application_date, notes, user_id)
      values (${company}, ${jobTitle || 'Unknown title'}, ${status}, ${date.toISOString().slice(0, 10)}, ${noteLine}, ${userId})
      returning *
    `;
    existingJobs.push(row);
    return { action: 'inserted', job: row };
  }

  const newNotes = appendNote(existing.notes, noteLine);
  const currentRank = STATUS_RANK[existing.status] || 0;
  const newRank = STATUS_RANK[status] || 0;
  const newStatus = newRank > currentRank ? status : existing.status;

  const [row] = await sql`
    update jobs set notes = ${newNotes}, status = ${newStatus}
    where id = ${existing.id} and user_id = ${userId}
    returning *
  `;
  Object.assign(existing, row);
  return { action: 'updated', job: row };
}

module.exports = {
  getExistingJobs,
  upsertClassifiedEmail,
  normalizeStr,
  companiesMatch,
  titleSimilarity,
  findExistingJob,
  buildNoteLine,
  STATUS_RANK,
};
