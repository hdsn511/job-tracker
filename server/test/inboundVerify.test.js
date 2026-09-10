const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { verifyMailgunSignature } = require('../sync/inboundVerify');

const SIGNING_KEY = 'test-signing-key';

function sign(timestamp, token, key = SIGNING_KEY) {
  return crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
}

test('verifyMailgunSignature: accepts a correctly signed, fresh request', () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = 'abc123';
  const signature = sign(timestamp, token);

  assert.equal(
    verifyMailgunSignature({ signingKey: SIGNING_KEY, timestamp, token, signature }),
    true,
  );
});

test('verifyMailgunSignature: rejects a wrong signature', () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.equal(
    verifyMailgunSignature({ signingKey: SIGNING_KEY, timestamp, token: 'abc123', signature: 'deadbeef' }),
    false,
  );
});

test('verifyMailgunSignature: rejects when signed with a different key', () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = 'abc123';
  const signature = sign(timestamp, token, 'a-different-key');

  assert.equal(
    verifyMailgunSignature({ signingKey: SIGNING_KEY, timestamp, token, signature }),
    false,
  );
});

test('verifyMailgunSignature: rejects a stale timestamp even with a valid signature', () => {
  const timestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1 hour old
  const token = 'abc123';
  const signature = sign(timestamp, token);

  assert.equal(
    verifyMailgunSignature({ signingKey: SIGNING_KEY, timestamp, token, signature }),
    false,
  );
});

test('verifyMailgunSignature: fails closed when the signing key is not configured', () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = 'abc123';
  const signature = sign(timestamp, token);

  assert.equal(
    verifyMailgunSignature({ signingKey: undefined, timestamp, token, signature }),
    false,
  );
});

test('verifyMailgunSignature: rejects a missing field', () => {
  assert.equal(
    verifyMailgunSignature({ signingKey: SIGNING_KEY, timestamp: '', token: 'abc123', signature: 'x' }),
    false,
  );
});
