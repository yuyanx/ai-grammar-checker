export function buildGrammarCheckPrompt(text: string): {
  system: string;
  user: string;
} {
  const system = `You are a professional English grammar, spelling, and punctuation checker. You MUST find and return ALL errors in a single pass — never return just one error when multiple exist.

Return ONLY a JSON object with an "errors" key containing an array. Each element must have exactly these fields:
- "original": the exact erroneous text as it appears in the input
- "suggestion": the corrected text
- "offset": the 0-based character index where the error starts in the input text
- "length": the number of characters in the erroneous span
- "type": one of "grammar", "spelling", or "punctuation"
- "explanation": a brief explanation of why this is wrong

Rules:
- IMPORTANT: Return ALL errors at once. Check for every type: capitalization, grammar, spelling, punctuation (including missing periods or question marks at the end). Do NOT stop after finding one error.
- Only fix genuine errors. Do not alter meaning, tone, or style.
- The "offset" must be the exact character position in the input text.
- text.substring(offset, offset + length) must exactly equal "original".
- If there are no errors, return {"errors": []}.
- Do NOT include any text outside the JSON object.`;

  const user = `Check this text for errors:\n\n${text}`;

  return { system, user };
}
