// Per-message classification store.
//
// The resync is a re-read: every run re-examines the whole window AND
// reclassifies every message in it from scratch (sync/index.js clears this
// table for the window's message ids before reprocessing), so a classifier
// or provider fix reaches old mail on the very next run rather than waiting
// behind a stale answer. This is no longer a memoized shortcut that saves an
// LLM call on a re-read -- it is the durable record getAllSignalMessages()
// reads to (re)build every job, surviving between runs for that reason.
//
// Stores derived fields only. The subject and body are never persisted --
// redacting what we send to the LLM would be pointless if the raw mail were
// sitting in our own database.

const sql = require('../db');

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
 * Forgets cached classifications so the next sync re-derives them. With
 * `messageIds` given, only those rows are dropped -- this is what every sync
 * run does to its own window now, since the cache is keyed only by message
 * id and has no idea the rules or an LLM provider changed. With no
 * `messageIds`, every one of the user's cached rows is dropped, including
 * ones outside any particular sync window -- the escape hatch for when a
 * classifier fix needs to reach mail a narrower window won't re-fetch.
 */
async function clearCache(userId, messageIds) {
  if (messageIds !== undefined) {
    if (messageIds.length === 0) return 0;
    const rows = await sql`
      delete from message_classifications
       where user_id = ${userId} and gmail_message_id = any(${messageIds})
      returning gmail_message_id
    `;
    return rows.length;
  }

  const rows = await sql`
    delete from message_classifications where user_id = ${userId} returning gmail_message_id
  `;
  return rows.length;
}

module.exports = { saveClassification, clearCache };
