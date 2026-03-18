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
