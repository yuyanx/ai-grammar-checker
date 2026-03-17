import { GrammarError } from "../shared/types.js";
import { getShadowRoot, getShadowHost } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";
import { clearErrors, clearAllErrors } from "./underline-renderer.js";

let currentPopover: HTMLElement | null = null;
let closeHandler: ((e: Event) => void) | null = null;
let hoverTimeout: number | null = null;

/**
 * Show popover on hover with a 200ms delay (Grammarly-style).
 * Called from underline-renderer when mouseenter fires.
 */
export function showPopoverOnHover(
  error: GrammarError,
  anchorRect: DOMRect,
  targetElement: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  onAccept: () => void,
  onDismiss: () => void,
  underlineEl: HTMLElement
): void {
  cancelHoverPopover();

  hoverTimeout = window.setTimeout(() => {
    hoverTimeout = null;
    showPopover(error, anchorRect, targetElement, onAccept, onDismiss);
  }, 200);

  // If mouse leaves underline before timeout, cancel
  const onLeave = () => {
    cancelHoverPopover();
    underlineEl.removeEventListener("mouseleave", onLeave);
  };
  underlineEl.addEventListener("mouseleave", onLeave);
}

export function cancelHoverPopover(): void {
  if (hoverTimeout !== null) {
    clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }
}

export function showPopover(
  error: GrammarError,
  anchorRect: DOMRect,
  targetElement: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  onAccept: () => void,
  onDismiss: () => void
): void {
  hidePopover();

  const dark = isDarkMode();
  const root = getShadowRoot();
  const popover = document.createElement("div");
  popover.className = `grammar-popover${dark ? " grammar-popover--dark" : ""}`;

  // Caret element (arrow pointing to underline)
  const caret = document.createElement("div");
  caret.className = "grammar-popover__caret";
  popover.appendChild(caret);

  const content = document.createElement("div");
  content.innerHTML = `
    <div class="grammar-popover__header">
      <span class="grammar-popover__badge grammar-popover__badge--${error.type}">
        ${error.type}
      </span>
    </div>
    <div class="grammar-popover__correction" title="Click to apply fix">
      <span class="grammar-popover__original">${escapeHtml(error.original)}</span>
      <span class="grammar-popover__arrow">\u2192</span>
      <span class="grammar-popover__suggestion">${escapeHtml(error.suggestion)}</span>
    </div>
    <div class="grammar-popover__explanation">${escapeHtml(error.explanation)}</div>
    <div class="grammar-popover__actions">
      <button class="grammar-popover__btn grammar-popover__btn--accept">Accept</button>
      <button class="grammar-popover__btn grammar-popover__btn--dismiss">Dismiss</button>
    </div>
  `;
  popover.appendChild(content);

  // Position: below the underline, or above if near viewport bottom
  const gap = 10;
  let top = anchorRect.bottom + gap;
  let left = anchorRect.left;
  let isAbove = false;

  // Append first to measure
  root.appendChild(popover);
  currentPopover = popover;

  const popRect = popover.getBoundingClientRect();
  if (top + popRect.height > window.innerHeight - 8) {
    top = anchorRect.top - popRect.height - gap;
    isAbove = true;
    popover.classList.add("grammar-popover--above");
    caret.classList.add("grammar-popover__caret--bottom");
  }
  if (left + popRect.width > window.innerWidth - 8) {
    left = window.innerWidth - popRect.width - 8;
  }

  popover.style.top = `${top}px`;
  popover.style.left = `${Math.max(8, left)}px`;

  // Position caret horizontally to point at the anchor
  const caretLeft = Math.max(
    12,
    Math.min(
      anchorRect.left - Math.max(8, left) + anchorRect.width / 2,
      popRect.width - 20
    )
  );
  caret.style.left = `${caretLeft}px`;

  // Clickable correction box — quick-accept on click (like Grammarly)
  const correctionBox = popover.querySelector(".grammar-popover__correction")!;
  correctionBox.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  correctionBox.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    applyFix(targetElement, error);
    clearErrors(targetElement);
    clearAllErrors();
    showFixFlash(anchorRect);
    animateHidePopover();
    onAccept();
  });

  // Button handlers
  const acceptBtn = popover.querySelector(".grammar-popover__btn--accept")!;
  const dismissBtn = popover.querySelector(".grammar-popover__btn--dismiss")!;

  acceptBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  acceptBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    applyFix(targetElement, error);
    clearErrors(targetElement);
    clearAllErrors();
    showFixFlash(anchorRect);
    animateHidePopover();
    onAccept();
  });

  dismissBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onDismiss();
    animateHidePopover();
  });

  // Keep popover open when mouse enters it
  popover.addEventListener("mouseenter", () => {
    cancelHoverPopover();
  });

  // Close popover when mouse leaves it (with grace period)
  popover.addEventListener("mouseleave", () => {
    hoverTimeout = window.setTimeout(() => {
      animateHidePopover();
    }, 300);
  });

  // Close on click outside (delayed to avoid immediate close)
  setTimeout(() => {
    closeHandler = (e: Event) => {
      const host = getShadowHost();
      const path = e.composedPath();
      if (currentPopover && host && !path.includes(host)) {
        animateHidePopover();
      }
    };
    document.addEventListener("mousedown", closeHandler, true);
  }, 50);

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      animateHidePopover();
      document.removeEventListener("keydown", escHandler, true);
    }
  };
  document.addEventListener("keydown", escHandler, true);
}

