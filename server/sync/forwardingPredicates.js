// Pure predicate functions estimating what a Gmail filter would forward, so
// candidate filter definitions can be checked against real inbox history
// before any forwarding infrastructure exists. See scripts/test-filter-recall.js.
//
// Each predicate takes { from, subject, snippet, labelIds } -- the fields a
// Gmail filter itself can see (a filter has no access to the full body).

const { extractAddress, extractDomain } = require('./classifier');

const ATS_DOMAINS = [
  'greenhouse.io',
  'lever.co',
  'myworkday.com',
  'icims.com',
  'smartrecruiters.com',
  'ashbyhq.com',
  'workable.com',
  'bamboohr.com',
];

const JOB_KEYWORDS = [
  'your application',
  'application received',
  'next steps',
  'phone screen',
  'coding challenge',
  'online assessment',
  'unfortunately',
  'move forward',
];

// Real Gmail category label ids (Settings -> Filters lets you scope a filter
// to "Doesn't have" one of these categories).
const EXCLUDED_CATEGORY_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

function isOnAtsAllowList({ from } = {}) {
  const domain = extractDomain(extractAddress(from));
  if (!domain) return false;
  return ATS_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
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
 * `after:X` unparenthesized after "(A) OR (B)" would bind to B alone under
 * most search-query precedence, silently letting pre-date mail through the
 * deny-list side.
 *
 * This only sets the filter's search criteria -- Gmail requires the target
 * address to already be a verified forwarding address (Settings -> Forwarding
 * and POP/IMAP) before "Forward it to" can be selected, so that step can't be
 * deep-linked and still has to happen once in the Gmail UI.
 */
function buildDenyListGmailQuery({ after } = {}) {
  const excludeCategories = EXCLUDED_CATEGORY_LABELS.map(
    (label) => `-category:${label.replace('CATEGORY_', '').toLowerCase()}`,
  ).join(' ');
  const allowListClause = `from:(${ATS_DOMAINS.join(' OR ')})`;
  const core = `(${excludeCategories}) OR ${allowListClause}`;
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
  ATS_DOMAINS,
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
