import { GrammarError } from "./types.js";

export interface ParsedResponse {
  errors: GrammarError[];
  correctedText?: string;
}

export function parseOpenAIResponse(responseJson: any): ParsedResponse {
  try {
    const content = responseJson.choices?.[0]?.message?.content;
    if (!content) return { errors: [] };
    const parsed = JSON.parse(content);
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
      try {
        const parsed = JSON.parse(text);
        const errors = parsed.errors || parsed;
        if (Array.isArray(errors)) {
          return {
            errors,
            correctedText: typeof parsed.correctedText === "string" ? parsed.correctedText : undefined,
          };
        }
      } catch {
        // not valid JSON, try next part
      }
    }
    return { errors: [] };
  } catch {
    return { errors: [] };
  }
}

export function validateErrors(
  errors: any[],
  originalText: string
): GrammarError[] {
  const validated: GrammarError[] = [];
  const usedOffsets = new Set<string>();

  for (const err of errors) {
    if (
      !err.suggestion ||
      typeof err.type !== "string" ||
      !["grammar", "spelling", "punctuation"].includes(err.type)
    ) {
      continue;
    }

    // Handle missing-punctuation insertion errors (empty original)
    if (!err.original || err.original === err.suggestion) {
      continue;
    }

    let offset = typeof err.offset === "number" ? err.offset : -1;
    const length = err.original.length;

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
          type: err.type,
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
          type: err.type,
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
