// The upload-backfill ingestion path: messages a browser parsed out of a
// user's exported mbox file, batched over HTTP. Shares inbound_emails /
// inbound_message_classifications (see migrations/002, 003) with the
// forwarding path -- see resolve.js and inboundController.js for the
// classify/upsert pipeline this feeds into.
//
// Split the same way sync/startDate.js is: pure validation here (unit
// tested without a database), the actual insert below it.

const sql = require('../db');

// A generous batch is still bounded -- see server/index.js's json() limit
// comment for the request-size half of this guard.
const MAX_BATCH_SIZE = 50;

// Field caps exist to bound what an untrusted browser can push into the
// database and, from there, at the LLM -- not to accommodate legitimate mail.
// redact.js truncates the LLM payload to 2000 chars regardless, so
// MAX_BODY_CHARS only needs enough headroom that trimming here never clips a
// message redact.js would otherwise have used in full.
const MAX_FROM_CHARS = 320;
const MAX_SUBJECT_CHARS = 500;
const MAX_BODY_CHARS = 8000;
// RFC 5322's own line-length ceiling; Message-ID headers are always far
// shorter than this in practice.
const MAX_MESSAGE_ID_CHARS = 998;

/**
 * Validates and normalizes one client-parsed message. Returns `{ value }`
 * shaped for saveUploadedEmail/resolveMessage, or `{ error }` safe to surface
 * per-message in the batch response.
 */
function normalizeUploadedMessage(raw) {
  if (!raw || typeof raw !== 'object') {
    return { error: 'Message is not a valid object.' };
  }

  const from = typeof raw.from === 'string' ? raw.from.trim() : '';
  if (!from) return { error: 'Message is missing a From address.' };
  if (from.length > MAX_FROM_CHARS) return { error: 'From address is too long.' };

  const subject = typeof raw.subject === 'string' ? raw.subject : '';
  const body = typeof raw.body === 'string' ? raw.body : '';

  const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : '';
  if (messageId.length > MAX_MESSAGE_ID_CHARS) return { error: 'Message id is too long.' };

  const date = raw.date ? new Date(raw.date) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { error: 'Message is missing a valid date.' };
  }
  // A day of slack for clock skew between the browser and whatever wrote the
  // export -- past that, it's not skew, it's a malformed or hostile payload.
  if (date.getTime() > Date.now() + 86400000) {
    return { error: 'Message date is in the future.' };
  }

  return {
    value: {
      from,
      subject: subject.slice(0, MAX_SUBJECT_CHARS),
      body: body.slice(0, MAX_BODY_CHARS),
      date,
      messageId: messageId || null,
    },
  };
}

/**
 * Records one uploaded message's existence (never its subject/body -- see
 * classificationCache.js's comment on why redacted content shouldn't sit in
 * our own database either) and returns its id, or `null` if this exact
 * message (same user, same Message-ID) was already uploaded -- a re-upload of
 * the same export, or an overlapping date range, is a safe no-op rather than
 * a duplicate job.
 */
async function saveUploadedEmail(userId, message) {
  const rows = await sql`
    insert into inbound_emails (user_id, source, message_id_header, raw_from)
    values (${userId}, 'upload', ${message.messageId}, ${message.from})
    on conflict (user_id, message_id_header) where message_id_header is not null do nothing
    returning id
  `;
  return rows[0] ? rows[0].id : null;
}

module.exports = {
  MAX_BATCH_SIZE,
  MAX_FROM_CHARS,
  MAX_SUBJECT_CHARS,
  MAX_BODY_CHARS,
  MAX_MESSAGE_ID_CHARS,
  normalizeUploadedMessage,
  saveUploadedEmail,
};
