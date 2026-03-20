import { GrammarError, CheckRequest, CheckResponse, ElementState, PrewarmResponse } from "../shared/types.js";
import { getSettings, isConfigured } from "../shared/storage.js";
import { renderErrors, clearErrors, clearAllErrors, errorKey } from "./underline-renderer.js";
import { updateWidget, removeWidget, removeAllWidgets, refreshWidget, clearTransientWidgetsExcept, getWidgetState } from "./status-widget.js";
import { showPopover } from "./popover.js";
import { showErrorPanel, hideErrorPanel, getErrorPanelElement, isErrorPanelOpenForElement } from "./error-panel.js";
import { getContentEditableText } from "./contenteditable-snapshot.js";
import { isLikelyEnglish } from "../shared/language-detect.js";
import { classifyEditor, EditorClassification } from "./editor-classifier.js";

const elementStates = new WeakMap<HTMLElement, ElementState>();
const trackedElements = new Set<HTMLElement>();
const elementSourceIds = new WeakMap<HTMLElement, string>();
const loggedClassifications = new WeakMap<HTMLElement, string>();
let debounceMs = 800;
let enabled = true;
let configuredCache: boolean | null = null;
let lastUrl = location.href;
let sourceCounter = 0;
let backgroundPrewarmed = false;
let backgroundPrewarmPromise: Promise<void> | null = null;
let runtimeInvalidated = false;
let maintenanceIntervalId: number | null = null;
const FOCUS_CHECK_DELAY_MS = 150;
const CHECK_REQUEST_TIMEOUT_MS = 15000;
const STALE_PENDING_THRESHOLD_MS = 20000;

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

// Selectors for standard text inputs and contenteditable elements
const TEXT_INPUT_SELECTORS = [
  "textarea",
  "input[type='text']",
  "input[type='search']",
  "input:not([type])",
  "[contenteditable='true']",
  "[contenteditable='']",
  "[contenteditable='plaintext-only']",
  "[role='textbox'][contenteditable]",
  "[role='textbox']",
].join(", ");

/**
 * Normalize text for comparison: trim trailing whitespace/newlines that
 * contenteditable editors (LinkedIn, Medium, etc.) add inconsistently
 * due to <br>, <p>, and other block-level element changes.
 */
function normalizeText(text: string): string {
  return text.replace(/[\n\r\s]+$/, "");
}

/**
 * Extract text from an element, normalizing for contenteditable quirks.
 */
function getElementText(element: HTMLElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }
  return getContentEditableText(element);
}

/**
 * Check if an element is actually editable (contenteditable, textarea, input, or role=textbox
 * with visible text content that can be typed into).
 */
function isEditableElement(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return true;
  if (el.isContentEditable) return true;
  // role="textbox" elements may be custom editors without explicit contenteditable
  if (el.getAttribute("role") === "textbox") return true;
  return false;
}

/**
 * Find the best editable element from a focusin target.
 * Walks up the DOM to find the root editor element.
 */
function findEditableRoot(target: HTMLElement): HTMLElement | null {
  // 1. Try matching our selectors directly (includes role=textbox)
  const matched = target.closest<HTMLElement>(TEXT_INPUT_SELECTORS);
  if (matched) {
    // For contenteditable, walk up to find the outermost editable root
    // so we attach to the editor container, not an inner <p> or <span>
    if (matched.isContentEditable) {
      let root = matched;
      let parent = root.parentElement;
      while (parent && parent !== document.body && parent.isContentEditable) {
        if (parent.hasAttribute("contenteditable")) {
          root = parent;
        }
        parent = parent.parentElement;
      }
      return root;
    }
    return matched;
  }

  // 2. Fallback: if target or ancestor is contenteditable but wasn't matched by selectors
  if (target.isContentEditable) {
    let el: HTMLElement = target;
    let parent = el.parentElement;
    while (parent && parent !== document.body && parent.isContentEditable) {
      if (parent.hasAttribute("contenteditable")) {
        el = parent;
      }
      parent = parent.parentElement;
    }
    return el;
  }

  return null;
}

