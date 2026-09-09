// Pure, dependency-free rule-based classification for job-application emails.
// No network calls in this file, so it's fully unit-testable.

const {
  KNOWN_DIRECT_SENDERS,
  THIRD_PARTY_SENDERS,
  prettifyCompanySlug,
} = require('./companyMap');

const ATS = {
  WORKDAY: 'workday',
  GREENHOUSE: 'greenhouse',
  ASHBY: 'ashby',
  LEVER: 'lever',
  ICIMS: 'icims',
  HACKERRANK: 'hackerrank',
  ORACLE_RECRUITING: 'oracle_recruiting',
  DIRECT: 'direct',
};

// ---------------------------------------------------------------------------
// Sender parsing
// ---------------------------------------------------------------------------

/** Pulls the bare email address out of a "Display Name <addr@domain>" header. */
function extractAddress(fromHeader) {
  if (!fromHeader) return '';
  const match = fromHeader.match(/<([^>]+)>/);
  const addr = match ? match[1] : fromHeader;
  return addr.trim().toLowerCase();
}

function extractDomain(address) {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1);
}

function identifyATS(fromHeader) {
  const address = extractAddress(fromHeader);
  const domain = extractDomain(address);

  if (domain === 'myworkday.com' || domain.endsWith('.myworkday.com')) {
    return { ats: ATS.WORKDAY, address, domain };
  }
  if (domain === 'us.greenhouse-mail.io') {
    return { ats: ATS.GREENHOUSE, address, domain };
  }
  if (domain === 'ashbyhq.com') {
    return { ats: ATS.ASHBY, address, domain };
  }
  if (domain === 'hire.lever.co') {
    return { ats: ATS.LEVER, address, domain };
  }
  if (domain === 'talent.icims.com') {
    return { ats: ATS.ICIMS, address, domain };
  }
  if (domain === 'hackerrankforwork.com' || domain.endsWith('.hackerrankforwork.com')) {
    return { ats: ATS.HACKERRANK, address, domain };
  }
  if (domain.endsWith('.workflow.mail.us2.cloud.oracle.com')) {
    return { ats: ATS.ORACLE_RECRUITING, address, domain };
  }
  if (KNOWN_DIRECT_SENDERS[address] || THIRD_PARTY_SENDERS[address]) {
    return { ats: ATS.DIRECT, address, domain };
  }
  return { ats: null, address, domain };
}

// ---------------------------------------------------------------------------
// Noise filtering — emails that are not new-application signal at all.
// ---------------------------------------------------------------------------

const JOB_ALERT_SENDERS = new Set([
  'donotreply@match.indeed.com',
  'team@hi.wellfound.com',
]);

const JOB_ALERT_SUBJECT_PATTERNS = [
  /jobs? you may be interested in/i,
  /new jobs? for you/i,
  /job alert/i,
  /recommended for you/i,
  /jobs? matching your/i,
];

function classifyNoise({ from, subject, body }) {
  const address = extractAddress(from);
  const domain = extractDomain(address);
  const text = `${subject || ''}\n${body || ''}`;

  if (address === 'noreply@mail.amazon.jobs' && /keep track of your application/i.test(text)) {
    return { isNoise: true, reason: 'amazon_duplicate_reminder' };
  }

  if (JOB_ALERT_SENDERS.has(address)) {
    return { isNoise: true, reason: 'job_alert_digest' };
  }

  if (domain === 'linkedin.com' && JOB_ALERT_SUBJECT_PATTERNS.some((re) => re.test(subject || ''))) {
    return { isNoise: true, reason: 'job_alert_digest' };
  }

  return { isNoise: false, reason: null };
}

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

