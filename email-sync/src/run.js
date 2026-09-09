require('dotenv').config();

const { syncAllConnections } = require('./sync');

// The scheduled entry point (GitHub Actions, twice daily). The sync itself
// lives in sync.js so the app's "Resync inbox" button runs the exact same
// code path for a single user.
syncAllConnections({ log: (line) => console.log(line) }).catch((err) => {
  console.error(err);
  process.exit(1);
});
