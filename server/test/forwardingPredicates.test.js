const test = require('node:test');
const assert = require('node:assert/strict');

const {
  alsoWithAllowList,
  denyList,
  denyListOnly,
  isOnAtsAllowList,
  matchesJobKeyword,
  toGmailDate,
  buildDenyListGmailQuery,
  buildGmailCreateFilterUrl,
} = require('../sync/forwardingPredicates');

// ---------------------------------------------------------------------------
// isOnAtsAllowList / matchesJobKeyword
// ---------------------------------------------------------------------------

test('isOnAtsAllowList: matches an exact ATS domain and its subdomains', () => {
  assert.equal(isOnAtsAllowList({ from: 'Acme <no-reply@lever.co>' }), true);
  assert.equal(isOnAtsAllowList({ from: 'Acme <no-reply@hire.lever.co>' }), true);
});

test('isOnAtsAllowList: matches a domain that merely contains the vendor name too', () => {
  // us.greenhouse-mail.io is a different registrable domain than greenhouse.io,
  // not a subdomain of it -- an enumerated exact-domain list used to miss
  // this on purpose. A pattern match on the address instead of an exact
  // suffix closes that gap, which is the point of the token-based rewrite.
  assert.equal(isOnAtsAllowList({ from: 'Acme <no-reply@us.greenhouse-mail.io>' }), true);
});

test('isOnAtsAllowList: matches a direct employer\'s own recruiting subdomain, not just the 8 enumerated ATS vendors', () => {
  // Real senders that a fixed domain list kept missing: a Chewy verification
  // email from otp.workday.com (not myworkday.com), an assessment reminder
  // from assessment-support@roblox.com (no ATS vendor domain at all), and a
  // screening invite from recruiting@jobalerts.careers.hpe.com.
  assert.equal(isOnAtsAllowList({ from: 'chewy@otp.workday.com' }), true);
  assert.equal(isOnAtsAllowList({ from: 'Early Career Talent Support <assessment-support@roblox.com>' }), true);
  assert.equal(isOnAtsAllowList({ from: 'HPE <recruiting@jobalerts.careers.hpe.com>' }), true);
});

test('isOnAtsAllowList: unrelated sender does not match', () => {
  assert.equal(isOnAtsAllowList({ from: 'Newsletter <hello@substack.com>' }), false);
  assert.equal(isOnAtsAllowList({ from: '"Domino\'s Pizza" <offers@e-offers.dominos.com>' }), false);
});

test('matchesJobKeyword: matches against subject or snippet, case-insensitively', () => {
  assert.equal(matchesJobKeyword({ subject: 'Thanks for your application!' }), true);
  assert.equal(matchesJobKeyword({ subject: 'hi', snippet: 'Unfortunately we have decided...' }), true);
  assert.equal(matchesJobKeyword({ subject: 'Weekly newsletter' }), false);
});

test('matchesJobKeyword: "interview" and "assessment" match on their own', () => {
  // Real Roblox assessment invitation from an unrecognized sender: "We're
  // thrilled to invite you to the next step of the recruiting process — the
  // assessments! ... Access My Assessments." matched none of the original
  // 8 phrases (no "online assessment", no "next steps" -- it says "next
  // step" singular) and was dropped as no_job_signal before ever reaching
  // the classifier, which reads the same text correctly once let through.
  assert.equal(
    matchesJobKeyword({
      subject: 'Your Roblox Assessments Invitation',
      snippet: "We're thrilled to invite you to the next step of the recruiting process — the assessments!",
    }),
    true,
  );
  assert.equal(matchesJobKeyword({ subject: 'Interview invitation from our team' }), true);
});

test('matchesJobKeyword: broadened recruiting-conversation phrasing matches too', () => {
  // Real micro1 recruiter follow-up -- no ATS sender pattern in the address
  // at all (support@micro1.ai), so content is the only possible signal.
  assert.equal(matchesJobKeyword({ subject: 'Still interested in moving forward?' }), true);
});

// ---------------------------------------------------------------------------
// alsoWithAllowList
// ---------------------------------------------------------------------------

test('alsoWithAllowList: forwards ATS senders even with no keyword match', () => {
  assert.equal(alsoWithAllowList({ from: 'no-reply@myworkday.com', subject: 'hi' }), true);
});

