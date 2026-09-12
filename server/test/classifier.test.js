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

// Real Nightwing (spun off from Northrop Grumman) mail: the Workday tenant
// slug is the legacy "nwis", which the plain-capitalize fallback turned into
// "Nwis" instead of the real company name.
test('extractCompany: workday subdomain "nwis" maps to Nightwing', () => {
  assert.equal(extractCompany({ from: 'nwis@myworkday.com', subject: '', body: '' }), 'Nightwing');
});

test('extractCompany: workday subdomain fallback capitalization for unknown company', () => {
  assert.equal(
    extractCompany({ from: 'acmecorp@myworkday.com', subject: '', body: '' }),
    'Acmecorp',
  );
});

// Real L3Harris mail: their own subject line carries a leading zero-width
// space before the company name ("Thank you for applying at ​L3Harris!"),
// which survived straight through into the stored company name since
// neither \s nor .trim() treat U+200B as whitespace.
test('extractCompany: a zero-width space embedded in the source text is stripped, not stored', () => {
  assert.equal(
    extractCompany({
      from: 'bizx@l3harris.ns2cloud.com',
      subject: 'Thank you for applying at ​L3Harris!',
      body: '',
    }),
    'L3Harris',
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

// Real Epidemic Sound confirmation: "Thanks for applying to be our next
// Backend Engineer - Studio!" was extracting "be our next Backend Engineer"
// as the company. The real name only appears later in the body ("interest
// in Epidemic Sound"), which extractCompanyFromText now reaches once the
// infinitive false match is excluded.
test('extractCompany: "applying to be our next X" names the role, not the company', () => {
  assert.equal(
    extractCompany({
      from: 'no-reply@ashbyhq.com',
      subject: 'Epidemic Sound - Thank you for your application!',
      body:
        'Thanks for applying to be our next Backend Engineer - Studio! We’re thrilled ' +
        'you’re interested in joining the team.\n\n' +
        'Thanks again for your interest in Epidemic Sound. We’ll be in touch!',
    }),
    'Epidemic Sound',
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

// Regression coverage for three real misclassifications found by auditing
// this user's actual mail against what the app had stored (real Gmail
// content, paraphrased here rather than quoted verbatim).

test('classifyStatus: a conditional "if you are not selected" disclaimer is not a rejection', () => {
  // Real IBM assessment-invite mail: "If you are successful with the
  // assessment, you will be contacted about next steps. If you are not
  // selected, you will be notified." -- a hypothetical about a future,
  // undecided outcome, not a decision that already happened.
  const text =
    "You're invited to complete our assessment. If you are successful, you will be contacted about next steps. " +
    'If you are not selected, you will be notified, and you are welcome to apply for other open positions.';
  assert.notEqual(classifyStatus(text).status, 'Rejected');
});

test('classifyStatus: a long conditional list before "not selected" is still not a rejection', () => {
  // Real Microsoft application-confirmation mail, sent the same minute as
  // applying: "If you see the job moved to an inactive state, that means
  // the position is either no longer open, you withdrew from
  // consideration, or you were not selected for the role." 142 characters
  // separate "if" from "not selected" -- the original 60-char exclude
  // window didn't reach across this longer conditional list, so a fresh
  // application confirmation read as an actual rejection.
  const text =
    'Thank you for taking the time to submit your application for Software Engineer Intune. ' +
    'If you see the job moved to an inactive state, that means the position is either no longer open, ' +
    'you withdrew from consideration, or you were not selected for the role.';
  assert.notEqual(classifyStatus(text).status, 'Rejected');
});

test('classifyStatus: a declarative "not selected" (no "if") still reads as Rejected', () => {
  // The exclude above is scoped to the conditional framing specifically --
  // a real, already-decided rejection using the same words must still match.
  assert.equal(classifyStatus('After careful review, you were not selected for this role').status, 'Rejected');
});

test('classifyStatus: "identified other candidates to move forward" is Rejected', () => {
  // Real Chewy rejection: "we have identified other candidates to move
  // forward in consideration for this role." The verb is "identified", not
  // "decided"/"chosen" like the other Rejected patterns, so this fell
  // through to null when the LLM (which read it correctly) was unavailable
  // and the rules engine was the only fallback.
  const text =
    'Thank you for expressing interest in our Software Engineer I role. We appreciate you applying. ' +
    'At this time, we have identified other candidates to move forward in consideration for this role.';
  assert.equal(classifyStatus(text).status, 'Rejected');
});

test('classifyStatus: a conditional "if you have been selected...set up an interview" is not an interview stage', () => {
  // Real Chewy application-confirmation mail (sent the same day as
  // applying): "If you have been selected, a recruiter will contact you
  // directly to set up an interview." Nothing has been decided yet -- this
  // misread as a real invitation before the Interviewing rule had a
  // conditional guard mirroring the Rejected rule's.
  const text =
    'The Chewy recruiting team thanks you for your interest in this role! ' +
    'If you have been selected, a recruiter will contact you directly to set up an interview. ' +
    'Otherwise we will keep your resume in our database.';
  assert.notEqual(classifyStatus(text).status, 'Interviewing');
});

test('classifyStatus: "chosen/decided to (move forward with|pursue) a[nother] (different) candidate" is Rejected', () => {
  // Real Oracle rejection: "chosen to move forward with another candidate."
  assert.equal(
    classifyStatus('The hiring manager has chosen to move forward with another candidate.').status,
    'Rejected',
  );
  // Real Intel rejection: "decided to pursue a different candidate."
  assert.equal(
    classifyStatus('After careful review, we have decided to pursue a different candidate.').status,
    'Rejected',
  );
});

test('classifyStatus: a generic mention of "interview process" near "next steps" is not an interview stage', () => {
  // Real OpenAI application-confirmation mail: "we'll discuss next steps...
  // learn more about our hiring philosophy and interview process" -- an
  // informational link, not an invitation for this candidate.
  const text =
    "Your application has been received. We'll reach out to discuss next steps. " +
    'In the meantime, learn more about our hiring philosophy and interview process.';
  assert.notEqual(classifyStatus(text).status, 'Interviewing');
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

test('extractCompany: a capture starting with a personal pronoun is rejected', () => {
  // Real ByteDance graduate-program subject: "...your interest in joining us
  // as a Cloud Engineer Graduate" -- the "joining (X)" pattern grabbed "us
  // as a Cloud Engineer Graduate" as if it were the company name, when "us"
  // is the employer referring to itself and names no company at all.
  assert.equal(
    extractCompany({
      from: 'careers@unknown-corp-example.com',
      subject: 'We welcome your interest in joining us as a Cloud Engineer Graduate',
      body: '',
    }),
    null,
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

test('classifyStatus: a conditional "if you meet qualifications, you will receive" assessment promise is not yet Assessment', () => {
  // Real Roblox application-confirmation mail, sent the same minute as
  // applying: "Complete our Assessments: If your profile meets our basic
  // qualifications, you'll receive a link to our assessments." The first
  // Assessment pattern matched on "Complete our Assessments" alone, even
  // though the very next clause says the actual invite (the link) hasn't
  // been sent -- this is still just an application confirmation.
  const text =
    'Thank you for applying to Roblox! We have received your application for our Software Engineer role. ' +
    'Complete our Assessments: If your profile meets our basic qualifications, you will receive a link to our assessments.';
  assert.notEqual(classifyStatus(text).status, 'Assessment');
});

test('classifyStatus: a real, already-issued assessment invitation still matches Assessment', () => {
  // The other half of the same real Roblox thread, sent later once the
  // assessment was actually ready: "We're thrilled to invite you to the
  // next step of the recruiting process — the assessments! ... Access My
  // Assessments." Guards against the conditional exclude above being too
  // broad and swallowing a genuine invite.
  const text =
    'Your Roblox Assessments Invitation\n' +
    "We're thrilled to invite you to the next step of the recruiting process — the assessments! " +
    'Access My Assessments. Your Assessments will expire in 7 days.';
  assert.equal(classifyStatus(text).status, 'Assessment');
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

// Real L3Harris confirmation mail: "Your application for Associate, Software
// Engineer (43447) has been received." The generic "application for X"
// fallback excludes commas from its capture, which truncated this down to
// just "Associate" -- and since a second, different L3Harris application
// ("Associate, Systems Engineering (41239)") truncated to the exact same
// "Associate", the two merged into one job instead of staying separate.
test('extractJobTitle: a comma-separated level/discipline before a bare requisition number is not truncated at the comma', () => {
  assert.equal(
    extractJobTitle({
      subject: '',
      body: 'Your application for Associate, Software Engineer (43447) has been received.',
    }),
    'Associate, Software Engineer',
  );
  assert.equal(
    extractJobTitle({
      subject: '',
      body: 'Your application for Associate, Systems Engineering (41239) has been received.',
    }),
    'Associate, Systems Engineering',
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

test('extractJobTitle: rejects the EEO/"Equal Employment Opportunity" boilerplate footer', () => {
  // Real Google application-confirmation footer. The generic "the X
  // opportunity" fallback read this as job_title 'EEOC's "Equal Employment' --
  // confirmed against the actual mail via Gmail after the DB showed that
  // exact garbage title on a real job row.
  const body =
    'Learn more about our Equal Employment Opportunity policy:\n' +
    'https://careers.google.com/eeo/ and the EEOC\'s "Equal Employment\n' +
    'Opportunity is The Law" (PDF):\n' +
    'https://careers.google.com/static/files/eeoisthelaw.pdf';
  assert.equal(extractJobTitle({ subject: '', body }), null);
});

test('extractJobTitle: rejects a lowercase-leading capture from the generic "the X position/opportunity" fallback', () => {
  // Real IBM assessment-invite boilerplate: "we want to ensure that you have
  // the best opportunity to showcase your fantastic skills" matched the
  // fallback pattern and landed as job_title 'best'.
  assert.equal(
    extractJobTitle({
      subject: '',
      body: 'We want to ensure that you have the best opportunity to showcase your fantastic skills.',
    }),
    null,
  );
  // Real Nightwing/Workday auto-reply: "If your profile meets the
  // requirements of our open position, a member of our recruiting team will
  // be in contact" landed as job_title 'requirements of our open'.
  assert.equal(
    extractJobTitle({
      subject: '',
      body: 'If your profile meets the requirements of our open position, we will be in contact.',
    }),
    null,
  );
  // Real Sift (Ashby) confirmation: "taking the time to apply to our
  // Software Engineer – New College Graduate role" put "the" and "role"
  // around the WRONG span -- the real title sits between them, but the
  // fallback pattern's non-greedy capture still grabbed the whole "time to
  // apply to our..." run since it's the only "the ... role" pair in the
  // sentence. Left null here (rather than guessing at the real title) is
  // correct: a later, cleaner email for the same job supplies it instead.
  assert.equal(
    extractJobTitle({
      subject: '',
      body: 'Thank you for taking the time to apply to our Software Engineer – New College Graduate role.',
    }),
    null,
  );
});
