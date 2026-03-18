import { CheckRequest, CheckResponse, GrammarError, PrewarmRequest, PrewarmResponse } from "../shared/types.js";
import { getSettings } from "../shared/storage.js";
import { buildGrammarCheckPrompt } from "../shared/prompts.js";
import { parseOpenAIResponse, parseGeminiResponse, validateErrors, ParsedResponse } from "../shared/api-parsers.js";
import { OPENAI_API_URL, GEMINI_API_URL, DEFAULT_OPENAI_MODEL, MAX_TEXT_LENGTH, PROMPT_CACHE_VERSION } from "../shared/constants.js";

// Rate limit state lives here in the service worker — persists across all tabs/page loads
let rateLimitedUntil = 0;

// Cached settings to avoid repeated chrome.storage reads on every check
let cachedSettings: Awaited<ReturnType<typeof getSettings>> | null = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 30_000; // 30 seconds

async function getCachedSettings() {
  if (cachedSettings && Date.now() - settingsCacheTime < SETTINGS_CACHE_TTL) {
    return cachedSettings;
  }
  cachedSettings = await getSettings();
  settingsCacheTime = Date.now();
  return cachedSettings;
}

// Invalidate settings cache when settings change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    cachedSettings = null;
    settingsCacheTime = 0;
  }
});

// Simple LRU cache for recent checks (text → errors + correctedText)
const responseCache = new Map<string, { errors: GrammarError[]; correctedText?: string; timestamp: number }>();
const CACHE_TTL = 60_000; // 1 minute
const CACHE_MAX = 50;

function getCached(cacheKey: string): { errors: GrammarError[]; correctedText?: string } | null {
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    responseCache.delete(cacheKey);
    return null;
  }
  responseCache.delete(cacheKey);
  responseCache.set(cacheKey, entry);
  return { errors: entry.errors, correctedText: entry.correctedText };
}

function setCache(cacheKey: string, errors: GrammarError[], correctedText?: string): void {
  if (responseCache.size >= CACHE_MAX) {
    const oldest = responseCache.keys().next().value!;
    responseCache.delete(oldest);
  }
  responseCache.set(cacheKey, { errors, correctedText, timestamp: Date.now() });
}

// Track in-flight requests so we can abort superseded ones
const inflightAborts = new Map<string, AbortController>();

chrome.runtime.onMessage.addListener(
  (message: any, sender, sendResponse) => {
    if (message.type === "PREWARM") {
      handlePrewarm(message)
        .then(sendResponse)
        .catch(() => {
          const response: PrewarmResponse = {
            type: "PREWARM_RESULT",
            configured: false,
          };
          sendResponse(response);
        });
      return true;
    }

    if (message.type === "CHECK_GRAMMAR") {
      // If rate limited, reject immediately without making an API call
      if (Date.now() < rateLimitedUntil) {
        const response: CheckResponse = {
          type: "CHECK_GRAMMAR_RESULT",
          requestId: message.requestId,
          errors: [],
          error: "Rate limited",
          rateLimitedUntil,
        };
        sendResponse(response);
        return true;
      }

      handleCheckGrammar(message, sender)
        .then(sendResponse)
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          // Parse retry-after from error message if present
          const retryMatch = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
          if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("quota")) {
            const waitSecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
            rateLimitedUntil = Date.now() + waitSecs * 1000;
          }
          const response: CheckResponse = {
            type: "CHECK_GRAMMAR_RESULT",
            requestId: message.requestId,
            errors: [],
            error: msg,
            rateLimitedUntil: rateLimitedUntil > Date.now() ? rateLimitedUntil : undefined,
          };
          sendResponse(response);
        });
      return true; // async response
    }

    return false;
  }
);

