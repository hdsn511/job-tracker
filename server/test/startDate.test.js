const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeStartDate,
  defaultStartDate,
  MAX_LOOKBACK_DAYS,
} = require('../sync/startDate');

const NOW = new Date('2026-09-09T15:00:00Z');

test('defaultStartDate: 30 days back', () => {
  assert.equal(defaultStartDate(NOW), '2026-08-10');
});

test('normalizeStartDate: absent falls back to the default window', () => {
  for (const empty of [undefined, null, '']) {
    assert.deepEqual(normalizeStartDate(empty, NOW), { value: '2026-08-10' });
  }
});

test('normalizeStartDate: accepts a valid past date', () => {
  assert.deepEqual(normalizeStartDate('2026-03-01', NOW), { value: '2026-03-01' });
});

test('normalizeStartDate: accepts today', () => {
  assert.deepEqual(normalizeStartDate('2026-09-09', NOW), { value: '2026-09-09' });
});

test('normalizeStartDate: rejects a future date', () => {
  assert.match(normalizeStartDate('2026-09-10', NOW).error, /future/i);
});

test('normalizeStartDate: rejects a malformed date', () => {
  for (const bad of ['09/09/2026', 'yesterday', '2026-9-9', '2026-09-09T00:00:00Z']) {
    assert.match(normalizeStartDate(bad, NOW).error, /YYYY-MM-DD/, bad);
  }
});

test('normalizeStartDate: rejects an impossible date', () => {
  assert.ok(normalizeStartDate('2026-02-31', NOW).error, 'Feb 31 should be rejected');
});

test('normalizeStartDate: bounds how far back the window can reach', () => {
  const tooOld = new Date(NOW.getTime() - (MAX_LOOKBACK_DAYS + 5) * 86400000)
    .toISOString()
    .slice(0, 10);
  assert.match(normalizeStartDate(tooOld, NOW).error, /more than/i);

  const justInside = new Date(NOW.getTime() - (MAX_LOOKBACK_DAYS - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  assert.ok(normalizeStartDate(justInside, NOW).value, 'a date inside the bound is accepted');
});

test('normalizeStartDate: a rejected value never yields a usable date', () => {
  // The caller branches on `.value`, so an invalid input must not carry one.
  const result = normalizeStartDate('2099-01-01', NOW);
  assert.equal(result.value, undefined);
});
