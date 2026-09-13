// Pure predicate functions estimating what a Gmail filter would forward, so
// candidate filter definitions can be checked against real inbox history
// before any forwarding infrastructure exists. See scripts/test-filter-recall.js.
//
// Each predicate takes { from, subject, snippet, labelIds } -- the fields a
// Gmail filter itself can see (a filter has no access to the full body).

// Structural recruiting-infrastructure tokens, matched as a fragment of the
// sender's From header (display name or address) -- not an enumerated list
// of exact domains. A token generalizes to any company's own careers
// subdomain or any ATS vendor's send domain without a maintained list of
// exact senders; the enumerated 8-domain list this replaces kept missing
// real mail this way, confirmed against a real inbox audit:
//   - a Chewy verification email from otp.workday.com, not myworkday.com
//   - an assessment reminder from assessment-support@roblox.com -- no ATS
//     vendor domain at all, a direct employer's own send address
//   - a screening invite from recruiting@jobalerts.careers.hpe.com
// All three sat in Gmail's Promotions/Social category, which only the
// 8-domain list could have overridden -- and didn't, because none of them
// were on it and never could be enumerated in advance.
const ATS_SENDER_TERMS = [
  'career', 'careers', 'recruit', 'recruiting', 'recruiter', 'talent',
  'hiring', 'candidate', 'applicant', 'screening', 'assessment',
  'workday', 'myworkday', 'greenhouse', 'ashby', 'ashbyhq', 'lever',
  'icims', 'smartrecruiters', 'workable', 'bamboohr', 'hackerrank',
  'jobvite', 'taleo', 'successfactors', 'jobalerts',
];

const ATS_SENDER_PATTERN = new RegExp(
  `(?:^|[^a-z0-9])(?:${ATS_SENDER_TERMS.join('|')})(?:[^a-z0-9]|$)`,
  'i',
);

const JOB_KEYWORDS = [
  'your application',
  'application received',
  'application confirmation',
  'thank you for applying',
  'thanks for applying',
  'received your application',
  'next steps',
  'next step',
  'phone screen',
  'coding challenge',
  'online assessment',
  'unfortunately',
  'move forward',
  // The two most central application-process nouns were missing outright --
  // neither "interview" nor "assessment" appeared anywhere in this list.
  // Confirmed real: a Roblox assessment invitation ("We're thrilled to
  // invite you to the next step of the recruiting process — the
  // assessments! ... Access My Assessments.") matched none of the phrases
  // above and was dropped as no_job_signal before ever reaching the
  // classifier, even though the rules engine classifies the same text
  // correctly once it's let through.
  'interview',
  'assessment',
  'screening process',
  // Confirmed real: a micro1 recruiter follow-up ("Still interested in
  // moving forward?") from a sender with no ATS pattern in its address at
  // all -- content is the only signal available for a case like this.
  'moving forward',
  'not moving forward',
  'still interested',
  'other candidates',
  'your candidacy',
];

// Real Gmail category label ids (Settings -> Filters lets you scope a filter
// to "Doesn't have" one of these categories).
const EXCLUDED_CATEGORY_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

function isOnAtsAllowList({ from } = {}) {
  return ATS_SENDER_PATTERN.test(String(from || ''));
}

function matchesJobKeyword({ subject, snippet } = {}) {
  const text = `${subject || ''} ${snippet || ''}`.toLowerCase();
  return JOB_KEYWORDS.some((kw) => text.includes(kw));
}

function isExcludedCategory({ labelIds } = {}) {
  return (labelIds || []).some((id) => EXCLUDED_CATEGORY_LABELS.includes(id));
}

/** Sender is on the ATS allow-list, or the subject/snippet names a job-application milestone. */
function alsoWithAllowList(message) {
  return isOnAtsAllowList(message) || matchesJobKeyword(message);
}

/**
 * Forwards everything except Promotions/Social/Forums -- but an ATS
 * allow-list sender bypasses that exclusion, since ATS mail sometimes gets
 * miscategorized into one of those tabs.
 */
