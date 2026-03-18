import { GrammarError, CheckRequest, CheckResponse, ElementState } from "../shared/types.js";
import { getSettings, isConfigured } from "../shared/storage.js";
import { renderErrors, clearErrors, clearAllErrors, errorKey } from "./underline-renderer.js";
import { updateWidget, removeWidget, removeAllWidgets } from "./status-widget.js";
import { showPopover } from "./popover.js";
import { showErrorPanel, hideErrorPanel } from "./error-panel.js";

const elementStates = new WeakMap<HTMLElement, ElementState>();
const trackedElements = new Set<HTMLElement>();
let debounceMs = 800;
let enabled = true;
let configuredCache: boolean | null = null;
let lastUrl = location.href;

// Track recently applied fixes to prevent oscillation (suggestion reverting back to original)
// Maps element → Set of "suggestion→original" pairs that should be suppressed
const recentFixes = new WeakMap<HTMLElement, Map<string, number>>();
const RECENT_FIX_TTL = 10000; // suppress reverse suggestions for 10 seconds

export function trackAppliedFix(element: HTMLElement, original: string, suggestion: string): void {
  let fixes = recentFixes.get(element);
  if (!fixes) {
    fixes = new Map();
    recentFixes.set(element, fixes);
  }
  // Key: if AI suggests reverting suggestion back to original, suppress it
  const key = `${suggestion.toLowerCase()}→${original.toLowerCase()}`;
  fixes.set(key, Date.now());
}

function isReverseFix(element: HTMLElement, error: GrammarError): boolean {
  const fixes = recentFixes.get(element);
  if (!fixes) return false;
  const key = `${error.original.toLowerCase()}→${error.suggestion.toLowerCase()}`;
  const timestamp = fixes.get(key);
  if (!timestamp) return false;
  if (Date.now() - timestamp > RECENT_FIX_TTL) {
    fixes.delete(key);
    return false;
  }
  return true;
}

// Privacy: skip these input types and field patterns
const PRIVACY_SKIP_TYPES = new Set(["password", "hidden"]);
const PRIVACY_SKIP_NAMES = /password|passwd|secret|token|ssn|credit.?card|cvv|cvc|api.?key/i;
const PRIVACY_SKIP_AUTOCOMPLETE = /cc-|password|one-time-code/i;

export async function startMonitoring(): Promise<void> {
  const settings = await getSettings();
  debounceMs = settings.debounceMs;
  enabled = settings.enabled;

  if (!enabled) return;

  // Scan existing elements
  scanForElements(document.body);

  // Watch for new elements AND attribute changes (e.g. contenteditable set dynamically)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            scanForElements(node);
          }
        }
      } else if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
        // An element just got contenteditable set — scan it
        scanForElements(mutation.target);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["contenteditable", "role"],
  });

  // Recalculate underline positions on scroll/resize
  let rafId: number | null = null;
  const recalculate = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      reRenderAll();
    });
  };

  window.addEventListener("scroll", recalculate, true);
  window.addEventListener("resize", recalculate);

  // Periodically clean up disconnected elements (handles SPA navigation)
  setInterval(() => {
    // Detect URL change (SPA navigation) — nuclear cleanup
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearAllErrors();
      removeAllWidgets();
      for (const el of trackedElements) {
        const state = elementStates.get(el);
        if (state) {
          state.errors = [];
          state.lastText = "";
          if (state.debounceTimer !== null) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = null;
          }
        }
        if (!el.isConnected) {
          trackedElements.delete(el);
        }
      }
      // Re-scan for new elements after SPA navigation
      setTimeout(() => scanForElements(document.body), 200);
      return;
    }

    // Clean up elements that were removed from DOM
    for (const el of trackedElements) {
      if (!el.isConnected) {
        clearErrors(el);
        removeWidget(el);
        trackedElements.delete(el);
      }
    }
  }, 1000);

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      const newSettings = changes.settings.newValue as Record<string, any>;
      if (newSettings) {
        configuredCache = null; // invalidate
        debounceMs = (newSettings.debounceMs as number) || 800;
        enabled = newSettings.enabled as boolean;
        if (!enabled) {
          for (const el of trackedElements) {
            clearErrors(el);
            removeWidget(el);
          }
        }
      }
    }
  });
}

