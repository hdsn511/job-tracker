const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_FROM_CHARS,
  MAX_SUBJECT_CHARS,
  MAX_BODY_CHARS,
  MAX_MESSAGE_ID_CHARS,
  normalizeUploadedMessage,
} = require('../sync/inboundUploads');

const VALID = {
  from: 'Acme Recruiting <no-reply@acme.com>',
  subject: 'Thanks for applying',
  body: 'We received your application.',
  date: '2026-01-05T12:00:00.000Z',
  messageId: '<abc123@mail.acme.com>',
};

test('normalizeUploadedMessage: accepts a well-formed message', () => {
  const result = normalizeUploadedMessage(VALID);
  assert.equal(result.error, undefined);
  assert.equal(result.value.from, VALID.from);
  assert.equal(result.value.subject, VALID.subject);
  assert.equal(result.value.body, VALID.body);
  assert.equal(result.value.messageId, VALID.messageId);
  assert.equal(result.value.date.toISOString(), VALID.date);
});

test('normalizeUploadedMessage: rejects a non-object', () => {
  assert.ok(normalizeUploadedMessage(null).error);
  assert.ok(normalizeUploadedMessage('x').error);
  assert.ok(normalizeUploadedMessage(undefined).error);
});

test('normalizeUploadedMessage: rejects a missing/blank From', () => {
  assert.ok(normalizeUploadedMessage({ ...VALID, from: '' }).error);
  assert.ok(normalizeUploadedMessage({ ...VALID, from: '   ' }).error);
  assert.ok(normalizeUploadedMessage({ ...VALID, from: undefined }).error);
});

test('normalizeUploadedMessage: rejects a From address over the length cap', () => {
  const result = normalizeUploadedMessage({ ...VALID, from: 'a'.repeat(MAX_FROM_CHARS + 1) });
  assert.ok(result.error);
});

test('normalizeUploadedMessage: truncates subject/body to their caps rather than rejecting', () => {
  const result = normalizeUploadedMessage({
    ...VALID,
    subject: 'a'.repeat(MAX_SUBJECT_CHARS + 500),
    body: 'b'.repeat(MAX_BODY_CHARS + 500),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.subject.length, MAX_SUBJECT_CHARS);
  assert.equal(result.value.body.length, MAX_BODY_CHARS);
});

test('normalizeUploadedMessage: rejects a Message-ID over the length cap', () => {
  const result = normalizeUploadedMessage({ ...VALID, messageId: 'x'.repeat(MAX_MESSAGE_ID_CHARS + 1) });
  assert.ok(result.error);
});

test('normalizeUploadedMessage: a missing Message-ID is allowed -- normalizes to null, not an error', () => {
  const result = normalizeUploadedMessage({ ...VALID, messageId: undefined });
  assert.equal(result.error, undefined);
  assert.equal(result.value.messageId, null);
});

test('normalizeUploadedMessage: rejects a missing or unparsable date', () => {
  assert.ok(normalizeUploadedMessage({ ...VALID, date: undefined }).error);
  assert.ok(normalizeUploadedMessage({ ...VALID, date: 'not a date' }).error);
});

test('normalizeUploadedMessage: rejects a date more than a day in the future', () => {
  const future = new Date(Date.now() + 2 * 86400000).toISOString();
  assert.ok(normalizeUploadedMessage({ ...VALID, date: future }).error);
});

test('normalizeUploadedMessage: a few minutes of clock skew into the future is tolerated', () => {
  const soon = new Date(Date.now() + 5 * 60000).toISOString();
  const result = normalizeUploadedMessage({ ...VALID, date: soon });
  assert.equal(result.error, undefined);
});
