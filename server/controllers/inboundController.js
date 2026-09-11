const sql = require('../db');
const { generateAlias, mailgunPayloadToEmail } = require('../sync/inboundEmail');
const { verifyMailgunSignature } = require('../sync/inboundVerify');
const { saveInboundClassification } = require('../sync/inboundClassifications');
const { resolveMessage } = require('../sync/resolve');
const { getExistingJobs, getAllSignalMessages, upsertJobFromMessages, groupMessages } = require('../sync/jobs');
const { buildGmailCreateFilterUrl, buildDenyListGmailQuery } = require('../sync/forwardingPredicates');
const { normalizeStartDate } = require('../sync/startDate');
const { MAX_BATCH_SIZE, normalizeUploadedMessage, saveUploadedEmail } = require('../sync/inboundUploads');
const { getLlmStats, resetLlmStats, activeProvider, activeModel } = require('../sync/llm');

// Mirrors sync/index.js's FETCH_DELAY_MS: a large backfill (thousands of
// messages in one sitting, unlike a bounded Gmail sync window) fires LLM
// calls back-to-back otherwise, which blows through Groq's per-minute token
// ceiling far faster than its per-day request cap alone would. Confirmed
// against real data: a real backfill's upload-sourced classifications
// disagreed with the same messages' Gmail-sync classifications 14 times,
// nearly all resolving to whichever the LLM actually ran for -- the rules
// fallback (necessary and correct when the LLM is genuinely unavailable)
// is measurably less accurate, so it's worth pacing calls to need it less.
const CLASSIFY_DELAY_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates (or returns the existing) forwarding alias for this user. Idempotent
 * on purpose -- the frontend calls this every time it renders the forwarding
 * setup screen, so a user re-visiting it must not get handed a second,
 * different address to reconfigure.
 */