const TEXT_INPUT_SELECTORS = "textarea, input[type='text'], input[type='search'], input:not([type]), [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']";

function scanForElements(root: HTMLElement): void {
  const elements: HTMLElement[] = root.matches?.(TEXT_INPUT_SELECTORS) ? [root] : [];
  root.querySelectorAll<HTMLElement>(TEXT_INPUT_SELECTORS).forEach((el) => elements.push(el));

  // Traverse into shadow roots to find inputs inside web components
  walkShadowRoots(root, elements);

  for (const el of elements) {
    if (el instanceof HTMLElement && !elementStates.has(el)) {
      // Privacy check: skip sensitive fields
      if (shouldSkipElement(el)) continue;
      attachListeners(el);
      trackedElements.add(el);
    }
  }
}

function walkShadowRoots(root: HTMLElement | ShadowRoot, out: HTMLElement[]): void {
  const children = root instanceof HTMLElement
    ? [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
    : Array.from(root.querySelectorAll<HTMLElement>("*"));

  for (const el of children) {
    const sr = el.shadowRoot;
    if (sr) {
      sr.querySelectorAll<HTMLElement>(TEXT_INPUT_SELECTORS).forEach((found) => out.push(found));
      walkShadowRoots(sr, out);
    }
  }
}

/**
 * Privacy filter: skip password fields, credit card inputs, etc.
 */
function shouldSkipElement(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) {
    if (PRIVACY_SKIP_TYPES.has(element.type)) return true;
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

function attachListeners(element: HTMLElement): void {
  const state: ElementState = {
    lastText: "",
    errors: [],
    ignoredErrors: new Set(),
    debounceTimer: null,
  };
  elementStates.set(element, state);

  const handler = () => {
    if (!enabled) return;

    const currentState = elementStates.get(element);
    if (!currentState) return;

    // Always clear stale underlines and badge immediately when text changes
    clearErrors(element);
    if (currentState.errors.length > 0) {
      currentState.errors = [];
      updateWidget(element, "idle");
    }

    // Get current text to check if it's now empty
    const currentText = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? element.value
      : element.innerText;

    if (!currentText.trim() || currentText.trim().length < 10) {
      // Text is empty or too short — clear everything and don't schedule a check
      currentState.lastText = "";
      if (currentState.debounceTimer !== null) {
        clearTimeout(currentState.debounceTimer);
        currentState.debounceTimer = null;
      }
      updateWidget(element, "idle");
      return;
    }

    if (currentState.debounceTimer !== null) {
      clearTimeout(currentState.debounceTimer);
    }

    currentState.debounceTimer = window.setTimeout(async () => {
      await checkElement(element);
    }, debounceMs);
  };

  // Listen for multiple events to catch all text changes (including programmatic ones)
  element.addEventListener("input", handler);
  element.addEventListener("keyup", handler);

  // For contenteditable, also watch for DOM mutations
  if (element.isContentEditable) {
    const observer = new MutationObserver(() => handler());
    observer.observe(element, { childList: true, subtree: true, characterData: true });
  }
}

async function checkElement(element: HTMLElement, autoShowPanel = false): Promise<void> {
  if (configuredCache === null) configuredCache = await isConfigured();
  if (!configuredCache) return;

  const state = elementStates.get(element);
  if (!state) return;

  let text: string;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    text = element.value;
  } else {
    text = element.innerText;
  }

  // If text is empty or too short, clear existing errors and return
  if (!text.trim() || text.trim().length < 10) {
    if (state.errors.length > 0) {
      state.errors = [];
      state.lastText = "";
      clearErrors(element);
      updateWidget(element, "idle");
    }
    return;
  }

  // Skip unchanged text
  if (text === state.lastText) return;

  state.lastText = text;

  // Show checking widget
  updateWidget(element, "checking");

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const request: CheckRequest = {
      type: "CHECK_GRAMMAR",
      text,
      requestId,
    };

    const response: CheckResponse = await chrome.runtime.sendMessage(request);

    if (response.error) {
      updateWidget(element, "idle");
      return;
    }

    // Only apply if text hasn't changed since we sent the request
    const currentText = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? element.value
      : element.innerText;

    if (currentText !== text) {
      updateWidget(element, "idle");
      return;
    }

    // Filter out errors that would reverse a recently applied fix (prevents oscillation)
    state.errors = response.errors.filter((e) => !isReverseFix(element, e));
    state.correctedText = response.correctedText;

    // Update widget state
    const visibleErrors = state.errors.filter(
      (e) => !state.ignoredErrors.has(errorKey(e))
    );

    if (visibleErrors.length > 0) {
      updateWidget(element, "errors", visibleErrors.length, () => {
        openErrorPanelForElement(element);
      });

      // Auto-show panel after a post-fix re-check finds new errors
      if (autoShowPanel) {
        openErrorPanelForElement(element);
      }
    } else {
      updateWidget(element, "clean");
    }

    renderErrorsForElement(element);
  } catch (err: any) {
    if (err?.message?.includes("Extension context invalidated")) return;
    console.warn("[AI Grammar Checker] Error:", err);
    updateWidget(element, "idle");
  }
}

