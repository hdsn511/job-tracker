const sql = require('../db');
const { encrypt, decrypt } = require('../tokenCrypto');

/** One DB row -> the shape the sync engine consumes. */
function toConnection(row) {
  return {
    userId: row.user_id,
    gmailAddress: row.gmail_address,
    refreshToken: decrypt(row.refresh_token_encrypted),
    // Informational only since the sync became a re-read — the window is
    // anchored to sync_start_date, not to this.
    lastSyncedAt: row.last_synced_at === null ? null : Number(row.last_synced_at),
    // NULL means "use the 30-day default", which is how every connection made
    // before this column existed behaves.
    syncStartDate: row.sync_start_date ? String(row.sync_start_date).slice(0, 10) : null,
  };
}

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
    select user_id, gmail_address, refresh_token_encrypted, last_synced_at, sync_start_date
    from gmail_connections
  `;
  return rows.map(toConnection);
}

/** One connected account, token decrypted — what the app's Resync button syncs. */
async function getConnection(userId) {
  const rows = await sql`
    select user_id, gmail_address, refresh_token_encrypted, last_synced_at, sync_start_date
    from gmail_connections
    where user_id = ${userId}
  `;
  if (!rows[0]) return null;
  return toConnection(rows[0]);
}

/** How far back this account's sync should ever look. */
async function setSyncStartDate(userId, isoDate) {
  await sql`update gmail_connections set sync_start_date = ${isoDate} where user_id = ${userId}`;
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
  setSyncStartDate,
  toConnection,
};
