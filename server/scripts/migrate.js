require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sql = require('../db');

// There is no migration framework here and this project doesn't need one --
// a handful of idempotent .sql files applied in filename order is enough.
// Every migration must be safe to re-run, since nothing tracks which have
// already been applied.
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// The Neon HTTP driver rejects multiple statements in one call, so each file
// is split. Naive semicolon splitting would break on a semicolon inside a
// string literal or a $$-quoted function body -- neither of which these
// migrations use. If that ever changes, this needs a real parser.
//
// Splitting on a bare ";" rather than an end-of-line anchor: these files are
// checked out with CRLF endings on Windows, and ";\r\n" does not match a
// "/;\s*$/m" anchor the way it appears to.
function splitStatements(text) {
  return text
    .split(';')
    .map((chunk) => chunk.trim())
    // A chunk that is nothing but comments (the header, or trailing notes
    // after the final semicolon) is not a statement.
    .filter((chunk) => {
      const withoutComments = chunk
        .split('\n')
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim();
      return withoutComments.length > 0;
    });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to server/.env (see .env.example).');
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('No migrations found.');
    return;
  }

  for (const file of files) {
    const statements = splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    console.log(`\n=== ${file} (${statements.length} statement(s)) ===`);
    for (const statement of statements) {
      const preview = statement.replace(/\s+/g, ' ').slice(0, 90);
      try {
        // sql.query() is the Neon driver's plain-string form; the tagged
        // template form is for interpolated values, which migrations have none of.
        await sql.query(statement);
        console.log(`  ok   ${preview}`);
      } catch (err) {
        console.error(`  FAIL ${preview}`);
        console.error(`       ${err.message}`);
        process.exit(1);
      }
    }
  }
  console.log('\nAll migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
