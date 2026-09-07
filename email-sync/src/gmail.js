// Sender domains/addresses worth searching for at all — keeps the Gmail
// query narrow instead of scanning the whole mailbox every run.
const CANDIDATE_SENDER_TERMS = [
  'myworkday.com',
  'us.greenhouse-mail.io',
  'ashbyhq.com',
  'hire.lever.co',
  'talent.icims.com',
  'hackerrankforwork.com',
  'workflow.mail.us2.cloud.oracle.com',
  'ibm.com',
  'mail.amazon.jobs',
  'google.com',
  'openai.com',
  'spacex.com',
  'oracle.com',
  'email.careers.microsoft.com',
  'stripe.com',
  'recruitment.americanexpress.com',
  'cognizant.com',
  'talent.paypal.com',
  'epic.com',
  'micro1.ai',
  // Noise sources are included too — we still need to see them to filter
  // them out, e.g. the Amazon "keep track" duplicate.
  'match.indeed.com',
  'hi.wellfound.com',
  'linkedin.com',
];

function buildSenderQuery() {
  return `(${CANDIDATE_SENDER_TERMS.map((term) => `from:${term}`).join(' OR ')})`;
}

/** Gmail search query for the messages worth fetching, since a given time. */
function buildSearchQuery({ afterEpochSeconds } = {}) {
  const parts = [buildSenderQuery()];
  if (afterEpochSeconds) {
    parts.push(`after:${afterEpochSeconds}`);
  }
  return parts.join(' ');
}

async function listCandidateMessageIds(gmail, { afterEpochSeconds } = {}) {
  const query = buildSearchQuery({ afterEpochSeconds });
  const ids = [];
  let pageToken;

  do {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      pageToken,
      maxResults: 100,
    });
    (data.messages || []).forEach((m) => ids.push(m.id));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return ids;
}

function decodeBase64Url(data) {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Walks the MIME part tree, preferring text/plain, falling back to text/html. */
function extractBody(payload) {
  if (!payload) return '';

  let plain = null;
  let html = null;

  function walk(part) {
    if (!part) return;
    const body = part.body && part.body.data ? decodeBase64Url(part.body.data) : null;
    if (body) {
      if (part.mimeType === 'text/plain' && !plain) plain = body;
      if (part.mimeType === 'text/html' && !html) html = body;
    }
    (part.parts || []).forEach(walk);
  }

  walk(payload);

  if (plain) return plain;
  if (html) return stripHtml(html);
  return '';
}

function getHeader(headers, name) {
  const header = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

async function getMessage(gmail, id) {
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full',
  });

  const headers = data.payload && data.payload.headers;

  return {
    id: data.id,
    threadId: data.threadId,
    from: getHeader(headers, 'From'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    body: extractBody(data.payload),
    snippet: data.snippet || '',
  };
}

module.exports = {
  CANDIDATE_SENDER_TERMS,
  buildSearchQuery,
  listCandidateMessageIds,
  getMessage,
};
