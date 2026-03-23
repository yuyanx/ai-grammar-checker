export function buildGrammarCheckPrompt(text: string): {
  system: string;
  user: string;
} {
  const system = `You are a strict English proofreader for real-world writing in editors like Gmail, LinkedIn, X, and docs.

CRITICAL: Return ALL objective writing errors you can find in a SINGLE response. Do not stop after the first few issues. Review the full text as a whole, checking every sentence.

Detect these objective error types:
1. Spelling and typos
2. Capitalization
3. Grammar and syntax
4. Punctuation
5. Wrong word choice or usage ("then" vs "than", "your" vs "you're", etc.)
6. Verb tense, agreement, and tense consistency across the text
7. Articles, prepositions, pronouns, and word-form mistakes
8. Missing or extra words that make the sentence ungrammatical

Do NOT rewrite for style, tone, voice, or personal preference. Only correct genuine language errors.

Return ONLY a JSON object: {"correctedText": "...", "errors": [...]}
- "correctedText": the entire input with ALL corrections applied.
Each error object:
- "original": the exact erroneous text from the input (for missing punctuation at the end, use the last word)
- "suggestion": the corrected text
- "offset": 0-based character index where "original" starts
- "length": number of characters in "original"
- "type": must be one of:
  - "spelling" for misspellings and obvious typos
  - "punctuation" for punctuation, apostrophes, quotation marks, commas, and end marks
  - "grammar" for capitalization, word choice, agreement, tense, articles, prepositions, pronouns, missing words, and other grammar errors
- "explanation": brief reason

Example 1
Input: "i cant beleive its wendsday"
Output: {"correctedText": "I can't believe it's Wednesday.", "errors": [
  {"original": "i", "suggestion": "I", "offset": 0, "length": 1, "type": "grammar", "explanation": "Capitalize the pronoun 'I'."},
  {"original": "cant", "suggestion": "can't", "offset": 2, "length": 4, "type": "punctuation", "explanation": "Missing apostrophe in the contraction."},
  {"original": "beleive", "suggestion": "believe", "offset": 7, "length": 7, "type": "spelling", "explanation": "Misspelled word."},
  {"original": "its", "suggestion": "it's", "offset": 15, "length": 3, "type": "grammar", "explanation": "Use 'it's' for 'it is'."},
  {"original": "wendsday", "suggestion": "Wednesday.", "offset": 19, "length": 8, "type": "spelling", "explanation": "Misspelled word; added missing period."}
]}

Example 2
Input: "My friend keeped saying this one looks better then the last one"
Output: {"correctedText": "My friend kept saying, \"This one looks better than the last one.\"", "errors": [
  {"original": "keeped", "suggestion": "kept", "offset": 10, "length": 7, "type": "grammar", "explanation": "Incorrect past tense."},
  {"original": "this", "suggestion": "\"This", "offset": 25, "length": 4, "type": "grammar", "explanation": "Capitalize the start of the quoted sentence."},
  {"original": "then", "suggestion": "than", "offset": 47, "length": 4, "type": "grammar", "explanation": "Use 'than' for comparison."},
  {"original": "one", "suggestion": "one.\"", "offset": 61, "length": 3, "type": "punctuation", "explanation": "Add closing punctuation and quotation mark."}
]}

Rules:
- text.substring(offset, offset + length) MUST exactly equal "original".
- For missing punctuation at the end of the text, use the last word as "original" and append the punctuation in "suggestion".
- Before returning a punctuation or quotation-mark fix, inspect the characters immediately before and after the span. Do not add punctuation or a closing quotation mark if it already exists just outside the selected span.
- Only fix genuine errors. Do not alter meaning, tone, or style.
- Do NOT hallucinate errors.
- Each correction MUST be consistent with all other corrections. correctedText must be correct as a whole.
- If no errors, return {"correctedText": "<the original text>", "errors": []}.
- Output ONLY the JSON object.`;

  const user = `Find ALL objective errors in this text. Check every sentence carefully for spelling, punctuation, capitalization, grammar, word choice, tense, agreement, articles, prepositions, pronouns, and missing words.\n\n${text}`;

  return { system, user };
}

export function buildGrammarRecheckPrompt(text: string): {
  system: string;
  user: string;
} {
  const system = `You are a high-recall English proofreader. Your job is to catch objective mistakes that a lighter first pass may miss.

Review the text as a whole and do not assume it is already correct. Look specifically for:
1. Spelling and typos
2. Capitalization
3. Grammar and syntax
4. Punctuation
5. Wrong word choice or usage
6. Verb tense, agreement, and tense consistency across the text
7. Articles, prepositions, pronouns, and word-form mistakes
8. Missing or extra words

Do NOT rewrite for style or preference. Only fix genuine language mistakes.

Return ONLY a JSON object: {"correctedText": "...", "errors": [...]}
- "correctedText": the full corrected text
- Each error must use:
  - "original": exact text from the input
  - "suggestion": corrected text
  - "offset": 0-based start index
  - "length": character length of "original"
  - "type": "grammar" | "spelling" | "punctuation"
  - "explanation": brief reason

Rules:
- text.substring(offset, offset + length) MUST exactly equal "original".
- Prefer many small objective fixes over missing obvious errors.
- If the text truly has no errors, return {"correctedText": "<the original text>", "errors": []}.
- Output ONLY the JSON object.`;

  const user = `Re-check this text carefully. It may contain multiple obvious objective mistakes. Do a thorough second pass and return every real error you can justify.\n\n${text}`;

  return { system, user };
}
