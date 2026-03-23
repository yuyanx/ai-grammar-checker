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

  const sentences = text.split(/(?<=[.!?;])\s+/);
  let sentenceOffset = 0;

  for (const sentence of sentences) {
    findModalParallelErrors(sentence, sentenceOffset, errors, seen);
    findCompoundSubjectWasErrors(sentence, sentenceOffset, errors, seen);
    sentenceOffset += sentence.length;
    while (sentenceOffset < text.length && /\s/.test(text[sentenceOffset])) {
      sentenceOffset++;
    }
  }

  // If text signals present tense, catch past progressive ("was/were + -ing")
  const textSignals = countTextTenseSignals(text);
  if (textSignals.present >= 3 && textSignals.past === 0) {
    findPastProgressiveInPresentText(text, errors, seen);
  }

  return errors;
}

/**
 * Check if a word at the given offset is in a modal verb phrase context
 * (directly after a modal, or coordinated via "and" with a modal verb).
 * Such words must be base form and should not be changed to conjugated forms.
 */
export function isVerbProtectedByModal(text: string, offset: number): boolean {
  // Find the sentence containing this offset
  const sentences = text.split(/(?<=[.!?;])\s+/);
  let sentenceOffset = 0;
  let sentence = "";

  for (const s of sentences) {
    if (offset >= sentenceOffset && offset < sentenceOffset + s.length) {
      sentence = s;
      break;
    }
    sentenceOffset += s.length;
    while (sentenceOffset < text.length && /\s/.test(text[sentenceOffset])) {
      sentenceOffset++;
    }
  }

  if (!sentence) return false;

  const localOffset = offset - sentenceOffset;
  const lower = sentence.toLowerCase();

  for (const modal of MODALS) {
    const modalPattern = new RegExp(`\\b${modal}\\s+(\\w+)`, "gi");

    for (const modalMatch of lower.matchAll(modalPattern)) {
      const modalEnd = (modalMatch.index ?? 0) + modalMatch[0].length;
      const verbAfterModal = modalMatch[1];

      // Check if the target offset is the verb directly after the modal
      // (protect regardless of whether it's currently conjugated or base form)
      const verbStart = (modalMatch.index ?? 0) + modal.length + (modalMatch[0].length - modal.length - verbAfterModal.length);
      if (localOffset === verbStart) return true;

      // Check if the target offset is after "and" coordinated with this modal phrase
      const rest = lower.slice(modalEnd);
      const andPattern = /\band\s+(\w+)\b/gi;

      for (const andMatch of rest.matchAll(andPattern)) {
        const wordStart = modalEnd + (andMatch.index ?? 0) + andMatch[0].indexOf(andMatch[1]);
        if (localOffset === wordStart) return true;
      }
    }
  }

  return false;
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

/**
 * Detect compound subject + "which was" agreement errors:
 * "burgers and fries, which was" → "which were"
 * When "which" refers to a compound noun phrase joined by "and",
 * the verb should be plural "were", not singular "was".
 */
function findCompoundSubjectWasErrors(
  sentence: string,
  baseOffset: number,
  errors: GrammarError[],
  seen: Set<string>
): void {
  // Match: [word] and [word][,] which was
  const pattern = /\b(\w+)\s+and\s+(\w+)\s*,?\s*which\s+(was)\b/gi;

  for (const match of sentence.matchAll(pattern)) {
    const wasGroup = match[3];
    const wasStart = (match.index ?? 0) + match[0].lastIndexOf(wasGroup);
    const absoluteOffset = baseOffset + wasStart;

    const key = `${absoluteOffset}:${wasGroup.length}`;
    if (seen.has(key)) continue;
    seen.add(key);

    errors.push({
      original: wasGroup,
      suggestion: "were",
      offset: absoluteOffset,
      length: wasGroup.length,
      type: "grammar",
      explanation: "Compound subject joined by 'and' requires plural verb 'were'.",
    });
  }
}

/**
 * When the text's dominant tense is present, "was/were [verb]ing" should
 * be "is/are [verb]ing" — not just an agreement fix but a tense fix.
 */
function findPastProgressiveInPresentText(
  text: string,
  errors: GrammarError[],
  seen: Set<string>
): void {
  // Match "was/were [verb]ing" patterns
  const pattern = /\b(was|were)\s+(\w+ing)\b/gi;

  for (const match of text.matchAll(pattern)) {
    const wasWere = match[1];
    const offset = match.index ?? 0;
    const key = `${offset}:${wasWere.length}`;
    if (seen.has(key)) continue;

    // Determine correct present progressive form based on preceding subject
    const before = text.slice(0, offset).trimEnd().toLowerCase();
    const lastWord = before.match(/(\w+)$/)?.[1] ?? "";

    let suggestion: string;
    if (["they", "we", "you"].includes(lastWord)) {
      suggestion = "are";
    } else if (["he", "she", "it"].includes(lastWord)) {
      suggestion = "is";
    } else {
      // For noun subjects, check if the "was" form suggests singular or plural
      // "They was playing" → "They are playing"
      // Default to "are" for "were", "is" for "was" (preserving number intent)
      suggestion = wasWere.toLowerCase() === "was" ? "is" : "are";
    }

    seen.add(key);
    errors.push({
      original: wasWere,
      suggestion,
      offset,
      length: wasWere.length,
      type: "grammar",
      explanation: `Use present progressive '${suggestion} ${match[2]}' to match the present tense of the surrounding text.`,
    });
  }
}

// ── Tense normalization ──────────────────────────────────────────────
// When the AI's corrections mix present and past tense (common in chunked
// checks), normalize minority-direction verb suggestions to match the majority.

const TENSE_PAIRS: Array<{ present: string; past: string }> = [
  { present: "goes", past: "went" },
  { present: "plays", past: "played" },
  { present: "tells", past: "told" },
  { present: "gets", past: "got" },
  { present: "feels", past: "felt" },
  { present: "starts", past: "started" },
  { present: "brings", past: "brought" },
  { present: "wants", past: "wanted" },
  { present: "learns", past: "learned" },
  { present: "knows", past: "knew" },
  { present: "comes", past: "came" },
  { present: "takes", past: "took" },
  { present: "makes", past: "made" },
  { present: "sees", past: "saw" },
  { present: "gives", past: "gave" },
  { present: "finds", past: "found" },
  { present: "thinks", past: "thought" },
  { present: "says", past: "said" },
  { present: "does", past: "did" },
  { present: "has", past: "had" },
  { present: "runs", past: "ran" },
  { present: "reads", past: "read" },
  { present: "writes", past: "wrote" },
  { present: "tries", past: "tried" },
  { present: "asks", past: "asked" },
  { present: "needs", past: "needed" },
  { present: "helps", past: "helped" },
  { present: "stops", past: "stopped" },
  { present: "looks", past: "looked" },
  { present: "walks", past: "walked" },
  { present: "talks", past: "talked" },
  { present: "eats", past: "ate" },
  { present: "sits", past: "sat" },
  { present: "stands", past: "stood" },
  { present: "leaves", past: "left" },
  { present: "keeps", past: "kept" },
  { present: "meets", past: "met" },
  { present: "sleeps", past: "slept" },
  { present: "sends", past: "sent" },
  { present: "builds", past: "built" },
  { present: "buys", past: "bought" },
  { present: "catches", past: "caught" },
  { present: "chooses", past: "chose" },
  { present: "drives", past: "drove" },
  { present: "falls", past: "fell" },
  { present: "grows", past: "grew" },
  { present: "holds", past: "held" },
  { present: "loses", past: "lost" },
  { present: "pays", past: "paid" },
  { present: "shows", past: "showed" },
  { present: "speaks", past: "spoke" },
  { present: "teaches", past: "taught" },
  { present: "throws", past: "threw" },
  { present: "understands", past: "understood" },
  { present: "wins", past: "won" },
  { present: "wears", past: "wore" },
  { present: "explains", past: "explained" },
  { present: "lives", past: "lived" },
  { present: "opens", past: "opened" },
  { present: "closes", past: "closed" },
  { present: "works", past: "worked" },
  { present: "calls", past: "called" },
  { present: "moves", past: "moved" },
  { present: "turns", past: "turned" },
  { present: "puts", past: "put" },
  { present: "hits", past: "hit" },
  { present: "cuts", past: "cut" },
  { present: "lets", past: "let" },
  { present: "hears", past: "heard" },
  { present: "breaks", past: "broke" },
  { present: "spends", past: "spent" },
  { present: "rises", past: "rose" },
  { present: "draws", past: "drew" },
  { present: "lies", past: "lay" },
  // Contractions
  { present: "doesn't", past: "didn't" },
];

// Build fast lookup maps
const presentToInfo = new Map<string, { direction: "present"; flipped: string }>();
const pastToInfo = new Map<string, { direction: "past"; flipped: string }>();
for (const pair of TENSE_PAIRS) {
  presentToInfo.set(pair.present, { direction: "present", flipped: pair.past });
  pastToInfo.set(pair.past, { direction: "past", flipped: pair.present });
}

function classifySuggestionTense(suggestion: string): { direction: "present" | "past"; flipped: string } | null {
  const lower = suggestion.toLowerCase();
  return presentToInfo.get(lower) ?? pastToInfo.get(lower) ?? null;
}

/**
 * Filter corrections that change correct subject-verb agreement to wrong agreement.
 * E.g., reject "were" → "was" when preceded by plural subject "They/We/You".
 */
export function filterBadAgreementCorrections(errors: GrammarError[], text: string): GrammarError[] {
  const PLURAL_SUBJECTS = new Set(["they", "we", "you"]);

  return errors.filter((error) => {
    const orig = error.original.toLowerCase();
    const sugg = error.suggestion.toLowerCase();

    // Reject "were" → "was" after plural subject
    if (orig === "were" && sugg === "was") {
      const before = text.slice(0, error.offset).trimEnd().toLowerCase();
      const lastWord = before.match(/(\w+)$/)?.[1];
      if (lastWord && PLURAL_SUBJECTS.has(lastWord)) {
        console.log(
          `[AI Grammar Checker] Filtering bad agreement: "${orig}" → "${sugg}" (plural subject "${lastWord}" requires "were")`
        );
        return false;
      }
    }

    return true;
  });
}

// Base-form verbs used for text-level tense signal detection
const BASE_FORM_VERBS = new Set([
  "go", "play", "tell", "get", "feel", "start", "bring", "want", "learn",
  "know", "come", "take", "make", "see", "give", "find", "think", "say",
  "do", "have", "run", "read", "write", "try", "ask", "need", "help",
  "stop", "look", "walk", "talk", "eat", "sit", "stand", "leave", "keep",
  "meet", "sleep", "send", "open", "close", "work", "call", "move", "turn",
  "put", "hit", "cut", "let", "hear", "break", "spend", "rise", "draw",
  "lie", "explain", "live", "buy", "catch", "choose", "drive", "fall",
  "grow", "hold", "lose", "pay", "show", "speak", "teach", "throw",
  "understand", "win", "wear",
]);

/**
 * Count tense signals from the original text.
 * "3rd person subject + base form verb" = strong present-tense signal
 * (the writer meant present tense but has an agreement error).
 */
function countTextTenseSignals(text: string): { present: number; past: number } {
  let present = 0;
  const past = 0;
  const lower = text.toLowerCase();

  // Match 3rd person singular subjects followed by a base-form verb
  const pattern = /\b(he|she|it|the\s+\w+|his\s+\w+|her\s+\w+)\s+(\w+)\b/gi;
  for (const match of lower.matchAll(pattern)) {
    const verb = match[2];
    if (BASE_FORM_VERBS.has(verb)) present++;
  }

  return { present, past };
}

/**
 * Normalize tense consistency across all corrections.
 * If corrections mix present and past verb forms, flip minority-direction
 * suggestions to match the majority. Also uses text-level tense signals
 * (3rd person subject + base form = present intent) to determine tense
 * direction when corrections alone are insufficient.
 * Drops corrections where the flipped suggestion would equal the original.
 */
export function normalizeTenseInCorrections(errors: GrammarError[], text: string): GrammarError[] {
  const classified = errors.map((error) => ({
    error,
    tense: classifySuggestionTense(error.suggestion),
  }));

  let presentCount = classified.filter((c) => c.tense?.direction === "present").length;
  let pastCount = classified.filter((c) => c.tense?.direction === "past").length;

  // Add text-level tense signals
  const textSignals = countTextTenseSignals(text);
  presentCount += textSignals.present;
  pastCount += textSignals.past;

  // Need at least one correction to normalize AND a clear direction
  const correctionPresent = classified.filter((c) => c.tense?.direction === "present").length;
  const correctionPast = classified.filter((c) => c.tense?.direction === "past").length;
  if (correctionPresent + correctionPast === 0) return errors;
  if (presentCount === pastCount) return errors;
  if (Math.abs(presentCount - pastCount) < 2) return errors;

  const majorityTense = presentCount > pastCount ? "present" : "past";
  console.log(
    `[AI Grammar Checker] Tense normalization: ${presentCount} present, ${pastCount} past → normalizing to ${majorityTense}`
  );

  const result: GrammarError[] = [];
  for (const { error, tense } of classified) {
    // When normalizing to present, upgrade "was"→"were" to present progressive form
    if (majorityTense === "present" && !tense) {
      const origLower = error.original.toLowerCase();
      const suggLower = error.suggestion.toLowerCase();
      if (origLower === "was" && suggLower === "were") {
        // Check if followed by -ing verb (progressive)
        const afterOffset = error.offset + error.length;
        const afterText = text.slice(afterOffset).trimStart();
        if (/^\w+ing\b/.test(afterText)) {
          // Determine subject for is/are
          const before = text.slice(0, error.offset).trimEnd().toLowerCase();
          const lastWord = before.match(/(\w+)$/)?.[1] ?? "";
          const presentForm = ["they", "we", "you"].includes(lastWord) ? "are" : "is";
          result.push({
            ...error,
            suggestion: matchTenseCase(presentForm, error.original),
            explanation: `Use present progressive to match the present tense of the surrounding text.`,
          });
          continue;
        }
      }
    }

    if (!tense || tense.direction === majorityTense) {
      result.push(error);
      continue;
    }

    // Flip suggestion to majority tense
    const flipped = matchTenseCase(tense.flipped, error.suggestion);

    // If flipping makes suggestion equal original, this error doesn't exist in the majority tense
    if (flipped.toLowerCase() === error.original.toLowerCase()) {
      console.log(
        `[AI Grammar Checker] Tense normalization: dropping "${error.original}" → "${error.suggestion}" (would be no-op in ${majorityTense} tense)`
      );
      continue;
    }

    result.push({
      ...error,
      suggestion: flipped,
      explanation: `${error.explanation} (adjusted to ${majorityTense} tense for consistency)`,
    });
  }

  return result;
}

function matchTenseCase(target: string, reference: string): string {
  if (
    reference.length > 0 &&
    reference[0] === reference[0].toUpperCase() &&
    reference[0] !== reference[0].toLowerCase()
  ) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return target;
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
