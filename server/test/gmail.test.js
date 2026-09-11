const test = require('node:test');
const assert = require('node:assert/strict');

const { stripHtml, extractBody, CANDIDATE_SENDER_TERMS, buildSearchQuery } = require('../sync/gmail');
const { extractJobTitle } = require('../sync/classifier');
const { KNOWN_DIRECT_SENDERS } = require('../sync/companyMap');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

test('stripHtml: block-level markup becomes line breaks, not spaces', () => {
  const text = stripHtml('<div>First line</div><div>Second line</div>');
  assert.equal(text, 'First line\nSecond line');
});

test('stripHtml: table cells stay separated so labelled fields survive', () => {
  const text = stripHtml(
    '<table><tr><td>Job Title:</td><td>Senior Data Engineer</td></tr>' +
      '<tr><td>Job ID:</td><td>R12345</td></tr></table>',
  );
  assert.match(text, /^Job Title: Senior Data Engineer$/m);
  assert.match(text, /^Job ID: R12345$/m);
});

test('stripHtml: inline tags do not break a word apart', () => {
  assert.equal(stripHtml('<p>Software <strong>Engineer</strong> II</p>'), 'Software Engineer II');
});

test('stripHtml: decodes named, decimal and hex entities', () => {
  assert.equal(
    stripHtml('<p>We&#39;ll review R&amp;D &mdash; Nestl&eacute; &#x2014; done</p>'),
    "We'll review R&D — Nestlé — done",
  );
});

test('stripHtml: an unknown entity is left alone rather than mangled', () => {
  assert.equal(stripHtml('<p>&notarealentity; x</p>'), '&notarealentity; x');
});

test('stripHtml: script and style contents are dropped', () => {
  const text = stripHtml('<style>.a{color:red}</style><script>var x=1</script><p>Hello</p>');
  assert.equal(text, 'Hello');
});

test('stripHtml: line structure makes an HTML-only title extractable', () => {
  const html =
    '<div>Thank you for applying!</div>' +
    '<table><tr><td>Job Title:</td><td>Senior Data Engineer</td></tr></table>';
  assert.equal(extractJobTitle({ subject: '', body: stripHtml(html) }), 'Senior Data Engineer');
});

// Regression coverage for a real gap: Dell and AMD's direct application mail
// (dellrecruiting@recruiting.dell.com, amd_careers_noreply@amd.com) wasn't in
// KNOWN_DIRECT_SENDERS, so the sync's Gmail search never matched it at all --
// not misclassified, never fetched. Confirmed live against the real mailbox
// before the fix. This asserts every KNOWN_DIRECT_SENDERS entry (not just
// these two) makes it into the actual search query, so the next gap like
// this one fails a test instead of silently dropping mail again.
test('CANDIDATE_SENDER_TERMS / buildSearchQuery: every KNOWN_DIRECT_SENDERS address is actually searched for', () => {
  for (const address of Object.keys(KNOWN_DIRECT_SENDERS)) {
    assert.ok(
      CANDIDATE_SENDER_TERMS.includes(address),
      `${address} (${KNOWN_DIRECT_SENDERS[address]}) is in KNOWN_DIRECT_SENDERS but missing from the search term list`,
    );
  }
  const query = buildSearchQuery({});
  for (const address of Object.keys(KNOWN_DIRECT_SENDERS)) {
    assert.match(query, new RegExp(`from:${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  }
});

test('buildSearchQuery: broadened with the deny-list so an unknown sender is not invisible by construction', () => {
  const query = buildSearchQuery({});
  assert.match(query, /-category:promotions/);
  assert.match(query, /-category:social/);
  assert.match(query, /-category:forums/);
});

test('buildSearchQuery: ANDs the date bound onto the whole (deny-list OR known-sender) expression, not just one side', () => {
  const dated = buildSearchQuery({ afterEpochSeconds: 1700000000 });
  const undated = buildSearchQuery({});
  assert.equal(dated, `(${undated}) after:1700000000`);
});

test('extractBody: prefers text/plain over text/html', () => {
  const body = extractBody({
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: b64('Plain version') } },
      { mimeType: 'text/html', body: { data: b64('<p>HTML version</p>') } },
    ],
  });
  assert.equal(body, 'Plain version');
});

test('extractBody: falls back to stripped HTML when there is no plain part', () => {
  const body = extractBody({
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/html', body: { data: b64('<div>Line one</div><div>Line two</div>') } }],
  });
  assert.equal(body, 'Line one\nLine two');
});

test('extractBody: an empty payload yields an empty string', () => {
  assert.equal(extractBody(null), '');
  assert.equal(extractBody({ mimeType: 'text/plain' }), '');
});
