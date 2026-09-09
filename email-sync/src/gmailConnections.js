const sql = require('./db');
const { encrypt, decrypt } = require('./crypto');

async function getUserIdByEmail(email) {
  const rows = await sql`select id from users where email = ${email}`;
  if (!rows[0]) throw new Error(`No job-tracker user found with email "${email}"`);
  return rows[0].id;
}

async function saveGmailConnection({ userId, gmailAddress, refreshToken }) {
  const encrypted = encrypt(refreshToken);
  await sql`
    insert into gmail_connections (user_id, gmail_address, refresh_token_encrypted)
    values (${userId}, ${gmailAddress}, ${encrypted})
    on conflict (user_id) do update
      set gmail_address = excluded.gmail_address,
          refresh_token_encrypted = excluded.refresh_token_encrypted
  `;
}

/** Every connected account, tokens decrypted, ready for run.js to loop over. */
async function listConnections() {
  const rows = await sql`
    select user_id, gmail_address, refresh_token_encrypted, last_synced_at
    from gmail_connections
  `;
  return rows.map((row) => ({
    userId: row.user_id,
    gmailAddress: row.gmail_address,
    refreshToken: decrypt(row.refresh_token_encrypted),
    lastSyncedAt: row.last_synced_at === null ? null : Number(row.last_synced_at),
  }));
}

/** One connected account, token decrypted — what the app's Resync button syncs. */
async function getConnection(userId) {
  const rows = await sql`
    select user_id, gmail_address, refresh_token_encrypted, last_synced_at
    from gmail_connections
    where user_id = ${userId}
  `;
  if (!rows[0]) return null;
  return {
    userId: rows[0].user_id,
    gmailAddress: rows[0].gmail_address,
    refreshToken: decrypt(rows[0].refresh_token_encrypted),
    lastSyncedAt: rows[0].last_synced_at === null ? null : Number(rows[0].last_synced_at),
  };
}

async function setLastSyncedAt(userId, epochSeconds) {
  await sql`update gmail_connections set last_synced_at = ${epochSeconds} where user_id = ${userId}`;
}

module.exports = {
  getUserIdByEmail,
  saveGmailConnection,
  listConnections,
  getConnection,
  setLastSyncedAt,
};
