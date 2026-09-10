const jwt = require('jsonwebtoken');
const sql = require('../db');
const { createOAuthClient, revokeRefreshToken, SCOPES } = require('../gmailAuth');
const { encrypt } = require('../tokenCrypto');
const { getConnection, deleteConnection } = require('../sync/gmailConnections');
const { normalizeStartDate, DEFAULT_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS } = require('../sync/startDate');

// CLIENT_ORIGIN is a comma-separated allow-list for CORS; the OAuth
// callback can only redirect to one place, so take the first entry.
const FRONTEND_URL =
  (process.env.CLIENT_ORIGIN || '').split(',')[0].trim() ||
  'https://job-tracker-frontend-ten-eta.vercel.app';

// Starts the OAuth flow. The browser will be redirected away from our SPA
// to Google and back, so identity can't ride along in an Authorization
// header for the callback — it's carried in a short-lived signed `state`
// instead.
const startGmailConnect = async (req, res) => {
  // How far back the first sync should read. Carried through the OAuth round
  // trip in the signed state, since the callback has no session to read it
  // from and an attacker-supplied window would be a quota lever.
  const startDate = normalizeStartDate(req.query.since);
  if (startDate.error) {
    return res.status(400).json({ error: startDate.error });
  }

  const state = jwt.sign(
    { userId: req.user.id, purpose: 'gmail-connect', since: startDate.value },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );

  const oauth2Client = createOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

  res.json({ url });
};

// Google redirects the browser here directly — this route is intentionally
// not behind authMiddleware, since there's no Authorization header on a
// browser redirect. The verified `state` JWT is what proves which
// logged-in user started this.
const handleGmailCallback = async (req, res) => {
  const { code, state, error } = req.query;
  console.log('Gmail callback hit', { hasCode: Boolean(code), hasState: Boolean(state), error: error || null });

  if (error) {
    console.error('Gmail callback: Google returned an error:', error);
    return res.redirect(`${FRONTEND_URL}/dashboard?gmail=error`);
  }

  let userId;
  let since = null;
  try {
    ({ userId, since } = jwt.verify(state, process.env.JWT_SECRET));
  } catch (err) {
    console.error('Gmail callback: invalid/expired state:', err.message);
    return res.redirect(`${FRONTEND_URL}/dashboard?gmail=error`);
  }

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // Happens if the account already granted consent and Google didn't
      // re-issue a refresh token — prompt=consent on the initial request
      // should prevent this, but fail safely if it happens anyway.
      return res.redirect(`${FRONTEND_URL}/dashboard?gmail=error`);
    }

    const [user] = await sql`select email from users where id = ${userId}`;
    const encrypted = encrypt(tokens.refresh_token);

    await sql`
      insert into gmail_connections (user_id, gmail_address, refresh_token_encrypted, sync_start_date)
      values (${userId}, ${user.email}, ${encrypted}, ${since})
      on conflict (user_id) do update
        set gmail_address = excluded.gmail_address,
            refresh_token_encrypted = excluded.refresh_token_encrypted,
            -- Reconnecting without picking a date keeps the window already set.
            sync_start_date = coalesce(excluded.sync_start_date, gmail_connections.sync_start_date)
    `;

    console.log(`Gmail connected for user ${userId} (${user.email})`);
    res.redirect(`${FRONTEND_URL}/dashboard?gmail=connected`);
  } catch (err) {
    console.error('Gmail callback failed:', err);
    res.redirect(`${FRONTEND_URL}/dashboard?gmail=error`);
  }
};

const getGmailStatus = async (req, res) => {
  try {
    const [row] = await sql`
      select gmail_address, connected_at, last_synced_at, sync_start_date
      from gmail_connections where user_id = ${req.user.id}
    `;
    res.json({
      connected: Boolean(row),
      gmailAddress: row ? row.gmail_address : null,
      connectedAt: row ? row.connected_at : null,
      // bigint epoch seconds — the driver hands it back as a string.
      lastSyncedAt: row && row.last_synced_at !== null ? Number(row.last_synced_at) : null,
      syncStartDate: row && row.sync_start_date ? String(row.sync_start_date).slice(0, 10) : null,
      defaultLookbackDays: DEFAULT_LOOKBACK_DAYS,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

// Revokes the grant at Google (so it drops off the user's
// myaccount.google.com/permissions list, not just our own DB) and forgets
// the connection locally. Revocation is best-effort — a token Google
// already considers dead must not block the user from clearing our side.
const disconnectGmail = async (req, res) => {
  try {
    const connection = await getConnection(req.user.id);
    if (!connection) {
      return res.status(400).json({ error: 'No Gmail account connected.' });
    }

    try {
      await revokeRefreshToken(connection.refreshToken);
    } catch (err) {
      console.warn(`Gmail disconnect: revoke failed for user ${req.user.id}:`, err.message);
    }

    await deleteConnection(req.user.id);
    res.json({ disconnected: true });
  } catch (error) {
    console.error('Gmail disconnect failed:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

module.exports = { startGmailConnect, handleGmailCallback, getGmailStatus, disconnectGmail };
