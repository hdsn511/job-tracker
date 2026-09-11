// Per-message classification store for forwarded mail -- the forwarding-path
// analogue of sync/classificationCache.js. Kept as its own table (see
// migration 002) rather than merged into message_classifications: forwarded
// mail has no Gmail message id to key on, and unlike a Gmail re-read (which
// always re-fetches its whole window), forwarding only ever sees one new
// message at a time, so this table doubles as the durable history that lets
// a job be regenerated the same way jobs.js already does for Gmail.

const sql = require('../db');

/** Persists one forwarded message's classification. */
async function saveInboundClassification(userId, inboundEmailId, result) {
  await sql`
    insert into inbound_message_classifications
      (user_id, inbound_email_id, message_date, is_noise, reason, stage, detail,
       company, job_title, job_id, ats, is_third_party, source)
    values
      (${userId}, ${inboundEmailId}, ${result.date || null}, ${Boolean(result.isNoise)}, ${result.reason || null},
       ${result.status || null}, ${result.detail || null}, ${result.company || null},
       ${result.jobTitle || null}, ${result.jobId || null}, ${result.ats || null},
       ${Boolean(result.isThirdParty)}, ${result.source || null})
    on conflict (user_id, inbound_email_id) do update
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
          classified_at = now()
  `;
}

/**
 * Every non-noise, staged message this user has ever forwarded, shaped the
 * same way sync/index.js's `usable` array is -- so it can be handed straight
 * to jobs.js's groupMessages/upsertJobFromMessages unmodified.
 *
 * Joined against inbound_emails for message_id_header -- this table doesn't
 * carry it directly, but that's the identifier jobs.js's
 * reconcileDuplicateMessages() uses to recognize the same physical email
 * also classified via the OAuth path. classified_at rides along as the
 * tiebreaker: the more recently classified copy is the one more likely to
 * reflect the current classifier.
 */
async function getSignalMessages(userId) {
  const rows = await sql`
    select c.message_date, c.stage, c.detail, c.company, c.job_title, c.job_id,
           c.is_third_party, c.classified_at, e.message_id_header
      from inbound_message_classifications c
      join inbound_emails e on e.id = c.inbound_email_id
     where c.user_id = ${userId}
       and c.is_noise = false
       and c.stage is not null
       and c.company is not null
  `;

  return rows.map((row) => ({
    date: row.message_date ? new Date(row.message_date) : new Date(),
    status: row.stage,
    detail: row.detail,
    company: row.company,
    jobTitle: row.job_title,
    jobId: row.job_id,
    isThirdParty: row.is_third_party,
    messageIdHeader: row.message_id_header,
    classifiedAt: row.classified_at ? new Date(row.classified_at) : null,
  }));
}

module.exports = { saveInboundClassification, getSignalMessages };
