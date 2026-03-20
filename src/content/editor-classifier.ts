export type EditorIntent =
  | "compose"
  | "utility_search"
  | "utility_picker"
  | "sensitive"
  | "unsupported";

export interface EditorClassification {
  eligible: boolean;
  intent: EditorIntent;
  reason: string;
}

const PRIVACY_SKIP_TYPES = new Set(["password", "hidden"]);
const PRIVACY_SKIP_NAMES = /password|passwd|secret|token|ssn|credit.?card|cvv|cvc|api.?key/i;
const PRIVACY_SKIP_AUTOCOMPLETE = /cc-|password|one-time-code/i;

const UTILITY_TOKEN_RE = /\b(search|find|filter|branch|tag|repo|repository|command|palette|query|lookup|address|url|jump to|ask gmail)\b/i;
const ASK_GMAIL_RE = /\bask gmail\b/i;

export function classifyEditor(element: HTMLElement): EditorClassification {
  if (isSensitiveField(element)) {
    return {
      eligible: false,
      intent: "sensitive",
      reason: "sensitive field denied by privacy policy",
    };
  }

  if (element instanceof HTMLInputElement) {
    const inputType = (element.type || "text").toLowerCase();
    return {
      eligible: false,
      intent: inputType === "search" ? "utility_search" : "unsupported",
      reason: `input[type=${inputType}] denied by compose-only policy`,
    };
  }

  if (isUtilityPicker(element)) {
    return {
      eligible: false,
      intent: "utility_picker",
      reason: "combobox or picker UI detected",
    };
  }

  if (isSiteSpecificDenied(element)) {
    return {
      eligible: false,
      intent: "utility_search",
      reason: "site-specific utility field denied",
    };
  }

  if (hasUtilitySearchIntent(element)) {
    return {
      eligible: false,
      intent: "utility_search",
      reason: "utility/search semantics detected",
    };
  }

  const composeReason = getSiteSpecificComposeReason(element);
  if (composeReason) {
    return {
      eligible: true,
      intent: "compose",
      reason: composeReason,
    };
  }

  if (element instanceof HTMLTextAreaElement) {
    return {
      eligible: true,
      intent: "compose",
      reason: "textarea allowed as compose surface",
    };
  }

  if (element.isContentEditable) {
    return {
      eligible: true,
      intent: "compose",
      reason: "contenteditable allowed as compose surface",
    };
  }

  if (isMultilineTextbox(element)) {
    return {
      eligible: true,
      intent: "compose",
      reason: "multiline textbox allowed as compose surface",
    };
  }

  return {
    eligible: false,
    intent: "unsupported",
    reason: "single-line or unsupported editor surface",
  };
}

function isSensitiveField(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) {
    if (PRIVACY_SKIP_TYPES.has((element.type || "").toLowerCase())) return true;
    if (PRIVACY_SKIP_NAMES.test(element.name || "")) return true;
    if (PRIVACY_SKIP_NAMES.test(element.id || "")) return true;
    if (PRIVACY_SKIP_AUTOCOMPLETE.test(element.autocomplete || "")) return true;
  }

  if (element instanceof HTMLTextAreaElement) {
    if (PRIVACY_SKIP_NAMES.test(element.name || "")) return true;
    if (PRIVACY_SKIP_NAMES.test(element.id || "")) return true;
  }

  return false;
}

function hasUtilitySearchIntent(element: HTMLElement): boolean {
  if (element.getAttribute("role") === "searchbox") return true;
  if (closestByRole(element, "search")) return true;
  return getSemanticSignals(element).some((signal) => UTILITY_TOKEN_RE.test(signal));
}

function isUtilityPicker(element: HTMLElement): boolean {
  const role = (element.getAttribute("role") || "").toLowerCase();
  if (role === "combobox") return true;

  if ((element.getAttribute("aria-haspopup") || "").toLowerCase() === "listbox") {
    return true;
  }

  if (closestByRole(element, "combobox")) return true;
  if (closestByRole(element, "listbox")) return true;

  const signals = getSemanticSignals(element);
  return signals.some((signal) => /\b(combobox|picker|autocomplete|suggestion list)\b/i.test(signal));
}

