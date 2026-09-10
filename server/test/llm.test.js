const test = require('node:test');
const assert = require('node:assert/strict');

const { retryDelayMs } = require('../sync/llm');

// A 429 is a "wait", not a failure — but only if we wait the RIGHT amount.
// Waiting too little burns the retry budget against a window that has not
// reopened, and the message silently degrades to the rules path. Each
// provider phrases the wait differently in prose, so every phrasing we rely
// on needs a test pinning it.
const noHeaders = { headers: { get: () => null } };
const withRetryAfter = (v) => ({ headers: { get: (k) => (k === 'retry-after' ? v : null) } });

test('retryDelayMs: Gemini phrasing — "Please retry in Ns"', () => {
  const detail =
    'You exceeded your current quota, please check your plan and billing details. ' +
    '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
    'limit: 20, model: gemini-3.6-flash\nPlease retry in 29.04806754s.';
  // Must be the ~29s Gemini asked for, not the 5s fallback.
  assert.equal(retryDelayMs(noHeaders, detail), 29299);
});

test('retryDelayMs: Groq phrasing — "try again in Ns"', () => {
  const detail = 'Rate limit reached for model, please try again in 6.5s.';
  assert.equal(retryDelayMs(noHeaders, detail), 6750);
});

test('retryDelayMs: a Retry-After header wins over the prose', () => {
  assert.equal(retryDelayMs(withRetryAfter('12'), 'Please retry in 29.0s.'), 12000);
});

test('retryDelayMs: a real Gemini free-tier window is honoured in full', () => {
  // The cap must clear the longest window a free tier actually quotes. At the
  // old 30s ceiling this waited 30s against a 59s window, retried early, and
  // burned the budget — which is what made Gemini look credit-dead.
  assert.equal(retryDelayMs(noHeaders, 'Please retry in 59.488751339s.'), 59739);
});

test('retryDelayMs: waits are still capped so a backfill cannot stall forever', () => {
  assert.equal(retryDelayMs(noHeaders, 'Please retry in 600s.'), 65000);
  assert.equal(retryDelayMs(withRetryAfter('600'), ''), 65000);
});

test('retryDelayMs: falls back to a fixed wait when nothing is parseable', () => {
  assert.equal(retryDelayMs(noHeaders, 'quota exhausted'), 5000);
  assert.equal(retryDelayMs(noHeaders, ''), 5000);
  assert.equal(retryDelayMs(noHeaders, undefined), 5000);
});

// --- pacing -----------------------------------------------------------------
// A hard requests-per-minute ceiling is best handled by not hitting it. These
// pin the spacing maths; the 429 path above remains the safety net.
const { paceDelayMs, resetPacing } = require('../sync/llm');

test('paceDelayMs: a provider with no stated rate is never paced', () => {
  // Groq's free tier is token-based, not request-based, so it declares no
  // requestsPerMinute and must keep running at full speed.
  assert.deepEqual(paceDelayMs(undefined, 1000, 0), { delay: 0, nextSlot: 0 });
  assert.deepEqual(paceDelayMs(0, 1000, 0), { delay: 0, nextSlot: 0 });
});

test('paceDelayMs: the first call goes out immediately', () => {
  const { delay } = paceDelayMs(20, 1000, 0);
  assert.equal(delay, 0);
});

test('paceDelayMs: spacing sits just under the stated rate', () => {
  // 20/min is one every 3000ms; the 5% margin makes it 3150ms.
  const { nextSlot } = paceDelayMs(20, 1000, 0);
  assert.equal(nextSlot - 1000, 3150);
});

test('paceDelayMs: a call arriving early is held until its slot', () => {
  // Slot is at 5000, we are at 1000 — hold 4000ms.
  const { delay } = paceDelayMs(20, 1000, 5000);
  assert.equal(delay, 4000);
});

test('paceDelayMs: a late call is not credited backwards', () => {
  // Idle past the slot must not bank a burst: the next slot is measured from
  // now, not from the stale slot, or a pause would license a spike after it.
  const { delay, nextSlot } = paceDelayMs(20, 100000, 5000);
  assert.equal(delay, 0);
  assert.equal(nextSlot, 103150);
});

test('paceDelayMs: 29 messages stay inside a 20/min ceiling', () => {
  resetPacing();
  let now = 0;
  let slot = 0;
  let calls = 0;
  for (let i = 0; i < 29; i += 1) {
    const r = paceDelayMs(20, now, slot);
    now += r.delay;
    slot = r.nextSlot;
    calls += 1;
  }
  // 29 calls paced at 3150ms span ~88s. The binding check: no 60s window
  // may contain more than 20 calls.
  const elapsedMin = now / 60000;
  assert.ok(calls / Math.max(elapsedMin, 1) <= 20, `${calls} calls in ${elapsedMin.toFixed(2)} min`);
});

