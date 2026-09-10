const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMessage, senderNamesEmployer, acceptTitle, acceptCompany } = require('../sync/resolve');

/** A stub LLM so these tests are deterministic and make no network calls. */
const stubLlm = (result) => async () => result;
const deadLlm = async () => null;

test('resolveMessage: LLM stage wins over the rule engine', async () => {
  const result = await resolveMessage(
    {
      from: 'salesforce@myworkday.com',
      subject: "Update on Salesforce's Software Engineering AMTS (College Grad) Role",
      body: "We've made the tough choice not to move forward with your candidacy.",
    },
    { llm: stubLlm({ stage: 'Rejected', company: 'Salesforce', jobTitle: 'Software Engineering AMTS' }) },
  );
  assert.equal(result.status, 'Rejected');
  assert.equal(result.source, 'llm');
});

test('resolveMessage: falls back to rules when the LLM is unavailable', async () => {
  const result = await resolveMessage(
    {
      from: 'no-reply@ashbyhq.com',
      subject: 'Crusoe | Application Received',
      body: 'Thank you for applying to our role: Software Engineer I, Storage.',
    },
    { llm: deadLlm },
  );
  assert.equal(result.status, 'Applied');
  assert.equal(result.source, 'rules');
  assert.equal(result.company, 'Crusoe');
  assert.equal(result.jobTitle, 'Software Engineer I, Storage');
});

test('resolveMessage: a throwing LLM degrades to rules instead of failing', async () => {
  const result = await resolveMessage(
    { from: 'talent@ibm.com', subject: 'Application Received', body: 'Thank you for applying.' },
    { llm: async () => { throw new Error('quota exceeded'); } },
  );
  assert.equal(result.status, 'Applied');
  assert.equal(result.source, 'rules');
});

test('resolveMessage: credential mail is dropped, never classified or stored', async () => {
  let called = false;
  const result = await resolveMessage(
    {
      from: 'noreply@oracle.com',
      subject: 'Your Oracle identity verification',
      body: 'You must confirm your identity using this one-time pass code: 771643',
    },
    { llm: async () => { called = true; return null; } },
  );
  assert.equal(result.isNoise, true);
  assert.equal(result.reason, 'auth_code');
  assert.equal(called, false, 'auth mail must never be sent to the LLM');
});

test('resolveMessage: digest noise still short-circuits', async () => {
  const result = await resolveMessage(
    { from: 'jobs-noreply@linkedin.com', subject: 'Jobs you may be interested in', body: '' },
    { llm: stubLlm({ stage: 'Applied', company: 'X', jobTitle: 'Y' }) },
  );
  assert.equal(result.isNoise, true);
  assert.equal(result.reason, 'job_alert_digest');
});

test('resolveMessage: a self-naming sender beats a wrong LLM company', async () => {
  const result = await resolveMessage(
    { from: 'PwC <pwc@myworkday.com>', subject: 'Action required', body: 'Complete the entry-level assessment.' },
    { llm: stubLlm({ stage: 'Assessment', company: 'Workday', jobTitle: 'Associate' }) },
  );
  assert.equal(result.company, 'PwC');
  assert.equal(result.status, 'Assessment');
  assert.equal(result.detail, 'Assessment/OA');
});

test('resolveMessage: LLM company is used when the sender names no employer', async () => {
  const result = await resolveMessage(
    { from: 'no-reply@us.greenhouse-mail.io', subject: 'Thanks!', body: 'Hello.' },
    { llm: stubLlm({ stage: 'Applied', company: 'Instabase', jobTitle: 'Software Engineer - Early Careers' }) },
  );
  assert.equal(result.company, 'Instabase');
  assert.equal(result.jobTitle, 'Software Engineer - Early Careers');
});

test('resolveMessage: an implausible LLM title is rejected in favour of the rules', async () => {
  const result = await resolveMessage(
    {
      from: 'no-reply@ashbyhq.com',
      subject: 'Crusoe | Application Received',
      body: 'Thank you for applying to our role: Software Engineer I, Storage.',
    },
    { llm: stubLlm({ stage: 'Applied', company: 'Crusoe', jobTitle: 'your application for the role' }) },
  );
  assert.equal(result.jobTitle, 'Software Engineer I, Storage');
});

test('resolveMessage: needsReview when neither engine names a company', async () => {
  const result = await resolveMessage(
    { from: 'careers@unknown-example.com', subject: 'Hello', body: 'A note.' },
    { llm: deadLlm },
  );
  assert.equal(result.needsReview, true);
});

// ---------------------------------------------------------------------------
// Guard rails in isolation
// ---------------------------------------------------------------------------

test('senderNamesEmployer: true for direct/workday/tagged-icims, false for vendors', () => {
  assert.equal(senderNamesEmployer({ from: 'talent@ibm.com' }), true);
  assert.equal(senderNamesEmployer({ from: 'pwc@myworkday.com' }), true);
  assert.equal(senderNamesEmployer({ from: 'amd+autoreply@talent.icims.com' }), true);
  assert.equal(senderNamesEmployer({ from: 'support@micro1.ai' }), false);
  assert.equal(senderNamesEmployer({ from: 'no-reply@us.greenhouse-mail.io' }), false);
});

test('acceptCompany: rejects ATS and screening vendor names', () => {
  assert.equal(acceptCompany('Workday'), null);
  assert.equal(acceptCompany('HackerRank'), null);
  assert.equal(acceptCompany('greenhouse'), null);
  assert.equal(acceptCompany('Crusoe'), 'Crusoe');
});

test('acceptTitle: never emits a redaction placeholder', () => {
  // Defense in depth. llm.js/cleanLlmString rejects model output containing a
  // placeholder outright; if one still reaches here, the usable part of the
  // title is salvaged and the placeholder never survives into the database.
  assert.equal(acceptTitle('Application Software Engineer 1 - [redacted]'), 'Application Software Engineer 1');
  assert.equal(acceptTitle('Software Engineer I, Storage'), 'Software Engineer I, Storage');
  for (const bad of ['[redacted]', '[link]', '[email]']) {
    assert.doesNotMatch(String(acceptTitle(bad)), /\[(?:redacted|link|email)\]/, bad);
  }
});

test('cleanLlmString: model output carrying a placeholder is discarded', () => {
  const { cleanLlmString } = require('../sync/llm');
  assert.equal(cleanLlmString('Application Software Engineer 1 - [redacted]'), null);
  assert.equal(cleanLlmString('Contact [email] about this'), null);
  assert.equal(cleanLlmString('Software Engineer I, Storage'), 'Software Engineer I, Storage');
});
