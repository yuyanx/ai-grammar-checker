const PAST_IRREGULAR = new Set([
  "was", "were", "had", "did", "went", "came", "saw", "felt",
  "said", "took", "got", "made", "gave", "found", "knew", "thought",
  "told", "became", "left", "kept", "let", "began", "stood", "heard",
  "ran", "held", "brought", "wrote", "sat", "lost", "paid", "met",
  "set", "spent", "grew", "led", "understood", "fell", "sent", "built",
  "broke", "drove", "bought", "wore", "chose", "rose", "spoke", "ate",
  "drew", "caught", "threw", "forgot", "hid", "shook", "woke", "woke",
]);

const PRESENT_MARKERS = new Set([
  "is", "are", "has", "have", "do", "does", "goes", "comes", "says",
  "takes", "gets", "makes", "gives", "finds", "knows", "thinks",
  "tells", "becomes", "keeps", "begins", "stands", "hears", "runs",
  "holds", "brings", "writes", "sits", "feels", "seems", "wants",
  "needs", "looks", "uses", "works", "tries", "calls", "asks",
]);

// Words that look past-tense (-ed) but aren't verbs
const ED_FALSE_POSITIVES = new Set([
  "bed", "red", "shed", "fed", "led", "wed", "sped",
  "named", "based", "called", "related", "required", "supposed",
  "interested", "concerned", "involved", "limited", "continued",
  "increased", "expected", "considered", "detailed", "advanced",
  "experienced", "complicated", "dedicated", "automated",
]);

export function detectDominantTense(text: string): "past" | "present" | null {
  const words = text.toLowerCase().match(/\b[a-z']+\b/g);
  if (!words || words.length < 10) return null;

  let pastCount = 0;
  let presentCount = 0;

  for (const word of words) {
    if (PAST_IRREGULAR.has(word)) {
      pastCount++;
      continue;
    }

    if (PRESENT_MARKERS.has(word)) {
      presentCount++;
      continue;
    }

    // Regular past tense: -ed endings (but not adjective-like false positives)
    if (word.length >= 4 && word.endsWith("ed") && !ED_FALSE_POSITIVES.has(word)) {
      pastCount++;
    }
  }

  const total = pastCount + presentCount;
  if (total < 3) return null;

  if (pastCount > presentCount * 1.5) return "past";
  if (presentCount > pastCount * 1.5) return "present";
  return null;
}