function isSiteSpecificDenied(element: HTMLElement): boolean {
  const host = location.hostname.toLowerCase();
  const signals = getSemanticSignals(element).join(" ");

  if (isGoogleHost(host) && signals.includes("search")) return true;
  if ((host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) && signals.includes("search")) {
    return true;
  }
  if (host === "github.com" && /\b(find or create a branch|switch branches|branches\/tags)\b/i.test(signals)) {
    return true;
  }
  if (host === "mail.google.com" && (ASK_GMAIL_RE.test(signals) || /\bsearch mail|search in mail\b/i.test(signals))) {
    return true;
  }

  return false;
}

function getSiteSpecificComposeReason(element: HTMLElement): string | null {
  const host = location.hostname.toLowerCase();

  if (host === "mail.google.com" && isGmailComposeSurface(element)) {
    return "gmail compose surface";
  }

  if (isGrokHost(host) && isGenericComposeSurface(element)) {
    return "grok chat composer";
  }

  if (isLinkedInHost(host) && isGenericComposeSurface(element)) {
    return "linkedin compose surface";
  }

  if (isInstagramHost(host) && isGenericComposeSurface(element)) {
    return "instagram compose surface";
  }

  if ((host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) && isGenericComposeSurface(element)) {
    return "x compose surface";
  }

  return null;
}

function isGmailComposeSurface(element: HTMLElement): boolean {
  if (!isGenericComposeSurface(element)) return false;
  const signals = getSemanticSignals(element).join(" ");
  if (ASK_GMAIL_RE.test(signals)) return false;
  if (/\bsearch mail|search in mail\b/i.test(signals)) return false;
  return true;
}

function isGenericComposeSurface(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element.isContentEditable) return true;
  return isMultilineTextbox(element);
}

function isMultilineTextbox(element: HTMLElement): boolean {
  return (
    (element.getAttribute("role") || "").toLowerCase() === "textbox" &&
    (element.getAttribute("aria-multiline") || "").toLowerCase() === "true"
  );
}

function getSemanticSignals(element: HTMLElement): string[] {
  const seen = new Set<string>();
  const signals: string[] = [];

  let current: HTMLElement | null = element;
  let depth = 0;
  while (current && depth < 4) {
    pushSignal(signals, seen, current.getAttribute("role"));
    pushSignal(signals, seen, current.getAttribute("aria-label"));
    pushSignal(signals, seen, current.getAttribute("aria-placeholder"));
    pushSignal(signals, seen, current.getAttribute("aria-roledescription"));
    pushSignal(signals, seen, current.getAttribute("placeholder"));
    pushSignal(signals, seen, current.getAttribute("title"));
    pushSignal(signals, seen, current.getAttribute("name"));
    pushSignal(signals, seen, current.id);
    pushSignal(signals, seen, current.getAttribute("data-testid"));
    current = current.parentElement;
    depth += 1;
  }

  return signals;
}

function pushSignal(target: string[], seen: Set<string>, value: string | null): void {
  const normalized = normalizeSignal(value);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function normalizeSignal(value: string | null): string {
  return (value || "").trim().toLowerCase();
}

function closestByRole(element: HTMLElement, role: string): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    if ((current.getAttribute("role") || "").toLowerCase() === role) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isGoogleHost(host: string): boolean {
  return host === "google.com" || host === "www.google.com";
}

function isLinkedInHost(host: string): boolean {
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

function isInstagramHost(host: string): boolean {
  return host === "instagram.com" || host.endsWith(".instagram.com");
}

function isGrokHost(host: string): boolean {
  return host === "grok.com" || host.endsWith(".grok.com") || location.pathname.includes("/i/grok");
}
