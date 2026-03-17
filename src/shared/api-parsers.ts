import { GrammarError } from "./types.js";

export function parseOpenAIResponse(responseJson: any): GrammarError[] {
  try {
    const content = responseJson.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content);
    const errors = parsed.errors || parsed;
    if (!Array.isArray(errors)) return [];
    return errors;
  } catch {
    return [];
  }
}

export function parseGeminiResponse(responseJson: any): GrammarError[] {
  try {
    const parts = responseJson.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) return [];

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
        if (Array.isArray(errors)) return errors;
      } catch {
        // not valid JSON, try next part
      }
    }
    return [];
  } catch {
    return [];
  }
}

export function validateErrors(
  errors: any[],
  originalText: string
): GrammarError[] {
  const validated: GrammarError[] = [];

  for (const err of errors) {
    if (
      !err.original ||
      !err.suggestion ||
      typeof err.type !== "string" ||
      !["grammar", "spelling", "punctuation"].includes(err.type)
    ) {
      continue;
    }

    let offset = typeof err.offset === "number" ? err.offset : -1;
    const length = err.original.length;

    // Verify the offset matches
    if (
      offset >= 0 &&
      originalText.substring(offset, offset + length) === err.original
    ) {
      validated.push({
        original: err.original,
        suggestion: err.suggestion,
        offset,
        length,
        type: err.type,
        explanation: err.explanation || "",
      });
      continue;
    }

    // Fallback: find by indexOf
    const foundIndex = originalText.indexOf(err.original);
    if (foundIndex >= 0) {
      validated.push({
        original: err.original,
        suggestion: err.suggestion,
        offset: foundIndex,
        length,
        type: err.type,
        explanation: err.explanation || "",
      });
    }
    // If neither works, silently drop this error
  }

  return validated;
}
