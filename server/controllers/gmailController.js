const jwt = require('jsonwebtoken');
const sql = require('../db');
const { createOAuthClient, SCOPES } = require('../gmailAuth');
const { encrypt } = require('../tokenCrypto');

const FRONTEND_URL = process.env.CLIENT_ORIGIN || 'https://job-tracker-frontend-ten-eta.vercel.app';

// Starts the OAuth flow. The browser will be redirected away from our SPA
// to Google and back, so identity can't ride along in an Authorization
// header for the callback — it's carried in a short-lived signed `state`
// instead.
const startGmailConnect = async (req, res) => {
  const state = jwt.sign({ userId: req.user.id, purpose: 'gmail-connect' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });

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
  try {
    ({ userId } = jwt.verify(state, process.env.JWT_SECRET));
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
      insert into gmail_connections (user_id, gmail_address, refresh_token_encrypted)
      values (${userId}, ${user.email}, ${encrypted})
      on conflict (user_id) do update
        set gmail_address = excluded.gmail_address,
            refresh_token_encrypted = excluded.refresh_token_encrypted
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
      select gmail_address, connected_at from gmail_connections where user_id = ${req.user.id}
    `;
    res.json({ connected: Boolean(row), gmailAddress: row ? row.gmail_address : null });
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

module.exports = { startGmailConnect, handleGmailCallback, getGmailStatus };
