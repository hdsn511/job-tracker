// AES-256-GCM at-rest encryption for Gmail refresh tokens — must produce/
// read the exact same format as email-sync/src/crypto.js, since both write
// to and read from the same gmail_connections table with the same
// TOKEN_ENCRYPTION_KEY.
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) throw new Error('Missing TOKEN_ENCRYPTION_KEY env var.');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, hex-encoded (64 hex characters).');
  }
  return key;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString('hex')).join(':');
}

module.exports = { encrypt };
