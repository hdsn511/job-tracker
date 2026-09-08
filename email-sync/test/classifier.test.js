const test = require('node:test');
const assert = require('node:assert/strict');

const {
  identifyATS,
  classifyNoise,
  classifyStatus,
  extractCompany,
  extractJobTitle,
  extractJobId,
  classifyEmail,
} = require('../src/classifier');

test('identifyATS: workday subdomain', () => {
  const { ats, domain } = identifyATS('PwC <pwc@myworkday.com>');
  assert.equal(ats, 'workday');
  assert.equal(domain, 'myworkday.com');
});

test('identifyATS: greenhouse, ashby, lever, icims have no company signal in the address', () => {
  assert.equal(identifyATS('no-reply@us.greenhouse-mail.io').ats, 'greenhouse');
  assert.equal(identifyATS('no-reply@ashbyhq.com').ats, 'ashby');
  assert.equal(identifyATS('no-reply@hire.lever.co').ats, 'lever');
  assert.equal(identifyATS('careers+autoreply@talent.icims.com').ats, 'icims');
});

test('identifyATS: hackerrank vendor and oracle recruiting cloud', () => {
  assert.equal(identifyATS('support@hackerrankforwork.com').ats, 'hackerrank');
  assert.equal(
    identifyATS('no-reply@abc123.workflow.mail.us2.cloud.oracle.com').ats,
    'oracle_recruiting',
  );
});

test('identifyATS: direct/custom company senders', () => {
  assert.equal(identifyATS('talent@ibm.com').ats, 'direct');
  assert.equal(identifyATS('noreply@mail.amazon.jobs').ats, 'direct');
  assert.equal(identifyATS('no-reply@stripe.com').ats, 'direct');
});

test('extractCompany: direct sender map', () => {
  assert.equal(
    extractCompany({ from: 'talent@ibm.com', subject: '', body: '' }),
    'IBM',
  );
  assert.equal(
    extractCompany({ from: 'noreply@mail.amazon.jobs', subject: '', body: '' }),
    'Amazon',
  );
  assert.equal(
    extractCompany({ from: 'donotreply@email.careers.microsoft.com', subject: '', body: '' }),
    'Microsoft',
  );
});

test('extractCompany: workday subdomain prettified via known map', () => {
  assert.equal(extractCompany({ from: 'pwc@myworkday.com', subject: '', body: '' }), 'PwC');
  assert.equal(
    extractCompany({ from: 'blueorigin@myworkday.com', subject: '', body: '' }),
    'Blue Origin',
  );
  assert.equal(extractCompany({ from: 'chewy@myworkday.com', subject: '', body: '' }), 'Chewy');
});

test('extractCompany: workday subdomain fallback capitalization for unknown company', () => {
  assert.equal(
    extractCompany({ from: 'acmecorp@myworkday.com', subject: '', body: '' }),
    'Acmecorp',
  );
});

test('extractCompany: greenhouse/ashby extracted from subject text', () => {
  assert.equal(
    extractCompany({
      from: 'no-reply@us.greenhouse-mail.io',
      subject: 'Thank you for applying to Acme Robotics',
      body: '',
    }),
    'Acme Robotics',
  );
  assert.equal(
    extractCompany({
      from: 'no-reply@ashbyhq.com',
      subject: "Thanks for applying to Nova Labs!",
      body: '',
    }),
    'Nova Labs',
  );
  assert.equal(
    extractCompany({
      from: 'no-reply@us.greenhouse-mail.io',
      subject: 'Widgetco | Application Confirmation',
      body: '',
    }),
    'Widgetco',
  );
});

test('extractCompany: micro1 flags third-party but prefers real employer from body', () => {
  assert.equal(
    extractCompany({
      from: 'support@micro1.ai',
      subject: 'Your assessment for Acme Corp',
      body: 'Thank you for applying to Acme Corp',
    }),
    'Acme Corp',
  );
  assert.equal(
    extractCompany({ from: 'support@micro1.ai', subject: 'Screening invite', body: '' }),
    'micro1 (third-party AI screener)',
  );
});

test('extractJobId: Amazon "ID:" and JPMorganChase "Job Number:" formats', () => {
  assert.equal(extractJobId({ subject: 'Amazon ID: 3130865', body: '' }), '3130865');
  assert.equal(
    extractJobId({ subject: '', body: 'JPMorganChase Job Number: 210774111' }),
    '210774111',
  );
});

test('classifyStatus: Applied signals', () => {
  assert.equal(classifyStatus('Thank you for applying to our team').status, 'Applied');
  assert.equal(classifyStatus("We've received your application").status, 'Applied');
  assert.equal(classifyStatus('Your application has been successfully submitted').status, 'Applied');
});

test('classifyStatus: Interviewing covers both OA/assessment and interview signals', () => {
  assert.equal(classifyStatus('Please complete your HackerRank coding challenge').status, 'Interviewing');
  assert.equal(classifyStatus('Action Required: IBM Coding Assessment').detail, 'Assessment/OA');
  assert.equal(classifyStatus('We would like to schedule a call for a phone screen').detail, 'Interview');
  assert.equal(classifyStatus('Interview invitation from our team').status, 'Interviewing');
});

test('classifyStatus: Rejected signals', () => {
  assert.equal(
    classifyStatus('We will not be moving forward with your application').status,
    'Rejected',
  );
  assert.equal(
    classifyStatus('We have decided to move forward with other candidates').status,
    'Rejected',
  );
  assert.equal(
    classifyStatus('Unfortunately, after review, you were not selected').status,
    'Rejected',
  );
});

