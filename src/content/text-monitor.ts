import { GrammarError, CheckRequest, CheckResponse, ElementState } from "../shared/types.js";
import { getSettings, isConfigured } from "../shared/storage.js";
import { renderErrors, clearErrors, errorKey } from "./underline-renderer.js";
import { updateWidget, removeWidget } from "./status-widget.js";
import { showPopover } from "./popover.js";

const elementStates = new WeakMap<HTMLElement, ElementState>();
let debounceMs = 800;
let enabled = true;
let configuredCache: boolean | null = null;

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

  // Watch for new elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          scanForElements(node);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

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

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      const newSettings = changes.settings.newValue as Record<string, any>;
      if (newSettings) {
        configuredCache = null; // invalidate
        debounceMs = (newSettings.debounceMs as number) || 800;
        enabled = newSettings.enabled as boolean;
        if (!enabled) {
          document.querySelectorAll("textarea, input[type='text'], input[type='search'], input:not([type]), [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']").forEach((el) => {
            clearErrors(el as HTMLElement);
            removeWidget(el as HTMLElement);
          });
        }
      }
    }
  });
}

function scanForElements(root: HTMLElement): void {
  const selectors = "textarea, input[type='text'], input[type='search'], input:not([type]), [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']";
  const elements: HTMLElement[] = root.matches?.(selectors) ? [root] : [];
  root.querySelectorAll<HTMLElement>(selectors).forEach((el) => elements.push(el));

  for (const el of elements) {
    if (el instanceof HTMLElement && !elementStates.has(el)) {
      // Privacy check: skip sensitive fields
      if (shouldSkipElement(el)) continue;
      attachListeners(el);
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

    if (currentState.debounceTimer !== null) {
      clearTimeout(currentState.debounceTimer);
    }

    currentState.debounceTimer = window.setTimeout(async () => {
      await checkElement(element);
    }, debounceMs);
  };

  element.addEventListener("input", handler);
}

async function checkElement(element: HTMLElement): Promise<void> {
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

  // Skip empty, too short, or unchanged text
  if (!text.trim() || text.trim().length < 10 || text === state.lastText) return;

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

    state.errors = response.errors;

    // Update widget state
    const visibleErrors = state.errors.filter(
      (e) => !state.ignoredErrors.has(errorKey(e))
    );

    if (visibleErrors.length > 0) {
      updateWidget(element, "errors", visibleErrors.length, () => {
        // Click widget → show first error's popover
        if (visibleErrors.length > 0) {
          const firstError = visibleErrors[0];
          // Trigger a re-render which will create the underlines,
          // then we can show the popover for the first error
          renderErrorsForElement(element);
        }
      });
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
        setTimeout(() => checkElement(element), 300);
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
  const allElements = document.querySelectorAll(
    "textarea, input[type='text'], input[type='search'], input:not([type]), [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']"
  );
  for (const el of allElements) {
    if (el instanceof HTMLElement) {
      const state = elementStates.get(el);
      if (state && state.errors.length > 0) {
        renderErrorsForElement(el);
      }
    }
  }
}