/**
 * Brief green flash over corrected text (Grammarly-style positive feedback).
 */
function showFixFlash(rect: DOMRect): void {
  const root = getShadowRoot();
  const flash = document.createElement("div");
  flash.className = "grammar-fix-flash";
  flash.style.left = `${rect.left - 2}px`;
  flash.style.top = `${rect.top - 2}px`;
  flash.style.width = `${rect.width + 4}px`;
  flash.style.height = `${rect.height + 4}px`;
  root.appendChild(flash);
  setTimeout(() => flash.remove(), 600);
}

/**
 * Animate popover out with fade, then remove from DOM.
 */
function animateHidePopover(): void {
  if (!currentPopover) return;
  const popover = currentPopover;
  popover.classList.add("grammar-popover--closing");
  currentPopover = null;
  if (closeHandler) {
    document.removeEventListener("mousedown", closeHandler, true);
    closeHandler = null;
  }
  setTimeout(() => {
    if (popover.parentNode) popover.remove();
  }, 120);
}

export function hidePopover(): void {
  if (currentPopover) {
    currentPopover.remove();
    currentPopover = null;
  }
  if (closeHandler) {
    document.removeEventListener("mousedown", closeHandler, true);
    closeHandler = null;
  }
}

/**
 * Apply a grammar fix by setting the selection in the content script (isolated world),
 * then delegating execCommand('insertText') to the MAIN world page-script via postMessage.
 * Selection state is shared across worlds, so this approach works.
 */
const appliedFixes = new Set<string>();

function applyFix(
  element: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  error: GrammarError
): void {
  // Guard against double application
  const fixId = `${error.offset}:${error.original}:${error.suggestion}`;
  if (appliedFixes.has(fixId)) return;
  appliedFixes.add(fixId);
  // Clean up after a delay
  setTimeout(() => appliedFixes.delete(fixId), 2000);

  element.focus();

  let selectionSet = false;

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    selectionSet = setTextareaSelection(element, error);
  } else if (element.isContentEditable) {
    selectionSet = setContentEditableSelection(element, error);
  }

  if (selectionSet) {
    // Snapshot value before sending to MAIN world
    const valueBefore = (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
      ? element.value : null;

    // Delegate execCommand to MAIN world where it actually works
    window.postMessage(
      { type: "AI_GRAMMAR_APPLY_FIX", suggestion: error.suggestion },
      "*"
    );

    // Fallback for textareas only: if execCommand didn't work in MAIN world,
    // do a direct value replacement after a delay
    if (valueBefore !== null) {
      const el = element as HTMLTextAreaElement | HTMLInputElement;
      setTimeout(() => {
        // Only apply fallback if the value is completely unchanged
        if (el.value === valueBefore) {
          const idx = el.value.indexOf(error.original);
          if (idx === -1) return;
          const before = el.value.substring(0, idx);
          const after = el.value.substring(idx + error.original.length);
          el.value = before + error.suggestion + after;
          el.setSelectionRange(
            idx + error.suggestion.length,
            idx + error.suggestion.length
          );
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, 100);
    }
  }
}

/**
 * Set selection range on a textarea/input for the error text. Returns true if selection was set.
 */
function setTextareaSelection(
  element: HTMLTextAreaElement | HTMLInputElement,
  error: GrammarError
): boolean {
  const idx = element.value.indexOf(error.original);
  if (idx === -1) return false;
  element.setSelectionRange(idx, idx + error.original.length);
  return true;
}

/**
 * Set selection range on a contentEditable element for the error text. Returns true if selection was set.
 */
function setContentEditableSelection(
  element: HTMLElement,
  error: GrammarError
): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let full = "";
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    nodes.push({ node: n, start: full.length });
    full += n.textContent || "";
  }

  const idx = full.indexOf(error.original);
  if (idx === -1) return false;

  let startNode: Text | null = null,
    startOffset = 0,
    endNode: Text | null = null,
    endOffset = 0;

  for (const entry of nodes) {
    const nodeEnd = entry.start + (entry.node.textContent?.length || 0);
    if (!startNode && nodeEnd > idx) {
      startNode = entry.node;
      startOffset = idx - entry.start;
    }
    if (startNode && nodeEnd >= idx + error.original.length) {
      endNode = entry.node;
      endOffset = idx + error.original.length - entry.start;
      break;
    }
  }

  if (startNode && endNode) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
  }
  return false;
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
