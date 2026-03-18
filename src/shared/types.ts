export type ApiProvider = "openai" | "gemini";

export type ErrorType = "grammar" | "spelling" | "punctuation";

export interface GrammarError {
  original: string;
  suggestion: string;
  offset: number;
  length: number;
  type: ErrorType;
  explanation: string;
}

export interface CheckRequest {
  type: "CHECK_GRAMMAR";
  text: string;
  requestId: string;
  sourceId?: string;
}

export interface CheckResponse {
  type: "CHECK_GRAMMAR_RESULT";
  requestId: string;
  errors: GrammarError[];
  correctedText?: string; // fully corrected text for "Fix All"
  error?: string;
  rateLimitedUntil?: number; // epoch ms — content script should not retry until this time
}

export interface UserSettings {
  provider: ApiProvider;
  openaiApiKey: string;
  geminiApiKey: string;
  enabled: boolean;
  debounceMs: number;
  checkGrammar: boolean;
  checkSpelling: boolean;
  checkPunctuation: boolean;
}

export interface ElementState {
  lastText: string;
  pendingText: string | null;
  errors: GrammarError[];
  correctedText?: string;
  ignoredErrors: Set<string>;
  debounceTimer: number | null;
  sourceId: string;
  observers: MutationObserver[];
}
