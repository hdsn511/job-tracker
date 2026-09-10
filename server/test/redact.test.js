const test = require('node:test');
const assert = require('node:assert/strict');

const { isAuthMail, redactText, buildLlmPayload } = require('../sync/redact');

// ---------------------------------------------------------------------------
// Auth mail is dropped outright — it never reaches the LLM or the pipeline.
// ---------------------------------------------------------------------------

test('isAuthMail: one-time passcode mail is dropped', () => {
  const result = isAuthMail({
    from: 'noreply@oracle.com',
    subject: 'Your Oracle identity verification',
    body: 'You must confirm your identity using this one-time pass code: 771643. This code will expire in 10 minutes.',
  });
  assert.equal(result.drop, true);
  assert.equal(result.reason, 'auth_code');
});

test('isAuthMail: verification code / 2FA / password reset are dropped', () => {
  const cases = [
    'Your verification code is 448120',
    'Here is your security code: 99213',
    'Use this one-time password to continue',
    'Reset your password using the link below',
    'Your two-factor authentication code',
    'Confirm your identity to continue',
  ];
  for (const subject of cases) {
    assert.equal(isAuthMail({ from: 'x@y.com', subject, body: '' }).drop, true, subject);
  }
});

test('isAuthMail: ordinary application mail is not dropped', () => {
  const cases = [
    ['Thank you for applying to Acme', 'We received your application for Software Engineer.'],
    ['Action required: complete your assessment', 'Please complete your coding challenge.'],
    ['Update on your application', 'We have decided to progress with other candidates.'],
  ];
  for (const [subject, body] of cases) {
    assert.equal(isAuthMail({ from: 'x@y.com', subject, body }).drop, false, subject);
  }
});

test('isAuthMail: "verify your email to finish applying" is NOT auth mail', () => {
  // A profile chore, not a credential — it stays in the pipeline so it can be
  // classified as application paperwork rather than silently vanishing.
  const result = isAuthMail({
    from: 'no-reply@us.greenhouse-mail.io',
    subject: 'Verify your email address to complete your application',
    body: 'Click below to confirm your email and finish your application.',
  });
  assert.equal(result.drop, false);
});

// ---------------------------------------------------------------------------
// Redaction of what does get sent
// ---------------------------------------------------------------------------

test('redactText: strips standalone numeric codes', () => {
  assert.equal(redactText('Your code is 771643 today'), 'Your code is [redacted] today');
  assert.equal(redactText('PIN 4821'), 'PIN [redacted]');
});

test('redactText: keeps requisition ids and years, which are not secrets', () => {
  // Job IDs are the dedup key and must survive; a bare year is not a code.
  assert.equal(redactText('Job ID: R0000392873'), 'Job ID: R0000392873');
  assert.equal(redactText('Software Engineer 2026 (US)'), 'Software Engineer 2026 (US)');
  assert.equal(redactText('req JR0285267 open'), 'req JR0285267 open');
});

test('redactText: collapses URLs to a placeholder', () => {
  assert.equal(
    redactText('Apply at https://tracking.example.com/L0/abc?token=secret&x=1 now'),
    'Apply at [link] now',
  );
  assert.equal(redactText('See http://a.co/b'), 'See [link]');
});

test('redactText: removes email addresses and phone numbers', () => {
  assert.equal(redactText('Sent to htreinen511@gmail.com'), 'Sent to [email]');
  assert.equal(redactText('Call 555-867-5309 to confirm'), 'Call [phone] to confirm');
});

test('redactText: leaves ordinary application prose untouched', () => {
  const prose =
    'Thank you for applying to our role: Software Engineer I, Storage. ' +
    'We will review your application shortly.';
  assert.equal(redactText(prose), prose);
});

test('redactText: handles empty and missing input', () => {
  assert.equal(redactText(''), '');
  assert.equal(redactText(null), '');
  assert.equal(redactText(undefined), '');
});

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

test('buildLlmPayload: returns null for auth mail so it is never sent', () => {
  assert.equal(
    buildLlmPayload({
      from: 'noreply@oracle.com',
      subject: 'Your Oracle identity verification',
      body: 'one-time pass code: 771643',
    }),
    null,
  );
});

test('buildLlmPayload: redacts body and subject, and truncates', () => {
  const payload = buildLlmPayload({
    from: 'Acme <no-reply@ashbyhq.com>',
    subject: 'Application received 12345',
    body: `Visit https://x.co/a?t=1 ${'word '.repeat(2000)}`,
  });
  assert.equal(payload.subject, 'Application received [redacted]');
  assert.match(payload.body, /^Visit \[link\] word/);
  assert.ok(payload.body.length <= 2000, `body was ${payload.body.length} chars`);
});

test('buildLlmPayload: keeps the sender address intact for ATS identification', () => {
  const payload = buildLlmPayload({
    from: 'AMD Careers <amd+autoreply@talent.icims.com>',
    subject: 'Thank you for applying',
    body: 'Hello',
  });
  // The sender is the company signal and is not sensitive user content.
  assert.match(payload.from, /amd\+autoreply@talent\.icims\.com/);
});
