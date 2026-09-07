const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function createOAuthClient({ clientId, clientSecret, redirectUri } = {}) {
  return new google.auth.OAuth2(
    clientId || process.env.GMAIL_CLIENT_ID,
    clientSecret || process.env.GMAIL_CLIENT_SECRET,
    redirectUri || 'urn:ietf:wg:oauth:2.0:oob',
  );
}

/**
 * @param refreshToken - a specific connected account's refresh token (from
 * gmailConnections.listConnections()), not a single global env var — each
 * account gets its own authenticated client.
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

module.exports = { createOAuthClient, getGmailClient, SCOPES };
