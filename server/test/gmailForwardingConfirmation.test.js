const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isGmailForwardingConfirmation,
  extractConfirmationLink,
} = require('../sync/gmailForwardingConfirmation');

test('isGmailForwardingConfirmation: true for Gmail\'s forwarding confirmation sender + subject', () => {
  const result = isGmailForwardingConfirmation({
    from: 'Gmail Team <forwarding-noreply@google.com>',
    subject: '(Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com',
  });
  assert.equal(result, true);
});

test('isGmailForwardingConfirmation: false for a real job-application sender', () => {
  const result = isGmailForwardingConfirmation({
    from: 'Amazon Jobs <noreply@mail.amazon.jobs>',
    subject: 'Thanks for applying',
  });
  assert.equal(result, false);
});

test('isGmailForwardingConfirmation: false when subject is missing the marker even if sender matches', () => {
  const result = isGmailForwardingConfirmation({
    from: 'Gmail Team <forwarding-noreply@google.com>',
    subject: 'Something else entirely',
  });
  assert.equal(result, false);
});

test('isGmailForwardingConfirmation: false when sender is missing even if subject matches', () => {
  const result = isGmailForwardingConfirmation({
    from: 'Someone Else <spoof@example.com>',
    subject: 'Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com',
  });
  assert.equal(result, false);
});

test('extractConfirmationLink: pulls the vf- confirm link out of a real message body, not the uf- cancel link', () => {
  const body = `someone@gmail.com has requested to automatically forward mail to your email
address job-1-abcd1234@sandbox123.mailgun.org.

To allow someone@gmail.com to automatically forward mail to your address,
please click the link below to confirm the request:

https://mail.google.com/mail/vf-%5BANGjdJ-3o2P8r7YkhEkj72aT4USk-O9gcOiNgXCYYqKxt4ruis6tWydUEDwkDixYtJjkktk1d_EXoczvBEVRk3DG9gcvydzOxzTu6M03uJrRYgRAQpdtnR8-r9D8sgbNuZBNfo730-G-LSVoKCk8%5D-SJUehVjE_dt4V8o3CxiGeWJMuTA

If you click the link and it appears to be broken, please copy and paste it
into a new browser window.

Thanks for using Gmail!

Sincerely,

The Gmail Team

If you do not approve of this request, no further action is required.
someone@gmail.com cannot automatically forward messages to your
email address
unless you confirm the request by clicking the link above. If you accidentally
clicked the link, but you do not want to allow someone@gmail.com to
automatically forward messages to your address, click this link to cancel this
verification:
https://mail.google.com/mail/uf-%5BANGjdJ-jFEQ_XHl6EF_vcC8nhAf9WjEJf9eqTvGx4rY7UwVm3AzfvGVyiQxOOJ2tydaBULN1_EqnDmHFUaSWi31svuwRV01ZbCz0fKPI5-unF5grVyOd5g7xWkdz8Je7JPzVc0o792FM8EnjqfBf%5D-SJUehVjE_dt4V8o3CxiGeWJMuTA
`;
  const link = extractConfirmationLink(body);
  assert.equal(
    link,
    'https://mail.google.com/mail/vf-%5BANGjdJ-3o2P8r7YkhEkj72aT4USk-O9gcOiNgXCYYqKxt4ruis6tWydUEDwkDixYtJjkktk1d_EXoczvBEVRk3DG9gcvydzOxzTu6M03uJrRYgRAQpdtnR8-r9D8sgbNuZBNfo730-G-LSVoKCk8%5D-SJUehVjE_dt4V8o3CxiGeWJMuTA',
  );
});

test('extractConfirmationLink: also matches the mail-settings.google.com host variant', () => {
  const body = 'please click the link below to confirm the request:\n\nhttps://mail-settings.google.com/mail/vf-%5Babc%5D-xyz\n';
  const link = extractConfirmationLink(body);
  assert.equal(link, 'https://mail-settings.google.com/mail/vf-%5Babc%5D-xyz');
});

test('extractConfirmationLink: returns null when there is no confirmation link', () => {
  assert.equal(extractConfirmationLink('just some random text'), null);
});