function openErrorPanelForElement(element: HTMLElement): void {
  const currentState = elementStates.get(element);
  if (!currentState) return;

  const currentVisible = currentState.errors.filter(
    (e) => !currentState.ignoredErrors.has(errorKey(e))
  );
  if (currentVisible.length === 0) return;

  showErrorPanel(
    element,
    currentVisible,
    currentState.ignoredErrors,
    element.getBoundingClientRect(),
    currentState.correctedText,
    () => {
      // onAccept: clear errors and re-check
      const s = elementStates.get(element);
      if (s) {
        s.errors = [];
        s.lastText = "";
        clearErrors(element);
        updateWidget(element, "idle");
        setTimeout(() => checkElement(element, true), 300);
      }
    },
    (key: string) => {
      // onDismiss: add to ignored set and update
      const s = elementStates.get(element);
      if (s) {
        s.ignoredErrors.add(key);
        renderErrorsForElement(element);
        const remaining = s.errors.filter(
          (e) => !s.ignoredErrors.has(errorKey(e))
        );
        if (remaining.length > 0) {
          updateWidget(element, "errors", remaining.length);
        } else {
          updateWidget(element, "clean");
        }
      }
    }
  );
}

function renderErrorsForElement(element: HTMLElement): void {
  const state = elementStates.get(element);
  if (!state) return;

  renderErrors(
    element,
    state.errors,
    state.ignoredErrors,
    () => {
      // On accept: clear all underlines immediately, then re-check after a delay
      const s = elementStates.get(element);
      if (s) {
        s.errors = [];
        s.lastText = ""; // Force re-check
        clearErrors(element);
        updateWidget(element, "idle");
        setTimeout(() => checkElement(element, true), 300);
      }
    },
    (key: string) => {
      // On dismiss: add to ignored list and update widget count
      const s = elementStates.get(element);
      if (s) {
        s.ignoredErrors.add(key);
        renderErrorsForElement(element);

        // Update widget with new count
        const visibleErrors = s.errors.filter(
          (e) => !s.ignoredErrors.has(errorKey(e))
        );
        if (visibleErrors.length > 0) {
          updateWidget(element, "errors", visibleErrors.length);
        } else {
          updateWidget(element, "clean");
        }
      }
    }
  );
}

function reRenderAll(): void {
  for (const el of trackedElements) {
    if (el instanceof HTMLElement) {
      const state = elementStates.get(el);
      if (state && state.errors.length > 0) {
        renderErrorsForElement(el);
      }
    }
  }
}
