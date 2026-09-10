require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

// The connection is created on first query rather than at import time.
//
// Eager connection meant that importing ANY module which touches the database
// threw immediately when DATABASE_URL was absent -- which made the pure
// classification and timeline logic in sync/ impossible to unit-test without a
// live database, and turned a missing env var into an unreadable stack trace
// from deep inside the driver.
let client = null;

function getClient() {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. Add it to server/.env (see server/.env.example).',
      );
    }
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

// Neon's `sql` is a tagged-template function that also carries helpers
// (.query, .transaction, .unsafe). The proxy forwards both shapes so callers
// cannot tell the difference.
const sql = new Proxy(function sqlProxy(...args) {
  return getClient()(...args);
}, {
  get(_target, prop) {
    const value = getClient()[prop];
    return typeof value === 'function' ? value.bind(getClient()) : value;
  },
});

module.exports = sql;