test('alsoWithAllowList: forwards a keyword match from an unlisted sender', () => {
  assert.equal(
    alsoWithAllowList({ from: 'jobs@acme.com', subject: 'Your application to Acme' }),
    true,
  );
});

test('alsoWithAllowList: drops mail with neither signal', () => {
  assert.equal(alsoWithAllowList({ from: 'hello@substack.com', subject: 'Weekly digest' }), false);
});

// ---------------------------------------------------------------------------
// denyList / denyListOnly
// ---------------------------------------------------------------------------

test('denyList: forwards mail with no excluded category', () => {
  assert.equal(denyList({ from: 'jobs@acme.com', labelIds: ['INBOX'] }), true);
});

test('denyList: drops Promotions mail from a sender not on the allow-list', () => {
  assert.equal(
    denyList({ from: 'deals@shop.com', labelIds: ['CATEGORY_PROMOTIONS'] }),
    false,
  );
});

test('denyList: an ATS allow-list sender bypasses the category exclusion', () => {
  assert.equal(
    denyList({ from: 'no-reply@ashbyhq.com', labelIds: ['CATEGORY_PROMOTIONS'] }),
    true,
  );
});

test('denyListOnly: drops excluded-category mail even from an ATS allow-list sender', () => {
  assert.equal(
    denyListOnly({ from: 'no-reply@ashbyhq.com', labelIds: ['CATEGORY_SOCIAL'] }),
    false,
  );
});

test('denyListOnly: forwards everything else', () => {
  assert.equal(denyListOnly({ from: 'jobs@acme.com', labelIds: ['INBOX'] }), true);
});

// ---------------------------------------------------------------------------
// Gmail filter-creation URL
// ---------------------------------------------------------------------------

test('buildDenyListGmailQuery: excludes the same three categories denyList excludes', () => {
  const query = buildDenyListGmailQuery();
  assert.match(query, /-category:promotions/);
  assert.match(query, /-category:social/);
  assert.match(query, /-category:forums/);
});

test('buildDenyListGmailQuery: ORs in the ATS sender-pattern override', () => {
  const query = buildDenyListGmailQuery();
  assert.match(query, /OR from:\(.*ashby.*\)/);
});

test('buildDenyListGmailQuery: ORs in a content-keyword clause too, for senders with no ATS pattern at all', () => {
  // What actually recovers a real micro1 recruiter message (support@micro1.ai
  // carries no ATS token) sitting in an excluded Gmail category -- verified
  // empirically against a real inbox: adding `"moving forward"` to the query
  // alongside the category exclusion is what surfaces it.
  const query = buildDenyListGmailQuery();
  assert.match(query, /"moving forward"/);
});

test('buildGmailCreateFilterUrl: produces a search deep link with the query URL-encoded', () => {
  const url = buildGmailCreateFilterUrl('from:(ashbyhq.com)');
  assert.equal(url, 'https://mail.google.com/mail/u/0/#search/from%3A(ashbyhq.com)');
});

// ---------------------------------------------------------------------------
// Backfill: date-bounded query
// ---------------------------------------------------------------------------

test('toGmailDate: converts YYYY-MM-DD to Gmail\'s YYYY/MM/DD', () => {
  assert.equal(toGmailDate('2026-01-05'), '2026/01/05');
});

test('buildDenyListGmailQuery: with no `after`, matches the plain (undated) query', () => {
  assert.equal(buildDenyListGmailQuery(), buildDenyListGmailQuery({}));
});

test('buildDenyListGmailQuery: wraps the OR in parens before ANDing the date on', () => {
  const dated = buildDenyListGmailQuery({ after: '2026-01-05' });
  const undated = buildDenyListGmailQuery();
  assert.equal(dated, `(${undated}) after:2026/01/05`);
});

test('buildDenyListGmailQuery: the date applies to both sides of the OR, not just the allow-list clause', () => {
  // A naive "(A) OR (B) after:X" would parse, under typical AND/OR
  // precedence, as "(A) OR (B AND after:X)" -- letting pre-date mail through
  // the deny-list side (A) with no date bound at all. Asserting the whole
  // OR is enclosed in one extra pair of parens before "after:" is what rules
  // that out.
  const dated = buildDenyListGmailQuery({ after: '2026-01-05' });
  assert.match(dated, /^\(\(.*\) OR from:\(.*\) OR \(.*\)\) after:2026\/01\/05$/);
});
