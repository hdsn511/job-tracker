// Free-tier LLM fallback for the small fraction of emails the deterministic
// rules in classifier.js can't confidently place. Never called for the bulk
// of mail — only when a candidate email survives the noise filter but has no
// status or no company from the rules.

const MODEL = 'gemini-2.0-flash';
const VALID_STATUSES = new Set(['Applied', 'Interviewing', 'Offer', 'Rejected']);

function buildPrompt({ from, subject, body }) {
  const truncatedBody = (body || '').slice(0, 2000);
  return `You classify job-application-related emails for a personal job tracker.
Given the email below, respond with ONLY a compact JSON object (no markdown fences, no prose):
{"status": one of "Applied" | "Interviewing" | "Offer" | "Rejected" | null, "company": string or null, "jobTitle": string or null}

Rules:
- "status" must be null if this email is not clearly about the outcome/stage of a specific job application (e.g. a generic newsletter, job alert, or unrelated email).
- "Interviewing" covers both interview invitations AND online assessments / coding challenges / screening steps.
- "company" is the hiring company's name, not an ATS vendor (e.g. Workday, Greenhouse, iCIMS) and not a screening vendor (e.g. HackerRank, micro1).
- "jobTitle" is the role applied for, if mentioned.

From: ${from}
Subject: ${subject}
Body: ${truncatedBody}`;
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Returns { status, company, jobTitle } or null if the API key is missing,
 * the request fails, or the response can't be parsed/validated.
 */
async function classifyWithGemini(email) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(email) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 200 },
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`Gemini fallback request failed: ${err.message}`);
    return null;
  }

  if (!response.ok) {
    console.warn(`Gemini fallback returned HTTP ${response.status}`);
    return null;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  const parsed = extractJson(text);
  if (!parsed) return null;

  const status = VALID_STATUSES.has(parsed.status) ? parsed.status : null;
  return {
    status,
    company: parsed.company || null,
    jobTitle: parsed.jobTitle || null,
  };
}

module.exports = { classifyWithGemini, buildPrompt, extractJson };
