// Validation for the user-chosen sync start date.
//
// This value is a quota lever, not just a preference: it sets how many Gmail
// messages.get calls and how many LLM classifications a first sync will make.
// So it is bounded on both ends and validated wherever it enters the system.

const DEFAULT_LOOKBACK_DAYS = 30;

// Two years is well past any realistic job search and keeps a first backfill
// from running away — Gmail's per-user quota is the real constraint.
const MAX_LOOKBACK_DAYS = 730;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The default window floor: today minus DEFAULT_LOOKBACK_DAYS, as YYYY-MM-DD. */
function defaultStartDate(now = new Date()) {
  const floor = new Date(startOfUtcDay(now).getTime() - DEFAULT_LOOKBACK_DAYS * 86400000);
  return floor.toISOString().slice(0, 10);
}

/**
 * Normalizes a user-supplied start date.
 *
 * Returns `{ value }` with a YYYY-MM-DD string, or `{ error }` with a message
 * safe to show the user. An absent value is not an error — it falls back to
 * the default window.
 */
function normalizeStartDate(raw, now = new Date()) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: defaultStartDate(now) };
  }

  const text = String(raw).trim();
  if (!ISO_DATE.test(text)) {
    return { error: 'Start date must be in YYYY-MM-DD format.' };
  }

  const parsed = new Date(`${text}T00:00:00Z`);
  // Round-trip rather than trusting the parse: JS silently rolls an
  // out-of-range day over ("2026-02-31" becomes March 3) instead of failing,
  // so the only reliable check is that formatting it back gives the input.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return { error: 'Start date is not a real date.' };
  }

  const today = startOfUtcDay(now);
  if (parsed.getTime() > today.getTime()) {
    return { error: 'Start date cannot be in the future.' };
  }

  const oldest = new Date(today.getTime() - MAX_LOOKBACK_DAYS * 86400000);
  if (parsed.getTime() < oldest.getTime()) {
    return { error: `Start date cannot be more than ${MAX_LOOKBACK_DAYS} days ago.` };
  }

  return { value: text };
}

module.exports = {
  normalizeStartDate,
  defaultStartDate,
  DEFAULT_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
};