function denyList(message) {
  if (!isExcludedCategory(message)) return true;
  return isOnAtsAllowList(message);
}

/** Forwards everything except Promotions/Social/Forums, no override. */
function denyListOnly(message) {
  return !isExcludedCategory(message);
}

const CANDIDATE_FILTERS = {
  alsoWithAllowList,
  denyList,
  denyListOnly,
};

/** 'YYYY-MM-DD' -> 'YYYY/MM/DD', the only date format Gmail's `after:` operator accepts. */
function toGmailDate(isoDate) {
  return isoDate.replace(/-/g, '/');
}

/**
 * The Gmail search query that reproduces denyList's criteria, for prefilling
 * Gmail's own filter-creation screen (Settings -> Filters -> Create a new
 * filter, or the #create-filter?query= deep link). Gmail's filter UI has no
 * "unless" logic, so the allow-list override is expressed as an OR: forward
 * anything not in an excluded category, OR anything from an allow-listed
 * domain regardless of category.
 *
 * `after` (a 'YYYY-MM-DD' string, already validated by sync/startDate.js)
 * bounds the same query for the backfill flow: reusing the recall-tested
 * deny-list rather than a separate allow-list keeps a Takeout export scoped
 * to mail this app would classify the same way it classifies live mail. The
 * OR is wrapped in its own parens before ANDing the date on -- appending
 * `after:X` unparenthesized after "(A) OR (B) OR (C)" would bind to C alone
 * under most search-query precedence, silently letting pre-date mail through
 * the deny-list side.
 *
 * Two overrides, not one: a sender-pattern clause (ATS_SENDER_TERMS, matched
 * against the From header the same way isOnAtsAllowList does) catches real
 * recruiting mail sitting in an excluded category whose sender carries a
 * recognizable token -- confirmed empirically against a real inbox, this
 * alone recovers a Roblox assessment reminder and an HPE screening invite
 * that an 8-domain list missed. A content clause (JOB_KEYWORDS) catches the
 * rest: a real micro1 recruiter message ("Still interested in moving
 * forward?") carries no ATS token anywhere in its address, so only the
 * "moving forward" phrase itself recovers it.
 *
 * This only sets the filter's search criteria -- Gmail requires the target
 * address to already be a verified forwarding address (Settings -> Forwarding
 * and POP/IMAP) before "Forward it to" can be selected, so that step can't be
 * deep-linked and still has to happen once in the Gmail UI.
 */
function toGmailQueryTerm(keyword) {
  return keyword.includes(' ') ? `"${keyword}"` : keyword;
}

function buildDenyListGmailQuery({ after } = {}) {
  const excludeCategories = EXCLUDED_CATEGORY_LABELS.map(
    (label) => `-category:${label.replace('CATEGORY_', '').toLowerCase()}`,
  ).join(' ');
  const senderClause = `from:(${ATS_SENDER_TERMS.join(' OR ')})`;
  const keywordClause = `(${JOB_KEYWORDS.map(toGmailQueryTerm).join(' OR ')})`;
  const core = `(${excludeCategories}) OR ${senderClause} OR ${keywordClause}`;
  return after ? `(${core}) after:${toGmailDate(after)}` : core;
}

/**
 * Gmail's `#create-filter?query=` is not a real, working deep link -- it
 * opens the dialog with the "Has the words" field empty. `#search/<query>`
 * is: it runs the query in the search bar, and the "show search options"
 * icon there opens the same dialog with fields already populated from it,
 * "Create filter" one click away.
 */
function buildGmailCreateFilterUrl(query = buildDenyListGmailQuery()) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

module.exports = {
  ATS_SENDER_TERMS,
  JOB_KEYWORDS,
  EXCLUDED_CATEGORY_LABELS,
  isOnAtsAllowList,
  matchesJobKeyword,
  isExcludedCategory,
  alsoWithAllowList,
  denyList,
  denyListOnly,
  CANDIDATE_FILTERS,
  toGmailDate,
  buildDenyListGmailQuery,
  buildGmailCreateFilterUrl,
};
