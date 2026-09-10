// LLM provider adapters.
//
// The classifier is provider-agnostic: prompt, schema, validation, retry and
// telemetry all live in llm.js, and everything provider-shaped lives here.
// That boundary exists because both providers have already failed in
// different ways during development — Gemini exhausted its credits, Groq's
// free tier rate-limits at 8k tokens/minute — and a public deployment needs
// to move between them by changing an env var, not by editing the pipeline.
//
// Each adapter exposes:
//   apiKeyEnv     env var holding its key
//   requestsPerMinute  optional; free-tier request ceiling, paced by llm.js
//   defaultModel  pinned; overridable per-provider via env
//   buildRequest  ({ model, messages, schema, strict }) -> { url, headers, body }
//   extractText   (responseJson) -> the model's raw text answer
//   extractUsage  (responseJson) -> { input, output, thinking } for cost logging
//
// `messages` is always OpenAI-shaped (system + alternating user/assistant);
// adapters translate as needed so the prompt is written once.

/** OpenAI-style messages -> Gemini's systemInstruction + contents. */
function toGeminiContents(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      // Gemini calls the assistant turn "model"; few-shot examples rely on
      // that alternation being correct or they read as one long user turn.
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  return { system, contents };
}

/** JSON Schema -> the OpenAPI subset Gemini's responseSchema accepts. */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    // Gemini rejects additionalProperties outright.
    if (key === 'additionalProperties') continue;
    if (key === 'type' && typeof value === 'string') {
      out.type = value.toUpperCase();
    } else if (key === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)]),
      );
    } else if (value && typeof value === 'object') {
      out[key] = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const groq = {
  name: 'groq',
  apiKeyEnv: 'GROQ_API_KEY',
  modelEnv: 'GROQ_MODEL',
  defaultModel: 'openai/gpt-oss-120b',

  buildRequest({ model, messages, schema, strict, apiKey }) {
    return {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages,
        temperature: 0,
        max_completion_tokens: 300,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'job_email_classification', strict, schema },
        },
      },
    };
  },

  extractText: (data) => data?.choices?.[0]?.message?.content || '',
  extractUsage: (data) => ({
    input: data?.usage?.prompt_tokens || 0,
    output: data?.usage?.completion_tokens || 0,
    thinking: 0,
  }),
};

const gemini = {
  name: 'gemini',
  apiKeyEnv: 'GEMINI_API_KEY',
  modelEnv: 'GEMINI_MODEL',
  defaultModel: 'gemini-3.6-flash',
  // Free tier is 20 generateContent requests per DAY, per project, per model
  // (quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier). Not a rate
  // limit — no pacing or backoff can widen it, and the "retry in ~53s" hint
  // the 429 carries is misleading: the window is midnight Pacific. A daily
  // cap this small cannot classify a real inbox, so Gemini needs billing
  // enabled on the AI Studio project before it is a usable backend.
  dailyRequestLimit: 20,

  buildRequest({ model, messages, schema, apiKey, thinking = true }) {
    const { system, contents } = toGeminiContents(messages);
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents,
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 300,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
          // Gemini 3.x defaults to DYNAMIC thinking, and thinking tokens bill
          // at the (much more expensive) output rate. Left unset, the cost of
          // a classification is unbounded. "low" is the floor that 3.x Flash
          // supports — "minimal" is rejected by 3.8 Flash.
          //
          // Not every model accepts the field (the Lite variants differ), so
          // llm.js retries once with thinking:false when a 400 names it —
          // otherwise an unsupported field reads as "the model is broken".
          // Watch usage.thinking in the sync summary to confirm it is taking
          // effect where it IS supported.
          ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      },
    };
  },

  extractText: (data) =>
    (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') || '',
  extractUsage: (data) => ({
    input: data?.usageMetadata?.promptTokenCount || 0,
    output: data?.usageMetadata?.candidatesTokenCount || 0,
    thinking: data?.usageMetadata?.thoughtsTokenCount || 0,
  }),
};

const PROVIDERS = { groq, gemini };

/**
 * The active provider: LLM_PROVIDER when set, otherwise whichever key is
 * configured. Gemini wins a tie — it is the one with paid throughput, and
 * Groq's free tier caps at roughly 11 classifications a minute.
 */
function selectProvider(env = process.env) {
  const named = (env.LLM_PROVIDER || '').trim().toLowerCase();
  if (named) {
    if (!PROVIDERS[named]) {
      throw new Error(
        `Unknown LLM_PROVIDER "${named}". Valid values: ${Object.keys(PROVIDERS).join(', ')}.`,
      );
    }
    return PROVIDERS[named];
  }
  if (env[gemini.apiKeyEnv]) return gemini;
  if (env[groq.apiKeyEnv]) return groq;
  return null;
}

module.exports = { PROVIDERS, selectProvider, toGeminiContents, toGeminiSchema };
