import { GrammarError } from "./types.js";

const MODALS = ["might", "could", "would", "should", "can", "may", "will", "shall", "must"];

// Words ending in -s/-es that are commonly nouns, not verbs
const NOUN_ALLOW_LIST = new Set([
  "address", "business", "process", "success", "access", "progress",
  "stress", "congress", "witness", "eness", "focus", "campus",
  "status", "bonus", "plus", "bus", "gas", "class", "mass",
  "ross", "loss", "boss", "cross", "dress", "press", "less",
  "analysis", "basis", "crisis", "thesis", "diagnosis",
  "results", "reports", "issues", "updates", "changes", "problems",
  "systems", "records", "numbers", "matters", "others", "members",
  "actions", "conditions", "questions", "reasons", "operations",
  "options", "standards", "resources", "services", "materials",
]);

/**
 * Detect modal parallel structure errors:
 * "might relate ... and needs" → "needs" should be "need"
 * After a modal, all coordinated verbs must use base form.
 */
export function findLocalGrammarErrors(text: string): GrammarError[] {
  const errors: GrammarError[] = [];
  const seen = new Set<string>();

  // Split into sentences to avoid cross-sentence false positives
  const sentences = text.split(/(?<=[.!?;])\s+/);
  let sentenceOffset = 0;

  for (const sentence of sentences) {
    findModalParallelErrors(sentence, sentenceOffset, errors, seen);
    sentenceOffset += sentence.length + (text[sentenceOffset + sentence.length] === " " ? 1 : 0);
    // Advance past the whitespace that split created
    while (sentenceOffset < text.length && /\s/.test(text[sentenceOffset])) {
      sentenceOffset++;
    }
  }

  return errors;
}

function findModalParallelErrors(
  sentence: string,
  baseOffset: number,
  errors: GrammarError[],
  seen: Set<string>
): void {
  const lower = sentence.toLowerCase();

  for (const modal of MODALS) {
    const modalPattern = new RegExp(`\\b${modal}\\s+(\\w+)`, "gi");

    for (const modalMatch of sentence.matchAll(modalPattern)) {
      const modalEnd = (modalMatch.index ?? 0) + modalMatch[0].length;
      const verbAfterModal = modalMatch[1].toLowerCase();

      // The verb right after modal should be base form — skip if it's conjugated
      // (that's a different error, not parallel structure)
      if (isConjugatedVerb(verbAfterModal)) continue;

      // Now look for "and <verb>" patterns after this modal clause
      const rest = sentence.slice(modalEnd);
      const andPattern = /\band\s+(\w+)\b/gi;

      for (const andMatch of rest.matchAll(andPattern)) {
        const wordAfterAnd = andMatch[1];
        const wordLower = wordAfterAnd.toLowerCase();

        // Must be a conjugated verb (ends in -s/-es/-ed), not base form
        if (!isConjugatedVerb(wordLower)) continue;

        // Skip if it's a known noun
        if (NOUN_ALLOW_LIST.has(wordLower)) continue;

        // Skip short words that are ambiguous
        if (wordLower.length < 4) continue;

        // Compute the base form suggestion
        const baseForms = getBaseForms(wordLower);
        if (baseForms.length === 0) continue;

        const absoluteOffset = baseOffset + modalEnd + (andMatch.index ?? 0) + andMatch[0].indexOf(wordAfterAnd);
        const key = `${absoluteOffset}:${wordAfterAnd.length}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Verify the offset matches the original text
        errors.push({
          original: wordAfterAnd,
          suggestion: baseForms[0],
          offset: absoluteOffset,
          length: wordAfterAnd.length,
          type: "grammar",
          explanation: `Use base form '${baseForms[0]}' to match the modal '${modal}' shared across the coordinated verbs.`,
        });
      }
    }
  }
}

function isConjugatedVerb(word: string): boolean {
  // Third person -s (needs, wants, goes)
  if (word.endsWith("s") && !word.endsWith("ss") && word.length >= 4) {
    return true;
  }
  // Past tense -ed (needed, wanted)
  if (word.endsWith("ed") && word.length >= 5) {
    return true;
  }
  return false;
}

function getBaseForms(conjugated: string): string[] {
  // -ies → -y (carries → carry)
  if (conjugated.endsWith("ies")) {
    return [conjugated.slice(0, -3) + "y"];
  }
  // -es → remove -es (goes → go, addresses → address)
  if (conjugated.endsWith("es") && conjugated.length >= 5) {
    return [conjugated.slice(0, -2), conjugated.slice(0, -1)];
  }
  // -s → remove -s (needs → need)
  if (conjugated.endsWith("s") && !conjugated.endsWith("ss")) {
    return [conjugated.slice(0, -1)];
  }
  // -ed → remove -ed (needed → need)
  if (conjugated.endsWith("ed")) {
    return [conjugated.slice(0, -2), conjugated.slice(0, -1)];
  }
  return [];
}
