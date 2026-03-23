import { CheckRequest, CheckResponse, GrammarError, PrewarmRequest, PrewarmResponse } from "../shared/types.js";
import { getSettings } from "../shared/storage.js";
import { buildGrammarCheckPrompt, buildGrammarRecheckPrompt } from "../shared/prompts.js";
import {
  parseOpenAIResponse,
  parseGeminiResponse,
  validateErrors,
  deriveErrorsFromCorrectedText,
  isDerivedError,
  ParsedResponse,
} from "../shared/api-parsers.js";
import { OPENAI_API_URL, GEMINI_API_URL, DEFAULT_OPENAI_MODEL, MAX_TEXT_LENGTH, PROMPT_CACHE_VERSION } from "../shared/constants.js";
import { findLocalPunctuationErrors, PUNCTUATION_RULES_VERSION } from "../shared/punctuation-rules.js";
import { isLikelyEnglish } from "../shared/language-detect.js";

import { findLocalGrammarErrors, isVerbProtectedByModal } from "../shared/grammar-rules.js";

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

chrome.runtime.onInstalled.addListener(async () => {
  await reinjectContentScriptsIntoExistingTabs();
});

async function getCachedSettings() {
  if (cachedSettings && Date.now() - settingsCacheTime < SETTINGS_CACHE_TTL) {
    return cachedSettings;
  }
  cachedSettings = await getSettings();
  settingsCacheTime = Date.now();
  return cachedSettings;
}

async function reinjectContentScriptsIntoExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !isInjectableTabUrl(tab.url)) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/index.js"],
      });
    } catch {
      // Ignore restricted pages and transient tab races.
    }
  }
}

function isInjectableTabUrl(url?: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
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
const chunkResponseCache = new Map<string, { parsed: ParsedResponse; errors: GrammarError[]; timestamp: number }>();
const CHUNK_CACHE_TTL = 5 * 60_000; // 5 minutes
const CHUNK_CACHE_MAX = 100;
const CHUNK_CONCURRENCY = 2;

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

function getCachedChunk(cacheKey: string): { parsed: ParsedResponse; errors: GrammarError[] } | null {
  const entry = chunkResponseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CHUNK_CACHE_TTL) {
    chunkResponseCache.delete(cacheKey);
    return null;
  }
  chunkResponseCache.delete(cacheKey);
  chunkResponseCache.set(cacheKey, entry);
  return {
    parsed: cloneParsedResponse(entry.parsed),
    errors: cloneErrors(entry.errors),
  };
}

function setChunkCache(cacheKey: string, parsed: ParsedResponse, errors: GrammarError[]): void {
  if (chunkResponseCache.size >= CHUNK_CACHE_MAX) {
    const oldest = chunkResponseCache.keys().next().value!;
    chunkResponseCache.delete(oldest);
  }
  chunkResponseCache.set(cacheKey, {
    parsed: cloneParsedResponse(parsed),
    errors: cloneErrors(errors),
    timestamp: Date.now(),
  });
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
  const chunked = shouldChunkText(text);

  if (!isLikelyEnglish(text)) {
    return {
      type: "CHECK_GRAMMAR_RESULT",
      requestId: request.requestId,
      errors: [],
      chunked,
    };
  }

  const localPunctuationErrors = settings.checkPunctuation ? findLocalPunctuationErrors(text) : [];
  const localGrammarErrors = settings.checkGrammar ? findLocalGrammarErrors(text) : [];
  const cacheKey = buildCacheKey(text, settings);

  // Check cache first
  const cached = getCached(cacheKey);
  if (cached) {
    let errors = [...cached.errors];
    if (!settings.checkGrammar) errors = errors.filter((e) => e.type !== "grammar");
    if (!settings.checkSpelling) errors = errors.filter((e) => e.type !== "spelling");
    if (!settings.checkPunctuation) errors = errors.filter((e) => e.type !== "punctuation");
    return { type: "CHECK_GRAMMAR_RESULT", requestId: request.requestId, errors, correctedText: cached.correctedText, chunked };
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
    if (chunked) {
      ({ parsed, errors } = await checkTextInChunks(text, settings, abortController.signal));
    } else {
      ({ parsed, errors } = await checkSingleText(text, settings, abortController.signal));
    }
  } finally {
    if (inflightAborts.get(requestScope) === abortController) {
      inflightAborts.delete(requestScope);
    }
  }

  errors = filterDerivedErrorsForLocalPunctuation(errors, localPunctuationErrors);
  errors = mergeLocalPunctuationErrors(errors, localPunctuationErrors);
  errors = filterModalProtectedErrors(errors, text);
  errors = mergeLocalGrammarErrors(errors, localGrammarErrors);
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
    chunked,
  };
}

