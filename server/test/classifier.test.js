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
} = require('../sync/classifier');

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

test('classifyStatus: assessments are their own stage, interviews are not', () => {
  assert.equal(classifyStatus('Please complete your HackerRank coding challenge').status, 'Assessment');
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
  assert.equal(result.status, 'Assessment');
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

test('extractCompany: "<role> position at <Company>" resolves the employer', () => {
  // This case used to return null on the grounds that the only regex match
  // was sentence-length. It no longer has to guess: "position at X" pins the
  // company precisely, so an unknown sender still resolves to AMD instead of
  // going to review.
  assert.equal(
    extractCompany({
      from: 'careers@unknown-corp-example.com',
      subject: 'Update on your application',
      body:
        'Thank you very much for your recent application to the AI Software Development ' +
        'Engineer position at AMD, Inc.. Your submission will be reviewed.',
    }),
    'AMD',
  );
});

test('extractCompany: a sentence-length capture is still rejected', () => {
  // The original guard still has to hold for text with no anchoring phrase.
  assert.equal(
    extractCompany({
      from: 'careers@unknown-corp-example.com',
      subject: 'Update on your application',
      body: 'Your application to be considered for one of the many teams we are hiring across is noted.',
    }),
    null,
  );
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

// ---------------------------------------------------------------------------
// Regression: profile/account boilerplate was being read as an interview stage
// ---------------------------------------------------------------------------

test('classifyStatus: "complete your profile" is not an interview stage', () => {
  assert.notEqual(
    classifyStatus('Action Required: Complete your candidate profile').status,
    'Assessment',
  );
  assert.notEqual(
    classifyStatus('Please complete your profile so we can process your application').status,
    'Interviewing',
  );
});

test('classifyStatus: account setup / email verification is not an interview stage', () => {
  assert.notEqual(
    classifyStatus('Action required to complete your application. Please verify your email address.')
      .status,
    'Interviewing',
  );
  assert.notEqual(
    classifyStatus('Complete your account setup to finish applying').status,
    'Interviewing',
  );
});

test('classifyStatus: voluntary self-identification survey is not an interview stage', () => {
  assert.notEqual(
    classifyStatus('Action required: complete your voluntary self-identification survey').status,
    'Interviewing',
  );
});

test('classifyStatus: an applied confirmation mentioning "next steps" stays Applied', () => {
  const result = classifyStatus(
    'Thank you for applying to Nova Labs. Next steps: our team will review your application.',
  );
  assert.equal(result.status, 'Applied');
});

test('classifyStatus: profile boilerplate does not suppress genuine interview language', () => {
  const result = classifyStatus(
    'Please complete your profile. We would also like to schedule a call to discuss the role.',
  );
  assert.equal(result.status, 'Interviewing');
});

test('classifyStatus: real assessments map to the Assessment stage', () => {
  assert.equal(
    classifyStatus('Please complete your online assessment for the Backend Engineer role').detail,
    'Assessment/OA',
  );
  assert.equal(
    classifyStatus('Action Required: complete your coding challenge').detail,
    'Assessment/OA',
  );
  assert.equal(
    classifyStatus('You have been invited to take a HackerRank test').detail,
    'Assessment/OA',
  );
  assert.equal(classifyStatus('Your take-home assignment is ready').detail, 'Assessment/OA');
});

test('classifyStatus: real interview invitations stay Interviewing', () => {
  assert.equal(classifyStatus('Interview invitation from our team').detail, 'Interview');
  assert.equal(classifyStatus('We would like to schedule a phone screen').detail, 'Interview');
  assert.equal(
    classifyStatus('Next steps: please share your availability for an interview').detail,
    'Interview',
  );
});

// ---------------------------------------------------------------------------
// Regression: job titles present in the email were coming back null
// ---------------------------------------------------------------------------

test('extractJobTitle: "our role: X" phrasing (Ashby confirmations)', () => {
  assert.equal(
    extractJobTitle({
      subject: 'Crusoe | Application Received',
      body: 'Thank you for applying to our role: Software Engineer I, Storage. We appreciate your interest.',
    }),
    'Software Engineer I, Storage',
  );
});

test('extractJobTitle: "position of X" phrasing', () => {
  assert.equal(
    extractJobTitle({
      subject: 'Application received',
      body: 'We have received your application for the position of Software Engineer.',
    }),
    'Software Engineer',
  );
});

test('extractJobTitle: labeled "Job Title:" / "Position:" fields', () => {
  assert.equal(
    extractJobTitle({
      subject: 'Application Received',
      body: 'Job Title: Senior Data Engineer\nJob ID: R12345\nThank you for applying.',
    }),
    'Senior Data Engineer',
  );
  assert.equal(
    extractJobTitle({ subject: '', body: 'Position: Product Designer\nLocation: Remote' }),
    'Product Designer',
  );
});

test('extractJobTitle: "opening" / "opportunity" as role nouns', () => {
  assert.equal(
    extractJobTitle({ subject: '', body: 'Thank you for your interest in the Data Analyst opening.' }),
    'Data Analyst',
  );
});

test('extractJobTitle: title trailing the company in the subject line', () => {
  assert.equal(
    extractJobTitle({
      subject: 'Thank you for applying to Acme Robotics - Backend Engineer',
      body: 'We received your application.',
    }),
    'Backend Engineer',
  );
});

test('extractJobTitle: strips a trailing "at <Company>" and req suffix', () => {
  assert.equal(
    extractJobTitle({ subject: '', body: 'Your application for Software Engineer II at Acme Corp' }),
    'Software Engineer II',
  );
});

test('extractJobTitle: rejects non-title captures', () => {
  assert.equal(
    extractJobTitle({ subject: '', body: 'Job Title: 12345' }),
    null,
  );
  assert.equal(
    extractJobTitle({ subject: '', body: 'Thank you for the position.' }),
    null,
  );
});

test('extractCompany: a dash-separated title in the subject is not part of the company', () => {
  assert.equal(
    extractCompany({
      from: 'no-reply@us.greenhouse-mail.io',
      subject: 'Thank you for applying to Acme Robotics - Backend Engineer',
      body: 'We received your application.',
    }),
    'Acme Robotics',
  );
});

test('classifyEmail: a missing job title triggers the LLM fallback', () => {
  const result = classifyEmail({
    from: 'talent@ibm.com',
    subject: 'Application Received',
    body: 'Thank you for applying. We have received your submission.',
  });
  assert.equal(result.status, 'Applied');
  assert.equal(result.company, 'IBM');
  assert.equal(result.jobTitle, null);
  assert.equal(result.needsFallback, true);
});

test('classifyEmail: profile-completion email from an ATS is not Interviewing', () => {
  const result = classifyEmail({
    from: 'PwC <pwc@myworkday.com>',
    subject: 'Action Required: Complete your candidate profile',
    body: 'Please complete your profile so we can finish processing your application.',
  });
  assert.notEqual(result.status, 'Interviewing');
});

test('extractJobTitle: generic "the X position/role" clause', () => {
  assert.equal(
    extractJobTitle({
      subject: '',
      body: 'We would like to schedule a call to discuss the Software Engineer position.',
    }),
    'Software Engineer',
  );
  assert.equal(
    extractJobTitle({ subject: '', body: 'We are pleased to offer you the Senior Engineer position.' }),
    'Senior Engineer',
  );
});

test('extractJobTitle: keeps "of" inside a real title', () => {
  assert.equal(
    extractJobTitle({ subject: '', body: 'Your application for the Head of Engineering role.' }),
    'Head of Engineering',
  );
});

test('extractJobTitle: rejects captures that span a clause boundary', () => {
  assert.equal(
    extractJobTitle({ subject: '', body: 'Please complete the assessment for the role.' }),
    null,
  );
  assert.equal(
    extractJobTitle({ subject: '', body: 'We reviewed the applications for the role.' }),
    null,
  );
  assert.equal(
    extractJobTitle({ subject: '', body: 'Information about the role and the team.' }),
    null,
  );
});
