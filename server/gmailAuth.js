const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/**
 * The web OAuth client used by the app's connect flow. `redirectUri`
 * defaults to GMAIL_REDIRECT_URI (this server's own callback route) and is
 * overridden only by scripts/get-refresh-token.js, which listens on a local
 * port instead.
 */
function createOAuthClient({ clientId, clientSecret, redirectUri } = {}) {
  return new google.auth.OAuth2(
    clientId || process.env.GMAIL_CLIENT_ID,
    clientSecret || process.env.GMAIL_CLIENT_SECRET,
    redirectUri || process.env.GMAIL_REDIRECT_URI,
  );
}

/**
 * @param refreshToken - a specific connected account's refresh token (from
 * gmailConnections), not a single global env var — each account gets its
 * own authenticated client.
 */
function getGmailClient(refreshToken) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !refreshToken) {
    throw new Error('Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET env vars or a refresh token.');
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Revokes a refresh token at Google so the grant disappears from the
 * user's "third-party access" list, not just from our own database.
 * Best-effort: a token Google already considers invalid (expired,
 * previously revoked by the user directly) throws, which the caller
 * should swallow rather than block the local disconnect/delete on.
 */
async function revokeRefreshToken(refreshToken) {
  const oauth2Client = createOAuthClient();
  await oauth2Client.revokeToken(refreshToken);
}

module.exports = { createOAuthClient, getGmailClient, revokeRefreshToken, SCOPES };
