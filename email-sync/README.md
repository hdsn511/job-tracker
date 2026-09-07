# email-sync

Pulls job-application emails out of Gmail, classifies them with free
rule-based logic (Gemini Flash as a low-confidence fallback), and
upserts them into the `jobs` table the job-tracker app already uses.
Runs on a GitHub Actions cron — no server, no paid APIs.

## How it works

1. `src/gmailConnections.js` loads every connected Gmail account from the
   `gmail_connections` table (Neon) — today that's exactly one row (the
   app's only user), but `run.js` loops over whatever's there, so adding a
   real "Connect Gmail" flow to the app later just means adding rows to the
   same table, not rearchitecting the sync.
2. `src/gmail.js` searches each connected account's Gmail for mail from
   known ATS/employer domains, received since that account's last
   successful run (`gmail_connections.last_synced_at` — needs only
   `gmail.readonly`, no write access to Gmail).
3. `src/classifier.js` runs pure, deterministic rules: sender-domain → ATS →
   company name, subject/body regex → job title + job ID + status. See
   `test/classifier.test.js` for the exact patterns it's tuned against.
4. If the rules can't determine a status or company, `src/gemini.js` asks
   Gemini Flash's free tier once per email (skipped entirely if
   `GEMINI_API_KEY` isn't set — those emails are just logged as
   `NEEDS REVIEW`).
5. `src/jobs.js` matches the result against that user's existing rows (by an
   embedded job ID first, then fuzzy company+title matching), and inserts or
   updates. Every match appends a dated line to `notes` rather than
   overwriting it, and status only moves forward (Applied → Interviewing →
   Offer/Rejected), so an out-of-order or re-sent email can't regress a
   further-along application.

## Security notes

- Gmail refresh tokens are stored **encrypted** (AES-256-GCM) in
  `gmail_connections.refresh_token_encrypted`, keyed by a `TOKEN_ENCRYPTION_KEY`
  that's separate from the app's `JWT_SECRET`. They never sit in a GitHub
  secret or in plaintext anywhere.
- The app's login email is *not* what proves ownership of the connected
  Gmail account — Google's own OAuth consent screen is. Whoever completes
  `npm run get-token` while it's targeting a given `TARGET_USER_EMAIL` gets
  that Gmail account tied to that user's `user_id`, regardless of what
  address they registered with.

## One-time setup

1. **Neon**: run `sql/001_gmail_connections.sql` against the same database
   the Express server uses (via `neon psql`, the Neon console SQL editor, or
   any Postgres client).

2. **Google Cloud**: create an OAuth client (Desktop app type) at
   console.cloud.google.com, enable the Gmail API, and note the client ID
   and secret.

3. **Connect a Gmail account** (interactive, run locally):
   ```
   cd email-sync
   npm install
   cp .env.example .env   # fill in GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET /
                           # DATABASE_URL / TOKEN_ENCRYPTION_KEY / TARGET_USER_EMAIL
   npm run get-token
   ```
   Follow the printed URL, approve access, paste the code back. This writes
   an encrypted row straight into `gmail_connections` — nothing to copy into
   a GitHub secret.

4. **GitHub Actions secrets** (Settings → Secrets and variables → Actions):
   `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `DATABASE_URL`,
   `TOKEN_ENCRYPTION_KEY`, and optionally `GEMINI_API_KEY` (from
   aistudio.google.com — free tier). Note there's no `GMAIL_REFRESH_TOKEN`
   or `TARGET_USER_EMAIL` secret needed here — those only mattered for the
   one-time connect step above.

5. The workflow at `.github/workflows/sync-emails.yml` runs twice a day and
   can also be triggered manually from the Actions tab ("Run workflow").

## Local development

- `npm test` — unit tests for the classifier (no network/credentials
  needed).
- `npm start` — runs one real sync using whatever's in `.env`, for every
  connected account.

## Tuning the rules

The rules in `src/classifier.js` and `src/companyMap.js` were built from a
one-time scan of real inbox examples. As new ATSes, senders, or phrasings
show up in `NEEDS REVIEW` log lines, add a pattern and a matching test case
rather than leaning on the Gemini fallback — it's meant to stay rare.
