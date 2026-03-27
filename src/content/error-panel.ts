import { GrammarError } from "../shared/types.js";
import { getShadowRoot, getShadowHost } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";
import { applyFix, applyFixDirectly, escapeHtml, hidePopover } from "./popover.js";
import { errorKey } from "./underline-renderer.js";
import { trackAppliedFix } from "./text-monitor.js";
import {
  getContentEditableText,
  buildContentEditableSnapshot,
  getContentEditableRangeForError,
} from "./contenteditable-snapshot.js";

let currentPanel: HTMLElement | null = null;
let currentElement: HTMLElement | null = null;
let panelCloseHandler: ((e: Event) => void) | null = null;
let panelEscHandler: ((e: KeyboardEvent) => void) | null = null;
let panelScrollHandler: (() => void) | null = null;
let panelInputHandler: (() => void) | null = null;

export function isErrorPanelOpen(): boolean {
  return currentPanel !== null;
}

export function isErrorPanelOpenForElement(element: HTMLElement): boolean {
  return currentPanel !== null && currentElement === element;
}

export function getErrorPanelElement(): HTMLElement | null {
  return currentElement;
}

export function showErrorPanel(
  element: HTMLElement,
  errors: GrammarError[],
  ignoredErrors: Set<string>,
  elementRect: DOMRect,
  correctedText: string | undefined,
  onAccept: () => void,
  onDismiss: (key: string) => void
): void {
  console.log("[AI Grammar Checker] showErrorPanel called, errors:", errors.length);
  hideErrorPanel();
  hidePopover();

  const dark = isDarkMode();
  const root = getShadowRoot();
  const panel = document.createElement("div");
  panel.className = `grammar-error-panel${dark ? " grammar-error-panel--dark" : ""}`;

  currentPanel = panel;
  currentElement = element;

  // Filter visible errors
  const visibleErrors = errors.filter(
    (e) => !ignoredErrors.has(errorKey(e))
  );

  if (visibleErrors.length === 0) return;

  // Track remaining errors for Fix All
  let remainingErrors = [...visibleErrors];

  // Header
  const header = document.createElement("div");
  header.className = "grammar-error-panel__header";

  const title = document.createElement("span");
  title.className = "grammar-error-panel__title";
  title.textContent = `${visibleErrors.length} issue${visibleErrors.length !== 1 ? "s" : ""} found`;

  const headerActions = document.createElement("div");
  headerActions.className = "grammar-error-panel__header-actions";

  const fixAllBtn = document.createElement("button");
  fixAllBtn.className = "grammar-error-panel__fix-all";
  fixAllBtn.textContent = "Fix All";

  const closeBtn = document.createElement("button");
  closeBtn.className = "grammar-error-panel__close";
  closeBtn.innerHTML = "\u00d7";

  headerActions.appendChild(fixAllBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(headerActions);
  panel.appendChild(header);

  // Scrollable error list
  const list = document.createElement("div");
  list.className = "grammar-error-panel__list";

  // Success state (hidden initially)
  const success = document.createElement("div");
  success.className = "grammar-error-panel__success";
  success.style.display = "none";
  success.innerHTML = `<span>\u2713</span>All issues fixed!`;

  for (const error of visibleErrors) {
    const item = createErrorItem(error, element, dark, (fixedError) => {
      // Individual fix — adjust remaining errors' offsets to account for text length change
      const delta = fixedError.suggestion.length - fixedError.original.length;
      remainingErrors = remainingErrors.filter((e) => e !== fixedError);
      for (const err of remainingErrors) {
        if (err.offset > fixedError.offset) {
          err.offset += delta;
        }
      }
      // Also update correctedText to remove the applied fix so Fix All still works
      correctedText = undefined;
      updateTitle(title, remainingErrors.length);
      if (remainingErrors.length === 0) {
        showSuccessState(list, success, fixAllBtn);
        onAccept();
      }
    }, (dismissedError) => {
      // Individual dismiss
      remainingErrors = remainingErrors.filter((e) => e !== dismissedError);
      onDismiss(errorKey(dismissedError));
      updateTitle(title, remainingErrors.length);
      if (remainingErrors.length === 0) {
        showSuccessState(list, success, fixAllBtn);
      }
    });
    list.appendChild(item);
  }

  panel.appendChild(list);
  panel.appendChild(success);

  // Fix All handler
  fixAllBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    fixAllBtn.setAttribute("disabled", "true");

    // Temporarily ignore inputs so the synthetic events from applying fixes don't close the panel
    if (panelInputHandler) {
      element.removeEventListener("input", panelInputHandler);
    }

    await applyAllFixes(element, remainingErrors, list, correctedText);

    // Convergence loop: ask the AI if there's anything left
    let loopCount = 0;
    while (loopCount < 2) {
      loopCount++;
      const currentText = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? element.value
        : getContentEditableText(element);

      if (!currentText.trim()) break;

      updateTitle(title, "Fixing remaining... " + loopCount);

      const requestId = `convergence-${Date.now()}`;
      try {
        const response: any = await chrome.runtime.sendMessage({
          type: "CHECK_GRAMMAR",
          text: currentText,
          requestId,
        });

        // Break if completely clean or API failed
        if (response.error || !response.errors || response.errors.length === 0) {
          break;
        }

        await applyAllFixes(element, response.errors, list, response.correctedText);
      } catch (err) {
        console.warn("[AI Grammar Checker] Convergence check failed:", err);
        break;
      }
    }

    remainingErrors = [];
    updateTitle(title, 0);
    showSuccessState(list, success, fixAllBtn);
    onAccept();
  });

  // Close button
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    animateHidePanel();
  });

  // Append to shadow root and position
  root.appendChild(panel);
  positionPanel(panel, elementRect);
  console.log("[AI Grammar Checker] Panel appended, position:", panel.style.top, panel.style.left, "size:", panel.getBoundingClientRect().width, panel.getBoundingClientRect().height);

  // Close on click outside
  setTimeout(() => {
    panelCloseHandler = (e: Event) => {
      const host = getShadowHost();
      const path = e.composedPath();
      if (currentPanel && host && !path.includes(host)) {
        animateHidePanel();
      }
    };
    document.addEventListener("mousedown", panelCloseHandler, true);
  }, 50);

  // Close on Escape
  panelEscHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      animateHidePanel();
    }
  };
  document.addEventListener("keydown", panelEscHandler, true);

  // Close on scroll/resize (with delay to avoid immediate closure from page scroll events)
  setTimeout(() => {
    panelScrollHandler = () => {
      animateHidePanel();
    };
    window.addEventListener("scroll", panelScrollHandler, true);
    window.addEventListener("resize", panelScrollHandler);
  }, 300);

  // Close on user typing (errors become stale)
  panelInputHandler = () => {
    animateHidePanel();
  };
  element.addEventListener("input", panelInputHandler);
}