export async function startMonitoring(): Promise<void> {
  runtimeInvalidated = false;
  if (!isRuntimeAvailable()) {
    handleRuntimeInvalidation("startup");
    return;
  }

  console.log("[AI Grammar Checker] startMonitoring called");
  const settings = await getSettings();
  debounceMs = settings.debounceMs;
  enabled = settings.enabled;

  if (!enabled) {
    console.log("[AI Grammar Checker] Extension disabled in settings");
    return;
  }

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
        // An element just got contenteditable or role set — scan it
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

  // Catch text fields on focus — most reliable method for dynamically created editors
  // (e.g. LinkedIn's editor, Medium, Notion). When the user clicks into a field,
  // we check if it's a text input we should attach to.
  document.addEventListener("focusin", (e) => {
    if (runtimeInvalidated || !enabled) return;
    if (!isRuntimeAvailable()) {
      handleRuntimeInvalidation("focusin");
      return;
    }
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const el = findEditableRoot(target);
    if (!el) return;

    const classification = classifyEditor(el);
    logEditorClassification(el, classification);
    if (!classification.eligible) {
      deactivateElement(el);
      return;
    }

    if (!elementStates.has(el)) {
      console.log(
        "[AI Grammar Checker] focusin detected compose editor:",
        el.tagName,
        el.className,
        el.getAttribute("contenteditable"),
        el.getAttribute("role")
      );
      attachListeners(el);
      trackedElements.add(el);
    }

    if (elementStates.has(el)) {
      const state = elementStates.get(el);
      if (state) clearFocusOutTimer(state);
      recoverElementIfStuck(el, true);
      clearTransientWidgetsExcept(el);
      void prewarmBackground();
      requestAnimationFrame(() => {
        if (isElementActive(el)) {
          primeElementOnFocus(el);
        }
      });
    }
  }, true);

  // Recalculate underline positions on scroll/resize
  let rafId: number | null = null;
  const recalculate = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      reRenderAll();
      for (const el of trackedElements) {
        refreshWidget(el);
      }
    });
  };

  window.addEventListener("scroll", recalculate, true);
  window.addEventListener("resize", recalculate);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      recoverVisiblePendingChecks();
    }
  });
  window.addEventListener("pageshow", () => {
    recoverVisiblePendingChecks();
  });

  // Periodic maintenance: cleanup + rescan for missed editors
  maintenanceIntervalId = window.setInterval(() => {
    if (runtimeInvalidated) return;
    if (!isRuntimeAvailable()) {
      handleRuntimeInvalidation("maintenance");
      return;
    }

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
        }
        cleanupElementState(el);
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
        cleanupElementState(el);
        trackedElements.delete(el);
      }
    }

    clearTransientWidgetsExcept(getActiveTrackedElement() ?? getErrorPanelElement());
    recoverVisiblePendingChecks(true);
    for (const el of trackedElements) {
      recoverElementIfStuck(el);
    }

    // Periodic rescan: catch editors that might have been missed by MutationObserver/focusin.
    // This is a safety net for complex SPAs (LinkedIn, etc.) where editors are created
    // in ways that don't always trigger our detection.
    scanForElements(document.body);
  }, 2000);

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

