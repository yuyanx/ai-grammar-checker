import { GrammarError } from "./types.js";

export interface ParsedResponse {
  errors: GrammarError[];
  correctedText?: string;
}

interface OriginalToken {
  text: string;
  start: number;
  end: number;
}

export function parseOpenAIResponse(responseJson: any): ParsedResponse {
  try {
    const content = getOpenAIContent(responseJson);
    const parsed = parseJsonPayload(content);
    if (!parsed) return { errors: [] };
    const errors = parsed.errors || parsed;
    if (!Array.isArray(errors)) return { errors: [] };
    return {
      errors,
      correctedText: typeof parsed.correctedText === "string" ? parsed.correctedText : undefined,
    };
  } catch {
    return { errors: [] };
  }
}

export function parseGeminiResponse(responseJson: any): ParsedResponse {
  try {
    const parts = responseJson.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) return { errors: [] };

    // Gemini 2.5 models may include "thought" parts before the actual response.
    // Find the last non-thought part that contains the JSON output.
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part.thought) continue; // skip thinking parts
      const text = part.text;
      if (!text) continue;
      const parsed = parseJsonPayload(text);
      if (!parsed) continue;
      const errors = parsed.errors || parsed;
      if (Array.isArray(errors)) {
        return {
          errors,
          correctedText: typeof parsed.correctedText === "string" ? parsed.correctedText : undefined,
        };
      }
    }
    return { errors: [] };
  } catch {
    return { errors: [] };
  }
}

function getOpenAIContent(responseJson: any): string {
  const content = responseJson.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function parseJsonPayload(raw: string): any | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, ""),
  ];

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function validateErrors(
  errors: any[],
  originalText: string
): GrammarError[] {
  const validated: GrammarError[] = [];
  const usedOffsets = new Set<string>();

  for (const err of errors) {
    const normalizedType = normalizeErrorType(err.type);

    if (!err.suggestion || !normalizedType) {
      continue;
    }

    if (typeof err.original !== "string" || err.original === err.suggestion) {
      continue;
    }

    let offset = typeof err.offset === "number" ? err.offset : -1;
    const length = err.original.length;

    if (length === 0) {
      const insertionOffset = resolveInsertionOffset(err, originalText);
      if (insertionOffset < 0) continue;

      const key = `${insertionOffset}:0:${err.suggestion}`;
      if (!usedOffsets.has(key)) {
        usedOffsets.add(key);
        validated.push({
          original: "",
          suggestion: err.suggestion,
          offset: insertionOffset,
          length: 0,
          type: normalizedType,
          explanation: err.explanation || "",
        });
      }
      continue;
    }

    // Verify the offset matches
    if (
      offset >= 0 &&
      originalText.substring(offset, offset + length) === err.original
    ) {
      // Skip if the suggestion is already applied at this position
      // (e.g. "doing" → "doing?" when text already has "doing?")
      // Only skip when the suggestion is longer than the original (insertion/append),
      // to avoid false positives like "your" starts with "you"
      if (
        err.suggestion.length > err.original.length &&
        originalText.substring(offset, offset + err.suggestion.length) === err.suggestion
      ) {
        continue;
      }
      const key = `${offset}:${length}`;
      if (!usedOffsets.has(key)) {
        usedOffsets.add(key);
        validated.push({
          original: err.original,
          suggestion: err.suggestion,
          offset,
          length,
          type: normalizedType,
          explanation: err.explanation || "",
        });
      }
      continue;
    }

    // Fallback: find by indexOf (try all occurrences to avoid duplicates)
    let searchFrom = 0;
    let found = false;
    while (!found) {
      const foundIndex = originalText.indexOf(err.original, searchFrom);
      if (foundIndex < 0) break;
      // Skip if the suggestion is already applied at this position
      if (
        err.suggestion.length > err.original.length &&
        originalText.substring(foundIndex, foundIndex + err.suggestion.length) === err.suggestion
      ) {
        searchFrom = foundIndex + 1;
        continue;
      }
      const key = `${foundIndex}:${length}`;
      if (!usedOffsets.has(key)) {
        usedOffsets.add(key);
        validated.push({
          original: err.original,
          suggestion: err.suggestion,
          offset: foundIndex,
          length,
          type: normalizedType,
          explanation: err.explanation || "",
        });
        found = true;
      }
      searchFrom = foundIndex + 1;
    }
    // If neither works, silently drop this error
  }

  return validated;
}

