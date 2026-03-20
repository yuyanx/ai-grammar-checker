import { GrammarError } from "./types.js";

interface Span {
  start: number;
  end: number;
}

const URL_REGEX = /https?:\/\/\S+/g;
const EMAIL_REGEX = /\b\S+@\S+\.\S+\b/g;
const NUMBER_REGEX = /\b\d+\.\d+\b/g;
const DOMAIN_REGEX = /\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;
const FILE_PATH_REGEX = /(?:\b[A-Za-z]:)?(?:\/[^\s/]+)+/g;

function collectSpans(text: string, regex: RegExp): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(regex)) {
    const value = match[0];
    const start = match.index ?? 0;
    spans.push({ start, end: start + value.length });
  }
  return spans;
}

function overlapsSpan(start: number, end: number, spans: Span[]): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

function overlapsExisting(error: GrammarError, errors: GrammarError[]): boolean {
  const end = error.offset + error.length;
  return errors.some((existing) => {
    const existingEnd = existing.offset + existing.length;
    return error.offset < existingEnd && end > existing.offset;
  });
}

function addError(errors: GrammarError[], error: GrammarError, excludedSpans: Span[]): void {
  if (overlapsSpan(error.offset, error.offset + error.length, excludedSpans)) return;
  if (overlapsExisting(error, errors)) return;
  errors.push(error);
}

export function findLocalPunctuationErrors(text: string): GrammarError[] {
  const errors: GrammarError[] = [];
  const excludedSpans = [
    ...collectSpans(text, URL_REGEX),
    ...collectSpans(text, EMAIL_REGEX),
    ...collectSpans(text, NUMBER_REGEX),
    ...collectSpans(text, DOMAIN_REGEX),
    ...collectSpans(text, FILE_PATH_REGEX),
  ];

  for (const match of text.matchAll(/\.\.(?!\.)|\?\?(?!\?)|!!(?!\!)/g)) {
    const original = match[0];
    const offset = match.index ?? 0;
    addError(errors, {
      original,
      suggestion: original[0],
      offset,
      length: original.length,
      type: "punctuation",
      explanation: "Repeated terminal punctuation should be reduced to a single mark.",
    }, excludedSpans);
  }

  for (const match of text.matchAll(/,\.|\.,/g)) {
    const original = match[0];
    const offset = match.index ?? 0;
    addError(errors, {
      original,
      suggestion: ".",
      offset,
      length: original.length,
      type: "punctuation",
      explanation: "Use only a period here instead of conflicting comma-period punctuation.",
    }, excludedSpans);
  }

  for (const match of text.matchAll(/ +[,.;:]/g)) {
    const original = match[0];
    const offset = match.index ?? 0;
    const previousChar = offset > 0 ? text[offset - 1] : "";
    if (previousChar === "\n") continue;
    addError(errors, {
      original,
      suggestion: original.trimStart(),
      offset,
      length: original.length,
      type: "punctuation",
      explanation: "Remove the space before punctuation.",
    }, excludedSpans);
  }

  for (const match of text.matchAll(/[.,](?=[A-Za-z])/g)) {
    const offset = match.index ?? 0;
    addError(errors, {
      original: match[0],
      suggestion: `${match[0]} `,
      offset,
      length: 1,
      type: "punctuation",
      explanation: "Add a space after punctuation.",
    }, excludedSpans);
  }

  for (const match of text.matchAll(/ {2,}/g)) {
    const original = match[0];
    const offset = match.index ?? 0;
    const previousChar = offset > 0 ? text[offset - 1] : "";
    if (!previousChar || previousChar === "\n") continue;
    addError(errors, {
      original,
      suggestion: " ",
      offset,
      length: original.length,
      type: "punctuation",
      explanation: "Use a single space between words.",
    }, excludedSpans);
  }

  return errors.sort((a, b) => a.offset - b.offset);
}