function scanForElements(root: HTMLElement): void {
  if (runtimeInvalidated) return;
  const elements: HTMLElement[] = root.matches?.(TEXT_INPUT_SELECTORS) ? [root] : [];
  root.querySelectorAll<HTMLElement>(TEXT_INPUT_SELECTORS).forEach((el) => elements.push(el));

  // Traverse into shadow roots to find inputs inside web components
  walkShadowRoots(root, elements);

  for (const el of elements) {
    if (el instanceof HTMLElement && !elementStates.has(el)) {
      // Skip non-editable elements (e.g. role=textbox that isn't actually editable)
      if (!isEditableElement(el)) continue;
      const classification = classifyEditor(el);
      logEditorClassification(el, classification);
      if (!classification.eligible) continue;
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

function attachListeners(element: HTMLElement): void {
  const sourceId = getSourceId(element);
  const state: ElementState = {
    lastText: "",
    pendingText: null,
    pendingStartedAt: null,
    errors: [],
    ignoredErrors: new Set(),
    debounceTimer: null,
    requestTimeoutTimer: null,
    focusOutTimer: null,
    checkGeneration: 0,
    renderGeneration: 0,
    sourceId,
    observers: [],
  };
  elementStates.set(element, state);

  const handler = () => {
    if (runtimeInvalidated || !enabled) return;
    if (!isRuntimeAvailable()) {
      handleRuntimeInvalidation("element handler");
      return;
    }

    const currentState = elementStates.get(element);
    if (!currentState) return;

    // Get current text to check if it actually changed
    const currentText = normalizeText(getElementText(element));

    if (currentText.trim() && !isLikelyEnglish(currentText)) {
      clearPendingCheck(currentState);
      if (currentState.errors.length > 0) {
        clearErrors(element);
        currentState.errors = [];
      }
      currentState.pendingText = null;
      currentState.lastText = currentText;
      updateWidget(element, "idle");
      return;
    }

    if (!currentText.trim() || currentText.trim().length < 10) {
      // Text is empty or too short — clear everything and don't schedule a check
      if (currentState.errors.length > 0) {
        clearErrors(element);
        currentState.errors = [];
      }
      currentState.lastText = "";
      if (currentState.debounceTimer !== null) {
        clearTimeout(currentState.debounceTimer);
        currentState.debounceTimer = null;
      }
      if (document.activeElement === element || element.contains(document.activeElement)) {
        updateWidget(element, "ready");
      } else {
        updateWidget(element, "idle");
      }
      return;
    }

    // Only clear errors when text actually changed (prevents flicker from
    // contenteditable DOM mutations that don't change the visible text)
    if (currentText !== currentState.lastText) {
      clearErrors(element);
      currentState.renderGeneration += 1;
      if (currentState.errors.length > 0) {
        currentState.errors = [];
        updateWidget(element, "idle");
      }
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
  element.addEventListener("focusin", () => {
    const currentState = elementStates.get(element);
    if (currentState) clearFocusOutTimer(currentState);
  });
  element.addEventListener("focusout", () => {
    const currentState = elementStates.get(element);
    if (!currentState) return;
    clearFocusOutTimer(currentState);
    currentState.focusOutTimer = window.setTimeout(() => {
      currentState.focusOutTimer = null;
      if (isElementActive(element)) return;
      if (isErrorPanelOpenForElement(element)) return;
      const visibleErrors = currentState.errors.filter(
        (e) => !currentState.ignoredErrors.has(errorKey(e))
      );
      if (visibleErrors.length === 0) {
        updateWidget(element, "idle");
      }
    }, 250);
  });

  // For contenteditable, also watch for DOM mutations.
  // Use a microtask-debounced callback to avoid firing the handler dozens of times
  // when rich text editors (LinkedIn, Notion) batch DOM mutations.
  if (element.isContentEditable) {
    let mutationPending = false;
    const observer = new MutationObserver(() => {
      if (!mutationPending) {
        mutationPending = true;
        queueMicrotask(() => {
          mutationPending = false;
          handler();
        });
      }
    });
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    state.observers.push(observer);
  }

  // For role="textbox" elements that are NOT contenteditable (custom editors),
  // also set up a MutationObserver since they may not fire standard input events.
  if (!element.isContentEditable && element.getAttribute("role") === "textbox") {
    console.log("[AI Grammar Checker] Non-contenteditable textbox detected, adding mutation observer:", element.tagName, element.className);
    let mutationPending = false;
    const observer = new MutationObserver(() => {
      if (!mutationPending) {
        mutationPending = true;
        queueMicrotask(() => {
          mutationPending = false;
          handler();
        });
      }
    });
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    state.observers.push(observer);
  }
}

async function prewarmBackground(): Promise<void> {
  if (runtimeInvalidated || !isRuntimeAvailable()) {
    handleRuntimeInvalidation("prewarm");
    return;
  }
  if (backgroundPrewarmed) return;
  if (backgroundPrewarmPromise) return backgroundPrewarmPromise;

  backgroundPrewarmPromise = chrome.runtime.sendMessage({ type: "PREWARM" })
    .then((response?: PrewarmResponse) => {
      if (response?.type === "PREWARM_RESULT") {
        configuredCache = response.configured;
      }
      backgroundPrewarmed = true;
    })
    .catch((err) => {
      if (isRuntimeInvalidationError(err)) {
        handleRuntimeInvalidation(err);
        return;
      }
      // Ignore prewarm failures — normal checks will still work.
    })
    .finally(() => {
      backgroundPrewarmPromise = null;
    });

  return backgroundPrewarmPromise;
}

function primeElementOnFocus(element: HTMLElement): void {
  const state = elementStates.get(element);
  if (!state) return;

  const visibleErrors = state.errors.filter(
    (e) => !state.ignoredErrors.has(errorKey(e))
  );
  if (visibleErrors.length > 0) {
    updateWidget(element, "errors", visibleErrors.length, () => {
      openErrorPanelForElement(element);
    });
    return;
  }

  const text = normalizeText(getElementText(element));
  if (text.trim() && !isLikelyEnglish(text)) {
    updateWidget(element, "idle");
    return;
  }

  if (!text.trim() || text.trim().length < 10) {
    updateWidget(element, "ready");
    return;
  }

  if (text === state.lastText) return;
  if (text === state.pendingText) {
    if (isPendingRequestStale(state)) {
      console.warn("[AI Grammar Checker] Clearing stale pending check on focus");
      invalidatePendingRequest(state, text);
    } else {
      return;
    }
  }

  updateWidget(element, "checking");
  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
  }
  state.debounceTimer = window.setTimeout(async () => {
    await checkElement(element);
  }, Math.min(debounceMs, FOCUS_CHECK_DELAY_MS));
}

async function checkElement(element: HTMLElement, autoShowPanel = false, retryCount = 0): Promise<void> {
  if (runtimeInvalidated || !isRuntimeAvailable()) {
    handleRuntimeInvalidation("checkElement");
    return;
  }

  if (configuredCache === null) configuredCache = await isConfigured();
  if (!configuredCache) {
    console.log("[AI Grammar Checker] API key not configured, skipping check");
    return;
  }

  const state = elementStates.get(element);
  if (!state) return;

  const text = normalizeText(getElementText(element));

  if (text.trim() && !isLikelyEnglish(text)) {
    clearPendingCheck(state);
    if (state.errors.length > 0) {
      state.errors = [];
      clearErrors(element);
    }
    state.pendingText = null;
    state.lastText = text;
    updateWidget(element, "idle");
    return;
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

  // Skip unchanged text (normalized comparison to avoid spurious rechecks
  // from contenteditable editors that add/remove trailing whitespace)
  if (text === state.lastText) return;
  if (text === state.pendingText) {
    if (isPendingRequestStale(state)) {
      console.warn("[AI Grammar Checker] Clearing stale pending check before new check");
      invalidatePendingRequest(state, text);
    } else {
      return;
    }
  }

  state.pendingText = text;
  state.pendingStartedAt = Date.now();
  const checkGeneration = ++state.checkGeneration;
  clearRequestTimeout(state);

  // Show checking widget
  console.log("[AI Grammar Checker] Checking text:", text.substring(0, 50) + (text.length > 50 ? "..." : ""));
  updateWidget(element, "checking");

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const request: CheckRequest = {
      type: "CHECK_GRAMMAR",
      text,
      requestId,
      sourceId: state.sourceId,
    };

    state.requestTimeoutTimer = window.setTimeout(() => {
      const latestState = elementStates.get(element);
      if (!latestState || latestState.checkGeneration !== checkGeneration) {
        return;
      }
      console.warn("[AI Grammar Checker] Check request timed out, recovering pending state");
      invalidatePendingRequest(latestState, text);
      updateWidget(element, "error");
      if (normalizeText(getElementText(element)) === text) {
        setTimeout(() => {
          const retryState = elementStates.get(element);
          if (!retryState) return;
          if (normalizeText(getElementText(element)) !== text) return;
          checkElement(element, autoShowPanel, Math.min(retryCount + 1, 1));
        }, 300);
      }
    }, CHECK_REQUEST_TIMEOUT_MS);

    const response: CheckResponse = await chrome.runtime.sendMessage(request);
    const latestState = elementStates.get(element);
    if (!latestState || latestState.checkGeneration !== checkGeneration) {
      return;
    }
    clearRequestTimeout(latestState);

    if (response.error) {
      if (latestState.pendingText === text) {
        latestState.pendingText = null;
        latestState.pendingStartedAt = null;
      }
      const isRateLimit = response.error.includes("Rate limit") || response.rateLimitedUntil;
      if (!isRateLimit && retryCount < 1) {
        console.log("[AI Grammar Checker] API error, retrying in 2s:", response.error);
        updateWidget(element, "error");
        setTimeout(() => {
          const retryState = elementStates.get(element);
          if (!retryState || retryState.checkGeneration !== checkGeneration) return;
          if (normalizeText(getElementText(element)) !== text) return;
          checkElement(element, autoShowPanel, retryCount + 1);
        }, 2000);
        return;
      }
      console.log("[AI Grammar Checker] API error (no retry):", response.error);
      updateWidget(element, "idle");
      return;
    }

    // Only apply if text hasn't changed since we sent the request
    // Use normalized comparison — contenteditable editors (LinkedIn, Medium)
    // frequently mutate trailing whitespace/newlines between check and response
    const currentText = normalizeText(getElementText(element));

    if (currentText !== text) {
      if (latestState.pendingText === text) {
        latestState.pendingText = null;
        latestState.pendingStartedAt = null;
      }
      console.log("[AI Grammar Checker] Text changed during check, discarding result");
      if (latestState.debounceTimer === null) {
        updateWidget(element, "idle");
      }
      return;
    }

    latestState.lastText = text;
    if (latestState.pendingText === text) {
      latestState.pendingText = null;
      latestState.pendingStartedAt = null;
    }

    // Filter out errors that would reverse a recently applied fix (prevents oscillation)
    latestState.errors = response.errors.filter((e) => !isReverseFix(element, e));
    latestState.correctedText = response.correctedText;

    console.log("[AI Grammar Checker] Found", latestState.errors.length, "errors");

    // Update widget state
    const visibleErrors = latestState.errors.filter(
      (e) => !latestState.ignoredErrors.has(errorKey(e))
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
    const latestState = elementStates.get(element);
    if (!latestState || latestState.checkGeneration !== checkGeneration) {
      return;
    }
    clearRequestTimeout(latestState);
    if (latestState.pendingText === text) {
      latestState.pendingText = null;
      latestState.pendingStartedAt = null;
    }
    if (isRuntimeInvalidationError(err) || !isRuntimeAvailable()) {
      handleRuntimeInvalidation(err);
      return;
    }
    if (retryCount < 1) {
      console.warn("[AI Grammar Checker] Error, retrying in 2s:", err);
      updateWidget(element, "error");
      setTimeout(() => {
        const retryState = elementStates.get(element);
        if (!retryState || retryState.checkGeneration !== checkGeneration) return;
        if (normalizeText(getElementText(element)) !== text) return;
        checkElement(element, autoShowPanel, retryCount + 1);
      }, 2000);
    } else {
      console.warn("[AI Grammar Checker] Error (no retry):", err);
      updateWidget(element, "idle");
    }
  }
}

function isRuntimeAvailable(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function isRuntimeInvalidationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    message.includes("Extension context invalidated") ||
    message.includes("Extension context was invalidated") ||
    message.includes("Receiving end does not exist")
  );
}

function handleRuntimeInvalidation(reason?: unknown): void {
  if (runtimeInvalidated) return;

  runtimeInvalidated = true;
  backgroundPrewarmed = false;
  backgroundPrewarmPromise = null;
  configuredCache = false;
  console.warn("[AI Grammar Checker] Runtime invalidated; refresh tab to restore checking", reason);

  if (maintenanceIntervalId !== null) {
    clearInterval(maintenanceIntervalId);
    maintenanceIntervalId = null;
  }

  for (const element of trackedElements) {
    const state = elementStates.get(element);
    if (state) {
      state.pendingText = null;
      state.pendingStartedAt = null;
      state.lastText = "";
      state.errors = [];
      cleanupElementState(element);
    }
    clearErrors(element);
    removeWidget(element);
  }

  trackedElements.clear();
  removeAllWidgets();
}

function getSourceId(element: HTMLElement): string {
  let sourceId = elementSourceIds.get(element);
  if (!sourceId) {
    sourceId = `editor-${sourceCounter++}`;
    elementSourceIds.set(element, sourceId);
  }
  return sourceId;
}

function cleanupElementState(element: HTMLElement): void {
  const state = elementStates.get(element);
  if (!state) return;

  clearPendingCheck(state);
  clearFocusOutTimer(state);

  for (const observer of state.observers) {
    observer.disconnect();
  }
  state.observers = [];
}

function clearPendingCheck(state: ElementState): void {
  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  clearRequestTimeout(state);
}

function clearFocusOutTimer(state: ElementState): void {
  if (state.focusOutTimer !== null) {
    clearTimeout(state.focusOutTimer);
    state.focusOutTimer = null;
  }
}

function clearRequestTimeout(state: ElementState): void {
  if (state.requestTimeoutTimer !== null) {
    clearTimeout(state.requestTimeoutTimer);
    state.requestTimeoutTimer = null;
  }
}

function invalidatePendingRequest(state: ElementState, pendingText?: string): void {
  clearRequestTimeout(state);
  if (!pendingText || state.pendingText === pendingText) {
    state.pendingText = null;
    state.pendingStartedAt = null;
  }
  state.checkGeneration += 1;
}

function recoverVisiblePendingChecks(onlyStale = false): void {
  for (const element of trackedElements) {
    if (!element.isConnected) continue;
    const state = elementStates.get(element);
    if (!state || !state.pendingText) continue;
    if (onlyStale && !isPendingRequestStale(state)) continue;

    const currentText = normalizeText(getElementText(element));
    if (currentText !== state.pendingText) {
      invalidatePendingRequest(state);
      if (isElementActive(element)) {
        updateWidget(element, currentText.trim().length >= 10 ? "ready" : "idle");
      } else {
        updateWidget(element, "idle");
      }
      continue;
    }

    console.warn("[AI Grammar Checker] Recovering stale pending check after tab became visible");
    invalidatePendingRequest(state, currentText);
    if (currentText.trim().length >= 10) {
      void checkElement(element);
    } else if (isElementActive(element)) {
      updateWidget(element, "ready");
    } else {
      updateWidget(element, "idle");
    }
  }
}

function isPendingRequestStale(state: ElementState): boolean {
  return state.pendingStartedAt !== null && Date.now() - state.pendingStartedAt >= STALE_PENDING_THRESHOLD_MS;
}

function recoverElementIfStuck(element: HTMLElement, forceRecheck = false): void {
  const state = elementStates.get(element);
  if (!state) return;
  if (getWidgetState(element) !== "checking") return;

  if (state.pendingText) {
    if (isPendingRequestStale(state)) {
      console.warn("[AI Grammar Checker] Recovering stale checking widget with pending text");
      const pendingText = state.pendingText;
      invalidatePendingRequest(state, pendingText);
      if (normalizeText(getElementText(element)) === pendingText && pendingText.trim().length >= 10) {
        void checkElement(element);
      } else if (isElementActive(element)) {
        updateWidget(element, "ready");
      } else {
        updateWidget(element, "idle");
      }
    }
    return;
  }

  const currentText = normalizeText(getElementText(element));
  const visibleErrors = state.errors.filter(
    (e) => !state.ignoredErrors.has(errorKey(e))
  );

  console.warn("[AI Grammar Checker] Recovering desynced checking widget without pending request");
  if (visibleErrors.length > 0) {
    updateWidget(element, "errors", visibleErrors.length, () => {
      openErrorPanelForElement(element);
    });
    return;
  }

  if (!currentText.trim() || currentText.trim().length < 10) {
    updateWidget(element, isElementActive(element) ? "ready" : "idle");
    return;
  }

  updateWidget(element, isElementActive(element) ? "ready" : "idle");
  if (forceRecheck || isElementActive(element)) {
    void checkElement(element);
  }
}

function logEditorClassification(element: HTMLElement, classification: EditorClassification): void {
  const signature = `${classification.eligible}:${classification.intent}:${classification.reason}`;
  if (loggedClassifications.get(element) === signature) return;
  loggedClassifications.set(element, signature);
  console.log(
    `[AI Grammar Checker] editor classification: eligible=${classification.eligible} intent=${classification.intent} reason=${classification.reason}`
  );
}

function deactivateElement(element: HTMLElement): void {
  const state = elementStates.get(element);
  if (!state) return;
  clearErrors(element);
  removeWidget(element);
  cleanupElementState(element);
  trackedElements.delete(element);
  elementStates.delete(element);
}

function getActiveTrackedElement(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;

  const matched = findEditableRoot(active);
  if (matched && elementStates.has(matched)) {
    return matched;
  }

  for (const el of trackedElements) {
    if (el === active || el.contains(active)) {
      return el;
    }
  }

  return null;
}

function isElementActive(element: HTMLElement): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && (active === element || element.contains(active));
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
      // On accept (hover tooltip fix): clear all underlines immediately, then re-check.
      // Don't auto-show the Fix All panel — only the panel's own accept should do that.
      const s = elementStates.get(element);
      if (s) {
        s.errors = [];
        s.lastText = ""; // Force re-check
        clearErrors(element);
        updateWidget(element, "idle");
        setTimeout(() => checkElement(element, false), 300);
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
    },
    state.renderGeneration
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
