import { CheckRequest, CheckResponse, GrammarError } from "../shared/types.js";
import { getSettings } from "../shared/storage.js";
import { buildGrammarCheckPrompt } from "../shared/prompts.js";
import { parseOpenAIResponse, parseGeminiResponse, validateErrors } from "../shared/api-parsers.js";
import { OPENAI_API_URL, GEMINI_API_URL, DEFAULT_OPENAI_MODEL, MAX_TEXT_LENGTH } from "../shared/constants.js";

chrome.runtime.onMessage.addListener(
  (message: any, sender, sendResponse) => {
    if (message.type === "CHECK_GRAMMAR") {
      handleCheckGrammar(message)
        .then(sendResponse)
        .catch((err) => {
          const response: CheckResponse = {
            type: "CHECK_GRAMMAR_RESULT",
            requestId: message.requestId,
            errors: [],
            error: err instanceof Error ? err.message : "Unknown error",
          };
          sendResponse(response);
        });
      return true; // async response
    }

    return false;
  }
);

async function handleCheckGrammar(
  request: CheckRequest
): Promise<CheckResponse> {
  const settings = await getSettings();
  const text = request.text.substring(0, MAX_TEXT_LENGTH);
  const { system, user } = buildGrammarCheckPrompt(text);

  let rawErrors: GrammarError[];

  if (settings.provider === "openai") {
    if (!settings.openaiApiKey) {
      return {
        type: "CHECK_GRAMMAR_RESULT",
        requestId: request.requestId,
        errors: [],
        error: "OpenAI API key not configured",
      };
    }
    rawErrors = await callOpenAI(system, user, settings.openaiApiKey);
  } else {
    if (!settings.geminiApiKey) {
      return {
        type: "CHECK_GRAMMAR_RESULT",
        requestId: request.requestId,
        errors: [],
        error: "Gemini API key not configured",
      };
    }
    rawErrors = await callGemini(system, user, settings.geminiApiKey);
  }

  // Validate and filter errors
  let errors = validateErrors(rawErrors, text);

  // Filter by user preferences
  if (!settings.checkGrammar) errors = errors.filter((e) => e.type !== "grammar");
  if (!settings.checkSpelling) errors = errors.filter((e) => e.type !== "spelling");
  if (!settings.checkPunctuation) errors = errors.filter((e) => e.type !== "punctuation");

  return {
    type: "CHECK_GRAMMAR_RESULT",
    requestId: request.requestId,
    errors,
  };
}

async function callOpenAI(
  system: string,
  user: string,
  apiKey: string
): Promise<GrammarError[]> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new Error("Invalid OpenAI API key");
    if (status === 429) throw new Error("OpenAI rate limit exceeded");
    throw new Error(`OpenAI API error: ${status}`);
  }

  const json = await response.json();
  return parseOpenAIResponse(json);
}

async function callGemini(
  system: string,
  user: string,
  apiKey: string
): Promise<GrammarError[]> {
  const url = `${GEMINI_API_URL}?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          parts: [{ text: user }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson.error?.message || JSON.stringify(errJson).substring(0, 200);
    } catch {}
    if (status === 429) throw new Error(`Gemini rate limit exceeded. ${detail}`);
    if (status === 400) throw new Error(`Gemini API error (400): ${detail}`);
    if (status === 403) throw new Error(`Gemini API forbidden (403): ${detail}`);
    throw new Error(`Gemini API error ${status}: ${detail}`);
  }

  const json = await response.json();
  return parseGeminiResponse(json);
}
