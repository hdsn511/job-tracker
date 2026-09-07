// Pure, dependency-free rule-based classification for job-application emails.
// No network calls in this file, so it's fully unit-testable.

const {
  KNOWN_DIRECT_SENDERS,
  THIRD_PARTY_SENDERS,
  prettifyWorkdaySubdomain,
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

const SUBJECT_COMPANY_PATTERNS = [
  /thanks? for applying to ([^!.,\n|]+)/i,
  /thank you for applying to ([^!.,\n|]+)/i,
  /your application to ([^!.,\n|]+)/i,
  /application (?:to|with) ([^!.,\n|]+)/i,
  /^([^|]+?)\s*\|\s*Application Confirmation/i,
];

function cleanExtracted(raw) {
  if (!raw) return null;
  return raw.replace(/\s+/g, ' ').trim().replace(/[.!,]+$/, '') || null;
}

function extractCompanyFromText(subject, body) {
  for (const re of SUBJECT_COMPANY_PATTERNS) {
    const match = (subject || '').match(re);
    if (match) return cleanExtracted(match[1]);
  }
  for (const re of SUBJECT_COMPANY_PATTERNS) {
    const match = (body || '').match(re);
    if (match) return cleanExtracted(match[1]);
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
    return prettifyWorkdaySubdomain(localPart);
  }
  if (
    [ATS.GREENHOUSE, ATS.ASHBY, ATS.LEVER, ATS.ICIMS, ATS.HACKERRANK, ATS.ORACLE_RECRUITING].includes(
      info.ats,
    )
  ) {
    return extractCompanyFromText(subject, body);
  }
  return extractCompanyFromText(subject, body);
}

// ---------------------------------------------------------------------------
// Job title extraction
// ---------------------------------------------------------------------------

const JOB_TITLE_PATTERNS = [
  /for the ([^.,\n(]+?) (?:position|role)\b/i,
  /for ([^.,\n(]+?)\s*\(Job ID/i,
  /for ([^.,\n(]+?)\s*\(req/i,
  /application for ([^.,\n(]+?)(?:\s+at\s+|\s*[.,(\n]|$)/i,
];

function extractJobTitle({ subject, body }) {
  for (const re of JOB_TITLE_PATTERNS) {
    const match = (subject || '').match(re);
    if (match) return cleanExtracted(match[1]);
  }
  for (const re of JOB_TITLE_PATTERNS) {
    const match = (body || '').match(re);
    if (match) return cleanExtracted(match[1]);
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
