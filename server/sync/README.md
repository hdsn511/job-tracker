# sync

Pulls job-application emails out of Gmail, classifies them with free
rule-based logic (Gemini Flash as a low-confidence fallback), and upserts
them into the `jobs` table the app already uses.

Two entry points, one engine:

- `scripts/sync-all.js` (`npm run sync`) — every connected account. This is
  what the GitHub Actions cron runs, twice a day.
- `POST /auth/gmail/sync` — one account, on demand, behind the dashboard's
  "Resync inbox" button. See `controllers/syncController.js`.

Both call `syncConnection()` in `index.js`, so there is only one copy of the
classify/upsert behaviour.

## How it works

1. `gmailConnections.js` loads connected Gmail accounts from the
   `gmail_connections` table. `syncAllConnections()` loops over every row;
   `getConnection(userId)` fetches just one for the API route.
2. `gmail.js` searches each connected account's Gmail for mail from known
   ATS/employer domains, received since that account's last successful run
   (`gmail_connections.last_synced_at` — needs only `gmail.readonly`, no
   write access to Gmail).
3. `classifier.js` runs pure, deterministic rules: sender-domain → ATS →
   company name, subject/body regex → job title + job ID + status. See
   `test/classifier.test.js` for the exact patterns it's tuned against.
4. If the rules can't determine a status or company, `gemini.js` asks Gemini
   Flash's free tier once per email (skipped entirely if `GEMINI_API_KEY`
   isn't set — those emails are just logged as `NEEDS REVIEW`).
5. `jobs.js` matches the result against that user's existing rows (by an
   embedded job ID first, then fuzzy company+title matching), and inserts or
   updates. Every match appends a dated line to `notes` rather than
   overwriting it, and status only moves forward (Applied → Interviewing →
   Offer/Rejected), so an out-of-order or re-sent email can't regress a
   further-along application.

A run that hits any error leaves `last_synced_at` where it was, so the next
run retries the same window instead of silently skipping messages. Re-seeing
a message is safe: the upsert matches by ref or company+title.

## Security notes

- Gmail refresh tokens are stored **encrypted** (AES-256-GCM) in
  `gmail_connections.refresh_token_encrypted`, keyed by a
  `TOKEN_ENCRYPTION_KEY` separate from the app's `JWT_SECRET`. They never sit
  in a GitHub secret or in plaintext anywhere.
- The app's login email is *not* what proves ownership of the connected
  Gmail account — Google's own OAuth consent screen is.

## Setup

1. **Neon**: run `sql/001_gmail_connections.sql` against the same database
   the Express server uses.

2. **Google Cloud**: create an OAuth client at console.cloud.google.com,
   enable the Gmail API, and put the client ID/secret in `server/.env`.

3. **Connect an account**: normally users do this themselves through the
   app's `/connect` screen. `npm run get-token` is the local fallback for
   attaching an account by hand — it targets whatever `TARGET_USER_EMAIL` is
   set to and writes an encrypted row straight into `gmail_connections`.

4. **GitHub Actions secrets** (Settings → Secrets and variables → Actions):
   `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `DATABASE_URL`,
   `TOKEN_ENCRYPTION_KEY`, and optionally `GEMINI_API_KEY`. The workflow at
   `.github/workflows/sync-emails.yml` runs twice a day and can also be
   triggered manually from the Actions tab.

## Local development

- `npm test` — classifier unit tests, no network or credentials needed.
- `npm run sync` — one real sync for every connected account.

## Tuning the rules

The rules in `classifier.js` and `companyMap.js` were built from a one-time
scan of real inbox examples. As new ATSes, senders, or phrasings show up in
`NEEDS REVIEW` log lines, add a pattern and a matching test case rather than
leaning on the Gemini fallback — it's meant to stay rare.
