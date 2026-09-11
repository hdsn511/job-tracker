const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const multer = require('multer');

// Regression coverage for the bug fixed in "Fix inbound webhook rejecting
// every non-attachment email" (see routes/inboundRouter.js): Mailgun's route
// forward() action only sends multipart/form-data when the message carries
// an attachment -- anything without (which is most application-status mail,
// including Gmail's own forwarding-confirmation message) arrives as
// application/x-www-form-urlencoded instead. multer alone silently leaves
// req.body empty for that content-type, which made every signature field
// read undefined and receiveInboundEmail fail closed on every real
// delivery -- independent of whether MAILGUN_SIGNING_KEY was even right.
//
// This mirrors inboundRouter.js's own body-parsing middleware stack in
// isolation (no DB, no controller) so it exercises exactly the
// configuration that broke, without needing a live database connection the
// rest of this suite deliberately avoids.
const urlencoded = express.urlencoded({ extended: true });
const upload = multer({ storage: multer.memoryStorage() });

async function withServer(app, fn) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test('inbound webhook body parsing: a urlencoded delivery (no attachment) populates req.body', async () => {
  const app = express();
  app.post('/email', urlencoded, upload.any(), (req, res) => res.json({ body: req.body }));

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        recipient: 'job-1-abcd@example.com',
        sender: 'no-reply@myworkday.com',
        subject: 'Thanks for applying',
        timestamp: '1234567890',
        token: 'tok',
        signature: 'deadbeef',
      }),
    });
    const data = await res.json();
    assert.equal(data.body.recipient, 'job-1-abcd@example.com');
    assert.equal(data.body.timestamp, '1234567890');
    assert.equal(data.body.token, 'tok');
    assert.equal(data.body.signature, 'deadbeef');
  });
});

test('inbound webhook body parsing: a multipart delivery (with an attachment) still populates req.body', async () => {
  const app = express();
  app.post('/email', urlencoded, upload.any(), (req, res) => res.json({ body: req.body }));

  await withServer(app, async (base) => {
    const form = new FormData();
    form.append('recipient', 'job-1-abcd@example.com');
    form.append('timestamp', '1234567890');
    form.append('token', 'tok');
    form.append('signature', 'deadbeef');
    form.append('attachment-1', new Blob(['resume bytes']), 'resume.pdf');

    const res = await fetch(`${base}/email`, { method: 'POST', body: form });
    const data = await res.json();
    assert.equal(data.body.recipient, 'job-1-abcd@example.com');
    assert.equal(data.body.signature, 'deadbeef');
  });
});

test('inbound webhook body parsing: multer alone (the pre-fix config) leaves a urlencoded body empty', async () => {
  // Proves the bug was real: with only multer mounted -- routes/
  // inboundRouter.js's config before 8dc937e -- a urlencoded POST's body
  // never gets parsed at all.
  const app = express();
  app.post('/email', upload.any(), (req, res) => res.json({ hasBody: req.body !== undefined, body: req.body || null }));

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ recipient: 'job-1-abcd@example.com', signature: 'deadbeef' }),
    });
    const data = await res.json();
    assert.equal(data.hasBody, false, 'multer alone must not populate req.body for a urlencoded request');
  });
});
