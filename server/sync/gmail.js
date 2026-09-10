const { KNOWN_DIRECT_SENDERS, THIRD_PARTY_SENDERS } = require('./companyMap');

// Multi-tenant ATS platform domains — safe to match broadly since every
// sender on them is some employer's recruiting flow.
const ATS_PLATFORM_DOMAINS = [
  'myworkday.com',
  'us.greenhouse-mail.io',
  'ashbyhq.com',
  'hire.lever.co',
  'talent.icims.com',
  'hackerrankforwork.com',
  'workflow.mail.us2.cloud.oracle.com',
];

// Direct/custom employer senders — matched by exact address, not domain.
// Domains like google.com or stripe.com send plenty of non-recruiting mail
// (security alerts, product announcements); matching the whole domain would
// pull all of that in and waste API quota on messages that are never
// job-application signal.
const DIRECT_SENDER_ADDRESSES = [
  ...Object.keys(KNOWN_DIRECT_SENDERS),
  ...Object.keys(THIRD_PARTY_SENDERS),
];

// Sender domains/addresses worth searching for at all — keeps the Gmail
// query narrow instead of scanning the whole mailbox every run. Pure noise
// sources (LinkedIn digests, Indeed/Wellfound alerts) are deliberately not
// included here at all — they're never real application signal, so there's
// no reason to spend quota fetching them just to filter them back out.
const CANDIDATE_SENDER_TERMS = [...ATS_PLATFORM_DOMAINS, ...DIRECT_SENDER_ADDRESSES];

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

const HTML_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#8217': '’',
  '#8211': '–',
  '#8212': '—',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  // Accented Latin-1 names show up in company and candidate names
  // ("Nestl&eacute;", "r&eacute;sum&eacute;").
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  ntilde: 'ñ',
  oslash: 'ø',
  aring: 'å',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const known = HTML_ENTITIES[name.toLowerCase()] ?? HTML_ENTITIES[name];
    if (known !== undefined) return known;
    const numeric = /^#x([0-9a-f]+)$/i.exec(name) || /^#(\d+)$/.exec(name);
    if (numeric) {
      const code = /^#x/i.test(name) ? parseInt(numeric[1], 16) : parseInt(numeric[1], 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    return whole;
  });
}

// Block-level markup carries the line structure of the original email. The
// classifier's field patterns are line-anchored ("Job Title: ...") and its
// captures stop at newlines, so flattening an HTML body to one long line —
// which is what collapsing all whitespace used to do — is what made titles
// unextractable in HTML-only mail.
const BLOCK_TAG_PATTERN =
  /<\s*\/?\s*(?:br|p|div|tr|li|ul|ol|table|h[1-6]|blockquote|section|header|footer|hr)\b[^>]*>/gi;

function stripHtml(html) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\s*\/?\s*td\b[^>]*>/gi, '\t')
    .replace(BLOCK_TAG_PATTERN, '\n')
    // Remaining inline tags (<a>, <span>, <strong>) sit inside a line.
    .replace(/<[^>]+>/g, '');

  return decodeEntities(text)
    // Horizontal whitespace only — newlines are meaningful now.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    // A run of block boundaries (</div><div>, </p><p>) is still just one
    // line break as far as the classifier is concerned.
    .replace(/\n{2,}/g, '\n')
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
  stripHtml,
  extractBody,
  buildSearchQuery,
  listCandidateMessageIds,
  getMessage,
};
