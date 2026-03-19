import { CheckRequest, CheckResponse, GrammarError, PrewarmRequest, PrewarmResponse } from "../shared/types.js";
import { getSettings } from "../shared/storage.js";
import { buildGrammarCheckPrompt, buildGrammarRecheckPrompt } from "../shared/prompts.js";
import { parseOpenAIResponse, parseGeminiResponse, validateErrors, deriveErrorsFromCorrectedText, ParsedResponse } from "../shared/api-parsers.js";
import { OPENAI_API_URL, GEMINI_API_URL, DEFAULT_OPENAI_MODEL, MAX_TEXT_LENGTH, PROMPT_CACHE_VERSION } from "../shared/constants.js";

interface TextChunk {
  text: string;
  start: number;
  end: number;
}

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

  let parsed: ParsedResponse;
  let errors: GrammarError[];

  try {
    if (shouldChunkText(text)) {
      ({ parsed, errors } = await checkTextInChunks(text, settings, abortController.signal));
    } else {
      ({ parsed, errors } = await checkSingleText(text, settings, abortController.signal));
    }
  } finally {
    if (inflightAborts.get(requestScope) === abortController) {
      inflightAborts.delete(requestScope);
    }
  }

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

async function checkSingleText(
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  signal?: AbortSignal
): Promise<{ parsed: ParsedResponse; errors: GrammarError[] }> {
  const prompt = buildGrammarCheckPrompt(text);
  let parsed = await callConfiguredProvider(
    settings,
    prompt.system,
    prompt.user,
    signal
  );

  console.log("[AI Grammar Checker] Raw errors from API:", JSON.stringify(parsed.errors));

  let errors = validateErrors(parsed.errors, text);
  if (errors.length === 0 && parsed.correctedText && parsed.correctedText !== text) {
    errors = deriveErrorsFromCorrectedText(text, parsed.correctedText);
    console.log("[AI Grammar Checker] Derived errors from correctedText:", errors.length, JSON.stringify(errors));
  }

  if (shouldRunHighRecallFallback(text, errors, parsed.correctedText)) {
    console.log("[AI Grammar Checker] Running high-recall recheck fallback");
    const fallbackPrompt = buildGrammarRecheckPrompt(text);
    const fallbackParsed = await callConfiguredProvider(
      settings,
      fallbackPrompt.system,
      fallbackPrompt.user,
      signal
    );
    let fallbackErrors = validateErrors(fallbackParsed.errors, text);
    if (fallbackErrors.length === 0 && fallbackParsed.correctedText && fallbackParsed.correctedText !== text) {
      fallbackErrors = deriveErrorsFromCorrectedText(text, fallbackParsed.correctedText);
      console.log("[AI Grammar Checker] Derived fallback errors from correctedText:", fallbackErrors.length, JSON.stringify(fallbackErrors));
    }
    if (fallbackErrors.length > 0) {
      parsed = fallbackParsed;
      errors = fallbackErrors;
    }
  }

  return { parsed, errors };
}

async function checkTextInChunks(
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  signal?: AbortSignal
): Promise<{ parsed: ParsedResponse; errors: GrammarError[] }> {
  const chunks = splitTextIntoChunks(text);
  console.log("[AI Grammar Checker] Chunking long text into", chunks.length, "chunks");

  const mergedErrors: GrammarError[] = [];
  let correctedText = "";

  for (const chunk of chunks) {
    const { parsed, errors } = await checkSingleText(chunk.text, settings, signal);
    mergedErrors.push(...errors.map((error) => ({
      ...error,
      offset: error.offset + chunk.start,
    })));
    correctedText += (parsed.correctedText && parsed.correctedText.trim().length > 0)
      ? parsed.correctedText
      : chunk.text;
  }

  const normalizedCorrectedText = normalizeCorrectedText(text, correctedText);
  const normalizedMergedErrors = deriveErrorsFromCorrectedText(text, normalizedCorrectedText);

  return {
    parsed: {
      errors: normalizedMergedErrors,
      correctedText: normalizedCorrectedText,
    },
    errors: normalizedMergedErrors,
  };
}

function shouldChunkText(text: string): boolean {
  const sentenceCount = countSentences(text);
  const wordCount = (text.match(/\b[\w']+\b/g) || []).length;
  return sentenceCount > 3 || wordCount > 45 || text.length > 260;
}

function countSentences(text: string): number {
  return (text.match(/[.!?]+(?=(?:["'”’)\]]*\s+)|$)/g) || []).length;
}

function splitTextIntoChunks(text: string): TextChunk[] {
  const sentences = splitIntoSentenceSlices(text);
  if (sentences.length <= 1) {
    return [{ text, start: 0, end: text.length }];
  }

  const chunks: TextChunk[] = [];
  let chunkStartIndex = 0;
  let currentStart = sentences[0].start;
  let currentEnd = sentences[0].end;

  for (let i = 1; i < sentences.length; i++) {
    const candidateEnd = sentences[i].end;
    const sentenceCount = i - chunkStartIndex + 1;
    const candidateText = text.slice(currentStart, candidateEnd);
    const shouldBreak =
      sentenceCount > 3 ||
      candidateText.length > 260;

    if (shouldBreak) {
      chunks.push({
        text: text.slice(currentStart, currentEnd),
        start: currentStart,
        end: currentEnd,
      });
      chunkStartIndex = i;
      currentStart = sentences[i].start;
      currentEnd = sentences[i].end;
    } else {
      currentEnd = candidateEnd;
    }
  }

  chunks.push({
    text: text.slice(currentStart, currentEnd),
    start: currentStart,
    end: currentEnd,
  });

  return chunks;
}

function splitIntoSentenceSlices(text: string): Array<{ start: number; end: number }> {
  const slices: Array<{ start: number; end: number }> = [];
  const regex = /[^.!?]+(?:[.!?]+|$)(?:\s*)/g;

  for (const match of text.matchAll(regex)) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    if (value) {
      slices.push({ start, end });
    }
  }

  if (slices.length === 0) {
    return [{ start: 0, end: text.length }];
  }

  return slices;
}

function normalizeCorrectedText(originalText: string, correctedText: string): string {
  const originalTrailing = originalText.match(/\s*$/)?.[0] ?? "";
  return correctedText.replace(/\s*$/, originalTrailing);
}

async function callConfiguredProvider(
  settings: Awaited<ReturnType<typeof getSettings>>,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<ParsedResponse> {
  if (settings.provider === "openai") {
    if (!settings.openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }
    return callOpenAI(system, user, settings.openaiApiKey, signal);
  }

  if (!settings.geminiApiKey) {
    throw new Error("Gemini API key not configured");
  }
  return callGemini(system, user, settings.geminiApiKey, signal);
}

function shouldRunHighRecallFallback(
  text: string,
  errors: GrammarError[],
  correctedText?: string
): boolean {
  if (errors.length > 0) return false;
  if (correctedText && correctedText !== text) return false;

  const wordCount = (text.match(/\b[\w']+\b/g) || []).length;
  const sentenceCount = (text.match(/[.!?](?:\s|$)/g) || []).length;
  return text.length >= 120 && wordCount >= 20 && sentenceCount >= 2;
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
                  type: { type: "string" },
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