function createErrorItem(
  error: GrammarError,
  element: HTMLElement,
  dark: boolean,
  onFix: (error: GrammarError) => void,
  onDismissItem: (error: GrammarError) => void
): HTMLElement {
  const item = document.createElement("div");
  item.className = "grammar-error-panel__item";

  item.innerHTML = `
    <div class="grammar-error-panel__item-header">
      <span class="grammar-popover__badge grammar-popover__badge--${error.type}">
        ${error.type}
      </span>
    </div>
    <div class="grammar-error-panel__item-correction">
      <span class="grammar-popover__original">${escapeHtml(error.original)}</span>
      <span class="grammar-popover__arrow">\u2192</span>
      <span class="grammar-popover__suggestion">${escapeHtml(error.suggestion)}</span>
    </div>
    <div class="grammar-error-panel__item-explanation">${escapeHtml(error.explanation)}</div>
    <div class="grammar-error-panel__item-actions">
      <button class="grammar-error-panel__item-btn grammar-error-panel__item-btn--fix">Fix</button>
      <button class="grammar-error-panel__item-btn grammar-error-panel__item-btn--dismiss">Dismiss</button>
    </div>
  `;

  const fixBtn = item.querySelector(".grammar-error-panel__item-btn--fix")!;
  const dismissBtn = item.querySelector(".grammar-error-panel__item-btn--dismiss")!;

  fixBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    applyFix(element, error);
    animateRemoveItem(item);
    onFix(error);
  });

  dismissBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    animateRemoveItem(item);
    onDismissItem(error);
  });

  return item;
}