async function handleCheckGrammar(
  request: CheckRequest,
  sender: chrome.runtime.MessageSender
): Promise<CheckResponse> {
  const settings = await getCachedSettings();
  const text = request.text.substring(0, MAX_TEXT_LENGTH);
  const cacheKey = buildCacheKey(text, settings);

  // Check cache first
  const cached = getCached(cacheKey);
  if (cached) {
    let errors = [...cached.errors];
    if (!settings.checkGrammar) errors = errors.filter((e) => e.type !== "grammar");
    if (!settings.checkSpelling) errors = errors.filter((e) => e.type !== "spelling");
    if (!settings.checkPunctuation) errors = errors.filter((e) => e.type !== "punctuation");
    return { type: "CHECK_GRAMMAR_RESULT", requestId: request.requestId, errors, correctedText: cached.correctedText };
  }

  // Abort any previous in-flight request from the same tab
  const requestScope = getRequestScope(request, sender);
  const prevAbort = inflightAborts.get(requestScope);
  if (prevAbort) prevAbort.abort();
  const abortController = new AbortController();
  inflightAborts.set(requestScope, abortController);

  const { system, user } = buildGrammarCheckPrompt(text);

  let parsed: ParsedResponse;

  try {
    if (settings.provider === "openai") {
      if (!settings.openaiApiKey) {
        return {
          type: "CHECK_GRAMMAR_RESULT",
          requestId: request.requestId,
          errors: [],
          error: "OpenAI API key not configured",
        };
      }
      parsed = await callOpenAI(system, user, settings.openaiApiKey, abortController.signal);
    } else {
      if (!settings.geminiApiKey) {
        return {
          type: "CHECK_GRAMMAR_RESULT",
          requestId: request.requestId,
          errors: [],
          error: "Gemini API key not configured",
        };
      }
      parsed = await callGemini(system, user, settings.geminiApiKey, abortController.signal);
    }
  } finally {
    if (inflightAborts.get(requestScope) === abortController) {
      inflightAborts.delete(requestScope);
    }
  }

  console.log("[AI Grammar Checker] Raw errors from API:", JSON.stringify(parsed.errors));

  // Validate and filter errors
  let errors = validateErrors(parsed.errors, text);
  console.log("[AI Grammar Checker] Validated errors:", errors.length, JSON.stringify(errors));

  // Cache the unfiltered result
  setCache(cacheKey, errors, parsed.correctedText);

  // Filter by user preferences
  if (!settings.checkGrammar) errors = errors.filter((e) => e.type !== "grammar");
  if (!settings.checkSpelling) errors = errors.filter((e) => e.type !== "spelling");
  if (!settings.checkPunctuation) errors = errors.filter((e) => e.type !== "punctuation");

  return {
    type: "CHECK_GRAMMAR_RESULT",
    requestId: request.requestId,
    errors,
    correctedText: parsed.correctedText,
  };
}

async function handlePrewarm(_request: PrewarmRequest): Promise<PrewarmResponse> {
  const settings = await getCachedSettings();
  const configured = settings.provider === "openai"
    ? settings.openaiApiKey.length > 0
    : settings.geminiApiKey.length > 0;

  return {
    type: "PREWARM_RESULT",
    configured,
  };
}

function getRequestScope(
  request: CheckRequest,
  sender: chrome.runtime.MessageSender
): string {
  const tabId = sender.tab?.id ?? "no-tab";
  const frameId = sender.frameId ?? 0;
  const sourceId = request.sourceId ?? request.requestId;
  return `${tabId}:${frameId}:${sourceId}`;
}

function buildCacheKey(
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>
): string {
  return JSON.stringify({
    text,
    provider: settings.provider,
    openaiModel: settings.provider === "openai" ? DEFAULT_OPENAI_MODEL : undefined,
    grammar: settings.checkGrammar,
    spelling: settings.checkSpelling,
    punctuation: settings.checkPunctuation,
    promptVersion: PROMPT_CACHE_VERSION,
  });
}

async function callOpenAI(
  system: string,
  user: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<ParsedResponse> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new Error("Invalid OpenAI API key");
    if (status === 429) throw new Error("OpenAI rate limit exceeded");
    throw new Error(`OpenAI API error: ${status}`);
  }

  const json = await response.json();
  return parseOpenAIResponse(json);
}

async function callGemini(
  system: string,
  user: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<ParsedResponse> {
  const url = `${GEMINI_API_URL}?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          parts: [{ text: user }],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            correctedText: { type: "string" },
            errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  original: { type: "string" },
                  suggestion: { type: "string" },
                  offset: { type: "integer" },
                  length: { type: "integer" },
                  type: { type: "string", enum: ["grammar", "spelling", "punctuation"] },
                  explanation: { type: "string" },
                },
                required: ["original", "suggestion", "offset", "length", "type", "explanation"],
              },
            },
          },
          required: ["correctedText", "errors"],
        },
      },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson.error?.message || JSON.stringify(errJson).substring(0, 200);
    } catch {}
    if (status === 429) throw new Error(`Gemini rate limit exceeded. ${detail}`);
    if (status === 400) throw new Error(`Gemini API error (400): ${detail}`);
    if (status === 403) throw new Error(`Gemini API forbidden (403): ${detail}`);
    throw new Error(`Gemini API error ${status}: ${detail}`);
  }

  const json = await response.json();
  return parseGeminiResponse(json);
}
