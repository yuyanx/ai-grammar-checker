import { GrammarError } from "../shared/types.js";
import { getShadowRoot, getShadowHost } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";
import { clearErrors, clearAllErrors } from "./underline-renderer.js";
import { trackAppliedFix } from "./text-monitor.js";

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
export function showFixFlash(rect: DOMRect): void {
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

export function applyFix(
  element: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  error: GrammarError
): void {
  // Guard against double application
  const fixId = `${error.offset}:${error.original}:${error.suggestion}`;
  if (appliedFixes.has(fixId)) return;
  appliedFixes.add(fixId);
  // Clean up after a delay
  setTimeout(() => appliedFixes.delete(fixId), 2000);

  // Track this fix to prevent the re-check from suggesting reverting it
  trackAppliedFix(element, error.original, error.suggestion);

  element.focus();

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    // For input/textarea: direct value replacement using offset for accuracy.
    // This avoids async execCommand issues where the selection can shift.
    const value = element.value;

    // Use error.offset first, fall back to indexOf
    let idx = error.offset;
    if (error.length === 0) {
      if (idx < 0 || idx > value.length) {
        idx = value.length;
      }
    } else if (idx < 0 || value.substring(idx, idx + error.original.length) !== error.original) {
      idx = value.indexOf(error.original);
    }
    if (idx === -1) return;

    // Try execCommand first (preserves undo history)
    element.setSelectionRange(idx, idx + error.original.length);
    const inserted = document.execCommand("insertText", false, error.suggestion);

    if (!inserted || element.value === value) {
      // Fallback: direct value assignment
      const before = value.substring(0, idx);
      const after = value.substring(idx + error.original.length);
      element.value = before + error.suggestion + after;
    }

    const cursorPos = idx + error.suggestion.length;
    element.setSelectionRange(cursorPos, cursorPos);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (element.isContentEditable) {
    // Capture text before fix for verification
    const textBefore = element.innerText;
    const selectionSet = setContentEditableSelection(element, error);
    if (selectionSet) {
      // Try execCommand directly first (works in isolated world for most editors)
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, error.suggestion);
      } catch {
        inserted = false;
      }

      if (!inserted) {
        // Fallback: try via MAIN world page-script
        window.postMessage(
          { type: "AI_GRAMMAR_APPLY_FIX", suggestion: error.suggestion },
          "*"
        );
      }

      // Verify the fix applied. If text hasn't changed at all, use DOM fallback.
      setTimeout(() => {
        const textAfter = element.innerText;
        if (textAfter === textBefore) {
          console.log("[AI Grammar Checker] execCommand failed, using DOM fallback");
          directDomReplace(element, error.original, error.suggestion, error.offset);
        }
      }, 100);
    }
  }
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

  const idx = error.length === 0 ? error.offset : full.indexOf(error.original);
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

/**
 * Direct DOM manipulation fallback for contenteditable elements.
 * Walks text nodes, finds the error text, and replaces it.
 * Dispatches InputEvent to notify rich-text editors (Quill, etc.) of the change.
 */
function directDomReplace(element: HTMLElement, original: string, replacement: string, offset: number = -1): void {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let accumulated = "";
  const nodes: { node: Text; start: number }[] = [];

  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    nodes.push({ node: n, start: accumulated.length });
    accumulated += n.textContent || "";
  }

  const idx = original.length === 0
    ? (offset >= 0 ? Math.min(offset, accumulated.length) : accumulated.length)
    : accumulated.indexOf(original);
  if (idx === -1) return;

  if (original.length === 0) {
    const range = document.createRange();
    const selection = window.getSelection();
    for (const entry of nodes) {
      const nodeText = entry.node.textContent || "";
      const nodeEnd = entry.start + nodeText.length;
      if (nodeEnd < idx) continue;
      range.setStart(entry.node, Math.max(0, idx - entry.start));
      range.collapse(true);
      const textNode = document.createTextNode(replacement);
      range.insertNode(textNode);
      selection?.removeAllRanges();
      selection?.collapse(textNode, replacement.length);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: replacement }));
      return;
    }

    element.appendChild(document.createTextNode(replacement));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: replacement }));
    return;
  }

  // Find the start and end text nodes
  for (const entry of nodes) {
    const nodeText = entry.node.textContent || "";
    const nodeEnd = entry.start + nodeText.length;

    if (nodeEnd <= idx) continue;

    // This node contains the start of the match
    const localStart = idx - entry.start;
    const localEnd = Math.min(nodeText.length, localStart + original.length);
    const remaining = original.length - (localEnd - localStart);

    if (remaining <= 0) {
      // Entire match is within this single text node
      entry.node.textContent =
        nodeText.substring(0, localStart) +
        replacement +
        nodeText.substring(localStart + original.length);
    } else {
      // Match spans multiple nodes — replace in first node and remove from subsequent
      entry.node.textContent = nodeText.substring(0, localStart) + replacement;
      let toRemove = remaining;
      for (const next of nodes) {
        if (next.start <= entry.start) continue;
        if (toRemove <= 0) break;
        const nextText = next.node.textContent || "";
        if (nextText.length <= toRemove) {
          toRemove -= nextText.length;
          next.node.textContent = "";
        } else {
          next.node.textContent = nextText.substring(toRemove);
          toRemove = 0;
        }
      }
    }
    break;
  }

  // Dispatch InputEvent to notify rich-text editors of the change
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: replacement,
  }));
}

export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
