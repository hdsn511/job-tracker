const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveStage,
  rebuildNotes,
  isSyncAuthoredLine,
  buildNoteLine,
  findExistingJob,
  reconcileDuplicateMessages,
  UNKNOWN_TITLE,
  localDay,
} = require('../sync/jobs');

const at = (iso) => new Date(`${iso}T12:00:00Z`);

// ---------------------------------------------------------------------------
// deriveStage — the rule that replaces "only ever ratchet upwards"
// ---------------------------------------------------------------------------

test('deriveStage: takes the furthest stage reached', () => {
  assert.equal(
    deriveStage([
      { status: 'Applied', date: at('2026-08-01') },
      { status: 'Assessment', date: at('2026-08-10') },
    ]),
    'Assessment',
  );
});

test('deriveStage: order of messages does not matter', () => {
  const messages = [
    { status: 'Interviewing', date: at('2026-08-20') },
    { status: 'Applied', date: at('2026-08-01') },
  ];
  assert.equal(deriveStage(messages), 'Interviewing');
  assert.equal(deriveStage([...messages].reverse()), 'Interviewing');
});

test('deriveStage: a rejection wins even when it follows an interview', () => {
  assert.equal(
    deriveStage([
      { status: 'Applied', date: at('2026-08-01') },
      { status: 'Interviewing', date: at('2026-08-15') },
      { status: 'Rejected', date: at('2026-08-20') },
    ]),
    'Rejected',
  );
});

test('deriveStage: rejection straight after applying', () => {
  assert.equal(
    deriveStage([
      { status: 'Applied', date: at('2026-08-01') },
      { status: 'Rejected', date: at('2026-08-03') },
    ]),
    'Rejected',
  );
});

test('deriveStage: between two terminal outcomes the most recent wins', () => {
  const messages = [
    { status: 'Rejected', date: at('2026-08-10') },
    { status: 'Offer', date: at('2026-08-20') },
  ];
  assert.equal(deriveStage(messages), 'Offer');
  assert.equal(
    deriveStage([
      { status: 'Offer', date: at('2026-08-10') },
      { status: 'Rejected', date: at('2026-08-20') },
    ]),
    'Rejected',
  );
});

test('deriveStage: THE REGRESSION — a re-read walks a wrong stage back down', () => {
  // The old rule could only raise a status, so a row wrongly marked
  // Interviewing stayed Interviewing forever. Re-deriving from the mail must
  // correct it.
  assert.equal(deriveStage([{ status: 'Applied', date: at('2026-08-01') }]), 'Applied');
});

test('deriveStage: no classified messages yields null', () => {
  assert.equal(deriveStage([]), null);
  assert.equal(deriveStage([{ status: null, date: at('2026-08-01') }]), null);
});

// ---------------------------------------------------------------------------
// rebuildNotes — idempotent re-read that preserves hand-written notes
// ---------------------------------------------------------------------------

test('isSyncAuthoredLine: distinguishes sync lines from user notes', () => {
  assert.equal(isSyncAuthoredLine('[2026-08-29] Assessment — Assessment/OA'), true);
  assert.equal(isSyncAuthoredLine('[2026-08-29] Applied — Applied (ref: R-40218)'), true);
  assert.equal(isSyncAuthoredLine('Called the recruiter, waiting to hear back'), false);
  assert.equal(isSyncAuthoredLine('[2026-08-29] spoke to Dana about the team'), false);
});

test('rebuildNotes: replaces a stale sync line rather than appending to it', () => {
  const before = '[2026-08-29] Interviewing — Assessment/OA';
  const after = rebuildNotes(before, ['[2026-08-29] Assessment — Assessment/OA']);
  assert.equal(after, '[2026-08-29] Assessment — Assessment/OA');
  assert.doesNotMatch(after, /Interviewing/);
});

test('rebuildNotes: keeps hand-written notes', () => {
  const before = 'Referred by Dana\n[2026-08-29] Interviewing — Assessment/OA';
  const after = rebuildNotes(before, ['[2026-08-29] Assessment — Assessment/OA']);
  assert.match(after, /^Referred by Dana$/m);
  assert.match(after, /^\[2026-08-29\] Assessment — Assessment\/OA$/m);
});

test('rebuildNotes: is idempotent across repeated re-reads', () => {
  const lines = ['[2026-08-01] Applied — Applied', '[2026-08-20] Rejected — Rejected'];
  const once = rebuildNotes('Referred by Dana', lines);
  const twice = rebuildNotes(once, lines);
  const thrice = rebuildNotes(twice, lines);
  assert.equal(once, twice);
  assert.equal(twice, thrice);
});

test('rebuildNotes: orders the timeline by date', () => {
  const after = rebuildNotes('', [
    '[2026-08-20] Rejected — Rejected',
    '[2026-08-01] Applied — Applied',
  ]);
  assert.equal(after, '[2026-08-01] Applied — Applied\n[2026-08-20] Rejected — Rejected');
});

// ---------------------------------------------------------------------------
// localDay — calendar-day attribution in LOCAL_TIMEZONE, not raw UTC
// ---------------------------------------------------------------------------
// Real bug: an application sent at 8:47pm Central on Sept 10 lands at
// 01:47 UTC on Sept 11. `.toISOString().slice(0, 10)` (the old approach)
// dated it "2026-09-11" -- tomorrow, from the applicant's own perspective --
// which showed up as an off-by-one on the calendar heat map. Confirmed
// against 19 real jobs in the live database before this fix, 17 of which
// were dated by the UTC day rather than the local one.

