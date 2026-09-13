const test = require('node:test');
const assert = require('node:assert/strict');

const { PROVIDERS } = require('../sync/providers');

// Groq's free tier is token-based (8k tokens/minute), not request-based, so
// requestsPerMinute was originally left unset entirely -- reactive 429
// handling alone was fine while only a small fraction of fetched messages
// ever reached the LLM. That precondition no longer holds: resolve.js now
// sends everything classifyEmail()/isAuthMail() don't already recognize as
// noise, so a resync of any real size bursts straight into the per-minute
// cap, waits out the reactive backoff, and bursts again -- exactly the
// "sprint into the wall, then idle" pattern paceDelayMs()'s own comment
// warns against. Confirmed live against a real account: a resync with ~600
// candidate messages slowed from processing dozens a minute to roughly one
// every two minutes once the burst exhausted the per-minute budget.
//
// requestsPerMinute is an approximation of a token-based limit, not an
// exact fit -- but a reasonable one beats none. sync/README.md's own
// measured throughput ("roughly 11 classifications a minute") is the
// empirical basis for the figure, with headroom for messages whose bodies
// run longer than the corpus average.
test('groq: paces to a real, conservative fraction of its documented per-minute token ceiling', () => {
  assert.ok(PROVIDERS.groq.requestsPerMinute > 0, 'must be set now that most fetched mail reaches the LLM');
  assert.ok(PROVIDERS.groq.requestsPerMinute <= 11, 'must not exceed the empirically measured safe throughput');
});
