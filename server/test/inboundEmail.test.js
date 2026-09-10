const test = require('node:test');
const assert = require('node:assert/strict');

const { generateAlias, mailgunPayloadToEmail } = require('../sync/inboundEmail');

test('generateAlias: includes the user id and the given domain', () => {
  const alias = generateAlias(42, 'sandbox123.mailgun.org');
  assert.match(alias, /^job-42-[0-9a-f]{8}@sandbox123\.mailgun\.org$/);
});

test('generateAlias: is not deterministic across calls', () => {
  assert.notEqual(generateAlias(1, 'example.com'), generateAlias(1, 'example.com'));
});

test('mailgunPayloadToEmail: prefers stripped-text over body-plain', () => {
  const email = mailgunPayloadToEmail({
    from: 'jobs@acme.com',
    subject: 'Thanks for applying',
    'stripped-text': 'stripped body',
    'body-plain': 'full body with quoted reply',
  });
  assert.equal(email.body, 'stripped body');
});

test('mailgunPayloadToEmail: falls back to body-plain when stripped-text is absent', () => {
  const email = mailgunPayloadToEmail({
    from: 'jobs@acme.com',
    subject: 'Thanks for applying',
    'body-plain': 'full body',
  });
  assert.equal(email.body, 'full body');
});

test('mailgunPayloadToEmail: parses the timestamp into a Date', () => {
  const email = mailgunPayloadToEmail({ from: 'a@b.com', subject: 's', timestamp: '1700000000' });
  assert.equal(email.date.getTime(), 1700000000 * 1000);
});

test('mailgunPayloadToEmail: falls back to sender when from is absent', () => {
  const email = mailgunPayloadToEmail({ sender: 'jobs@acme.com', subject: 's' });
  assert.equal(email.from, 'jobs@acme.com');
});
