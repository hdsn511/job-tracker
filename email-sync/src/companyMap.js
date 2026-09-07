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
};

// Third-party vendors that are not the employer themselves.
const THIRD_PARTY_SENDERS = {
  'support@micro1.ai': 'micro1 (third-party AI screener)',
};

// Workday subdomains ("<company>@myworkday.com") that don't prettify well
// with simple capitalization.
const KNOWN_WORKDAY_NAMES = {
  pwc: 'PwC',
  chewy: 'Chewy',
  salesforce: 'Salesforce',
  blueorigin: 'Blue Origin',
};

function prettifyWorkdaySubdomain(subdomain) {
  const known = KNOWN_WORKDAY_NAMES[subdomain.toLowerCase()];
  if (known) return known;
  // Best-effort fallback: capitalize the raw subdomain as one word.
  return subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
}

module.exports = {
  KNOWN_DIRECT_SENDERS,
  THIRD_PARTY_SENDERS,
  KNOWN_WORKDAY_NAMES,
  prettifyWorkdaySubdomain,
};
