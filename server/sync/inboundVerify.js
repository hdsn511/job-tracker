// Mailgun webhook authenticity check -- pure and dependency-free (besides
// node:crypto) so it's fully unit-testable without a live request.
//
// Mailgun signs every webhook delivery with HMAC-SHA256(signingKey,
// timestamp + token), hex-encoded. Verifying this before anything else runs
// is what stops an attacker from POSTing forged "you got an offer!" mail
// straight into a stranger's job history.

const crypto = require('node:crypto');

// Signed requests older than this are rejected even with a valid signature,
// so a captured request can't be replayed indefinitely.
const MAX_TIMESTAMP_AGE_SECONDS = 15 * 60;

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param signingKey - MAILGUN_SIGNING_KEY. Verification fails closed
 *   (returns false) when this is unset, rather than accepting anything.
 * @param timestamp/token/signature - the three fields Mailgun includes on
 *   every webhook payload.
 */
function verifyMailgunSignature({ signingKey, timestamp, token, signature }, { now = () => Date.now() } = {}) {
  if (!signingKey || !timestamp || !token || !signature) return false;

  const ageSeconds = Math.abs(now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_TIMESTAMP_AGE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${timestamp}${token}`)
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

module.exports = { verifyMailgunSignature, MAX_TIMESTAMP_AGE_SECONDS };
