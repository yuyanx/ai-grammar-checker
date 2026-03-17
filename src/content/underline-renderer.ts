import { GrammarError } from "../shared/types.js";
import { getOrCreateContainer } from "./shadow-host.js";
import { showPopover, showPopoverOnHover } from "./popover.js";

const elementContainerMap = new WeakMap<HTMLElement, string>();
let containerCounter = 0;

// Styles to copy for mirror div
const MIRROR_STYLES = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
  "wordSpacing", "lineHeight", "textTransform", "textIndent", "textAlign",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "boxSizing", "whiteSpace", "wordWrap", "overflowWrap", "wordBreak",
] as const;

export function renderErrors(
  element: HTMLElement,
  errors: GrammarError[],
  ignoredErrors: Set<string>,
  onAccept: () => void,
  onDismiss: (errorKey: string) => void
): void {
  clearErrors(element);

  const visibleErrors = errors.filter(
    (e) => !ignoredErrors.has(errorKey(e))
  );

  if (visibleErrors.length === 0) return;

  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement
  ) {
    renderForInput(element, visibleErrors, onAccept, onDismiss);
  } else if (element.isContentEditable) {
    renderForContentEditable(element, visibleErrors, onAccept, onDismiss);
  }
}

export function clearErrors(element: HTMLElement): void {
  const containerId = elementContainerMap.get(element);
  if (containerId) {
    const container = getOrCreateContainer(containerId);
    container.innerHTML = "";
  }
}

export function errorKey(error: GrammarError): string {
  return `${error.offset}:${error.length}:${error.original}`;
}

export function recalculatePositions(): void {
  // Called on scroll/resize — re-render would be needed
}

function getContainerId(element: HTMLElement): string {
  let id = elementContainerMap.get(element);
  if (!id) {
    id = `underlines-${containerCounter++}`;
    elementContainerMap.set(element, id);
  }
  return id;
}

/**
 * Attach both click and hover listeners to an underline element.
 */
function attachUnderlineListeners(
  underline: HTMLElement,
  error: GrammarError,
  anchorRect: DOMRect,
  targetElement: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  onAccept: () => void,
  onDismiss: (errorKey: string) => void
): void {
  // Click: show popover immediately
  underline.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showPopover(
      error,
      anchorRect,
      targetElement,
      onAccept,
      () => onDismiss(errorKey(error))
    );
  });

  // Hover: show popover after 200ms delay (Grammarly-style)
  underline.addEventListener("mouseenter", () => {
    showPopoverOnHover(
      error,
      anchorRect,
      targetElement,
      onAccept,
      () => onDismiss(errorKey(error)),
      underline
    );
  });
}

function renderForInput(
  element: HTMLTextAreaElement | HTMLInputElement,
  errors: GrammarError[],
  onAccept: () => void,
  onDismiss: (errorKey: string) => void
): void {
  const containerId = getContainerId(element);
  const container = getOrCreateContainer(containerId);
  container.innerHTML = "";

  const rect = element.getBoundingClientRect();
  const computed = window.getComputedStyle(element);

  // Create mirror div
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.top = `${rect.top}px`;
  mirror.style.left = `${rect.left}px`;
  mirror.style.width = `${rect.width}px`;
  mirror.style.height = `${rect.height}px`;
  mirror.style.overflow = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.visibility = "hidden";
  mirror.style.zIndex = "2147483646";

  // Copy styles
  for (const prop of MIRROR_STYLES) {
    (mirror.style as any)[prop] = computed.getPropertyValue(
      prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    );
  }

  // Build text with markers
  const text = element.value;
  const scrollTop = element instanceof HTMLTextAreaElement ? element.scrollTop : 0;
  const scrollLeft = element.scrollLeft;

  mirror.style.overflow = "hidden";
  mirror.scrollTop = scrollTop;
  mirror.scrollLeft = scrollLeft;

  // Use a temporary visible mirror to measure positions
  const measurer = mirror.cloneNode() as HTMLElement;
  measurer.style.visibility = "visible";
  measurer.style.pointerEvents = "none";
  measurer.style.opacity = "0";
  measurer.style.position = "fixed";
  document.body.appendChild(measurer);

  // Sort errors by offset
  const sorted = [...errors].sort((a, b) => a.offset - b.offset);

  // Build HTML with spans for each error
  let html = "";
  let lastIdx = 0;
  for (const err of sorted) {
    html += escapeHtml(text.substring(lastIdx, err.offset));
    html += `<span data-error-idx="${errors.indexOf(err)}" style="position:relative;">${escapeHtml(err.original)}</span>`;
    lastIdx = err.offset + err.length;
  }
  html += escapeHtml(text.substring(lastIdx));

  measurer.innerHTML = html;
  measurer.style.whiteSpace = computed.whiteSpace === "pre" ? "pre" : "pre-wrap";
  measurer.style.wordWrap = "break-word";

  // Measure span positions and create underlines
  const spans = measurer.querySelectorAll("span[data-error-idx]");
  spans.forEach((span) => {
    const idx = parseInt(span.getAttribute("data-error-idx")!);
    const error = errors[idx];
    const spanRect = span.getBoundingClientRect();

    const underline = document.createElement("div");
    underline.className = `grammar-underline grammar-underline--${error.type}`;
    underline.style.position = "fixed";
    underline.style.left = `${spanRect.left}px`;
    underline.style.top = `${spanRect.bottom - 4}px`;
    underline.style.width = `${spanRect.width}px`;
    underline.style.height = "4px";
    underline.style.pointerEvents = "auto";
    underline.style.cursor = "pointer";

    // Only show underlines within the element bounds
    if (
      spanRect.bottom > rect.top &&
      spanRect.top < rect.bottom &&
      spanRect.right > rect.left &&
      spanRect.left < rect.right
    ) {
      attachUnderlineListeners(underline, error, spanRect, element, onAccept, onDismiss);
      container.appendChild(underline);
    }
  });

  // Cleanup measurer
  document.body.removeChild(measurer);
}

function renderForContentEditable(
  element: HTMLElement,
  errors: GrammarError[],
  onAccept: () => void,
  onDismiss: (errorKey: string) => void
): void {
  const containerId = getContainerId(element);
  const container = getOrCreateContainer(containerId);
  container.innerHTML = "";

  const text = element.innerText;

  for (const error of errors) {
    const range = plainTextToRange(element, error.offset, error.length);
    if (!range) continue;

    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const underline = document.createElement("div");
      underline.className = `grammar-underline grammar-underline--${error.type}`;
      underline.style.position = "fixed";
      underline.style.left = `${r.left}px`;
      underline.style.top = `${r.bottom - 4}px`;
      underline.style.width = `${r.width}px`;
      underline.style.height = "4px";

      attachUnderlineListeners(underline, error, r, element, onAccept, onDismiss);
      container.appendChild(underline);
    }
  }
}

function plainTextToRange(
  root: HTMLElement,
  offset: number,
  length: number
): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeLen = node.textContent?.length || 0;

    if (!startNode && charCount + nodeLen > offset) {
      startNode = node;
      startOffset = offset - charCount;
    }

    if (startNode && charCount + nodeLen >= offset + length) {
      endNode = node;
      endOffset = offset + length - charCount;
      break;
    }

    charCount += nodeLen;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
