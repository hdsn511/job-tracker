// Pure helpers for the forwarding ingestion path: turning a Mailgun webhook
// payload into the { from, subject, body, date } shape classifier.js /
// resolveMessage already expect (the same shape sync/gmail.js produces from
// a Gmail API message), and generating the per-user alias address.

const crypto = require('node:crypto');

/** A short, unguessable local-part -- readable enough to debug, not enumerable. */
function generateAlias(userId, domain) {
  const token = crypto.randomBytes(4).toString('hex');
  return `job-${userId}-${token}@${domain}`;
}

/**
 * Mailgun's inbound route payload -> the shape resolveMessage() consumes.
 * `stripped-text` (Mailgun's own quoted-reply-stripped plain text) is
 * preferred over `body-plain` for the same reason sync/gmail.js prefers
 * text/plain over HTML -- least post-processing needed before the
 * classifier's line-anchored patterns see it.
 */
function mailgunPayloadToEmail(payload) {
  return {
    from: payload.from || payload.sender || '',
    subject: payload.subject || '',
    body: payload['stripped-text'] || payload['body-plain'] || '',
    date: payload.timestamp ? new Date(Number(payload.timestamp) * 1000) : new Date(),
  };
}

module.exports = { generateAlias, mailgunPayloadToEmail };
