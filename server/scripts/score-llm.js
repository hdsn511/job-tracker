require('dotenv').config({ quiet: true });

// Scores the real LLM path against the local inbox corpus.
//
// Not part of `npm test` — it needs a provider key and makes one network call
// per fixture. Run it after changing the prompt to see whether accuracy moved.
//
//   node scripts/score-llm.js
//   LLM_PROVIDER=gemini node scripts/score-llm.js
//
// The corpus is gitignored (it names the mailbox owner and every company they
// applied to), so build one first with `node scripts/build-corpus.js`.

const { resolveMessage } = require('../sync/resolve');

let corpus;
try {
  corpus = require('../test/fixtures/inbox-corpus.json');
} catch {
  console.error('No corpus at test/fixtures/inbox-corpus.json — build one with `node scripts/build-corpus.js`.');
  process.exit(1);
}

const pad = (s, n) => String(s).slice(0, n).padEnd(n);

async function main() {
  const { activeProvider, activeModel, getLlmStats } = require('../sync/llm');
  const provider = activeProvider();
  if (!provider) {
    console.error('No LLM provider configured — set GEMINI_API_KEY or GROQ_API_KEY.');
    process.exit(1);
  }
  console.log(`provider: ${provider.name}  model: ${activeModel()}
`);

  const byCategory = {};
  let correct = 0;
  let missingTitle = 0;
  const wrong = [];

  console.log(pad('OK', 3) + pad('EXPECTED', 12) + pad('GOT', 14) + pad('SRC', 7) + pad('COMPANY', 18) + 'TITLE');
  console.log('-'.repeat(120));

  for (const fixture of corpus) {
    const result = await resolveMessage(fixture);
    const got = result.isNoise ? 'Dropped' : result.status || 'unclassified';
    const ok = got === fixture.expected;
    if (ok) correct += 1;
    else wrong.push({ fixture, got, result });
    if (!result.isNoise && !result.jobTitle) missingTitle += 1;

    byCategory[fixture.expected] = byCategory[fixture.expected] || { n: 0, ok: 0 };
    byCategory[fixture.expected].n += 1;
    if (ok) byCategory[fixture.expected].ok += 1;

    console.log(
      pad(ok ? '' : 'XX', 3) + pad(fixture.expected, 12) + pad(got, 14) +
      pad(result.source || '-', 7) + pad(result.company, 18) + String(result.jobTitle || '').slice(0, 40),
    );
  }

  console.log('-'.repeat(120));
  for (const [k, v] of Object.entries(byCategory)) console.log(`  ${pad(k, 12)} ${v.ok}/${v.n}`);
  console.log(`\nLLM-path score: ${correct}/${corpus.length}`);

  console.log(`Missing job title: ${missingTitle}/${corpus.length}`);

  const u = getLlmStats();
  console.log(
    `
LLM calls: ${u.succeeded}/${u.attempted} ok, ${u.failed} failed, ` +
    `${u.rateLimited} rate-limited, ${u.schemaRelaxed} schema-relaxed`,
  );
  console.log(
    `Tokens: in=${u.inputTokens} out=${u.outputTokens} thinking=${u.thinkingTokens}` +
    (u.attempted ? ` (avg in=${Math.round(u.inputTokens / u.attempted)} per message)` : ''),
  );

  if (wrong.length) {
    console.log('\nMisses:');
    for (const w of wrong) {
      console.log(`  expected ${w.fixture.expected}, got ${w.got} — ${w.fixture.subject.slice(0, 70)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