/**
 * Apply all remaining fixes at once.
 * Uses correctedText from the AI when available for a clean one-shot replacement.
 * Falls back to building corrected string from individual fixes.
 */
async function applyAllFixes(
  element: HTMLElement,
  errors: GrammarError[],
  listEl: HTMLElement,
  correctedText?: string
): Promise<void> {
  // Animate all items out
  const items = listEl.querySelectorAll(".grammar-error-panel__item");
  items.forEach((item) => {
    (item as HTMLElement).classList.add("grammar-error-panel__item--removing");
  });

  // Track all fixes to prevent oscillation on re-check
  for (const err of errors) {
    trackAppliedFix(element, err.original, err.suggestion);
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.focus();

    const currentValue = element.value;
    const surfacedValue = buildTextareaValueFromErrors(currentValue, errors);

    // Use correctedText from AI first to ensure all structural changes are applied,
    // falling back to manually merging surfaced errors if missing.
    const value =
      correctedText && correctedText !== currentValue
        ? correctedText
        : surfacedValue !== currentValue
          ? surfacedValue
          : currentValue;

    // Try execCommand for undo support: select all text, then insert corrected version
    element.setSelectionRange(0, element.value.length);
    const inserted = document.execCommand("insertText", false, value);

    if (!inserted || element.value !== value) {
      // Fallback: direct value assignment
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  } else if (element.isContentEditable) {
    element.focus();
    let sorted: GrammarError[] | null = null;

    if (correctedText && correctedText !== getContentEditableText(element)) {
      console.log("[AI Grammar Checker] Fix All: applying canonical diff for contenteditable");
      const canonicalErrors = buildCanonicalFixAllErrors(getContentEditableText(element), correctedText);
      sorted = canonicalErrors.sort((a, b) => b.offset - a.offset);
    } else {
      console.log("[AI Grammar Checker] Fix All: applying", errors.length, "surfaced fixes for contenteditable");
      sorted = [...errors].sort((a, b) => b.offset - a.offset);
    }

    await applyFixesSequentially(element, sorted, 0);
  }
}

function buildTextareaValueFromErrors(value: string, errors: GrammarError[]): string {
  const sorted = [...errors].sort((a, b) => b.offset - a.offset);
  let nextValue = value;

  for (const err of sorted) {
    let idx = err.offset;
    if (err.length === 0) {
      if (idx < 0 || idx > nextValue.length) {
        idx = nextValue.length;
      }
    } else if (idx < 0 || nextValue.substring(idx, idx + err.original.length) !== err.original) {
      idx = findNearestOccurrence(nextValue, err.original, err.offset);
    }

    if (idx === -1) continue;

    const before = nextValue.substring(0, idx);
    const after = nextValue.substring(idx + err.original.length);
    nextValue = before + err.suggestion + after;
  }

  return nextValue;
}

function findNearestOccurrence(text: string, needle: string, preferredOffset: number): number {
  const candidates: number[] = [];
  let searchFrom = 0;
  while (true) {
    const foundIndex = text.indexOf(needle, searchFrom);
    if (foundIndex < 0) break;
    candidates.push(foundIndex);
    searchFrom = foundIndex + 1;
  }

  if (candidates.length === 0) {
    return -1;
  }

  const wordLike = /^[A-Za-z0-9']+$/.test(needle);
  const wholeWordCandidates = wordLike
    ? candidates.filter((index) => isWholeWordMatch(text, index, needle.length))
    : candidates;
  const usable = wholeWordCandidates.length > 0 ? wholeWordCandidates : candidates;

  if (preferredOffset < 0) {
    return usable[0];
  }

  let bestIndex = usable[0];
  let bestDistance = Math.abs(bestIndex - preferredOffset);
  for (const index of usable) {
    const distance = Math.abs(index - preferredOffset);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return bestIndex;
}

function isWholeWordMatch(text: string, index: number, length: number): boolean {
  const before = index > 0 ? text[index - 1] : "";
  const after = index + length < text.length ? text[index + length] : "";
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9']/.test(char);
}

/**
 * Apply contentEditable fixes one at a time with inline verification and fallback.
 * Does NOT delegate to applyFix (which has fire-and-forget timeouts) to avoid
 * race conditions when applying multiple fixes sequentially.
 */
async function applyFixesSequentially(
  element: HTMLElement,
  errors: GrammarError[],
  index: number
): Promise<void> {
  // Use a loop to avoid deep call stacking, process as fast as possible synchronously
  for (let i = index; i < errors.length; i++) {
    const error = errors[i];
    const textBefore = getContentEditableText(element);

    // Step 1: Try execCommand with proper selection
    let applied = false;
    const snapshot = buildContentEditableSnapshot(element);
    const range = getContentEditableRangeForError(element, error, snapshot);
    if (range) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
        try {
          document.execCommand("insertText", false, error.suggestion);
          if (getContentEditableText(element) !== textBefore) {
            applied = true;
          }
        } catch {
          // ignored
        }
      }
    }

    if (!applied) {
      // Wait briefly for editor to process
      await delay(30);
      applied = getContentEditableText(element) !== textBefore;
    }

    // Step 2: If execCommand didn't work, try MAIN world
    if (!applied) {
      if (range) {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      window.postMessage(
        { type: "AI_GRAMMAR_APPLY_FIX", suggestion: error.suggestion },
        "*"
      );
      await delay(50);
      applied = getContentEditableText(element) !== textBefore;
    }

    // Step 3: If still not applied, use direct DOM manipulation
    if (!applied) {
      console.log("[AI Grammar Checker] Fix All: execCommand failed for", JSON.stringify(error.original), "→", JSON.stringify(error.suggestion), ", using DOM fallback");
      applyFixDirectly(element, error);
      if (getContentEditableText(element) !== textBefore) {
        applied = true;
      } else {
        await delay(50);
        applied = getContentEditableText(element) !== textBefore;
      }
    }

    if (!applied) {
      console.log("[AI Grammar Checker] Fix All: all methods failed for", JSON.stringify(error.original));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DiffToken {
  text: string;
  start: number;
  end: number;
}

function buildCanonicalFixAllErrors(
  originalText: string,
  correctedText: string
): GrammarError[] {
  if (!correctedText || correctedText === originalText) {
    return [];
  }

  const originalTokens = tokenizeDiffTokens(originalText);
  const correctedTokens = tokenizeDiffStrings(correctedText);
  if (originalTokens.length === 0 || correctedTokens.length === 0) {
    const edit = buildCanonicalDiffError(originalText, originalTokens, 0, originalTokens, correctedTokens);
    return edit ? [edit] : [];
  }

  const lcs = buildTokenLcsMatrix(
    originalTokens.map((token) => token.text),
    correctedTokens
  );

  const edits: GrammarError[] = [];
  let i = 0;
  let j = 0;
  const originalLength = originalTokens.length;
  const correctedLength = correctedTokens.length;

  while (i < originalLength || j < correctedLength) {
    if (
      i < originalLength &&
      j < correctedLength &&
      originalTokens[i].text === correctedTokens[j]
    ) {
      i++;
      j++;
      continue;
    }

    const startI = i;
    const startJ = j;

    while (i < originalLength || j < correctedLength) {
      if (
        i < originalLength &&
        j < correctedLength &&
        originalTokens[i].text === correctedTokens[j]
      ) {
        break;
      }

      if (i >= originalLength) {
        j++;
        continue;
      }

      if (j >= correctedLength) {
        i++;
        continue;
      }

      const skipOriginal = lcs[(i + 1) * (correctedLength + 1) + j];
      const skipCorrected = lcs[i * (correctedLength + 1) + (j + 1)];
      if (skipOriginal >= skipCorrected) {
        i++;
      } else {
        j++;
      }
    }

    const edit = buildCanonicalDiffError(
      originalText,
      originalTokens,
      startI,
      originalTokens.slice(startI, i),
      correctedTokens.slice(startJ, j)
    );
    if (edit) {
      edits.push(edit);
    }
  }

  return edits.filter((edit) => edit.original !== edit.suggestion);
}

function tokenizeDiffTokens(text: string): DiffToken[] {
  const regex = /\s+|[A-Za-z0-9']+|[^\sA-Za-z0-9']/g;
  const tokens: DiffToken[] = [];
  for (const match of text.matchAll(regex)) {
    const token = match[0];
    const start = match.index ?? 0;
    tokens.push({
      text: token,
      start,
      end: start + token.length,
    });
  }
  return tokens;
}

function tokenizeDiffStrings(text: string): string[] {
  return Array.from(text.match(/\s+|[A-Za-z0-9']+|[^\sA-Za-z0-9']/g) || []);
}

function buildTokenLcsMatrix(originalTokens: string[], correctedTokens: string[]): Uint32Array {
  const columns = correctedTokens.length + 1;
  const matrix = new Uint32Array((originalTokens.length + 1) * columns);

  for (let i = originalTokens.length - 1; i >= 0; i--) {
    for (let j = correctedTokens.length - 1; j >= 0; j--) {
      const index = i * columns + j;
      if (originalTokens[i] === correctedTokens[j]) {
        matrix[index] = matrix[(i + 1) * columns + (j + 1)] + 1;
      } else {
        matrix[index] = Math.max(
          matrix[(i + 1) * columns + j],
          matrix[i * columns + (j + 1)]
        );
      }
    }
  }

  return matrix;
}

function buildCanonicalDiffError(
  originalText: string,
  allOriginalTokens: DiffToken[],
  insertionTokenIndex: number,
  originalTokens: DiffToken[],
  correctedTokens: string[]
): GrammarError | null {
  const suggestionText = correctedTokens.join("");

  if (originalTokens.length === 0) {
    const insertionOffset =
      insertionTokenIndex < allOriginalTokens.length
        ? allOriginalTokens[insertionTokenIndex].start
        : originalText.length;
    if (!suggestionText) {
      return null;
    }
    return {
      original: "",
      suggestion: suggestionText,
      offset: insertionOffset,
      length: 0,
      type: classifyCanonicalDiffType("", suggestionText),
      explanation: "Derived from the corrected text returned by the AI.",
    };
  }

  const offset = originalTokens[0].start;
  const end = originalTokens[originalTokens.length - 1].end;
  let original = originalText.slice(offset, end);
  let suggestion = suggestionText;
  let trimmedOffset = offset;

  while (
    original.length > 0 &&
    suggestion.length > 0 &&
    original[0] === suggestion[0]
  ) {
    original = original.slice(1);
    suggestion = suggestion.slice(1);
    trimmedOffset++;
  }

  while (
    original.length > 0 &&
    suggestion.length > 0 &&
    original[original.length - 1] === suggestion[suggestion.length - 1]
  ) {
    original = original.slice(0, -1);
    suggestion = suggestion.slice(0, -1);
  }

  if (!original && !suggestion) {
    return null;
  }

  return {
    original,
    suggestion,
    offset: trimmedOffset,
    length: original.length,
    type: classifyCanonicalDiffType(original, suggestion),
    explanation: "Derived from the corrected text returned by the AI.",
  };
}

function classifyCanonicalDiffType(
  original: string,
  suggestion: string
): GrammarError["type"] {
  const stripWordChars = (value: string) => value.replace(/[A-Za-z0-9\s]/g, "");
  const lowerOriginal = original.toLowerCase();
  const lowerSuggestion = suggestion.toLowerCase();

  if (
    lowerOriginal.replace(/[^\w]/g, "") === lowerSuggestion.replace(/[^\w]/g, "") &&
    stripWordChars(original) !== stripWordChars(suggestion)
  ) {
    return "punctuation";
  }

  const originalWords = lowerOriginal.match(/[a-z0-9']+/g) || [];
  const suggestionWords = lowerSuggestion.match(/[a-z0-9']+/g) || [];
  if (
    originalWords.length === suggestionWords.length &&
    originalWords.length === 1 &&
    originalWords[0] &&
    suggestionWords[0] &&
    editDistance(originalWords[0], suggestionWords[0]) <= 2
  ) {
    return "spelling";
  }

  return "grammar";
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function animateRemoveItem(item: HTMLElement): void {
  item.classList.add("grammar-error-panel__item--removing");
  setTimeout(() => {
    if (item.parentNode) item.remove();
  }, 300);
}

function updateTitle(titleEl: HTMLElement, count: number | string): void {
  if (typeof count === "string") {
    titleEl.textContent = count;
  } else {
    if (count > 0) {
      titleEl.textContent = `${count} issue${count !== 1 ? "s" : ""} found`;
    } else {
      titleEl.textContent = "No issues remaining";
    }
  }
}

function showSuccessState(
  listEl: HTMLElement,
  successEl: HTMLElement,
  fixAllBtn: HTMLElement
): void {
  fixAllBtn.style.display = "none";
  setTimeout(() => {
    listEl.style.display = "none";
    successEl.style.display = "block";
    // Auto-close after 1.5s
    setTimeout(() => {
      animateHidePanel();
    }, 1500);
  }, 300);
}

function positionPanel(panel: HTMLElement, elementRect: DOMRect): void {
  const margin = 8;
  const panelRect = panel.getBoundingClientRect();

  // Position: above the bottom-right corner of the element (near the widget)
  let top = elementRect.bottom - panelRect.height - 40; // 40px above widget area
  let left = elementRect.right - panelRect.width - margin;

  // If would go above viewport, position below the element instead
  if (top < margin) {
    top = elementRect.bottom + margin;
  }

  // Keep within viewport horizontally
  if (left < margin) {
    left = margin;
  }
  if (left + panelRect.width > window.innerWidth - margin) {
    left = window.innerWidth - panelRect.width - margin;
  }

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

function animateHidePanel(): void {
  if (!currentPanel) return;
  console.log("[AI Grammar Checker] animateHidePanel called");
  const panel = currentPanel;
  panel.classList.add("grammar-error-panel--closing");
  cleanupListeners();
  currentPanel = null;
  currentElement = null;
  setTimeout(() => {
    if (panel.parentNode) panel.remove();
  }, 120);
}

export function hideErrorPanel(): void {
  if (currentPanel) {
    cleanupListeners();
    currentPanel.remove();
    currentPanel = null;
    currentElement = null;
  }
}

function cleanupListeners(): void {
  if (panelCloseHandler) {
    document.removeEventListener("mousedown", panelCloseHandler, true);
    panelCloseHandler = null;
  }
  if (panelEscHandler) {
    document.removeEventListener("keydown", panelEscHandler, true);
    panelEscHandler = null;
  }
  if (panelScrollHandler) {
    window.removeEventListener("scroll", panelScrollHandler, true);
    window.removeEventListener("resize", panelScrollHandler);
    panelScrollHandler = null;
  }
  if (panelInputHandler && currentElement) {
    currentElement.removeEventListener("input", panelInputHandler);
    panelInputHandler = null;
  }
}
