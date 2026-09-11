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

// Application-workflow chores that ATS platforms send in the same "Action
// Required" / "Complete your ..." voice as a real assessment invite, but that
// say nothing about progressing to a later stage. Matching these words alone
// used to be enough to mark an application as Interviewing.
const ADMIN_CHORE_PATTERNS = [
  /complete (?:your |the |our )?(?:candidate |applicant |online |user )?profile/i,
  /(?:update|finish|set ?up|create|activate|register) (?:your |the |an )?(?:candidate |applicant |online |user )?(?:profile|account|password|login)/i,
  /profile (?:completion|is incomplete)/i,
  /verify your (?:email|e-mail|account|identity|address)/i,
  /confirm your (?:email|e-mail|account|address)/i,
  /account setup/i,
  /(?:self[- ]identification|self[- ]identify|voluntary disclosure|eeo|equal employment|demographic)[\s\S]{0,40}(?:survey|questionnaire|form)?/i,
  /(?:complete|finish|submit) (?:your |the )?application\b/i,
  /upload your (?:resume|cv|documents?)/i,
  /(?:complete|update) your (?:preferences|settings|job alerts?)/i,
];

// Nouns that make "complete your X" / "action required" actually mean a
// screening step rather than paperwork.
const ASSESSMENT_NOUN = '(?:online |technical |coding |skills? |video |pre-?employment )*(?:assessment|assessments|coding challenge|challenge|test|exam|evaluation|screening|quiz|assignment)';

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
      // Phrasings taken from real rejection mail. Employers avoid the word
      // "reject" entirely, so this list is vocabulary, not cleverness.
      /not to move forward/i,
      /not be (?:moving|going) forward/i,
      /decided to (?:progress|proceed|continue|move ahead) with other/i,
      /pursu(?:e|ing) other (?:candidates|applicants)/i,
      /unable to offer you/i,
      /no longer (?:be )?(?:under consideration|considering)/i,
      /\bnot (?:been )?(?:selected|shortlisted)\b/i,
      /will not be (?:progressing|proceeding)/i,
      /after careful consideration[\s\S]{0,120}other candidates/i,
      /unfortunately[\s\S]{0,200}\bnot\b/i,
      // Singular "a/another candidate" phrasings real rejection mail uses,
      // as distinct from the plural "other candidates" already covered
      // above -- confirmed missing against real Oracle/Intel rejections
      // that instead fell through to Applied's generic "thank you for your
      // interest" catch-all when the LLM was unavailable.
      /(?:chosen|decided) to (?:move forward|proceed|progress) with another candidate/i,
      /decided to pursue (?:a |another )?different candidate/i,
      // "we have identified other candidates to move forward in
      // consideration for this role" -- the verb is "identified", not
      // "decided"/"chosen", so none of the above matched. Confirmed missing
      // against a real Chewy rejection that the LLM read correctly but the
      // rules engine (the only path a failed/rate-limited LLM call falls
      // back to) let through to null instead.
      /identified (?:other|another) candidate/i,
    ],
    // A rejection VERB inside a conditional/hypothetical clause about a
    // future, not-yet-decided outcome ("if you are not selected, you will
    // be notified") is boilerplate risk-disclosure language common in
    // assessment and application-confirmation mail -- not an actual
    // decision. Real rejections are declarative ("you were not selected"),
    // never "if"-gated. Confirmed against real ID.me and IBM mail that was
    // misclassified as Rejected this way when the LLM fell back to rules.
    //
    // The window is 200, not 60, because the conditional clause can be a
    // whole list of hypothetical outcomes before it ever reaches the
    // disqualifying phrase. Real Microsoft application-confirmation mail,
    // sent the same minute as applying: "If you see the job moved to an
    // inactive state, that means the position is either no longer open,
    // you withdrew from consideration, or you were not selected for the
    // role" -- 142 characters from "if" to "not selected", so the original
    // 60-char window didn't reach and this read as an actual rejection.
    exclude: [/\bif\b[\s\S]{0,200}\bnot (?:been )?(?:selected|shortlisted)\b/i],
  },
  {
    status: 'Interviewing',
    detail: 'Interview',
    patterns: [
      /interview invitation/i,
      /invit(?:e|ing|ation) (?:you )?to (?:an? )?interview/i,
      /\binterview\b[\s\S]{0,60}\b(?:schedule|scheduled|availability|invitation|request)\b/i,
      /(?:schedule|set up|arrange|book) (?:a|an|your|the)? ?(?:phone |video |initial |brief |quick )?(?:call|interview|chat|conversation|meeting|screen)/i,
      /phone screen/i,
      /(?:your |share your |provide your )?availability[\s\S]{0,60}\b(?:call|interview|chat|conversation|meeting)\b/i,
      // "Next steps" alone is boilerplate in application confirmations, so it
      // only counts when an actual scheduling word follows it. Bare
      // "interview" was in this alternation too, but that's still too loose
      // on its own -- confirmed against a real OpenAI confirmation email
      // ("we'll discuss next steps... learn more about our hiring
      // philosophy and interview process") that got misread as a real
      // invitation. The other Interviewing patterns above already cover
      // genuine "invited to interview" phrasing with tighter context.
      /next steps?\b[\s\S]{0,120}\b(?:schedule|scheduled|availability|call with|speak with|meet with)\b/i,
      /would like to (?:speak|talk|chat|meet) with you/i,
      /moving (?:you )?(?:forward|ahead) (?:to|with|in)[\s\S]{0,60}interview/i,
    ],
    // Mirrors the Rejected rule's conditional guard just above: a scheduling
    // VERB inside an "if [you have been] selected" clause is a not-yet-
    // decided future outcome, not an actual invitation. Confirmed against a
    // real Chewy application-confirmation email ("If you have been
    // selected, a recruiter will contact you directly to set up an
    // interview") that this rule misread as an actual interview invite
    // although nothing had been decided yet -- the application was only
    // just submitted.
    exclude: [
      /\bif\b[\s\S]{0,60}\b(?:you(?:'|’)?(?:ve| have)? been |you(?:'|’)?re |you are )?(?:selected|shortlisted|chosen)\b[\s\S]{0,80}\b(?:interview|schedule|call)\b/i,
    ],
  },
  {
    // A screening artifact is its own stage: real progress, but not a
    // conversation with a human. Conflating it with Interviewing is the bug
    // this taxonomy exists to fix.
    status: 'Assessment',
    detail: 'Assessment/OA',
    // Every pattern here names an actual screening artifact. A bare "action
    // required" or "complete your ..." is deliberately NOT enough — that
    // wording is just as common on profile/verification chores.
    patterns: [
      new RegExp(`(?:complete|start|begin|take|finish|submit) (?:your |the |this |our |an? )?${ASSESSMENT_NOUN}`, 'i'),
      new RegExp(`(?:invited|invitation) (?:you )?to (?:take|complete|start) (?:your |the |an? )?${ASSESSMENT_NOUN}`, 'i'),
      new RegExp(`(?:your |the )?${ASSESSMENT_NOUN} (?:is (?:ready|now available|waiting)|invitation|link|has been assigned)`, 'i'),
      /\b(?:online assessment|coding assessment|coding challenge|technical assessment|take[- ]home(?: assignment| exercise| test)?)\b/i,
      /\b(?:hackerrank|codesignal|codility|hirevue|karat|woven|coderbyte|testgorilla)\b[\s\S]{0,120}\b(?:test|assessment|challenge|invit|interview|complete)/i,
      /\b(?:test|assessment|challenge)\b[\s\S]{0,120}\b(?:hackerrank|codesignal|codility|hirevue|karat)\b/i,
      // Noun-phrase form: "your completion of the entry-level assessment
      // is required in order to be considered".
      new RegExp(`completion of (?:your |the |our |an? )?${ASSESSMENT_NOUN}`, 'i'),
      /entry-level assessment/i,
      /rembrandt/i,
    ],
    // Vetoed when the same email is really just profile/account paperwork,
    // OR when the assessment is a conditional future promise rather than an
    // actual invite already sent. Real Roblox application-confirmation
    // mail: "Complete our Assessments: If your profile meets our basic
    // qualifications, you'll receive a link to our assessments" -- matched
    // the first pattern above on "Complete our Assessments" alone, even
    // though the very next clause says the link (the real invite) hasn't
    // been sent yet. The rule is skipped rather than the whole email —
    // genuine interview language in an earlier rule still wins.
    exclude: [
      ...ADMIN_CHORE_PATTERNS,
      /\bif\b[\s\S]{0,150}\byou(?:'|’)?(?:ll| will)\b[\s\S]{0,60}\breceive\b[\s\S]{0,60}\b(?:assessment|link)/i,
    ],
  },
  {
    status: 'Applied',
    detail: 'Applied',
    patterns: [
      /thank you for applying/i,
      /thanks for applying/i,
      /we(?:'|’)ve received your application/i,
      /we have received your application/i,
      // Employers write this a dozen ways ("we received", "we've received",
      // "successfully received"); anchor on the receipt itself.
      /received your application/i,
      // An incomplete/unfinished application is still an application: it is
      // paperwork, so it belongs at Applied rather than nowhere.
      /your application[^.\n]{0,140}(?:is |remains )?incomplete/i,
      /complete your application to be considered/i,
      /your application (?:has been|was) received/i,
      /successfully submitted/i,
      /application received/i,
      /application confirmation/i,
      /thank you for your (?:recent )?(?:application|interest in)/i,
    ],
  },
];

function classifyStatus(text) {
  for (const rule of STATUS_RULES) {
    if (rule.exclude && rule.exclude.some((re) => re.test(text))) continue;
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
  // "Kikoff Application Confirmation" -- same shape as the piped form but
  // with no separator at all.
  /^([A-Za-z0-9.&'’ -]{2,40}?) Application (?:Confirmation|Received|Update|Status)\b/i,
  // "...the Backend Engineer - Studio position at Epidemic Sound"
  new RegExp(`(?:position|role|opening) at (${NAME_CHARS})`, 'i'),
  // "Thank you for your interest in working at ID.me"
  new RegExp(`interest in (?:working at|joining) (${NAME_CHARS})`, 'i'),
  // Bare "interest in Instabase!" -- requires a capitalised name so it
  // cannot swallow lowercase prose like "interest in a career at Oracle".
  /interest in ([A-Z][A-Za-z0-9.&'’-]*(?: [A-Z][A-Za-z0-9.&'’-]*){0,3})[!.,\n]/,
  // Checked last — "application to/for the X position at Y" tends to
  // capture the role, not just the company, if a more specific pattern
  // above didn't already match; isPlausibleCompanyName() guards the rest.
  new RegExp(`application (?:to|with) (${NAME_CHARS})`, 'i'),
];

// Zero-width/format characters (ZWSP, ZWNJ, ZWJ, BOM) are invisible but not
// whitespace as far as \s or .trim() are concerned, so they survive
// straight through into a stored company/title otherwise. Confirmed real:
// L3Harris's own subject line ("Thank you for applying at ​L3Harris!")
// carries a leading U+200B, which without this showed up as "​L3Harris"
// in the jobs table.
const INVISIBLE_CHARS = /[​-‍﻿]/g;

function cleanExtracted(raw) {
  if (!raw) return null;
  return raw.replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim().replace(/[.!,]+$/, '') || null;
}

// A spaced separator in a subject line ("Thank you for applying to Acme
// Robotics - Backend Engineer") starts the role, not more of the company
// name. Only spaced separators are cut, so hyphenated names like
// "Hewlett-Packard" survive intact.
function trimCompany(s) {
  if (!s) return null;
  return s.split(/\s+[|\-–—]\s+/)[0].replace(/[\s.,;:-]+$/, '').trim() || null;
}

// A capture starting with a personal pronoun is the tell that a pattern like
// "interest in joining (X)" grabbed the wrong span -- "...interest in
// joining us as a Cloud Engineer Graduate" names no company at all, "us" is
// the employer referring to itself. Confirmed real: a ByteDance graduate-
// program email extracted "us as a Cloud Engineer Graduate" as the company.
const LEADING_PRONOUN = /^(?:us|we|our|you|your|them|they|it|i)\b/i;

// Free-text regex extraction is fragile — a plausible company name is short.
// Rejects sentence-length captures like "the AI Software Development
// Engineer position at AMD" instead of trusting them outright.
function isPlausibleCompanyName(s) {
  if (!s) return false;
  if (LEADING_PRONOUN.test(s.trim())) return false;
  return s.length <= 60 && s.trim().split(/\s+/).length <= 6;
}

function extractCompanyFromText(subject, body) {
  for (const re of SUBJECT_COMPANY_PATTERNS) {
    const match = (subject || '').match(re);
    if (match) {
      const cleaned = trimCompany(cleanExtracted(match[1]));
      if (isPlausibleCompanyName(cleaned)) return cleaned;
    }
  }
  for (const re of SUBJECT_COMPANY_PATTERNS) {
    const match = (body || '').match(re);
    if (match) {
      const cleaned = trimCompany(cleanExtracted(match[1]));
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

// Role nouns that can follow a title ("... the Backend Engineer position").
// Written out inline in each pattern rather than interpolated, so the regex
// escapes stay literal and reviewable.

// Ordered most-specific first. A labeled field ("Job Title: X") is the most
// reliable signal, so it's checked before any free-text phrasing.
// A period inside a title ("Software Engineer, R.&D.") shouldn't end the
// capture — only a sentence-ending one (followed by space or end) should.
const JOB_TITLE_PATTERNS = [
  // "Job Title: Senior Data Engineer" / "Position - Product Designer"
  /^[ \t]*(?:job title|position title|role title|job|position|role)[ \t]*[:–—-][ \t]*((?:[^.\n|]|\.(?!\s|$))+)/im,
  // "applying to our role: Software Engineer I, Storage"
  /(?:applying|applied|application)\s+(?:to|for)\s+(?:our\s+|the\s+|this\s+)?(?:position|role|opening|opportunity|vacancy|requisition|job)[ \t]*[:–—-][ \t]*((?:[^.\n|]|\.(?!\s|$))+)/i,
  // "for the position of Software Engineer"
  /(?:position|role|opening|opportunity|vacancy|requisition)\s+of\s+(?:the\s+)?([^.,\n(]+)/i,
  // "applying for the Backend Engineer role"
  /for\s+the\s+([^.,\n(]+?)\s+(?:position|role|opening|opportunity|vacancy|requisition|req)\b/i,
  // Anchored on "application to/for" specifically — a bare "to" is too
  // common a word and matches unrelated earlier sentences (e.g. "a
  // reminder to complete...") in longer emails.
  /application\s+(?:to|for)\s+(?:the\s+)?([^.,\n(]+?)\s+(?:position|role|opening|opportunity|vacancy|requisition|req)\b/i,
  // "your interest in the Data Analyst opening"
  /interest\s+in\s+(?:the\s+)?([^.,\n(]+?)\s+(?:position|role|opening|opportunity|vacancy)\b/i,
  // Last free-text resort: any "the <title> position/role" clause, wherever
  // it sits ("pleased to offer you the Senior Engineer position"). Broad, so
  // it runs after the anchored patterns and leans on isPlausibleJobTitle().
  /\bthe\s+([^.,\n(]+?)\s+(?:position|role|opening|opportunity|vacancy)\b/i,
  /for ([^.,\n(]+?)\s*\(Job ID/i,
  /for ([^.,\n(]+?)\s*\(req/i,
  // "application for Associate, Software Engineer (43447)" -- a level and a
  // discipline separated by a comma, closed off by a bare requisition
  // number in parens (as distinct from the "(Job ID ...)"/"(req ...)"
  // labelled forms above, which are unambiguous enough to stop at any
  // comma). The generic fallback below excludes commas entirely, which
  // truncated this real shape down to just "Associate" -- confirmed against
  // real L3Harris mail, where it collapsed two different roles (Software
  // Engineer and Systems Engineering) into the same truncated title and
  // merged what should have been two separate jobs into one.
  /application for ([^.\n(]+?)\s*\(\d{3,}\)/i,
  /application for ([^.,\n(]+?)(?:\s+at\s+|\s*[.,(\n]|$)/i,
];

// Subject lines routinely tack the role onto the company after a separator
// ("Thank you for applying to Acme Robotics - Backend Engineer"). Only tried
// on the subject, and only after the "applying/application" anchor, so it
// can't fire on an arbitrary hyphenated sentence.
const SUBJECT_TRAILING_TITLE =
  /(?:applying|application)\s+(?:to|at|for)\s+[^\n|–—-]+[|–—-]\s*([^\n|]+)$/i;

// A leading lowercase filler word (verb, pronoun, article) is the tell that
// a non-greedy capture ran across a sentence boundary into unrelated text
// instead of landing on an actual title, e.g. "be considered for the" or
// "submit your application for the".
const JOB_TITLE_BAD_LEAD_WORDS = new Set([
  'a', 'an', 'the', 'you', 'your', 'we', 'our', 'us', 'this', 'that', 'it',
  'if', 'to', 'for', 'and', 'or', 'but', 'be', 'see', 'take', 'submit',
  'complete', 'arrange', 'apply', 'applying', 'proceed',
]);

// Nouns that name part of the hiring *process* rather than the job. A capture
// starting with one of these ran into surrounding boilerplate.
const JOB_TITLE_BAD_LEAD_NOUNS = new Set([
  'assessment', 'interview', 'survey', 'questionnaire', 'following', 'open',
  'profile', 'account', 'email', 'resume', 'cv', 'offer', 'update',
  'status', 'invitation', 'reminder', 'message', 'candidate', 'requisition',
]);

// A preposition inside a capture means it spanned a clause boundary
// ("the assessment for the role"). "of" is excluded — real titles use it
// ("Head of Engineering", "Director of Product").
const CLAUSE_SPANNING_WORDS = /\b(?:for|at|with|about|regarding|from|via|on)\b/i;

// Captures that are structurally title-shaped but carry no role information.
const JOB_TITLE_BAD_VALUES = new Set([
  'position', 'role', 'job', 'opening', 'opportunity', 'vacancy',
  'application', 'this position', 'this role', 'the position', 'the role',
]);

// Trailing scraps a capture commonly drags along after the real title.
function trimJobTitle(s) {
  if (!s) return null;
  return (
    s
      // "Software Engineer II at Acme Corp" -> "Software Engineer II"
      .replace(/\s+at\s+[^,]*$/i, '')
      // "Backend Engineer (R12345)" / "- Req 4471" / "#4471"
      .replace(/\s*[([{][^)\]}]*[)\]}]\s*$/, '')
      .replace(/\s*[-–—]\s*(?:req(?:uisition)?|job\s*id|id)\b.*$/i, '')
      // "Application Software Engineer 1 - 343874" -> drops the bare req number
      .replace(/\s*[-–—]\s*\d{4,}\s*$/, '')
      .replace(/\s*[-–—|]\s*$/, '')
      .replace(/^(?:the|our|a|an)\s+/i, '')
      .replace(/[\s.:,;-]+$/, '')
      .trim() || null
  );
}

function isPlausibleJobTitle(s) {
  if (!s) return false;
  const words = s.trim().split(/\s+/);
  if (words.length > 12 || s.length > 100) return false;
  // Needs at least one real word — "12345" or "-" is not a title.
  if (!/[a-z]{2}/i.test(s)) return false;
  if (JOB_TITLE_BAD_VALUES.has(s.trim().toLowerCase())) return false;
  if (JOB_TITLE_BAD_LEAD_NOUNS.has(words[0].toLowerCase())) return false;
  if (CLAUSE_SPANNING_WORDS.test(s)) return false;
  // A trailing article/preposition is the tell of a truncated clause.
  if (/\b(?:the|a|an|of|and|or|to|in)$/i.test(s.trim())) return false;
  // "your application", "the application status" etc. describe the email
  // rather than the job. Only the possessive/article forms are rejected:
  // "Application Software Engineer" and "Applications Engineer" are real
  // titles, and blanket-rejecting the word threw them away.
  if (/\b(?:your|the|this|my|our)\s+applications?\b/i.test(s)) return false;
  // The EEO/"Equal Employment Opportunity is The Law" footer is boilerplate
  // on nearly every corporate application-confirmation email. The generic
  // "the X opportunity" fallback pattern read "the EEOC's ... Equal
  // Employment[\n]Opportunity is The Law" as a title -- confirmed against a
  // real Google confirmation, where it landed as job_title 'EEOC's "Equal
  // Employment' and, since a group's title only ever gets set once, stuck
  // there even after a later email would otherwise have supplied the real
  // role (or left it correctly unknown, since this email names no role at
  // all).
  if (/equal employment/i.test(s)) return false;
  return !JOB_TITLE_BAD_LEAD_WORDS.has(words[0].toLowerCase());
}

function firstPlausibleTitle(text, patterns) {
  for (const re of patterns) {
    const match = (text || '').match(re);
    if (match) {
      const cleaned = trimJobTitle(cleanExtracted(match[1]));
      if (isPlausibleJobTitle(cleaned)) return cleaned;
    }
  }
  return null;
}

function extractJobTitle({ subject, body }) {
  return (
    firstPlausibleTitle(subject, JOB_TITLE_PATTERNS) ||
    firstPlausibleTitle(body, JOB_TITLE_PATTERNS) ||
    firstPlausibleTitle(subject, [SUBJECT_TRAILING_TITLE]) ||
    null
  );
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
    // Low confidence when we can't name the status, the company, or the
    // role — callers should try the LLM fallback in that case. A missing
    // title used to be silently accepted here, which is how rows ended up
    // stored as 'Unknown title' even though the role was in the email.
    needsFallback: !status || !company || !jobTitle,
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
  // Exported so the LLM orchestrator can hold model output to the same
  // plausibility bar as a regex capture.
  isPlausibleJobTitle,
  trimJobTitle,
};
