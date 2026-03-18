import { GrammarError } from "../shared/types.js";
import { getShadowRoot, getShadowHost } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";
import { applyFix, escapeHtml, hidePopover } from "./popover.js";
import { errorKey } from "./underline-renderer.js";

let currentPanel: HTMLElement | null = null;
let currentElement: HTMLElement | null = null;
let panelCloseHandler: ((e: Event) => void) | null = null;
let panelEscHandler: ((e: KeyboardEvent) => void) | null = null;
let panelScrollHandler: (() => void) | null = null;
let panelInputHandler: (() => void) | null = null;

export function isErrorPanelOpen(): boolean {
  return currentPanel !== null;
}

export function showErrorPanel(
  element: HTMLElement,
  errors: GrammarError[],
  ignoredErrors: Set<string>,
  elementRect: DOMRect,
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
      // Individual fix
      remainingErrors = remainingErrors.filter((e) => e !== fixedError);
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
  fixAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    applyAllFixes(element, remainingErrors, list);
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
 * For input/textarea: build corrected string in one pass (reverse offset order).
 * For contentEditable: apply fixes one by one in reverse offset order.
 */
function applyAllFixes(
  element: HTMLElement,
  errors: GrammarError[],
  listEl: HTMLElement
): void {
  // Animate all items out
  const items = listEl.querySelectorAll(".grammar-error-panel__item");
  items.forEach((item) => {
    (item as HTMLElement).classList.add("grammar-error-panel__item--removing");
  });

  const sorted = [...errors].sort((a, b) => b.offset - a.offset);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    // Build corrected string in one pass
    element.focus();
    let value = element.value;
    for (const err of sorted) {
      let idx = err.offset;
      if (idx < 0 || value.substring(idx, idx + err.original.length) !== err.original) {
        idx = value.indexOf(err.original);
      }
      if (idx === -1) continue;
      const before = value.substring(0, idx);
      const after = value.substring(idx + err.original.length);
      value = before + err.suggestion + after;
    }

    // Try execCommand for undo support: select all text, then insert corrected version
    element.setSelectionRange(0, element.value.length);
    const inserted = document.execCommand("insertText", false, value);

    if (!inserted || element.value !== value) {
      // Fallback: direct value assignment
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (element.isContentEditable) {
    // Apply fixes one by one in reverse offset order with small delays
    element.focus();
    applyFixesSequentially(element, sorted, 0);
  }
}

/**
 * Apply contentEditable fixes one at a time with delays for MAIN world processing.
 */
function applyFixesSequentially(
  element: HTMLElement,
  errors: GrammarError[],
  index: number
): void {
  if (index >= errors.length) return;
  applyFix(element, errors[index]);
  setTimeout(() => {
    applyFixesSequentially(element, errors, index + 1);
  }, 50);
}

function animateRemoveItem(item: HTMLElement): void {
  item.classList.add("grammar-error-panel__item--removing");
  setTimeout(() => {
    if (item.parentNode) item.remove();
  }, 300);
}

function updateTitle(titleEl: HTMLElement, count: number): void {
  if (count > 0) {
    titleEl.textContent = `${count} issue${count !== 1 ? "s" : ""} found`;
  } else {
    titleEl.textContent = "No issues remaining";
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
  console.log("[AI Grammar Checker] animateHidePanel called", new Error().stack);
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
