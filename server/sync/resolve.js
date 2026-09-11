// Resolves one email into a classified result, combining the two engines by
// what each is actually good at:
//
//   rules  -> sender/ATS identity, company for senders that name themselves,
//             job id, digest noise. Deterministic, free, no data leaves here.
//   LLM    -> stage and job title, where the failures were all phrasing.
//   rules  -> again, as a guard rail on what the model returns.
//
// The LLM is primary for stage, but never trusted blindly and never required:
// with no GROQ_API_KEY the rule engine still produces a usable answer, so a
// self-hosted deployment degrades rather than breaks.

const { classifyEmail, identifyATS, isPlausibleJobTitle, trimJobTitle, ATS } = require('./classifier');
const { KNOWN_DIRECT_SENDERS, THIRD_PARTY_SENDERS, KNOWN_COMPANY_SLUGS } = require('./companyMap');
const { isAuthMail } = require('./redact');
const { classifyWithLlm } = require('./llm');
const { matchesJobKeyword } = require('./forwardingPredicates');

const ASSESSMENT_DETAIL = 'Assessment/OA';

/**
 * Whether the sender itself names the employer, in which case no model output
 * should be allowed to override it. "pwc@myworkday.com" IS PwC; a model
 * reading the body might answer "Workday".
 */
function senderNamesEmployer(email) {
  const info = identifyATS(email.from);
  if (THIRD_PARTY_SENDERS[info.address]) return false; // vendor, not the employer
  if (KNOWN_DIRECT_SENDERS[info.address]) return true;

  // A Workday/iCIMS local part identifies the employer only when we can map
  // the slug to a real name. Otherwise prettifyCompanySlug just capitalises
  // it, which turns "cat" into "Cat" and "jhuapl" into "Jhuapl" -- a guess,
  // and a worse one than a model that read "Caterpillar" in the body. So an
  // unknown slug defers to the LLM instead of overriding it.
  const localPart = info.address.split('@')[0];
  if (info.ats === ATS.WORKDAY) {
    return Boolean(KNOWN_COMPANY_SLUGS[localPart.toLowerCase()]);
  }
  if (info.ats === ATS.ICIMS && localPart.includes('+')) {
    return Boolean(KNOWN_COMPANY_SLUGS[localPart.split('+')[0].toLowerCase()]);
  }
  return false;
}

/** Holds a model-supplied title to the same bar as a regex capture. */
function acceptTitle(candidate) {
  const cleaned = trimJobTitle(String(candidate || '').replace(/\s+/g, ' ').trim());
  return isPlausibleJobTitle(cleaned) ? cleaned : null;
}

/**
 * A model answer naming the ATS or screening vendor instead of the employer is
 * the single most likely company failure, so it is rejected outright.
 */
const VENDOR_NAMES =
  /^(?:workday|greenhouse|ashby|ashbyhq|lever|icims|taleo|smartrecruiters|hackerrank|codesignal|codility|hirevue|micro1|oracle recruiting|myworkday)$/i;

function acceptCompany(candidate) {
  const cleaned = String(candidate || '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 80) return null;
  if (VENDOR_NAMES.test(cleaned)) return null;
  return cleaned;
}

function detailFor(stage) {
  return stage === 'Assessment' ? ASSESSMENT_DETAIL : stage;
}

/**
 * Resolves one email. Returns a result with `isNoise` set for anything that
 * should never reach the jobs table — digests, and credential mail, which is
 * dropped here so it is neither stored nor sent anywhere.
 */
async function resolveMessage(email, { llm = classifyWithLlm } = {}) {
  const rules = classifyEmail(email);
  if (rules.isNoise) {
    return { isNoise: true, reason: rules.reason };
  }

  // Credential mail reaches this point only because its sender is on the ATS
  // allowlist (Oracle sends job confirmations and identity codes from the same
  // address). It carries no application signal, so it stops here.
  const auth = isAuthMail(email);
  if (auth.drop) {
    return { isNoise: true, reason: auth.reason };
  }

  // A sender we don't already recognize (no known ATS/direct-employer match)
  // gets one more, cheap check before an LLM call: does the subject/snippet
  // even look job-related? This is what makes gmail.js's broad deny-list
  // search affordable -- without it, every non-promotional email in the
  // inbox would reach the LLM. Known senders (rules.ats truthy) skip this;
  // they're already trusted the same way they always have been.
  //
  // `snippet` falls back to `body` here because the upload/forwarding path
  // (inboundController.js) never sets snippet -- it has no Gmail search
  // result to take one from, only the full message it already parsed. That
  // silently left this gate checking the SUBJECT LINE ALONE for every
  // uploaded message, since matchesJobKeyword only looks at subject+snippet.
  // A subject like "Thank you for Applying to Amazon!" or "Kikoff
  // Application Confirmation" doesn't contain any of JOB_KEYWORDS's
  // phrases -- the phrase is always in the body -- so real application mail
  // from any sender not already on the direct/ATS allow-list was dropped as
  // no_job_signal before ever reaching company/title extraction. Confirmed
  // against a real backfill: 852 of 995 uploaded messages fell to this gate.
  // The OAuth path is unaffected: it already sets a real `snippet`, so this
  // fallback never triggers there.
  if (!rules.ats && !matchesJobKeyword({ subject: email.subject, snippet: email.snippet || email.body })) {
    return { isNoise: true, reason: 'no_job_signal' };
  }

  let model = null;
  try {
    model = await llm(email, { ats: rules.ats });
  } catch (err) {
    console.warn(`LLM classify threw, falling back to rules: ${err.message}`);
  }

  const modelStage = model && model.stage;
  const modelTitle = model && acceptTitle(model.jobTitle);
  const modelCompany = model && acceptCompany(model.company);

  // An assessment vendor only ever mails about assessments, whatever the
  // wording. HackerRank's "Thanks for taking <program name>" names no
  // assessment noun at all, so no amount of vocabulary would catch it —
  // the sender is the signal.
  const vendorStage = rules.ats === ATS.HACKERRANK ? 'Assessment' : null;
  const stage = modelStage || rules.status || vendorStage || null;
  const company = senderNamesEmployer(email)
    ? rules.company || modelCompany
    : modelCompany || rules.company;
  const jobTitle = modelTitle || rules.jobTitle || null;

  return {
    isNoise: false,
    reason: null,
    ats: rules.ats,
    company: company || null,
    jobTitle,
    jobId: rules.jobId,
    status: stage,
    detail: stage ? detailFor(stage) : null,
    isThirdParty: rules.isThirdParty,
    // Which engine actually decided the stage — surfaced in sync logs so a
    // drop in accuracy can be attributed rather than guessed at.
    source: modelStage ? 'llm' : rules.status ? 'rules' : vendorStage ? 'vendor' : 'none',
    needsReview: !stage || !company,
  };
}

module.exports = {
  resolveMessage,
  senderNamesEmployer,
  acceptTitle,
  acceptCompany,
  detailFor,
  ASSESSMENT_DETAIL,
};