export function deriveErrorsFromCorrectedText(
  originalText: string,
  correctedText?: string
): GrammarError[] {
  if (!correctedText || correctedText === originalText) {
    return [];
  }

  const originalTokens = tokenizeOriginal(originalText);
  const correctedTokens = tokenizeCorrected(correctedText);

  if (originalTokens.length === 0 || correctedTokens.length === 0) {
    return buildSingleReplacement(originalText, correctedText);
  }

  const derived: GrammarError[] = [];
  let i = 0;
  let j = 0;

  while (i < originalTokens.length && j < correctedTokens.length) {
    if (originalTokens[i].text === correctedTokens[j]) {
      i++;
      j++;
      continue;
    }

    const match = findResync(originalTokens, correctedTokens, i, j);
    const nextI = match?.originalIndex ?? originalTokens.length;
    const nextJ = match?.correctedIndex ?? correctedTokens.length;

    const error = buildReplacementError(
      originalText,
      originalTokens.slice(i, nextI),
      correctedTokens.slice(j, nextJ)
    );
    if (error) derived.push(error);

    i = nextI;
    j = nextJ;
  }

  if (i < originalTokens.length || j < correctedTokens.length) {
    const tail = buildReplacementError(
      originalText,
      originalTokens.slice(i),
      correctedTokens.slice(j)
    );
    if (tail) derived.push(tail);
  }

  return filterUnstableDerivedPunctuation(
    mergeAdjacentDerivedErrors(derived, originalText)
  );
}

function normalizeErrorType(rawType: unknown): GrammarError["type"] | null {
  if (typeof rawType !== "string") return null;

  const normalized = rawType.trim().toLowerCase().replace(/[\s-]+/g, "_");

  const aliasMap: Record<string, GrammarError["type"]> = {
    grammar: "grammar",
    capitalization: "grammar",
    capitalisation: "grammar",
    case: "grammar",
    word_choice: "grammar",
    wrong_word: "grammar",
    usage: "grammar",
    verb_tense: "grammar",
    tense: "grammar",
    agreement: "grammar",
    subject_verb_agreement: "grammar",
    article: "grammar",
    articles: "grammar",
    preposition: "grammar",
    prepositions: "grammar",
    pronoun: "grammar",
    pronouns: "grammar",
    word_form: "grammar",
    conjugation: "grammar",
    pluralization: "grammar",
    pluralisation: "grammar",
    singular_plural: "grammar",
    missing_word: "grammar",
    extra_word: "grammar",
    fragment: "grammar",
    run_on: "grammar",
    spelling: "spelling",
    typo: "spelling",
    misspelling: "spelling",
    misspelled_word: "spelling",
    punctuation: "punctuation",
    punct: "punctuation",
    comma: "punctuation",
    apostrophe: "punctuation",
    quotation: "punctuation",
    quote: "punctuation",
    end_punctuation: "punctuation",
    sentence_end: "punctuation",
    question_mark: "punctuation",
    exclamation_mark: "punctuation",
  };

  return aliasMap[normalized] ?? null;
}

function resolveInsertionOffset(err: any, originalText: string): number {
  if (typeof err.offset === "number" && err.offset >= 0 && err.offset <= originalText.length) {
    return err.offset;
  }

  if (typeof err.suggestion !== "string" || !err.suggestion) {
    return -1;
  }

  const firstChar = err.suggestion[0];
  if (!firstChar) return -1;

  const matchIndex = originalText.indexOf(firstChar);
  if (matchIndex > 0) {
    return matchIndex;
  }

  return originalText.length;
}

function tokenizeOriginal(text: string): OriginalToken[] {
  const regex = /\s+|[A-Za-z0-9']+|[^\sA-Za-z0-9']/g;
  const tokens: OriginalToken[] = [];

  for (const match of text.matchAll(regex)) {
    const value = match[0];
    const index = match.index ?? 0;
    tokens.push({
      text: value,
      start: index,
      end: index + value.length,
    });
  }

  return tokens;
}

function tokenizeCorrected(text: string): string[] {
  return Array.from(text.match(/\s+|[A-Za-z0-9']+|[^\sA-Za-z0-9']/g) || []);
}

function findResync(
  originalTokens: OriginalToken[],
  correctedTokens: string[],
  originalIndex: number,
  correctedIndex: number
): { originalIndex: number; correctedIndex: number } | null {
  const LOOKAHEAD = 12;
  let best: { originalIndex: number; correctedIndex: number; cost: number } | null = null;

  for (
    let oi = originalIndex;
    oi < Math.min(originalTokens.length, originalIndex + LOOKAHEAD);
    oi++
  ) {
    for (
      let cj = correctedIndex;
      cj < Math.min(correctedTokens.length, correctedIndex + LOOKAHEAD);
      cj++
    ) {
      if (originalTokens[oi].text !== correctedTokens[cj]) continue;
      const cost = (oi - originalIndex) + (cj - correctedIndex);
      if (!best || cost < best.cost) {
        best = { originalIndex: oi, correctedIndex: cj, cost };
      }
    }
  }

  return best
    ? { originalIndex: best.originalIndex, correctedIndex: best.correctedIndex }
    : null;
}

