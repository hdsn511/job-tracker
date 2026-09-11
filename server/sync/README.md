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
2. `gmail.js` searches each connected account's Gmail back to
   `gmail_connections.sync_start_date` (needs only `gmail.readonly`, no write
   access). The search is a deny-list — everything except
   Promotions/Social/Forums (`forwardingPredicates.js`'s `buildDenyListGmailQuery`,
   the same recall-tested predicate the forwarding path uses), ORed with the
   known-sender allow-list so a recognized employer is never missed even if
   Gmail mis-files it. It used to be the allow-list alone, which meant a new
   company's ATS domain we hadn't manually added yet was invisible by
   construction — real mail from Dell and a second AMD sender went missing
   this way before the deny-list broadening. The known-sender list still
   matters: it's what lets an unrecognized sender's mail skip the keyword
   gate in step 5 below and what `senderNamesEmployer` trusts for company
   resolution. This is the WHOLE window on every run, not "since we last
   looked" — the sync is a re-read, which is what makes classifier
   improvements apply retroactively.
3. `redact.js` is the boundary to the third-party LLM. Credential mail
   (one-time passcodes, verification codes) is dropped outright; what does
   get sent has codes, tracking URLs, emails and phone numbers scrubbed.
4. `classifier.js` runs pure, deterministic rules for what is genuinely
   deterministic: sender-domain → ATS → company, plus job ID and digest
   noise. See `test/classifier.test.js` for the patterns it's tuned against.
5. Before the LLM: `resolve.js` gates on `matchesJobKeyword()`
   (`forwardingPredicates.js`) for any sender the allow-list doesn't already
   recognize — the subject/snippet has to at least look job-related. Known
   senders skip this and always reach the LLM, same as before. This is what
   makes the broadened deny-list search in step 2 affordable: without it,
   every personal/non-promotional email in the inbox would cost an LLM call.
   It does trade a little recall for that — `test-filter-recall.js` measured
   keyword-only matching at 74.4% vs. the deny-list's 98.9%, so an
   unrecognized sender with real signal but unusual phrasing can still slip
   through, same as it always could for forwarding.
6. `llm.js` is the PRIMARY classifier for stage and job title —
   not a fallback. Those failed on phrasing, an unbounded space regex loses
   to. `resolve.js` merges the two and holds the model output to the rules'
   guard rails. `providers.js` holds the provider adapters (Groq and Gemini)
   so switching backends is `LLM_PROVIDER=groq|gemini`, not a rewrite. With
   no key at all the rules still answer, less accurately. The summary reports
   `llmFailed` for calls that were made and failed, and `llmNotConfigured`
   for messages that never reached a provider because the key was missing —
   two different faults that both degrade to the rules. Only the first used
   to be counted, so a deployment missing its key logged a summary identical
   to a healthy run.

   Currently pinned to **Groq** (`openai/gpt-oss-120b`). Its free tier caps
   at 8k tokens/minute — roughly 11 classifications a minute, which is the
   throughput ceiling to watch as user count grows, not the price.

   Gemini's adapter works against a live key — the failure is quota, not
   code. The AI Studio free tier allows **20 `generateContent` requests per
   day**, per project, per model (quotaId
   `GenerateRequestsPerDayPerProjectPerModel-FreeTier`). That is a daily cap,
   not a rate limit: pacing and backoff cannot widen it, and the "Please
   retry in ~53s" hint the 429 carries is misleading — the window is midnight
   Pacific. The prose is identical for per-minute and per-day violations, so
   `isDailyQuota()` reads the structured `quotaId` and fails straight to the
   rules instead of sleeping the retry budget.

   Free-tier quota is per MODEL, though, and that is the way through:
   `gemini-3.5-flash-lite` gets **500 requests/day** where `gemini-3.6-flash`
   gets 20. Scoring Gemini needs no billing at all, just the smaller model:

       LLM_PROVIDER=gemini GEMINI_MODEL=gemini-3.5-flash-lite          node scripts/score-llm.js

   Measured on the 29-fixture corpus (2026-09-09):

   | | Groq `gpt-oss-120b` | Gemini `3.5-flash-lite` |
   |---|---|---|
   | Corpus score | 29/29 | 29/29 |
   | Missing job title | 3/29 | 2/29 |
   | Calls ok | 27/28 (1 failed) | 28/28 |
   | Rate-limit pauses | 12 | 2 |
   | Tokens in / out | 23915 / 4192 | 19018 / 689 |
   | Free ceiling | 1000 req/day + 8k tokens/min | 500 req/day |

   **The corpus is saturated — both are perfect, so it can no longer tell
   these models apart.** Any further provider choice needs harder fixtures
   (ambiguous recruiter mail, rescheduling, offers), not another run of this
   one.

   Groq stays the pin because it has the larger daily budget, not because it
   is uncapped — it is not. Groq reports its real limits in response headers,
   which is the only trustworthy source for them:

       x-ratelimit-limit-requests: 1000      # per DAY
       x-ratelimit-limit-tokens:   8000      # per MINUTE
       x-ratelimit-remaining-requests: 829

   So the free ceilings are 1000/day (Groq) and 500/day (Gemini flash-lite),
   and a first-time backfill of a year's inbox can exhaust either. Gemini
   flash-lite ran cleaner here (0 failed calls vs 1, 2 pauses vs 12).

   Because both are day-capped, the useful next step is a **failover chain**
   rather than a single pin: `isDailyQuota()` already detects terminal
   exhaustion, so falling through to the next configured provider instead of
   to the rules would give 1500 messages/day free from the two adapters that
   already exist.

   Still true and worth keeping: Google Cloud trial credits live on Vertex
   AI, a different endpoint from the `generativelanguage.googleapis.com` one
   used here, so those credits do not raise this limit.
7. `classificationCache.js` stores the derived result per Gmail message id
   (never the raw body), so a re-read costs no LLM calls for mail already
   seen. A result produced while the LLM was erroring is deliberately NOT
   cached, so restoring quota re-examines those messages.
8. `jobs.js` groups the classified messages into jobs (embedded job ID
   first, then fuzzy company+title) and writes each one authoritatively.
   `application_date` and every timeline line's date are attributed to
   `LOCAL_TIMEZONE` (currently hardcoded to `America/Chicago`), not raw UTC —
   `.toISOString().slice(0, 10)` dated anything sent after ~7pm Central as
   "tomorrow" the moment UTC rolled over, a real off-by-one on the calendar
   heat map for most evening applications. Both fields are re-derived on
   every re-read (not just at first insert), so this self-heals existing
   rows once a re-read runs, the same way the timeline already does.
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
