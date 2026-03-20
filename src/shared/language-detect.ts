const NON_LATIN_RE = /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/g;
const LATIN_LETTER_RE = /[A-Za-z\u00C0-\u024F]/g;
const ASCII_LETTER_RE = /[A-Za-z]/g;
const FUNCTION_WORD_RE = /\b(the|is|and|to|of|in|a|that|it|for)\b/gi;

export function isLikelyEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const nonLatinCount = countMatches(trimmed, NON_LATIN_RE);
  const latinLetterCount = countMatches(trimmed, LATIN_LETTER_RE);
  const asciiLetterCount = countMatches(trimmed, ASCII_LETTER_RE);
  const scriptCharCount = Math.max(nonLatinCount + latinLetterCount, 1);

  if (nonLatinCount > 0 && nonLatinCount / scriptCharCount > 0.15) {
    return false;
  }

  const asciiRatio = asciiLetterCount / scriptCharCount;
  if (trimmed.length < 40) {
    return asciiRatio >= 0.7 || nonLatinCount === 0;
  }

  const functionWordCount = countMatches(trimmed, FUNCTION_WORD_RE);
  if (functionWordCount < 2 && asciiRatio < 0.7) {
    return false;
  }

  return true;
}

function countMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}
