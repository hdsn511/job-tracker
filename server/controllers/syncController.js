// Runs the sync engine on demand for the logged-in user, so the dashboard's
// "Resync inbox" button does exactly what the twice-daily GitHub Actions job
// does — just for one account instead of all of them. The engine itself
// lives in server/sync so there's only one copy of the classify/upsert
// logic; this module is only the HTTP wrapper.
const { getConnection } = require('../sync/gmailConnections');
const { syncConnection } = require('../sync');

// A sync is minutes long on a first backfill. Without this, an impatient
// double-click would run two passes over the same messages concurrently.
const inFlight = new Set();

const runSync = async (req, res) => {
  const userId = req.user.id;

  if (inFlight.has(userId)) {
    return res.status(409).json({ error: 'A sync is already running for this account.' });
  }

  let connection;
  try {
    connection = await getConnection(userId);
  } catch (error) {
    console.error('Sync: failed to load Gmail connection:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  if (!connection) {
    return res.status(400).json({ error: 'No Gmail account connected.' });
  }

  inFlight.add(userId);
  try {
    const { summary, syncedAt } = await syncConnection(connection, {
      log: (line) => console.log(`[sync user ${userId}] ${line}`),
    });
    res.json({ summary, lastSyncedAt: syncedAt });
  } catch (error) {
    console.error(`Sync failed for user ${userId}:`, error);
    res.status(502).json({ error: "Couldn't reach Gmail. Please try again." });
  } finally {
    inFlight.delete(userId);
  }
};

module.exports = { runSync };
