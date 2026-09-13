// Gmail's own ownership check for a newly added forwarding address: when a
// user adds one of our aliases as a forwarding target in their Gmail
// settings, Gmail sends this message to the alias itself (not to the user)
// with a one-click link to confirm the request. It never reaches the
// classify pipeline meaningfully -- it isn't job-application mail, and
// there's no human inbox at the alias to read it and click through -- so
// the app has to detect it and hand the link back to the user itself.

const SENDER = 'forwarding-noreply@google.com';
const SUBJECT_MARKER = 'Gmail Forwarding Confirmation';

function isGmailForwardingConfirmation({ from, subject }) {
  return (
    String(from || '').toLowerCase().includes(SENDER) &&
    String(subject || '').includes(SUBJECT_MARKER)
  );
}

// The message contains two links -- "vf-" confirms the forward, "uf-"
// cancels it -- both on mail.google.com or mail-settings.google.com
// depending on which Gmail sent it. Only the vf- (confirm) link should ever
// be surfaced.
const CONFIRM_LINK_PATTERN = /https:\/\/mail[-a-z]*\.google\.com\/mail\/vf-\S+/;

function extractConfirmationLink(body) {
  const match = CONFIRM_LINK_PATTERN.exec(String(body || ''));
  return match ? match[0] : null;
}

module.exports = { isGmailForwardingConfirmation, extractConfirmationLink };
