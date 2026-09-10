const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMessage } = require('../sync/resolve');

// Real ATS mail, redacted at build time (see scripts/build-corpus.js).
//
// The fixture is deliberately NOT committed: even redacted it carries the
// mailbox owner's name and every company they applied to, and this repo is
// public. Build your own with `node scripts/build-corpus.js` against a
// connected mailbox; without it these tests skip rather than fail, so a
// clean clone still gets a green suite.
//
// These run the DETERMINISTIC path only -- the LLM is stubbed out -- so the
// suite stays offline and reproducible. In production the LLM is primary and
// should score higher; this measures the floor the system degrades to when
// there is no API key, which is also the floor a self-hosted deploy gets.
let corpus = null;
try {
  corpus = require('./fixtures/inbox-corpus.json');
} catch {
  // No fixture on this machine -- every test below skips.
}
const skip = corpus ? false : 'no corpus fixture; run scripts/build-corpus.js';

const noLlm = async () => null;

async function classifyAll() {
  return Promise.all(
    corpus.map(async (fixture) => ({
      fixture,
      result: await resolveMessage(fixture, { llm: noLlm }),
    })),
  );
}

test('corpus: credential mail is dropped before classification', { skip }, async () => {
  const results = await classifyAll();
  for (const { fixture, result } of results) {
    if (fixture.expected !== 'Dropped') continue;
    assert.equal(result.isNoise, true, fixture.subject);
    assert.equal(result.reason, 'auth_code', fixture.subject);
  }
});

test('corpus: THE REGRESSION — nothing is falsely marked Interviewing', { skip }, async () => {
  // The original complaint: most rows showing "Interviewing" were false, an
  // account/application chore, or an online assessment. No message in this
  // corpus is a genuine interview, so any Interviewing here is a false
  // positive — the exact bug this work exists to fix.
  const results = await classifyAll();
  const falsePositives = results
    .filter(({ result }) => result.status === 'Interviewing')
    .map(({ fixture }) => fixture.subject);

  assert.deepEqual(falsePositives, [], `falsely marked Interviewing:\n  ${falsePositives.join('\n  ')}`);
});

test('corpus: assessments are never classified as interviews', { skip }, async () => {
  const results = await classifyAll();
  for (const { fixture, result } of results) {
    if (fixture.expected !== 'Assessment') continue;
    assert.notEqual(result.status, 'Interviewing', fixture.subject);
  }
});

test('corpus: application confirmations are recognised', { skip }, async () => {
  const results = await classifyAll();
  const applied = results.filter(({ fixture }) => fixture.expected === 'Applied');
  const correct = applied.filter(({ result }) => result.status === 'Applied');

  // The rule engine handles plain confirmations well; this is its strongest
  // category and a drop here means something broke badly.
  const ratio = correct.length / applied.length;
  assert.ok(ratio >= 0.8, `only ${correct.length}/${applied.length} confirmations recognised`);
});

test('corpus: score report (rules-only baseline)', { skip }, async () => {
  const results = await classifyAll();
  const byCategory = {};
  let correct = 0;

  for (const { fixture, result } of results) {
    const got = result.isNoise ? 'Dropped' : result.status || 'unclassified';
    const ok = got === fixture.expected;
    if (ok) correct += 1;
    byCategory[fixture.expected] = byCategory[fixture.expected] || { n: 0, ok: 0 };
    byCategory[fixture.expected].n += 1;
    if (ok) byCategory[fixture.expected].ok += 1;
  }

  const lines = Object.entries(byCategory)
    .map(([k, v]) => `    ${k.padEnd(12)} ${v.ok}/${v.n}`)
    .join('\n');
  console.log(`\n  Rules-only corpus score: ${correct}/${results.length}\n${lines}\n`);

  // A floor, not a target. The LLM path is expected to beat this; the point
  // of the assertion is that a classifier change cannot quietly regress the
  // deterministic baseline.
  const RULES_FLOOR = 0.75;
  assert.ok(
    correct / results.length >= RULES_FLOOR,
    `rules-only accuracy ${correct}/${results.length} fell below the ${RULES_FLOOR} floor`,
  );
});

test('corpus: the rules resolve a company for all but the known LLM cases', { skip }, async () => {
  const results = await classifyAll();
  const missing = results
    .filter(({ fixture, result }) => fixture.expected !== 'Dropped' && !result.company)
    .map(({ fixture }) => fixture.subject);

  // Assessment-vendor mail (HackerRank) names the employer only inside a
  // program title in the body — "JPMorganChase – NAMR Software Engineer
  // Program". No sender or subject rule can reach that, which is exactly the
  // kind of case the LLM is primary for. Everything else must resolve
  // deterministically, with no network and no API key.
  const llmOnly = missing.filter((s) => /JPMorganChase/i.test(s));
  const unexpected = missing.filter((s) => !/JPMorganChase/i.test(s));

  assert.deepEqual(unexpected, [], `no company resolved for:\n  ${unexpected.join('\n  ')}`);
  assert.ok(llmOnly.length <= 2, `more LLM-only company cases than expected: ${llmOnly.length}`);
});