test('localDay: an evening-local message that has already crossed into the next UTC day stays on its local day', () => {
  // 01:47 UTC on the 11th = 8:47pm Central on the 10th (CDT, UTC-5).
  assert.equal(localDay(new Date('2026-09-11T01:47:02.000Z')), '2026-09-10');
});

test('localDay: a message well within the UTC day matches both UTC and local', () => {
  assert.equal(localDay(new Date('2026-09-10T18:17:11.000Z')), '2026-09-10');
});

test('buildNoteLine: attributes the local calendar day, not the UTC one, for a late-evening message', () => {
  const line = buildNoteLine({ date: new Date('2026-09-11T01:47:02.000Z'), status: 'Applied', detail: 'Applied' });
  assert.match(line, /^\[2026-09-10\]/);
});

test('buildNoteLine: renders detail, ref and third-party marker', () => {
  assert.equal(
    buildNoteLine({
      date: at('2026-08-29'),
      status: 'Assessment',
      detail: 'Assessment/OA',
      jobId: 'R-40218',
      isThirdParty: true,
    }),
    '[2026-08-29] Assessment — Assessment/OA (ref: R-40218) [via third-party screener]',
  );
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

test('findExistingJob: an Unknown-title row is matched and can be backfilled', () => {
  const jobs = [{ id: 1, company_name: 'Crusoe', job_title: UNKNOWN_TITLE, notes: '' }];
  const found = findExistingJob(jobs, { company: 'Crusoe', jobTitle: 'Software Engineer I, Storage' });
  assert.equal(found && found.id, 1);
});

test('findExistingJob: matches by job id ref across a title change', () => {
  const jobs = [{ id: 7, company_name: 'Amazon', job_title: 'SDE', notes: '[2026-08-01] Applied — Applied (ref: 3177934)' }];
  const found = findExistingJob(jobs, { company: 'Different Co', jobTitle: 'Other', jobId: '3177934' });
  assert.equal(found && found.id, 7);
});

// A row already carrying a DIFFERENT job id ref is a different requisition,
// however similar the titles read -- two distinct Amazon postings both
// titled "Software Development Engineer ..." collided here before this
// check existed: findExistingJob would fall through the failed ref lookup
// into the fuzzy company+title matcher below, silently merge the second
// job's messages into the first job's row, and overwrite it. Confirmed
// against real Gmail data auditing 6 Amazon applications where 2 vanished
// from the jobs table this way.
test('findExistingJob: never fuzzy-matches into a row with a different job id ref, even with near-identical titles', () => {
  const jobs = [
    { id: 1, company_name: 'Amazon', job_title: 'Software Development Engineer – Database 2026', notes: '[2026-09-03] Applied — Applied (ref: 3130865)' },
  ];
  const found = findExistingJob(jobs, { company: 'Amazon', jobTitle: 'Software Development Engineer', jobId: '3177934' });
  assert.equal(found, null);
});

test('findExistingJob: fuzzy title match still works for a row with no job id ref of its own', () => {
  const jobs = [{ id: 1, company_name: 'Amazon', job_title: 'Software Development Engineer – Database 2026', notes: '' }];
  const found = findExistingJob(jobs, { company: 'Amazon', jobTitle: 'Software Development Engineer', jobId: '3177934' });
  assert.equal(found && found.id, 1);
});

// ---------------------------------------------------------------------------
// reconcileDuplicateMessages -- same email arriving via both ingestion paths
// ---------------------------------------------------------------------------

// Real case that motivated this: a Microsoft application-confirmation email
// was cached Rejected by the OAuth path before a classifier fix landed, and
// classified correctly as Applied by the upload path after. Both fed
// getAllSignalMessages as if they were two different messages, and
// deriveStage's terminal-wins rule picked the stale Rejected.
test('reconcileDuplicateMessages: same Message-Id from both paths keeps only the more recently classified copy', () => {
  const stale = {
    status: 'Rejected',
    company: 'Microsoft',
    date: at('2026-09-03'),
    messageIdHeader: 'abc123@mail.microsoft.com',
    classifiedAt: at('2026-09-03'),
  };
  const fresh = {
    status: 'Applied',
    company: 'Microsoft',
    date: at('2026-09-03'),
    messageIdHeader: 'abc123@mail.microsoft.com',
    classifiedAt: at('2026-09-11'),
  };
  const result = reconcileDuplicateMessages([stale, fresh]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'Applied');
});

test('reconcileDuplicateMessages: order does not matter -- the freshest copy always wins', () => {
  const stale = { status: 'Rejected', messageIdHeader: 'x@y.com', classifiedAt: at('2026-09-01') };
  const fresh = { status: 'Applied', messageIdHeader: 'x@y.com', classifiedAt: at('2026-09-10') };
  assert.equal(reconcileDuplicateMessages([fresh, stale])[0].status, 'Applied');
  assert.equal(reconcileDuplicateMessages([stale, fresh])[0].status, 'Applied');
});

test('reconcileDuplicateMessages: messages without a Message-Id pass through untouched, including duplicates among themselves', () => {
  const a = { status: 'Applied', company: 'A', messageIdHeader: null };
  const b = { status: 'Applied', company: 'A', messageIdHeader: null };
  const result = reconcileDuplicateMessages([a, b]);
  assert.equal(result.length, 2);
});

test('reconcileDuplicateMessages: distinct Message-Ids are all kept', () => {
  const a = { status: 'Applied', messageIdHeader: 'a@x.com', classifiedAt: at('2026-09-01') };
  const b = { status: 'Interviewing', messageIdHeader: 'b@x.com', classifiedAt: at('2026-09-02') };
  const result = reconcileDuplicateMessages([a, b]);
  assert.equal(result.length, 2);
});
