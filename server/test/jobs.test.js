const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveStage,
  rebuildNotes,
  isSyncAuthoredLine,
  buildNoteLine,
  findExistingJob,
  UNKNOWN_TITLE,
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
