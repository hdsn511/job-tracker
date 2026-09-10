const sql = require('../db');
const { generateAlias, mailgunPayloadToEmail } = require('../sync/inboundEmail');
const { verifyMailgunSignature } = require('../sync/inboundVerify');
const { saveInboundClassification, getSignalMessages } = require('../sync/inboundClassifications');
const { resolveMessage } = require('../sync/resolve');
const { getExistingJobs, upsertJobFromMessages, groupMessages } = require('../sync/jobs');
const { buildGmailCreateFilterUrl } = require('../sync/forwardingPredicates');

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
      const messages = await getSignalMessages(userId);
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

module.exports = { setupInboundAddress, getInboundStatus, receiveInboundEmail };