async function checkSingleText(
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  signal?: AbortSignal
): Promise<{ parsed: ParsedResponse; errors: GrammarError[] }> {
  const localPunctuationErrors = settings.checkPunctuation ? findLocalPunctuationErrors(text) : [];
  const hasQuoteHeavyLocalPunctuation = hasQuoteRelatedLocalPunctuation(localPunctuationErrors);
  const prompt = buildGrammarCheckPrompt(text);
  let parsed = await callConfiguredProvider(
    settings,
    prompt.system,
    prompt.user,
    signal
  );

  let errors = validateErrors(parsed.errors, text);
  if (!hasQuoteHeavyLocalPunctuation && parsed.correctedText && parsed.correctedText !== text) {
    const derivedErrors = deriveErrorsFromCorrectedText(text, parsed.correctedText);
    if (errors.length === 0) {
      errors = derivedErrors;
    } else {
      errors = mergeSupplementalDerivedErrors(errors, derivedErrors, localPunctuationErrors);
    }
  }

  if (localPunctuationErrors.length === 0 && shouldRunHighRecallFallback(text, errors, parsed.correctedText)) {
    console.log("[AI Grammar Checker] Running high-recall recheck fallback");
    const fallbackPrompt = buildGrammarRecheckPrompt(text);
    const fallbackParsed = await callConfiguredProvider(
      settings,
      fallbackPrompt.system,
      fallbackPrompt.user,
      signal
    );
    let fallbackErrors = validateErrors(fallbackParsed.errors, text);
    if (
      !hasQuoteHeavyLocalPunctuation &&
      fallbackErrors.length === 0 &&
      fallbackParsed.correctedText &&
      fallbackParsed.correctedText !== text
    ) {
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

  const chunkResults = new Array<{ parsed: ParsedResponse; errors: GrammarError[] }>(chunks.length);

  for (let batchStart = 0; batchStart < chunks.length; batchStart += CHUNK_CONCURRENCY) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const batch = chunks
      .slice(batchStart, batchStart + CHUNK_CONCURRENCY)
      .map((chunk, offset) => ({ chunk, index: batchStart + offset }));

    const batchResults = await Promise.all(batch.map(async ({ chunk, index }) => ({
      index,
      result: await checkChunkWithCache(chunk, settings, signal),
    })));

    for (const { index, result } of batchResults) {
      chunkResults[index] = result;
    }
  }

  const mergedErrors: GrammarError[] = [];
  let correctedText = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkResult = chunkResults[i];
    if (!chunkResult) continue;

    mergedErrors.push(...chunkResult.errors.map((error) => ({
      ...error,
      offset: error.offset + chunk.start,
    })));
    correctedText += (chunkResult.parsed.correctedText && chunkResult.parsed.correctedText.trim().length > 0)
      ? chunkResult.parsed.correctedText
      : chunk.text;
  }

  const primaryMergedErrors = dedupeOverlappingErrors(mergedErrors);
  const normalizedCorrectedText = normalizeCorrectedText(text, correctedText);
  const validationErrors = deriveErrorsFromCorrectedText(text, normalizedCorrectedText);
  const additionalDerivedErrors = validationErrors.filter((validationError) =>
    !primaryMergedErrors.some((mergedError) => errorsEquivalent(mergedError, validationError))
  );
  if (additionalDerivedErrors.length > 0) {
    console.log(
      "[AI Grammar Checker] Chunk merge validation found additional derived errors:",
      additionalDerivedErrors.length,
      JSON.stringify(additionalDerivedErrors)
    );
  }

  return {
    parsed: {
      errors: primaryMergedErrors,
      correctedText: normalizedCorrectedText,
    },
    errors: primaryMergedErrors,
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
    punctuationRulesVersion: PUNCTUATION_RULES_VERSION,
  });
}

function buildChunkCacheKey(
  chunk: TextChunk,
  settings: Awaited<ReturnType<typeof getSettings>>
): string {
  return JSON.stringify({
    text: chunk.text,
    start: chunk.start,
    end: chunk.end,
    provider: settings.provider,
    openaiModel: settings.provider === "openai" ? DEFAULT_OPENAI_MODEL : undefined,
    grammar: settings.checkGrammar,
    spelling: settings.checkSpelling,
    punctuation: settings.checkPunctuation,
    promptVersion: PROMPT_CACHE_VERSION,
    punctuationRulesVersion: PUNCTUATION_RULES_VERSION,
  });
}

