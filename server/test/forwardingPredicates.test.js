const test = require('node:test');
const assert = require('node:assert/strict');

const {
  alsoWithAllowList,
  denyList,
  denyListOnly,
  isOnAtsAllowList,
  matchesJobKeyword,
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

test('isOnAtsAllowList: does not match a domain that merely contains the vendor name', () => {
  // us.greenhouse-mail.io is a different registrable domain than greenhouse.io,
  // not a subdomain of it -- this is a real, intentional recall gap.
  assert.equal(isOnAtsAllowList({ from: 'Acme <no-reply@us.greenhouse-mail.io>' }), false);
});

test('isOnAtsAllowList: unrelated sender does not match', () => {
  assert.equal(isOnAtsAllowList({ from: 'Newsletter <hello@substack.com>' }), false);
});

test('matchesJobKeyword: matches against subject or snippet, case-insensitively', () => {
  assert.equal(matchesJobKeyword({ subject: 'Thanks for your application!' }), true);
  assert.equal(matchesJobKeyword({ subject: 'hi', snippet: 'Unfortunately we have decided...' }), true);
  assert.equal(matchesJobKeyword({ subject: 'Weekly newsletter' }), false);
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

test('buildDenyListGmailQuery: ORs in the ATS allow-list as an override', () => {
  const query = buildDenyListGmailQuery();
  assert.match(query, /OR from:\(.*ashbyhq\.com.*\)/);
});

test('buildGmailCreateFilterUrl: produces a deep link with the query URL-encoded', () => {
  const url = buildGmailCreateFilterUrl('from:(ashbyhq.com)');
  assert.equal(url, 'https://mail.google.com/mail/u/0/#create-filter?query=from%3A(ashbyhq.com)');
});