test('classifyStatus: Offer signals', () => {
  assert.equal(classifyStatus('We are pleased to offer you the position').status, 'Offer');
  assert.equal(classifyStatus('Please find your offer letter attached').status, 'Offer');
});

test('classifyStatus: precedence — offer/rejection language wins over generic applied boilerplate', () => {
  const text = 'Thank you for applying. We are pleased to offer you the role.';
  assert.equal(classifyStatus(text).status, 'Offer');
});

test('classifyStatus: unrecognized text returns null (triggers fallback)', () => {
  assert.equal(classifyStatus('Please verify your email address').status, null);
});

test('classifyNoise: Amazon duplicate "keep track" reminder is noise', () => {
  const result = classifyNoise({
    from: 'noreply@mail.amazon.jobs',
    subject: 'Keep track of your application',
    body: 'Amazon ID: 3130865',
  });
  assert.equal(result.isNoise, true);
  assert.equal(result.reason, 'amazon_duplicate_reminder');
});

test('classifyNoise: job alert / recommendation senders are noise', () => {
  assert.equal(
    classifyNoise({ from: 'donotreply@match.indeed.com', subject: 'New jobs for you', body: '' })
      .isNoise,
    true,
  );
  assert.equal(
    classifyNoise({ from: 'team@hi.wellfound.com', subject: 'Jobs matching your profile', body: '' })
      .isNoise,
    true,
  );
  assert.equal(
    classifyNoise({
      from: 'jobs-noreply@linkedin.com',
      subject: 'Jobs you may be interested in',
      body: '',
    }).isNoise,
    true,
  );
});

test('classifyNoise: a real Amazon application-received email is not noise', () => {
  const result = classifyNoise({
    from: 'noreply@mail.amazon.jobs',
    subject: 'Thank you for applying — Amazon ID: 3130865',
    body: '',
  });
  assert.equal(result.isNoise, false);
});

test('classifyEmail: full pipeline on a Workday application confirmation', () => {
  const result = classifyEmail({
    from: 'Salesforce Careers <salesforce@myworkday.com>',
    subject: 'Application Received',
    body: 'Thank you for applying for the Software Engineer position at Salesforce.',
  });
  assert.equal(result.isNoise, false);
  assert.equal(result.company, 'Salesforce');
  assert.equal(result.status, 'Applied');
  assert.equal(result.jobTitle, 'Software Engineer');
});

test('classifyEmail: micro1 assessment is flagged as third-party', () => {
  const result = classifyEmail({
    from: 'support@micro1.ai',
    subject: 'Action Required: Complete your assessment',
    body: 'Please complete your assessment for the Backend Engineer role.',
  });
  assert.equal(result.isThirdParty, true);
  assert.equal(result.status, 'Interviewing');
});

test('extractCompany: iCIMS "<company>+autoreply@" tag is trusted over free text', () => {
  assert.equal(
    extractCompany({
      from: 'AMD Careers <amd+autoreply@talent.icims.com>',
      subject: 'Thank you for applying at AMD, Inc.',
      body:
        'Thank you very much for your recent application to the AI Software Development ' +
        'Engineer position at AMD, Inc.. Your submission will be reviewed.',
    }),
    'AMD',
  );
});

test('extractCompany: generic free-text fallback rejects sentence-length captures', () => {
  const result = extractCompany({
    from: 'careers@unknown-corp-example.com',
    subject: 'Update on your application',
    body:
      'Thank you very much for your recent application to the AI Software Development ' +
      'Engineer position at AMD, Inc.. Your submission will be reviewed.',
  });
  // No ATS/direct-sender signal and the only regex match is sentence-length,
  // so this should come back null (-> NEEDS REVIEW) rather than garbage.
  assert.equal(result, null);
});

test('extractJobTitle: "application to the X position at Y" phrasing', () => {
  assert.equal(
    extractJobTitle({
      subject: 'Thank you for applying at AMD, Inc.',
      body: 'Thank you very much for your recent application to the AI Software Development Engineer position at AMD, Inc..',
    }),
    'AI Software Development Engineer',
  );
});

test('extractCompany: a period inside the company name is not truncated', () => {
  assert.equal(
    extractCompany({
      from: 'no-reply@us.greenhouse-mail.io',
      subject: 'Thank you for applying to ID.me',
      body: 'Thank you for your interest in working at ID.me. Our recruiting team is hard at work.',
    }),
    'ID.me',
  );
});

test('extractCompany: "Company | Application Received" (not just "Confirmation")', () => {
  assert.equal(
    extractCompany({
      from: 'Crusoe Hiring Team <no-reply@ashbyhq.com>',
      subject: 'Crusoe | Application Received',
      body: 'Thank you for applying to our role: Software Engineer I, Storage. We appreciate your interest.',
    }),
    'Crusoe',
  );
});

test('classifyEmail: full pipeline on the real AMD/iCIMS example', () => {
  const result = classifyEmail({
    from: 'AMD Careers <amd+autoreply@talent.icims.com>',
    subject: 'Thank you for applying at AMD, Inc.',
    body:
      'Dear Hudson,\n\nThank you very much for your recent application to the AI Software ' +
      'Development Engineer position at AMD, Inc.. Your submission will be reviewed by our ' +
      'recruiting staff.',
  });
  assert.equal(result.isNoise, false);
  assert.equal(result.company, 'AMD');
  assert.equal(result.jobTitle, 'AI Software Development Engineer');
  assert.equal(result.status, 'Applied');
});

test('classifyEmail: unclassifiable status sets needsFallback', () => {
  const result = classifyEmail({
    from: 'talent@ibm.com',
    subject: 'A note from IBM Careers',
    body: 'We wanted to reach out.',
  });
  assert.equal(result.needsFallback, true);
});