const setupInboundAddress = async (req, res) => {
  const { MAILGUN_DOMAIN } = process.env;
  if (!MAILGUN_DOMAIN) {
    return res.status(500).json({ error: 'Forwarding is not configured on this server yet.' });
  }

  try {
    const [existing] = await sql`
      select alias, verified_at from inbound_addresses where user_id = ${req.user.id}
    `;
    if (existing) {
      return res.json({
        alias: existing.alias,
        verified: Boolean(existing.verified_at),
        gmailFilterUrl: buildGmailCreateFilterUrl(),
      });
    }

    const alias = generateAlias(req.user.id, MAILGUN_DOMAIN);
    await sql`
      insert into inbound_addresses (user_id, alias) values (${req.user.id}, ${alias})
    `;
    res.json({ alias, verified: false, gmailFilterUrl: buildGmailCreateFilterUrl() });
  } catch (error) {
    console.error('Inbound setup failed:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

const getInboundStatus = async (req, res) => {
  try {
    const [row] = await sql`
      select alias, verified_at, created_at from inbound_addresses where user_id = ${req.user.id}
    `;
    res.json({
      connected: Boolean(row),
      alias: row ? row.alias : null,
      verified: row ? Boolean(row.verified_at) : false,
      createdAt: row ? row.created_at : null,
      gmailFilterUrl: buildGmailCreateFilterUrl(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

/**
 * The Mailgun webhook. Not behind authMiddleware -- Mailgun is the caller,
 * not a logged-in user -- so authenticity comes entirely from the HMAC
 * signature Mailgun attaches to every delivery.
 *
 * Always responds 2xx once the request is authenticated and durably
 * recorded, even if classification/upsert fails after that: Mailgun retries
 * non-2xx responses, and retrying a signature check that already passed
 * would just re-run the same work, not fix anything.
 */
const receiveInboundEmail = async (req, res) => {
  const body = req.body || {};
  const signed = verifyMailgunSignature({
    signingKey: process.env.MAILGUN_SIGNING_KEY,
    timestamp: body.timestamp,
    token: body.token,
    signature: body.signature,
  });
  if (!signed) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  const alias = String(body.recipient || '').toLowerCase().trim();
  const [address] = await sql`
    select user_id from inbound_addresses where alias = ${alias}
  `;
  if (!address) {
    // Not a 401/403 -- this is a legitimate Mailgun delivery, just to an
    // alias we don't (or no longer) recognize. Ack it so Mailgun stops
    // retrying instead of hammering an address nobody owns anymore.
    return res.status(200).json({ ignored: true });
  }
  const userId = address.user_id;

  const [inboundEmail] = await sql`
    insert into inbound_emails (alias, raw_from, raw_subject, raw_body)
    values (${alias}, ${body.from || body.sender || null}, ${body.subject || null},
            ${body['stripped-text'] || body['body-plain'] || null})
    returning id
  `;

  try {
    await sql`
      update inbound_addresses set verified_at = coalesce(verified_at, now()) where user_id = ${userId}
    `;

    const email = mailgunPayloadToEmail(body);
    const result = await resolveMessage(email);
    result.date = email.date;
    await saveInboundClassification(userId, inboundEmail.id, result);

    if (!result.isNoise && result.status && result.company) {
      const existingJobs = await getExistingJobs(userId);
      const messages = await getAllSignalMessages(userId);
      for (const group of groupMessages(messages)) {
        await upsertJobFromMessages(userId, existingJobs, group);
      }
    }

    await sql`update inbound_emails set processed_at = now() where id = ${inboundEmail.id}`;
  } catch (error) {
    console.error(`Inbound classify/upsert failed for inbound_email ${inboundEmail.id}:`, error);
    // Left with processed_at = null -- visible in the audit trail as
    // something that arrived but never finished processing.
  }

  res.status(200).json({ received: true });
};

/**
 * The Gmail search/filter URL for the backfill flow: the same recall-tested
 * deny-list the forwarding setup screen uses, bounded to mail on or after the
 * date the user picked. See forwardingPredicates.js for why the date has to
 * be ANDed onto the whole OR rather than appended.
 */
const getBackfillFilterUrl = async (req, res) => {
  const normalized = normalizeStartDate(req.query.after);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const query = buildDenyListGmailQuery({ after: normalized.value });
  res.json({ after: normalized.value, gmailFilterUrl: buildGmailCreateFilterUrl(query) });
};

// One batch at a time per user -- upsertJobFromMessages reads existingJobs
// into memory and mutates it as it inserts, so two batches for the same user
// running concurrently (two tabs, a double-submit) could both miss each
// other's inserts and write the same job twice.
const uploadInFlight = new Set();

/**
 * Ingests one batch of browser-parsed mbox messages: the client already split
 * the file and extracted {from, subject, body, date, messageId} per message
 * (see client/src/lib/mbox.js) -- the raw file itself never reaches the
 * server. Runs each new message through the same resolveMessage()/
 * saveInboundClassification() pipeline the Mailgun webhook uses. The
 * regroup-and-upsert-jobs step reads and rewrites the user's *entire* signal
 * history, so it only runs once, on the batch the client marks `final` --
 * running it after every batch made a large backfill quadratic in its own
 * message count for no benefit, since nothing reads the jobs table until the
 * whole upload finishes anyway. A backfill abandoned before its final batch
 * leaves already-classified messages ungrouped until the upload is resumed.
 */
const uploadBackfillBatch = async (req, res) => {
  const userId = req.user.id;
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  const final = req.body?.final === true;

  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided.' });
  }
  if (messages.length > MAX_BATCH_SIZE) {
    return res.status(400).json({ error: `Send at most ${MAX_BATCH_SIZE} messages per batch.` });
  }

  if (uploadInFlight.has(userId)) {
    return res.status(409).json({ error: 'A batch is already processing for this account. Please wait.' });
  }
  uploadInFlight.add(userId);

  const result = { received: messages.length, saved: 0, duplicates: 0, noise: 0, staged: 0, errors: 0 };

  try {
    resetLlmStats();
    let first = true;
    for (const raw of messages) {
      if (!first) await sleep(CLASSIFY_DELAY_MS);
      first = false;

      const normalized = normalizeUploadedMessage(raw);
      if (normalized.error) {
        result.errors += 1;
        continue;
      }
      const { value: message } = normalized;

      let inboundEmailId;
      try {
        inboundEmailId = await saveUploadedEmail(userId, message);
      } catch (error) {
        console.error(`Upload batch: failed to save a message for user ${userId}:`, error);
        result.errors += 1;
        continue;
      }
      if (!inboundEmailId) {
        result.duplicates += 1;
        continue;
      }

      try {
        const email = { from: message.from, subject: message.subject, body: message.body, date: message.date };
        const classified = await resolveMessage(email);
        classified.date = message.date;
        await saveInboundClassification(userId, inboundEmailId, classified);
        result.saved += 1;
        if (classified.isNoise) result.noise += 1;
        else if (classified.status && classified.company) result.staged += 1;
      } catch (error) {
        console.error(`Upload batch: classify failed for user ${userId}:`, error);
        result.errors += 1;
      }
    }

    if (final) {
      const existingJobs = await getExistingJobs(userId);
      const signalMessages = await getAllSignalMessages(userId);
      for (const group of groupMessages(signalMessages)) {
        await upsertJobFromMessages(userId, existingJobs, group);
      }
    }

    // Surfaced for the same reason sync/index.js's summary carries these --
    // a batch that fell back to the (necessarily weaker) rules engine looked
    // identical to a healthy one otherwise, which is how this went unnoticed
    // until an audit against the real mailbox found it.
    const llm = getLlmStats();
    const provider = activeProvider();
    result.llmProvider = provider ? provider.name : null;
    result.llmModel = provider ? activeModel() : null;
    result.llmAttempted = llm.attempted;
    result.llmFailed = llm.failed;
    result.llmNotConfigured = llm.notConfigured;

    res.json(result);
  } catch (error) {
    console.error(`Upload batch failed for user ${userId}:`, error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  } finally {
    uploadInFlight.delete(userId);
  }
};

module.exports = {
  setupInboundAddress,
  getInboundStatus,
  receiveInboundEmail,
  getBackfillFilterUrl,
  uploadBackfillBatch,
};
