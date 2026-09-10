// Builds test/fixtures/inbox-corpus.json from raw sampled messages.
//
// The corpus is real mail, so every body is pushed through the same redaction
// the LLM boundary uses before it is written to disk. Nothing with a live
// credential in it ends up checked into the repository.
//
// Usage:  node scripts/build-corpus.js <raw.json>
// where <raw.json> is [[from, subject, body, expectedStage], ...]

const fs = require('fs');
const path = require('path');
const { redactText, isAuthMail } = require('../sync/redact');

const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'inbox-corpus.json');

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/build-corpus.js <raw.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(input, 'utf8'));

const fixtures = raw.map(([from, subject, body, expected]) => ({
  from,
  subject: redactText(subject),
  body: redactText(body),
  expected,
  // Recorded so the corpus documents which messages should never reach the
  // classifier at all, rather than leaving that implicit.
  dropped: isAuthMail({ from, subject, body }).drop,
}));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(fixtures, null, 2)}\n`);

const counts = fixtures.reduce((acc, f) => ({ ...acc, [f.expected]: (acc[f.expected] || 0) + 1 }), {});
console.log(`Wrote ${fixtures.length} fixtures to ${path.relative(process.cwd(), OUT)}`);
console.log(counts);
