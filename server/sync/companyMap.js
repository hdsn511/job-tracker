// Sender-address / domain -> employer name, for ATS setups where the
// "from" address itself identifies the company (no need to parse the body).
const KNOWN_DIRECT_SENDERS = {
  'talent@ibm.com': 'IBM',
  'noreply@mail.amazon.jobs': 'Amazon',
  'noreply@google.com': 'Google',
  'no-reply@openai.com': 'OpenAI',
  'no-reply-recruiting@spacex.com': 'SpaceX',
  'noreply@oracle.com': 'Oracle',
  'donotreply@email.careers.microsoft.com': 'Microsoft',
  'no-reply@stripe.com': 'Stripe',
  'careers@recruitment.americanexpress.com': 'American Express',
  'talentacquisitiongroup@cognizant.com': 'Cognizant',
  'careers@talent.paypal.com': 'PayPal',
  'careers@epic.com': 'Epic',
  'dellrecruiting@recruiting.dell.com': 'Dell',
  'amd_careers_noreply@amd.com': 'AMD',
};

// Third-party vendors that are not the employer themselves.
const THIRD_PARTY_SENDERS = {
  'support@micro1.ai': 'micro1 (third-party AI screener)',
};

// Short company slugs (from a Workday subdomain, or the "<company>+..." tag
// in an iCIMS local-part) that don't prettify well with simple
// capitalization — either an all-caps abbreviation or multiple words.
const KNOWN_COMPANY_SLUGS = {
  pwc: 'PwC',
  chewy: 'Chewy',
  salesforce: 'Salesforce',
  blueorigin: 'Blue Origin',
  amd: 'AMD',
  ibm: 'IBM',
  generalmotors: 'General Motors',
  // Nightwing's Workday tenant slug -- "nwis" is a legacy/internal name
  // (Northrop Grumman's former IT & Mission Support sector, spun off as
  // Nightwing), not something a plain capitalize() fallback could recover.
  // Confirmed against a real "nwis@myworkday.com" application-received
  // email, whose own footer signs off as "Nightwing Talent Acquisition".
  nwis: 'Nightwing',
};

function prettifyCompanySlug(slug) {
  const known = KNOWN_COMPANY_SLUGS[slug.toLowerCase()];
  if (known) return known;
  // Best-effort fallback: capitalize the raw slug as one word.
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

module.exports = {
  KNOWN_DIRECT_SENDERS,
  THIRD_PARTY_SENDERS,
  KNOWN_COMPANY_SLUGS,
  prettifyCompanySlug,
};
