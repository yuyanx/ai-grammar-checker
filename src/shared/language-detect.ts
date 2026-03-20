const NON_LATIN_REGEX = /[\u4E00-\u9FFF\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\uAC00-\uD7AF\u3040-\u30FF]/u;
const WORD_CHAR_REGEX = /[\p{L}\p{N}_]/u;
const ASCII_ALPHA_REGEX = /[A-Za-z]/;
const ENGLISH_FUNCTION_WORDS = ["the", "is", "and", "to", "of", "in", "a", "that", "it", "for"];

export function isLikelyEnglish(text: string): boolean {
  let wordChars = 0;
  let asciiAlpha = 0;
  let nonLatin = 0;

  for (const char of text) {
    if (WORD_CHAR_REGEX.test(char)) {
      wordChars += 1;
    }
    if (ASCII_ALPHA_REGEX.test(char)) {
      asciiAlpha += 1;
    }
    if (NON_LATIN_REGEX.test(char)) {
      nonLatin += 1;
    }
  }

  if (wordChars === 0) {
    return true;
  }

  if (nonLatin > 0 && nonLatin / wordChars > 0.15) {
    return false;
  }

  const asciiRatio = asciiAlpha / wordChars;
  if (text.length < 40) {
    return asciiRatio >= 0.7;
  }

  let functionWordMatches = 0;
  for (const word of ENGLISH_FUNCTION_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(text)) {
      functionWordMatches += 1;
    }
  }

  if (functionWordMatches < 2 && asciiRatio < 0.7) {
    return false;
  }

  return true;
}
