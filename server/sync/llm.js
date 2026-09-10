// LLM stage classification — the primary classifier, not a fallback.
//
// The rule engine in classifier.js stays authoritative for what is genuinely
// deterministic (sender -> ATS -> company, job id, digest noise). Stage and
// job title live here, because those failed on *phrasing*: real rejections
// say "decided to progress with other candidates", "made the tough choice not
// to move forward with your candidacy" and "will not be moving forward" — an
// unbounded space that regex loses to.
//
// Provider-agnostic: the prompt, schema, validation, retry and telemetry are
// here; anything provider-shaped is in providers.js. Everything sent has
// already passed through redact.js.

const { buildLlmPayload } = require('./redact');
const { selectProvider } = require('./providers');

// The five-stage taxonomy. Assessment sits between Applied and Interviewing:
// an online assessment is a real step forward but it is not a conversation
// with a human, and conflating the two was the original bug.
const STAGES = ['Applied', 'Assessment', 'Interviewing', 'Offer', 'Rejected'];

// A "None" sentinel rather than a nullable type: strict schema modes are far
// better behaved with a plain string enum, and mapping one sentinel back to
// null on the way out is cheaper than debugging schema-validation edge cases
// across providers.
const NONE = 'None';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    stage: { type: 'string', enum: [...STAGES, NONE] },
    company: { type: 'string' },
    jobTitle: { type: 'string' },
  },
  required: ['stage', 'company', 'jobTitle'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You classify job-application emails for a personal job tracker.

Stage definitions — these distinctions are the whole point:
- "Applied": the application was received or submitted. This ALSO covers application paperwork: completing or updating a candidate profile, finishing an incomplete application, uploading a resume, EEO/self-identification surveys, verifying an email address. Wording like "Action Required" or "Complete your ..." does NOT by itself mean a later stage.
- "Assessment": an online assessment, coding challenge, take-home, skills test or automated screening was invited, is pending, or was completed. An assessment is NOT an interview.
- "Interviewing": a conversation with a human — an interview invitation, a recruiter call, scheduling, or a request for availability.
- "Offer": an offer is extended.
- "Rejected": the candidate is no longer being considered, however politely phrased ("progressing with other candidates", "not moving forward with your candidacy", "unable to offer you a position at this time", "decided to pursue other applicants").
- "None": the email is not about a specific job application at all.

Other rules:
- "company" is the hiring employer, never an ATS vendor (Workday, Greenhouse, iCIMS, Ashby, Lever) and never a screening vendor (HackerRank, CodeSignal, micro1). Use "" if unknown.
- "jobTitle" is the role as written, without the company, location or requisition number. Use "" if no role is named.
- Text may contain [redacted], [link], [email] or [phone] placeholders. Ignore them; never copy one into your answer.
- Prefer "None" over guessing a stage. A wrong stage is worse than no stage.`;

// Few-shot examples from real ATS mail, each chosen because a keyword rule
// mishandled that exact phrasing. Kept to four: the prompt is billed on every
// message, and Groq's free tier rate-limits on tokens per minute.
const EXAMPLES = [
  // Assessment stated as a noun phrase, under an "Action required" subject
  // that is NOT a later stage — the two halves of the original bug.
  [
    'Subject: Action required for your application to be considered by PwC - Software Engineering Associate\nBody: As a part of our process, your completion of the entry-level assessment is required in order to be considered for the position below.',
    { stage: 'Assessment', company: 'PwC', jobTitle: 'Software Engineering Associate' },
  ],
  // Paperwork chore that reads urgent but is still just Applied.
  [
    "Subject: Your Amazon job application is incomplete!\nBody: We noticed that your application for the position of Systems Development Engineer is incomplete. We can't consider you until it is finished.",
    { stage: 'Applied', company: 'Amazon', jobTitle: 'Systems Development Engineer' },
  ],
  // Rejection that never says no plainly.
  [
    "Subject: Update on Salesforce's Software Engineering AMTS Role\nBody: After a thorough review, we've made the tough choice not to move forward with your candidacy for the Software Engineering AMTS role.",
    { stage: 'Rejected', company: 'Salesforce', jobTitle: 'Software Engineering AMTS' },
  ],
  // A genuine human conversation, so Interviewing still has a positive
  // example after all the near-misses above.
  [
    "Subject: Next steps for your application\nBody: We'd love to find time to speak. Please share your availability for a 30 minute call with the hiring manager.",
    { stage: 'Interviewing', company: '', jobTitle: '' },
  ],
];

function buildMessages(payload, senderHint) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const [user, answer] of EXAMPLES) {
    messages.push({ role: 'user', content: user });
    messages.push({ role: 'assistant', content: JSON.stringify(answer) });
  }
  messages.push({
    role: 'user',
    content:
      `${senderHint ? `${senderHint}\n` : ''}From: ${payload.from}\n` +
      `Subject: ${payload.subject}\nBody: ${payload.body}`,
  });
  return messages;
}

/**
 * A deterministic nudge for senders whose whole business is one stage.
 * HackerRank only ever mails about assessments, whatever the wording.
 */
function senderHintFor(ats) {
  if (ats === 'hackerrank') {
    return 'Note: this sender is an online-assessment vendor, so this email concerns an assessment.';
  }
  return null;
}

/** The provider and model in force, for logs and the scoring script. */
function activeProvider(env = process.env) {
  return selectProvider(env);
}

function activeModel(env = process.env) {
  const provider = activeProvider(env);
  if (!provider) return null;
  return env[provider.modelEnv] || provider.defaultModel;
}

// Counters for the current process. A failing LLM degrades to the rule engine
// by design, which is exactly why the failure must be counted and surfaced —
// otherwise a dead model or an exhausted quota looks identical to "the rules
// were confident", and accuracy silently halves. Not hypothetical: that is
// precisely what a retired Gemini model did before this existed.
const stats = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  rateLimited: 0,
  schemaRelaxed: 0,
  thinkingDisabled: 0,
  // Messages that never reached a provider because none is configured. A
  // failed call and an absent key both degrade to the rules, but only the
  // first was ever counted — so a deployment missing its key produced a
  // summary identical to a healthy run. This is the counter that tells them
  // apart, and it must be incremented BEFORE the early returns below.
  notConfigured: 0,
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  lastError: null,
};

function getLlmStats() {
  return { ...stats };
}

function resetLlmStats() {
  Object.assign(stats, {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    rateLimited: 0,
    schemaRelaxed: 0,
    thinkingDisabled: 0,
    notConfigured: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    lastError: null,
  });
}

function noteFailure(message) {
  stats.failed += 1;
  stats.lastError = message;
  // Only the first failure of a run is worth a line; the rest are the same
  // cause repeated once per message.
  if (stats.failed === 1) console.warn(`LLM classify failing: ${message}`);
}

// A provider's free tier will rate-limit a backfill. A 429 is a "wait", not a
// failure: treating it as one silently drops the message onto the weaker
// rules path. Providers say how long to wait, in Retry-After or in the text.
const MAX_RETRIES = 4;
// Gemini's free tier hands back windows longer than 30s once a burst has
// stacked up ("Please retry in 59.48s"). Capping below what the provider
// asked for guarantees the retry lands early and wastes the budget, so the
// ceiling has to clear the longest window a free tier actually quotes.
const MAX_WAIT_MS = 65000;

function retryDelayMs(response, detail) {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_WAIT_MS);
  // Providers word the same instruction differently: Groq says "try again in
  // 6.5s", Gemini says "Please retry in 29.04806754s". Matching only one of
  // them means falling back to a wait far shorter than the window that is
  // actually closed, which burns the retry budget and drops the message onto
  // the rules path — Gemini looked credit-dead for exactly this reason.
  const match = /(?:try again|retry) in ([\d.]+)\s*s/i.exec(detail || '');
  if (match) return Math.min(Math.ceil(parseFloat(match[1]) * 1000) + 250, MAX_WAIT_MS);
  return 5000;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reactive 429 handling is a safety net, not a plan. Against a hard
// requests-per-minute ceiling it guarantees the worst case: sprint into the
// wall, then idle for the whole window. Spacing calls to just under the
// provider's stated rate keeps a backfill inside the limit and finishes a
// corpus sooner than burst-and-stall does.
//
// Deliberately process-local and approximate: it paces one sync, and the 429
// path still covers quota shared with anything else using the same key.
let nextSlotAt = 0;

/** Milliseconds to hold before the next call, given the last scheduled slot. */
function paceDelayMs(rpm, now = Date.now(), slot = nextSlotAt) {
  if (!rpm || rpm <= 0) return { delay: 0, nextSlot: slot };
  // A 5% margin: clocks and the provider's window rarely agree exactly, and
  // pacing at precisely the limit still trips it.
  const spacing = Math.ceil((60000 / rpm) * 1.05);
  return { delay: Math.max(0, slot - now), nextSlot: Math.max(now, slot) + spacing };
}

async function pace(provider) {
  const { delay, nextSlot } = paceDelayMs(provider.requestsPerMinute);
  nextSlotAt = nextSlot;
  if (delay > 0) await sleep(delay);
}

function resetPacing() {
  nextSlotAt = 0;
}

// A 429 can mean two very different things, and they need opposite handling:
// a per-MINUTE window reopens on its own, so waiting is right; a per-DAY cap
// does not reopen for hours, so waiting is a way to spend a whole sync
// asleep. Google distinguishes them only in the structured violation detail
// (quotaId "...PerDay..."), never in the prose, so the id has to come out.
function quotaIdOf(body) {
  for (const detail of body?.error?.details || []) {
    for (const violation of detail?.violations || []) {
      if (violation?.quotaId) return violation.quotaId;
    }
  }
  return '';
}

/** Whether this quota is a daily cap, which no amount of waiting will lift. */
function isDailyQuota(quotaId) {
  // Google writes these both ways across APIs: "...PerDayPerProject..." and
  // "generate_requests_per_day". Match either separator.
  return /per[_-]?day/i.test(quotaId || '');
}

async function readError(response) {
  try {
    const body = await response.json();
    return {
      message: (body.error || {}).message || '',
      quotaId: quotaIdOf(body),
    };
  } catch {
    return { message: '', quotaId: '' };
  }
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// A redaction placeholder in a value means the underlying text had a bare
// number in it; it is not trustworthy at that point. "" and the None
// sentinel both mean "not stated".
function cleanLlmString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === NONE) return null;
  if (/\[(?:redacted|link|email|phone)\]/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Returns { stage, company, jobTitle } or null when the message must not be
 * sent, no provider is configured, or the call fails. Callers fall back to
 * the rule engine on null, so the sync still works with no API key at all.
 */
async function classifyWithLlm(email, { ats } = {}) {
  const provider = activeProvider();
  if (!provider) {
    stats.notConfigured += 1;
    return null;
  }

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    stats.notConfigured += 1;
    return null;
  }

  const payload = buildLlmPayload(email);
  if (!payload) return null; // auth mail — never leaves the process

  const model = activeModel();
  const messages = buildMessages(payload, senderHintFor(ats));

  stats.attempted += 1;

  // Strict mode constrains `stage` to the taxonomy at the API level, so an
  // invalid stage becomes impossible rather than merely filtered out after.
  // It occasionally fails outright ("Failed to generate JSON"), so a single
  // best-effort retry follows — the response is validated either way, and a
  // loose answer we can check beats a silent fall back to the rules.
  let strict = true;
  let thinking = true;
  let response;

  for (let attempt = 0; ; attempt += 1) {
    const request = provider.buildRequest({
      model,
      messages,
      schema: RESPONSE_SCHEMA,
      strict,
      thinking,
      apiKey,
    });

    await pace(provider);

    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
    } catch (err) {
      noteFailure(`request failed: ${err.message}`);
      return null;
    }

    if (response.ok) break;

    const { message: detail, quotaId } = await readError(response);

    // A daily cap is terminal for this run: fall straight through to the
    // rules rather than sleeping the retry budget against a window that
    // reopens tomorrow. Counted as failed, not rate-limited, so the sync
    // summary shows a dead provider instead of a busy one.
    if (response.status === 429 && isDailyQuota(quotaId)) {
      noteFailure(
        `daily quota exhausted on ${provider.name}/${model} (${quotaId})` +
        `${detail ? ` — ${detail}` : ''}`,
      );
      return null;
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      stats.rateLimited += 1;
      await sleep(retryDelayMs(response, detail));
      continue;
    }

    // An unsupported thinking field is a 400 that says so. Drop it and retry
    // once rather than reporting the model as dead.
    if (response.status === 400 && thinking && /thinking/i.test(detail)) {
      thinking = false;
      stats.thinkingDisabled += 1;
      continue;
    }

    if (response.status === 400 && strict && /json|schema/i.test(detail)) {
      strict = false;
      stats.schemaRelaxed += 1;
      continue;
    }

    noteFailure(`HTTP ${response.status} from ${provider.name}/${model}${detail ? ` — ${detail}` : ''}`);
    return null;
  }

  const data = await response.json();
  const text = provider.extractText(data);
  if (!text) {
    noteFailure('response contained no message content');
    return null;
  }

  const parsed = extractJson(text);
  if (!parsed) {
    noteFailure('response was not parseable JSON');
    return null;
  }

  const usage = provider.extractUsage(data);
  stats.inputTokens += usage.input;
  stats.outputTokens += usage.output;
  // Billed at the output rate on Gemini, so it is tracked separately —
  // an unexpected jump here is the cost running away.
  stats.thinkingTokens += usage.thinking;
  stats.succeeded += 1;

  return {
    stage: STAGES.includes(parsed.stage) ? parsed.stage : null,
    company: cleanLlmString(parsed.company),
    jobTitle: cleanLlmString(parsed.jobTitle),
  };
}

module.exports = {
  classifyWithLlm,
  retryDelayMs,
  paceDelayMs,
  resetPacing,
  quotaIdOf,
  isDailyQuota,
  buildMessages,
  extractJson,
  cleanLlmString,
  senderHintFor,
  getLlmStats,
  resetLlmStats,
  activeProvider,
  activeModel,
  STAGES,
  RESPONSE_SCHEMA,
  NONE,
};