// Checked in order — more specific/terminal outcomes win over generic
// "applied" language that may still appear as boilerplate in later emails.
const STATUS_RULES = [
  {
    status: 'Offer',
    detail: 'Offer',
    patterns: [/pleased to offer/i, /offer letter/i, /excited to extend an offer/i],
  },
  {
    status: 'Rejected',
    detail: 'Rejected',
    patterns: [
      /will not be moving forward/i,
      /decided to move forward with other candidates/i,
      /after careful consideration[\s\S]{0,120}other candidates/i,
      /unfortunately[\s\S]{0,200}\bnot\b/i,
    ],
  },
  {
    status: 'Interviewing',
    detail: 'Interview',
    patterns: [/interview invitation/i, /next step/i, /schedule a call/i, /phone screen/i],
  },
  {
    status: 'Interviewing',
    detail: 'Assessment/OA',
    patterns: [
      /\bassessment\b/i,
      /action required/i,
      /complete your/i,
      /hackerrank/i,
      /coding challenge/i,
      /rembrandt/i,
    ],
  },
  {
    status: 'Applied',
    detail: 'Applied',
    patterns: [
      /thank you for applying/i,
      /we(?:'|’)ve received your application/i,
      /we have received your application/i,
      /successfully submitted/i,
      /application received/i,
      /application confirmation/i,
    ],
  },
];

function classifyStatus(text) {
  for (const rule of STATUS_RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return { status: rule.status, detail: rule.detail };
    }
  }
  return { status: null, detail: null };
}

// ---------------------------------------------------------------------------
// Company name extraction
// ---------------------------------------------------------------------------

// A period inside the captured span (e.g. "ID.me") shouldn't stop the
// match, only a sentence-ending one (followed by whitespace or the end of
// the string) should.
const NAME_CHARS = '(?:[^!,\\n|.]|\\.(?!\\s|$))+';

const SUBJECT_COMPANY_PATTERNS = [
  new RegExp(`thanks? for applying (?:to|at) (${NAME_CHARS})`, 'i'),
  new RegExp(`thank you for applying (?:to|at) (${NAME_CHARS})`, 'i'),
  new RegExp(`your application to (${NAME_CHARS})`, 'i'),
  /^([^|]+?)\s*\|\s*Application (?:Confirmation|Received|Update|Status)\b/i,
  // Checked last — "application to/for the X position at Y" tends to
  // capture the role, not just the company, if a more specific pattern
  // above didn't already match; isPlausibleCompanyName() guards the rest.
  new RegExp(`application (?:to|with) (${NAME_CHARS})`, 'i'),
];

function cleanExtracted(raw) {
  if (!raw) return null;
  return raw.replace(/\s+/g, ' ').trim().replace(/[.!,]+$/, '') || null;
}

// Free-text regex extraction is fragile — a plausible company name is short.
// Rejects sentence-length captures like "the AI Software Development
// Engineer position at AMD" instead of trusting them outright.
function isPlausibleCompanyName(s) {
  if (!s) return false;
  return s.length <= 60 && s.trim().split(/\s+/).length <= 6;
}

function extractCompanyFromText(subject, body) {
  for (const re of SUBJECT_COMPANY_PATTERNS) {
    const match = (subject || '').match(re);
    if (match) {
      const cleaned = cleanExtracted(match[1]);
      if (isPlausibleCompanyName(cleaned)) return cleaned;
    }
  }
  for (const re of SUBJECT_COMPANY_PATTERNS) {
    const match = (body || '').match(re);
    if (match) {
      const cleaned = cleanExtracted(match[1]);
      if (isPlausibleCompanyName(cleaned)) return cleaned;
    }
  }
  return null;
}

function extractCompany({ from, subject, body }, atsInfo) {
  const info = atsInfo || identifyATS(from);

  if (KNOWN_DIRECT_SENDERS[info.address]) {
    return KNOWN_DIRECT_SENDERS[info.address];
  }
  if (THIRD_PARTY_SENDERS[info.address]) {
    // Real employer, if extractable, is more useful than the vendor name.
    return extractCompanyFromText(subject, body) || THIRD_PARTY_SENDERS[info.address];
  }
  if (info.ats === ATS.WORKDAY) {
    // "<company>@myworkday.com" — the company identifier is the local part.
    const localPart = info.address.split('@')[0];
    return prettifyCompanySlug(localPart);
  }
  if (info.ats === ATS.ICIMS) {
    // "<company>+autoreply@talent.icims.com" — trust the tag over free text.
    const localPart = info.address.split('@')[0];
    const [companyTag, hasTag] = localPart.split('+');
    if (hasTag !== undefined && companyTag) return prettifyCompanySlug(companyTag);
    return extractCompanyFromText(subject, body);
  }
  return extractCompanyFromText(subject, body);
}