async function checkChunkWithCache(
  chunk: TextChunk,
  settings: Awaited<ReturnType<typeof getSettings>>,
  signal?: AbortSignal
): Promise<{ parsed: ParsedResponse; errors: GrammarError[] }> {
  const cacheKey = buildChunkCacheKey(chunk, settings);
  const cached = getCachedChunk(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await checkSingleText(chunk.text, settings, signal);
  setChunkCache(cacheKey, result.parsed, result.errors);
  return {
    parsed: cloneParsedResponse(result.parsed),
    errors: cloneErrors(result.errors),
  };
}

function mergeLocalPunctuationErrors(
  apiErrors: GrammarError[],
  localErrors: GrammarError[]
): GrammarError[] {
  if (localErrors.length === 0) return apiErrors;

  const merged = [...localErrors];

  for (const apiError of apiErrors) {
    const overlappedLocal = localErrors.find((localError) => rangesOverlap(localError, apiError));
    if (
      overlappedLocal &&
      (apiError.type === "punctuation" || apiError.suggestion === overlappedLocal.suggestion)
    ) {
      continue;
    }
    merged.push(apiError);
  }

  return merged.sort((a, b) => a.offset - b.offset);
}

function mergeLocalGrammarErrors(
  apiErrors: GrammarError[],
  localErrors: GrammarError[]
): GrammarError[] {
  if (localErrors.length === 0) return apiErrors;

  const merged = [...apiErrors];

  for (const localError of localErrors) {
    const alreadyCovered = apiErrors.some((e) => rangesOverlap(e, localError));
    if (!alreadyCovered) {
      merged.push(localError);
    }
  }

  return merged.sort((a, b) => a.offset - b.offset);
}

function filterModalProtectedErrors(
  errors: GrammarError[],
  text: string
): GrammarError[] {
  return errors.filter((error) => {
    if (!isVerbProtectedByModal(text, error.offset)) return true;
    // The word at this offset is in a modal context — reject suggestions
    // that try to conjugate it (add -s, -es, -ed)
    const suggestion = error.suggestion.toLowerCase();
    const original = error.original.toLowerCase();
    if (suggestion.endsWith("ed") && !original.endsWith("ed")) return false;
    if (suggestion.endsWith("s") && !suggestion.endsWith("ss") && !original.endsWith("s")) return false;
    return true;
  });
}

function filterDerivedErrorsForLocalPunctuation(
  apiErrors: GrammarError[],
  localErrors: GrammarError[]
): GrammarError[] {
  if (!hasQuoteRelatedLocalPunctuation(localErrors)) {
    return apiErrors;
  }

  return apiErrors.filter((error) => !isDerivedError(error));
}

function hasQuoteRelatedLocalPunctuation(errors: GrammarError[]): boolean {
  return errors.some((error) =>
    /quotation mark/i.test(error.explanation) || /["“”]/.test(`${error.original}${error.suggestion}`)
  );
}

function mergeSupplementalDerivedErrors(
  explicitErrors: GrammarError[],
  derivedErrors: GrammarError[],
  localErrors: GrammarError[]
): GrammarError[] {
  if (derivedErrors.length === 0) {
    return explicitErrors;
  }

  const merged = [...explicitErrors];
  for (const derivedError of derivedErrors) {
    if (!isSafeSupplementalDerivedError(derivedError)) continue;
    if (explicitErrors.some((error) => rangesOverlap(error, derivedError))) continue;
    if (localErrors.some((error) => rangesOverlap(error, derivedError))) continue;
    if (merged.some((error) => errorsEquivalent(error, derivedError))) continue;
    merged.push(derivedError);
  }

  return merged.sort((a, b) => a.offset - b.offset);
}

function isSafeSupplementalDerivedError(error: GrammarError): boolean {
  if (!isDerivedError(error)) {
    return true;
  }

  const combined = `${error.original}${error.suggestion}`;
  if (/["“”]/.test(combined)) {
    return false;
  }

  if (error.type === "punctuation") {
    return false;
  }

  if (/[.!?]/.test(combined)) {
    return false;
  }

  const originalWords = error.original.match(/[A-Za-z0-9']+/g) || [];
  const suggestionWords = error.suggestion.match(/[A-Za-z0-9']+/g) || [];
  if (originalWords.length === 0 || suggestionWords.length === 0) {
    return false;
  }

  if (originalWords.length > 2 || suggestionWords.length > 2) {
    return false;
  }

  if (/[,:;]/.test(combined)) {
    return false;
  }

  if (error.original.length > 24 || error.suggestion.length > 24) {
    return false;
  }

  if (originalWords.length === 1 && suggestionWords.length === 1) {
    return suggestionWords[0].length >= 2;
  }

  return true;
}

function rangesOverlap(a: GrammarError, b: GrammarError): boolean {
  const aEnd = a.offset + Math.max(a.length, 1);
  const bEnd = b.offset + Math.max(b.length, 1);
  return a.offset < bEnd && b.offset < aEnd;
}

function dedupeOverlappingErrors(errors: GrammarError[]): GrammarError[] {
  const deduped: GrammarError[] = [];

  for (const error of [...errors].sort((a, b) => a.offset - b.offset || a.length - b.length)) {
    if (deduped.some((existing) => errorsEquivalent(existing, error))) {
      continue;
    }
    deduped.push(error);
  }

  return deduped;
}

function errorsEquivalent(a: GrammarError, b: GrammarError): boolean {
  return (
    rangesOverlap(a, b) &&
    a.original === b.original &&
    a.suggestion === b.suggestion &&
    a.type === b.type
  );
}

function cloneParsedResponse(parsed: ParsedResponse): ParsedResponse {
  return {
    errors: cloneErrors(parsed.errors),
    correctedText: parsed.correctedText,
  };
}

function cloneErrors(errors: GrammarError[]): GrammarError[] {
  return errors.map((error) => ({ ...error }));
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
