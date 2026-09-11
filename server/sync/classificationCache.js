// Per-message classification cache.
//
// The resync is a re-read: every run re-examines the whole window rather than
// only what arrived since the last run. That is what makes classifier fixes
// retroactive, but without a cache it would also re-send every message to the
// LLM on every run. Keyed by Gmail message id, a message is classified once.
//
// Stores derived fields only. The subject and body are never persisted --
// redacting what we send to the LLM would be pointless if the raw mail were
// sitting in our own database.

const sql = require('../db');

/** Cached classifications for the given message ids, as a Map by message id. */
async function loadCached(userId, messageIds) {
  const cache = new Map();
  if (!messageIds || messageIds.length === 0) return cache;

  const rows = await sql`
    select gmail_message_id, message_date, is_noise, reason, stage, detail,
           company, job_title, job_id, ats, is_third_party, source, message_id_header
      from message_classifications
     where user_id = ${userId}
       and gmail_message_id = any(${messageIds})
  `;

  for (const row of rows) {
    cache.set(row.gmail_message_id, {
      date: row.message_date ? new Date(row.message_date) : null,
      isNoise: row.is_noise,
      reason: row.reason,
      status: row.stage,
      detail: row.detail,
      company: row.company,
      jobTitle: row.job_title,
      jobId: row.job_id,
      ats: row.ats,
      isThirdParty: row.is_third_party,
      source: row.source,
      messageIdHeader: row.message_id_header,
      needsReview: !row.stage || !row.company,
      cached: true,
    });
  }
  return cache;
}

/** Upserts one message's classification. */
async function saveClassification(userId, messageId, result) {
  await sql`
    insert into message_classifications
      (user_id, gmail_message_id, message_date, is_noise, reason, stage, detail,
       company, job_title, job_id, ats, is_third_party, source, message_id_header)
    values
      (${userId}, ${messageId}, ${result.date || null}, ${Boolean(result.isNoise)}, ${result.reason || null},
       ${result.status || null}, ${result.detail || null}, ${result.company || null},
       ${result.jobTitle || null}, ${result.jobId || null}, ${result.ats || null},
       ${Boolean(result.isThirdParty)}, ${result.source || null}, ${result.messageIdHeader || null})
    on conflict (user_id, gmail_message_id) do update
      set message_date = excluded.message_date,
          is_noise = excluded.is_noise,
          reason = excluded.reason,
          stage = excluded.stage,
          detail = excluded.detail,
          company = excluded.company,
          job_title = excluded.job_title,
          job_id = excluded.job_id,
          ats = excluded.ats,
          is_third_party = excluded.is_third_party,
          source = excluded.source,
          message_id_header = excluded.message_id_header,
          classified_at = now()
  `;
}

/**
 * Forgets cached classifications for one user, so the next sync re-derives
 * every message. This is the escape hatch after a classifier change: the
 * cache is keyed only by message id, so it has no idea the rules improved.
 */
async function clearCache(userId) {
  const rows = await sql`
    delete from message_classifications where user_id = ${userId} returning gmail_message_id
  `;
  return rows.length;
}

module.exports = { loadCached, saveClassification, clearCache };