// ---------------------------------------------------------------------------
// Job title extraction
// ---------------------------------------------------------------------------

const JOB_TITLE_PATTERNS = [
  /for the ([^.,\n(]+?) (?:position|role)\b/i,
  // Anchored on "application to/for" specifically — a bare "to" is too
  // common a word and matches unrelated earlier sentences (e.g. "a
  // reminder to complete...") in longer emails.
  /application (?:to|for) (?:the\s+)?([^.,\n(]+?)\s+(?:position|role)\b/i,
  /for ([^.,\n(]+?)\s*\(Job ID/i,
  /for ([^.,\n(]+?)\s*\(req/i,
  /application for ([^.,\n(]+?)(?:\s+at\s+|\s*[.,(\n]|$)/i,
];

// A leading lowercase filler word (verb, pronoun, article) is the tell that
// a non-greedy capture ran across a sentence boundary into unrelated text
// instead of landing on an actual title, e.g. "be considered for the" or
// "submit your application for the".
const JOB_TITLE_BAD_LEAD_WORDS = new Set([
  'a', 'an', 'the', 'you', 'your', 'we', 'our', 'us', 'this', 'that', 'it',
  'if', 'to', 'for', 'and', 'or', 'but', 'be', 'see', 'take', 'submit',
  'complete', 'arrange', 'apply', 'applying', 'proceed',
]);

function isPlausibleJobTitle(s) {
  if (!s) return false;
  const words = s.trim().split(/\s+/);
  if (words.length > 12 || s.length > 100) return false;
  return !JOB_TITLE_BAD_LEAD_WORDS.has(words[0].toLowerCase());
}

function extractJobTitle({ subject, body }) {
  for (const re of JOB_TITLE_PATTERNS) {
    const match = (subject || '').match(re);
    if (match) {
      const cleaned = cleanExtracted(match[1]);
      if (isPlausibleJobTitle(cleaned)) return cleaned;
    }
  }
  for (const re of JOB_TITLE_PATTERNS) {
    const match = (body || '').match(re);
    if (match) {
      const cleaned = cleanExtracted(match[1]);
      if (isPlausibleJobTitle(cleaned)) return cleaned;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Job ID extraction (stored in notes as a dedup key)
// ---------------------------------------------------------------------------

const JOB_ID_PATTERNS = [
  /\bID:\s*([A-Za-z0-9-]+)/,
  /Job Number:\s*([A-Za-z0-9-]+)/i,
  /Job ID[:#]?\s*([A-Za-z0-9-]+)/i,
  /Requisition(?: ID)?[:#]?\s*([A-Za-z0-9-]+)/i,
  /Req(?:uisition)?\s*#\s*([A-Za-z0-9-]+)/i,
  /\b(R\d{5,})\b/,
];

function extractJobId({ subject, body }) {
  const text = `${subject || ''}\n${body || ''}`;
  for (const re of JOB_ID_PATTERNS) {
    const match = text.match(re);
    if (match) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top-level classification
// ---------------------------------------------------------------------------

function classifyEmail(email) {
  const noise = classifyNoise(email);
  if (noise.isNoise) {
    return { isNoise: true, reason: noise.reason };
  }

  const atsInfo = identifyATS(email.from);
  const text = `${email.subject || ''}\n${email.body || ''}`;
  const { status, detail } = classifyStatus(text);
  const company = extractCompany(email, atsInfo);
  const jobTitle = extractJobTitle(email);
  const jobId = extractJobId(email);
  const isThirdParty = Boolean(THIRD_PARTY_SENDERS[atsInfo.address]);

  return {
    isNoise: false,
    reason: null,
    ats: atsInfo.ats,
    company,
    jobTitle,
    jobId,
    status,
    detail,
    isThirdParty,
    // Low confidence when we can't even name the status or the company —
    // callers should try the LLM fallback in that case.
    needsFallback: !status || !company,
  };
}

module.exports = {
  ATS,
  extractAddress,
  extractDomain,
  identifyATS,
  classifyNoise,
  classifyStatus,
  extractCompany,
  extractJobTitle,
  extractJobId,
  classifyEmail,
};