// --- quota classification ---------------------------------------------------
// A 429 means "wait" or "come back tomorrow", and only the structured
// violation detail says which. Retrying a daily cap sleeps the whole budget
// against a window that reopens at midnight, which is how a Gemini run spent
// minutes producing nothing instead of degrading to the rules immediately.
const { quotaIdOf, isDailyQuota } = require('../sync/llm');

const geminiDailyBody = {
  error: {
    code: 429,
    message: 'You exceeded your current quota... Please retry in 53.817544375s.',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          quotaValue: '20',
        }],
      },
    ],
  },
};

test('quotaIdOf: pulls the quota id out of a real Gemini 429', () => {
  assert.equal(quotaIdOf(geminiDailyBody), 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
});

test('quotaIdOf: absent or malformed details yield no id, never a throw', () => {
  assert.equal(quotaIdOf(undefined), '');
  assert.equal(quotaIdOf({}), '');
  assert.equal(quotaIdOf({ error: {} }), '');
  assert.equal(quotaIdOf({ error: { details: [{ '@type': 'x' }] } }), '');
  assert.equal(quotaIdOf({ error: { details: [{ violations: [{}] }] } }), '');
});

test('isDailyQuota: a per-day cap is terminal, a per-minute one is not', () => {
  assert.equal(isDailyQuota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), true);
  assert.equal(isDailyQuota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), false);
  assert.equal(isDailyQuota('generate_requests_per_day'), true);
  assert.equal(isDailyQuota(''), false);
  assert.equal(isDailyQuota(undefined), false);
});

// --- provider request shaping -----------------------------------------------
// providers.js had no coverage at all, which is how a comment promising a
// thinking-field fallback survived without the fallback existing.
const { PROVIDERS } = require('../sync/providers');

const geminiReq = (opts) => PROVIDERS.gemini.buildRequest({
  model: 'gemini-3.6-flash',
  messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
  schema: { type: 'object', properties: { stage: { type: 'string' } } },
  apiKey: 'test-key',
  ...opts,
});

test('gemini.buildRequest: thinking is capped by default, never left dynamic', () => {
  // Unset means DYNAMIC, billed at the output rate — an unbounded per-message
  // cost. The default must always pin it.
  const cfg = geminiReq({}).body.generationConfig;
  assert.deepEqual(cfg.thinkingConfig, { thinkingLevel: 'low' });
});

test('gemini.buildRequest: thinking:false drops the field entirely', () => {
  // Not "sets it to none" — the field must be absent, since the retry exists
  // for models that reject the key itself.
  const cfg = geminiReq({ thinking: false }).body.generationConfig;
  assert.equal('thinkingConfig' in cfg, false);
});

test('gemini.buildRequest: the model is addressed in the URL, key included', () => {
  const req = geminiReq({});
  assert.match(req.url, /models\/gemini-3\.6-flash:generateContent/);
  assert.match(req.url, /key=test-key/);
});

test('gemini.buildRequest: system prompt is split out of the message list', () => {
  // Gemini takes the system turn as systemInstruction, not as a contents entry.
  const body = geminiReq({}).body;
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(body.contents.length, 1);
  assert.equal(body.contents[0].role, 'user');
});

// --- misconfiguration is not silence ----------------------------------------
// A missing key and a failing call both degrade to the rules, but only the
// second was ever counted. That made a keyless deployment produce a summary
// identical to a healthy run — the failure mode this whole telemetry exists
// to prevent.
const { classifyWithLlm, getLlmStats, resetLlmStats } = require('../sync/llm');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of ['LLM_PROVIDER', 'GROQ_API_KEY', 'GEMINI_API_KEY']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const sampleMail = { from: 'careers@example.com', subject: 'Thanks for applying', body: 'We received your application.' };

test('classifyWithLlm: no provider configured is counted, not swallowed', async () => {
  await withEnv({}, async () => {
    resetLlmStats();
    const result = await classifyWithLlm(sampleMail, {});
    assert.equal(result, null, 'must degrade to the rules');
    const stats = getLlmStats();
    assert.equal(stats.notConfigured, 1, 'the skip must be visible');
    assert.equal(stats.attempted, 0);
    assert.equal(stats.failed, 0);
  });
});

test('classifyWithLlm: a named provider with no key is counted too', async () => {
  // The likeliest deploy bug: LLM_PROVIDER set in the workflow, the secret
  // never added. Exactly the state this repo shipped in.
  await withEnv({ LLM_PROVIDER: 'groq' }, async () => {
    resetLlmStats();
    const result = await classifyWithLlm(sampleMail, {});
    assert.equal(result, null);
    assert.equal(getLlmStats().notConfigured, 1);
  });
});

test('resetLlmStats: clears notConfigured along with the rest', async () => {
  await withEnv({}, async () => {
    resetLlmStats();
    await classifyWithLlm(sampleMail, {});
    assert.equal(getLlmStats().notConfigured, 1);
    resetLlmStats();
    assert.equal(getLlmStats().notConfigured, 0);
  });
});
