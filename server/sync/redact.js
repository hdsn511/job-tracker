// The boundary between the user's mailbox and Google's Gemini API.
//
// Connecting Gmail means this app reads the user's mail — that is the deal the
// user opts into. Sending that mail to a third-party LLM is a *separate*
// boundary, and everything crossing it goes through this file.
//
// Two mechanisms, deliberately different in strength:
//   1. isAuthMail() DROPS credential mail from the pipeline entirely. Nothing
//      is stored, nothing is sent. These messages carry no application-stage
//      signal, so dropping them costs nothing.
//   2. redactText() SCRUBS what does get sent, for the residue that survives
//      the drop list — codes, tracking URLs, contact details.
//
// Pure and dependency-free so it is fully unit-testable.

const MAX_BODY_CHARS = 2000;

// Credential/transactional mail. These land in the pipeline only because the
// sender is on the ATS allowlist (Oracle sends both job confirmations and
// identity-verification codes from noreply@oracle.com).
const AUTH_SUBJECT_PATTERNS = [
  /\bone[- ]time (?:pass ?code|password|pin|code)\b/i,
  /\b(?:verification|security|access|login|authentication) code\b/i,
  /\byour code is\b/i,
  /\b2fa\b|\btwo[- ]factor\b|\bmulti[- ]factor\b/i,
  /\breset your password\b/i,
  /\bpassword reset\b/i,
  /\bidentity verification\b/i,
  /\bconfirm your identity\b/i,
];

// "Verify your email to finish applying" reads like auth but is application
// paperwork — it must stay in the pipeline so it can be classified as a chore
// rather than disappearing silently. Anything matching this is exempt from the
// drop list even if an auth pattern also fires.
const APPLICATION_CONTEXT_PATTERN =
  /\b(?:appl(?:y|ying|ication)|candidate profile|job posting|requisition|resume|cv)\b/i;

/**
 * Whether this message is credential mail that must never enter the pipeline.
 * Returns { drop, reason }.
 */
function isAuthMail({ subject, body } = {}) {
  const text = `${subject || ''}\n${body || ''}`;
  const looksLikeAuth = AUTH_SUBJECT_PATTERNS.some((re) => re.test(text));
  if (!looksLikeAuth) return { drop: false, reason: null };
  // An auth-shaped phrase inside obvious application context is a chore.
  if (APPLICATION_CONTEXT_PATTERN.test(text)) return { drop: false, reason: null };
  return { drop: true, reason: 'auth_code' };
}

// Requisition ids carry a letter (R0000392873, JR0285267) and are the dedup
// key, so they must survive. A bare 4-8 digit run is a code; a 4-digit run
// that is a plausible year is left alone because job titles carry years
// ("Software Engineer 2026").
const BARE_CODE_PATTERN = /(?<![A-Za-z0-9-])\d{4,8}(?![A-Za-z0-9-])/g;
const YEAR_PATTERN = /^(?:19|20)\d{2}$/;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()[\]]+/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_PATTERN = /(?<![A-Za-z0-9])(?:\+?\d{1,2}[ .-])?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![A-Za-z0-9])/g;

/**
 * Scrubs secrets and contact details out of text bound for the LLM. Ordinary
 * application prose is left byte-identical.
 */
function redactText(text) {
  if (!text) return '';
  return String(text)
    // URLs first: they contain digits and @ signs that the later patterns
    // would otherwise chew on piecemeal.
    .replace(URL_PATTERN, '[link]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(PHONE_PATTERN, '[phone]')
    .replace(BARE_CODE_PATTERN, (match) => (YEAR_PATTERN.test(match) ? match : '[redacted]'));
}

/**
 * The redacted, truncated payload for one message, or null when the message
 * must not be sent at all. The `from` header is preserved verbatim — it is the
 * company/ATS signal and is not user content.
 */
function buildLlmPayload(email) {
  if (isAuthMail(email).drop) return null;
  return {
    from: email.from || '',
    subject: redactText(email.subject),
    body: redactText(email.body).slice(0, MAX_BODY_CHARS),
  };
}

module.exports = { isAuthMail, redactText, buildLlmPayload, MAX_BODY_CHARS };
