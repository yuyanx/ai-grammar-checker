import { GrammarError } from "./types.js";

interface Span {
  start: number;
  end: number;
}

export const PUNCTUATION_RULES_VERSION = "2026-03-19-v1";

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

  return errors.sort((a, b) => a.offset - b.offset);
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
