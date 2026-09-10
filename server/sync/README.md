# sync

Pulls job-application emails out of Gmail, classifies them with
deterministic rules plus an LLM (currently Groq) for stage and job title,
and upserts them into the `jobs` table the app already uses.

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
   ATS/employer domains, back to `gmail_connections.sync_start_date` (needs
   only `gmail.readonly`, no write access). This is the WHOLE window on every
   run, not "since we last looked" — the sync is a re-read, which is what
   makes classifier improvements apply retroactively.
3. `redact.js` is the boundary to the third-party LLM. Credential mail
   (one-time passcodes, verification codes) is dropped outright; what does
   get sent has codes, tracking URLs, emails and phone numbers scrubbed.
4. `classifier.js` runs pure, deterministic rules for what is genuinely
   deterministic: sender-domain → ATS → company, plus job ID and digest
   noise. See `test/classifier.test.js` for the patterns it's tuned against.
5. `llm.js` is the PRIMARY classifier for stage and job title —
   not a fallback. Those failed on phrasing, an unbounded space regex loses
   to. `resolve.js` merges the two and holds the model output to the rules'
   guard rails. `providers.js` holds the provider adapters (Groq and Gemini)
   so switching backends is `LLM_PROVIDER=groq|gemini`, not a rewrite. With
   no key at all the rules still answer, less accurately; the sync summary
   reports `llmFailed` so a silent degradation is visible.

   Currently pinned to **Groq** (`openai/gpt-oss-120b`). Its free tier caps
   at 8k tokens/minute — roughly 11 classifications a minute, which is the
   throughput ceiling to watch as user count grows, not the price. Gemini's
   adapter is written and tested but its AI Studio project has no credits;
   note that Google Cloud trial credits live on Vertex AI, a different
   endpoint from the `generativelanguage.googleapis.com` one used here.
6. `classificationCache.js` stores the derived result per Gmail message id
   (never the raw body), so a re-read costs no LLM calls for mail already
   seen. A result produced while the LLM was erroring is deliberately NOT
   cached, so restoring quota re-examines those messages.
7. `jobs.js` groups the classified messages into jobs (embedded job ID
   first, then fuzzy company+title) and writes each one authoritatively:
   `deriveStage()` re-derives the stage from ALL of that job's mail, so a
   stage that was wrong is corrected — including downward. A terminal
   outcome wins outright, since you can be rejected after an interview.
   Rows flagged `manual_override` keep the stage the user set by hand.

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
   `TOKEN_ENCRYPTION_KEY`, and `GROQ_API_KEY`. The workflow at
   `.github/workflows/sync-emails.yml` runs twice a day and can also be
   triggered manually from the Actions tab.

## Local development

- `npm test` — unit tests plus a scored run against `test/fixtures/inbox-corpus.json`,
  a corpus of real (redacted) ATS mail. No network or credentials needed: it
  scores the deterministic rules only, which is the floor the system degrades
  to without an API key. The corpus itself is gitignored — even redacted it
  names the mailbox owner and every company they applied to — so on a fresh
  clone the six corpus tests skip until you build one.
- `node scripts/build-corpus.js` — builds that corpus from a connected
  mailbox, redacting each message through `sync/redact.js` on the way out.
- `node scripts/score-llm.js` — scores the real LLM path against the same
  corpus. Needs `GROQ_API_KEY`; run it after any prompt or model change.
- `npm run migrate` — applies `migrations/*.sql`; every migration is idempotent.
- `npm run sync` — one real sync for every connected account.

## Tuning the rules

The rules in `classifier.js` and `companyMap.js` were built from a one-time
scan of real inbox examples. As new ATSes, senders, or phrasings show up in
`NEEDS REVIEW` log lines, add a pattern and a matching test case — the rules
are the floor the system degrades to when the LLM is unavailable, so widening
them is what keeps that floor high.
