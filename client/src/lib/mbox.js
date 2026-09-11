// Client-side mbox parsing for the backfill upload flow (see pages/Backfill.jsx).
// Runs entirely in the browser -- the raw file never reaches the server, only
// the {from, subject, body, date, messageId} shape extracted here, matching
// what server/sync/inboundEmail.js's mailgunPayloadToEmail() already produces
// for the forwarding path and what resolveMessage() expects.
//
// Pure string/DOM logic, no network calls, so every helper below is exported
// for direct testing even though this repo has no client test runner yet.

import PostalMime from "postal-mime";

// A Takeout export scoped to one label (per the backfill instructions) should
// be small; these are a safety valve against someone uploading an entire,
// unfiltered mailbox and freezing their tab.
export const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB
export const MAX_MESSAGES = 20000;

export class MboxParseError extends Error {}

/**
 * Splits raw mbox text into per-message blocks (envelope line + RFC822
 * message, still attached). mbox delimits messages with a line starting
 * "From " (space) at the start of a line -- an RFC822 header can never
 * collide with this, since a From header is "From:" (colon, no space before
 * it).
 */
export function splitMboxMessages(text) {
  return text.split(/^(?=From )/m).filter((block) => block.startsWith("From "));
}

/**
 * Reverses mboxrd quoting: a body line that would otherwise be mistaken for a
 * new envelope gets one extra ">" prefixed by the writer. Only ever matches
 * body content -- a real header can't start with ">".
 */
export function unescapeMboxrd(rawMessage) {
  return rawMessage.replace(/^(>+)From /gm, (_match, gt) => `${gt.slice(1)}From `);
}

/** Drops the mbox envelope line, leaving the raw RFC822 message postal-mime expects. */
export function stripEnvelopeLine(block) {
  const newline = block.indexOf("\n");
  return newline === -1 ? "" : block.slice(newline + 1);
}

/**
 * Fallback date source when the RFC822 `Date:` header is missing or
 * unparsable: the envelope line itself carries a ctime-style date
 * ("From addr Www Mon DD HH:MM:SS YYYY"). Anchored from the pattern's shape
 * rather than a fixed position, since the address before it can vary in
 * length.
 */
export function parseEnvelopeDate(block) {
  const firstLine = block.slice(0, Math.max(block.indexOf("\n"), 0));
  const match = firstLine.match(/\b\w{3} \w{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}\b/);
  if (!match) return null;
  const parsed = new Date(match[0]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** postal-mime's Address -> the "Name <addr>" string form classifier.js expects. */
export function formatFromHeader(address) {
  if (!address || address.group) return "";
  if (!address.address) return address.name || "";
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

// Mirrors server/sync/gmail.js's stripHtml block-tag list -- the classifier's
// field patterns are line-anchored, so a plain-text fallback needs the same
// line structure a text/plain body would have had.
const BLOCK_TAGS = new Set([
  "BR", "P", "DIV", "TR", "LI", "UL", "OL", "TABLE",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "SECTION", "HEADER", "FOOTER", "HR",
]);

/**
 * HTML -> plain text using the browser's own parser rather than regex, so
 * malformed markup and entity decoding (&amp;, &rsquo;, ...) are handled the
 * way a real renderer would, not approximated.
 */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script").forEach((el) => el.remove());

  const lines = [];
  let current = "";

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName;
    if (tag === "TD") current += "\t";
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && current) {
      lines.push(current);
      current = "";
    }
    node.childNodes.forEach(walk);
    if (isBlock) {
      lines.push(current);
      current = "";
    }
  }

  walk(doc.body);
  if (current) lines.push(current);

  return lines
    .join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Parses one mbox block into the upload payload shape, or `null` when the
 * message carries no usable signal at all (no sender, or no date from either
 * the header or the envelope line) -- skipped rather than sent with a
 * fabricated date, which would corrupt jobs.js's earliest-message and
 * timeline derivation.
 */
async function parseOneMessage(block) {
  const rfc822 = unescapeMboxrd(stripEnvelopeLine(block));
  if (!rfc822.trim()) return null;

  const email = await PostalMime.parse(rfc822, { attachmentEncoding: "base64" });

  const from = formatFromHeader(email.from);
  if (!from) return null;

  const headerDate = email.date ? new Date(email.date) : null;
  const date =
    headerDate && !Number.isNaN(headerDate.getTime()) ? headerDate : parseEnvelopeDate(block);
  if (!date) return null;

  const body = email.text || (email.html ? htmlToText(email.html) : "");

  return {
    from,
    subject: email.subject || "",
    body,
    date: date.toISOString(),
    messageId: email.messageId || null,
  };
}

/**
 * Parses an mbox File into upload-ready messages. Everything happens
 * in-browser; nothing here touches the network. Yields to the event loop
 * periodically so a large file doesn't freeze the tab while parsing.
 *
 * @param {File} file
 * @param {{ onProgress?: (parsed: number, total: number) => void }} [opts]
 * @returns {Promise<{ messages: object[], skippedCount: number, totalCount: number }>}
 */
export async function parseMboxFile(file, { onProgress } = {}) {
  if (file.size > MAX_FILE_BYTES) {
    const limitMb = MAX_FILE_BYTES / 1024 / 1024;
    throw new MboxParseError(
      `That file is ${(file.size / 1024 / 1024).toFixed(0)}MB, over the ${limitMb}MB limit. ` +
        "Make sure Google Takeout exported only the label you created, not your whole mailbox.",
    );
  }

  const text = await file.text();
  const blocks = splitMboxMessages(text);

  if (blocks.length === 0) {
    throw new MboxParseError(
      "No messages found in this file. Make sure it's the .mbox file inside the Takeout export, not the .zip or .tgz itself.",
    );
  }
  if (blocks.length > MAX_MESSAGES) {
    throw new MboxParseError(
      `This file has ${blocks.length} messages, over the ${MAX_MESSAGES} limit. Try a narrower date range.`,
    );
  }

  const messages = [];
  let skippedCount = 0;

  for (let i = 0; i < blocks.length; i += 1) {
    try {
      const parsed = await parseOneMessage(blocks[i]);
      if (parsed) messages.push(parsed);
      else skippedCount += 1;
    } catch {
      // One malformed message (truncated MIME, unsupported encoding) should
      // not fail the whole import -- it's dropped and counted.
      skippedCount += 1;
    }

    if (onProgress && (i % 10 === 0 || i === blocks.length - 1)) {
      onProgress(i + 1, blocks.length);
    }
    if (i % 25 === 24) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { messages, skippedCount, totalCount: blocks.length };
}
