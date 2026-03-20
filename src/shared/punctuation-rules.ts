import { GrammarError } from "./types.js";

interface Span {
  start: number;
  end: number;
}

export const PUNCTUATION_RULES_VERSION = "2026-03-20-v3";

const URL_RE = /\bhttps?:\/\/\S+/gi;
const EMAIL_RE = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g;
const DECIMAL_RE = /\b\d+\.\d+\b/g;

export function findLocalPunctuationErrors(text: string): GrammarError[] {
  const errors: GrammarError[] = [];
  const seen = new Set<string>();
  const exclusions = findExclusionSpans(text);

  for (const match of text.matchAll(/,\.|\.,/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      ".",
      "Remove the extraneous punctuation mark."
    );
  }

  for (const match of text.matchAll(/\.\.(?!\.)/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      ".",
      "Repeated terminal punctuation should be reduced to a single period."
    );
  }

  for (const match of text.matchAll(/([!?])\1+/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      match[1],
      "Repeated terminal punctuation should be reduced to a single mark."
    );
  }

  for (const match of text.matchAll(/(["“”])\1+/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      match[1],
      "Reduce repeated quotation marks to a single quotation mark."
    );
  }

  for (const match of text.matchAll(/(["”]),\s*(but|and|or|yet)\b/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (isLikelyOpeningQuote(text, start)) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `,${match[1]} ${match[2]}`,
      "Move the comma inside the closing quotation mark."
    );
  }

  for (const match of text.matchAll(/(["”])\s+(but|and|or|yet)\b/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (isLikelyOpeningQuote(text, start)) continue;
    if (start > 0 && text[start - 1] === ",") continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `,${match[1]} ${match[2]}`,
      "Add the comma inside the closing quotation mark before the conjunction."
    );
  }

  for (const match of text.matchAll(/,(["”])(but|and|or|yet)\b/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (isLikelyOpeningQuote(text, start + 1)) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `,${match[1]} ${match[2]}`,
      "Add a space after the closing quotation mark."
    );
  }

  for (const match of text.matchAll(/(["”])([.!?])(["”])(\s*)([A-Z])/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (isLikelyOpeningQuote(text, start)) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `${match[2]}${match[3]} ${match[5]}`,
      "Normalize the closing quotation punctuation."
    );
  }

  for (const match of text.matchAll(/([.!?])(["”])([.!?])(["”])(\s*)([A-Z])/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `${match[1]}${match[2]} ${match[6]}`,
      "Remove the duplicated closing punctuation around the quotation mark."
    );
  }

  for (const match of text.matchAll(/([^\s])(\s+)([,.!?;:])/g)) {
    const start = (match.index ?? -1) + match[1].length;
    if (start < 0) continue;
    if (match[2].includes("\n") || match[2].includes("\r")) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[2].length + 1,
      match[3],
      "Remove the space before the punctuation mark."
    );
  }

  for (const match of text.matchAll(/([.!?]["'”’)\]]*)([A-Z])/g)) {
    const full = match[0];
    const start = match.index ?? -1;
    if (start < 0) continue;
    const punctuationGroup = match[1];
    const nextChar = match[2];
    const punctuationStart = start + full.length - nextChar.length - punctuationGroup.length;
    const previousChar = punctuationStart > 0 ? text[punctuationStart - 1] : "";
    if (/\d/.test(previousChar)) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      punctuationStart,
      punctuationStart + punctuationGroup.length + nextChar.length,
      `${punctuationGroup} ${nextChar}`,
      "Add a space after the sentence-ending punctuation."
    );
  }

  for (const match of text.matchAll(/([,;:])(["“])[ \t]+([A-Za-z])/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (!isLikelyOpeningQuote(text, start + match[1].length)) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `${match[1]} ${match[2]}${match[3]}`,
      "Normalize the spacing around the opening quotation mark."
    );
  }

  for (const match of text.matchAll(/([,;:])(["“])(?=\S)/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (!isLikelyOpeningQuote(text, start + match[1].length)) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `${match[1]} ${match[2]}`,
      "Add a space before the opening quotation mark."
    );
  }

  for (const match of text.matchAll(/(["“])[ \t]+([A-Za-z])/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (!isLikelyOpeningQuote(text, start)) continue;
    pushError(
      errors,
      seen,
      exclusions,
      text,
      start,
      start + match[0].length,
      `${match[1]}${match[2]}`,
      "Remove the space after the opening quotation mark."
    );
  }

  return coalesceQuoteBoundaryErrors(errors).sort((a, b) => a.offset - b.offset);
}

function pushError(
  errors: GrammarError[],
  seen: Set<string>,
  exclusions: Span[],
  text: string,
  start: number,
  end: number,
  suggestion: string,
  explanation: string
): void {
  if (start < 0 || end <= start) return;
  if (overlapsExcludedSpan(start, end, exclusions)) return;

  const original = text.slice(start, end);
  if (!original || original === suggestion) return;

  const key = `${start}:${end - start}:${suggestion}`;
  if (seen.has(key)) return;
  seen.add(key);

  errors.push({
    original,
    suggestion,
    offset: start,
    length: end - start,
    type: "punctuation",
    explanation,
  });
}

function findExclusionSpans(text: string): Span[] {
  const spans: Span[] = [];

  for (const regex of [URL_RE, EMAIL_RE, DECIMAL_RE]) {
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? -1;
      if (start < 0) continue;
      spans.push({ start, end: start + match[0].length });
    }
  }

  return spans;
}

function overlapsExcludedSpan(start: number, end: number, exclusions: Span[]): boolean {
  return exclusions.some((span) => start < span.end && end > span.start);
}

function coalesceQuoteBoundaryErrors(errors: GrammarError[]): GrammarError[] {
  const sorted = [...errors].sort((a, b) => a.offset - b.offset || b.length - a.length);
  const merged: GrammarError[] = [];

  for (const error of sorted) {
    const overlappingIndex = merged.findIndex((existing) =>
      isQuoteBoundaryError(existing) &&
      isQuoteBoundaryError(error) &&
      rangesOverlap(existing, error)
    );

    if (overlappingIndex === -1) {
      merged.push(error);
      continue;
    }

    const existing = merged[overlappingIndex];
    if (shouldPreferQuoteBoundaryError(error, existing)) {
      merged[overlappingIndex] = error;
    }
  }

  return merged;
}

function isQuoteBoundaryError(error: GrammarError): boolean {
  return /quotation|quote/i.test(error.explanation) || /["“”]/.test(`${error.original}${error.suggestion}`);
}

function shouldPreferQuoteBoundaryError(candidate: GrammarError, existing: GrammarError): boolean {
  if (candidate.length !== existing.length) {
    return candidate.length > existing.length;
  }

  return candidate.suggestion.length > existing.suggestion.length;
}

function rangesOverlap(a: GrammarError, b: GrammarError): boolean {
  const aEnd = a.offset + Math.max(a.length, 1);
  const bEnd = b.offset + Math.max(b.length, 1);
  return a.offset < bEnd && b.offset < aEnd;
}

function isLikelyOpeningQuote(text: string, quoteIndex: number): boolean {
  const quoteChar = text[quoteIndex];
  if (quoteChar === "“") {
    return true;
  }

  const immediatePrevious = quoteIndex > 0 ? text[quoteIndex - 1] : "";
  if (!immediatePrevious) {
    return true;
  }

  if (/\s/.test(immediatePrevious)) {
    return true;
  }

  return /[([{<\-–—]/.test(immediatePrevious);
}
