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
    const text = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return [];
    const parsed = JSON.parse(text);
    const errors = parsed.errors || parsed;
    if (!Array.isArray(errors)) return [];
    return errors;
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