function buildReplacementError(
  originalText: string,
  originalTokens: OriginalToken[],
  correctedTokens: string[]
): GrammarError | null {
  if (originalTokens.length === 0) return null;

  let startIndex = 0;
  let endIndex = originalTokens.length - 1;
  let correctedStart = 0;
  let correctedEnd = correctedTokens.length - 1;

  while (
    startIndex <= endIndex &&
    correctedStart <= correctedEnd &&
    originalTokens[startIndex].text === correctedTokens[correctedStart]
  ) {
    startIndex++;
    correctedStart++;
  }

  while (
    endIndex >= startIndex &&
    correctedEnd >= correctedStart &&
    originalTokens[endIndex].text === correctedTokens[correctedEnd]
  ) {
    endIndex--;
    correctedEnd--;
  }

  if (startIndex > endIndex && correctedStart > correctedEnd) {
    return null;
  }

  const slice = originalTokens.slice(startIndex, endIndex + 1);
  if (slice.length === 0) return null;

  const offset = slice[0].start;
  const end = slice[slice.length - 1].end;
  const original = originalText.slice(offset, end);
  const suggestion = correctedTokens.slice(correctedStart, correctedEnd + 1).join("");

  if (!original || original === suggestion) {
    return null;
  }

  return {
    original,
    suggestion,
    offset,
    length: original.length,
    type: classifyDerivedErrorType(original, suggestion),
    explanation: "Derived from the corrected text returned by the AI.",
  };
}

function buildSingleReplacement(originalText: string, correctedText: string): GrammarError[] {
  const prefixLength = commonPrefixLength(originalText, correctedText);
  const suffixLength = commonSuffixLength(
    originalText.slice(prefixLength),
    correctedText.slice(prefixLength)
  );
  const original = originalText.slice(prefixLength, originalText.length - suffixLength);
  const suggestion = correctedText.slice(prefixLength, correctedText.length - suffixLength);

  if (!original || original === suggestion) return [];

  return [{
    original,
    suggestion,
    offset: prefixLength,
    length: original.length,
    type: classifyDerivedErrorType(original, suggestion),
    explanation: "Derived from the corrected text returned by the AI.",
  }];
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++;
  }
  return i;
}

function classifyDerivedErrorType(
  original: string,
  suggestion: string
): GrammarError["type"] {
  const stripWordChars = (value: string) => value.replace(/[A-Za-z0-9\s]/g, "");
  const lowerOriginal = original.toLowerCase();
  const lowerSuggestion = suggestion.toLowerCase();

  if (
    lowerOriginal.replace(/[^\w]/g, "") === lowerSuggestion.replace(/[^\w]/g, "") &&
    stripWordChars(original) !== stripWordChars(suggestion)
  ) {
    return "punctuation";
  }

  const originalWords = lowerOriginal.match(/[a-z0-9']+/g) || [];
  const suggestionWords = lowerSuggestion.match(/[a-z0-9']+/g) || [];
  if (
    originalWords.length === suggestionWords.length &&
    originalWords.length === 1 &&
    editDistance(originalWords[0], suggestionWords[0]) <= 2
  ) {
    return "spelling";
  }

  return "grammar";
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function mergeAdjacentDerivedErrors(
  errors: GrammarError[],
  originalText: string
): GrammarError[] {
  if (errors.length <= 1) return errors;

  const merged: GrammarError[] = [];
  for (const error of errors.sort((a, b) => a.offset - b.offset)) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(error);
      continue;
    }

    const previousEnd = previous.offset + previous.length;
    if (error.offset - previousEnd > 1) {
      merged.push(error);
      continue;
    }

    const mergedEnd = error.offset + error.length;
    const between = originalText.slice(previousEnd, error.offset);
    const mergedOriginal = originalText.slice(previous.offset, mergedEnd);
    previous.suggestion = previous.suggestion + between + error.suggestion;
    previous.original = mergedOriginal;
    previous.length = mergedOriginal.length;
    previous.type = previous.type === error.type ? previous.type : "grammar";
  }

  return merged;
}

function filterUnstableDerivedPunctuation(errors: GrammarError[]): GrammarError[] {
  return errors.filter((error) => {
    if (error.explanation !== "Derived from the corrected text returned by the AI.") {
      return true;
    }
    if (error.type !== "punctuation") {
      return true;
    }

    const originalWord = error.original.replace(/[^A-Za-z0-9']/g, "");
    const suggestionWord = error.suggestion.replace(/[^A-Za-z0-9']/g, "");
    if (!originalWord || originalWord !== suggestionWord) {
      return true;
    }

    const originalMarks = error.original.replace(/[A-Za-z0-9'\s]/g, "");
    const suggestionMarks = error.suggestion.replace(/[A-Za-z0-9'\s]/g, "");

    // Derived punctuation-only toggles around the same word are too unstable for Fix All.
    // Keep them out of the list and rely on authoritative model-returned errors instead.
    return originalMarks === suggestionMarks;
  });
}
