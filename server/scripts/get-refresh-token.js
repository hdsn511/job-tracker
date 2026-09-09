// One-time interactive setup script — run locally, never in CI. Connects a
// Gmail account to a job-tracker user: exchanges an OAuth code for a refresh
// token and stores it encrypted in the gmail_connections table (never as a
// GitHub secret, never in plaintext).
//
// Uses the loopback-redirect flow (RFC 8252) — Google deprecated the old
// "urn:ietf:wg:oauth:2.0:oob" out-of-band flow for new OAuth clients, so a
// local HTTP server catches the redirect instead of asking you to paste a
// code by hand.
//
// This OAuth client is a "Web application" type, which (unlike "Desktop
// app") requires an exact, pre-registered redirect URI rather than any
// 127.0.0.1 port — so this is pinned to http://localhost:8080, which must
// be added under that client's Authorized redirect URIs in Google Cloud
// Console before running this.
//
// Usage:
//   TARGET_USER_EMAIL=you@example.com npm run get-token
require('dotenv').config();
const http = require('node:http');
const { exec } = require('node:child_process');
const { createOAuthClient, SCOPES } = require('../gmailAuth');
const { getUserIdByEmail, saveGmailConnection } = require('../sync/gmailConnections');

function openInBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${opener} "${url}"`);
}

/** Starts a one-shot local server, resolves with the ?code= from the redirect. */
function waitForAuthCode(redirectUri) {
  const { port } = new URL(redirectUri);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.setHeader('Content-Type', 'text/html');
      if (error) {
        res.end(`<html><body>Authorization failed: ${error}. You can close this tab.</body></html>`);
        server.close();
        return reject(new Error(`OAuth error: ${error}`));
      }
      res.end('<html><body>Connected. You can close this tab and return to the terminal.</body></html>');
      server.close();
      resolve(code);
    });

    server.listen(Number(port), '127.0.0.1');
    server.on('error', reject);

    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for Google OAuth redirect (5 minutes).'));
    }, 5 * 60 * 1000).unref();
  });
}

async function main() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, TARGET_USER_EMAIL } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET (in server/.env) first.');
    process.exit(1);
  }
  if (!TARGET_USER_EMAIL) {
    console.error('Set TARGET_USER_EMAIL to the job-tracker login this Gmail connection belongs to.');
    process.exit(1);
  }

  // Fail fast if the app account doesn't exist, before spending a round trip
  // on the OAuth flow.
  const userId = await getUserIdByEmail(TARGET_USER_EMAIL);

  const redirectUri = 'http://localhost:8080';
  const oauth2Client = createOAuthClient({ redirectUri });
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('Opening your browser to approve access. If it doesn\'t open automatically, visit:\n');
  console.log(authUrl);
  console.log('\nWaiting for you to approve access with the Gmail account you want synced...');

  openInBrowser(authUrl);

  const code = await waitForAuthCode(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      '\nNo refresh_token returned. This usually means the account already granted consent ' +
        'previously — revoke access at https://myaccount.google.com/permissions and try again.',
    );
    process.exit(1);
  }

  await saveGmailConnection({
    userId,
    gmailAddress: TARGET_USER_EMAIL,
    refreshToken: tokens.refresh_token,
  });

  console.log(`\nConnected. Gmail sync is now set up for ${TARGET_USER_EMAIL}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
