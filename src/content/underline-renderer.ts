import { GrammarError } from "../shared/types.js";
import { getOrCreateContainer, getShadowRoot } from "./shadow-host.js";
import { showPopover, showPopoverOnHover } from "./popover.js";
import { getWidgetRect } from "./status-widget.js";
import {
  buildContentEditableSnapshot,
  getContentEditableRangeForError,
  getContentEditableRange,
} from "./contenteditable-snapshot.js";

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
  onDismiss: (errorKey: string) => void,
  renderGeneration: number = 0
): void {
  const containerId = getContainerId(element);
  const container = getOrCreateContainer(containerId);
  const currentGeneration = Number(container.dataset.generation ?? "-1");
  if (currentGeneration > renderGeneration) return;

  container.dataset.generation = String(renderGeneration);
  container.innerHTML = "";

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

/**
 * Nuclear clear: remove all underline containers from the shadow DOM.
 * Used when element-specific clear isn't working (e.g., stale element references).
 */
export function clearAllErrors(): void {
  const root = getShadowRoot();
  const containers = root.querySelectorAll("[id^='underlines-']");
  containers.forEach((c) => { c.innerHTML = ""; });
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
  const blockedRect = getBlockedUnderlineRect(element);
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
    const underlineTop = element instanceof HTMLInputElement
      ? getSingleLineInputUnderlineTop(rect, computed)
      : spanRect.bottom - 4;
    const underlineRect = new DOMRect(
      spanRect.left,
      underlineTop,
      Math.max(spanRect.width, 8),
      4
    );

    const clippedUnderlineRect = clipUnderlineRectToElement(underlineRect, rect);
    if (!clippedUnderlineRect) return;
    if (blockedRect && rectsOverlap(clippedUnderlineRect, blockedRect)) return;

    const underline = createUnderline(error, clippedUnderlineRect);
    attachUnderlineListeners(underline, error, spanRect, element, onAccept, onDismiss);
    container.appendChild(underline);
  });

  for (const error of errors) {
    if (error.length !== 0) continue;
    const anchorRect = getInputInsertionAnchorRect(measurer, error.offset, rect);
    const underlineRect = buildUnderlineRect(anchorRect);
    const clippedUnderlineRect = clipUnderlineRectToElement(underlineRect, rect);
    if (!clippedUnderlineRect) continue;
    if (blockedRect && rectsOverlap(clippedUnderlineRect, blockedRect)) continue;
    const underline = createUnderline(error, clippedUnderlineRect);
    attachUnderlineListeners(underline, error, anchorRect, element, onAccept, onDismiss);
    container.appendChild(underline);
  }

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

  const snapshot = buildContentEditableSnapshot(element);
  const elementRect = element.getBoundingClientRect();
  const blockedRect = getBlockedUnderlineRect(element);

  for (const error of errors) {
    const rects = getErrorClientRects(element, error, snapshot);
    for (const r of rects) {
      const underlineRect = clipUnderlineRectToElement(buildUnderlineRect(r), elementRect);
      if (!underlineRect) continue;
      if (blockedRect && rectsOverlap(underlineRect, blockedRect)) continue;
      const underline = createUnderline(error, underlineRect);
      attachUnderlineListeners(underline, error, r, element, onAccept, onDismiss);
      container.appendChild(underline);
    }
  }
}

function createUnderline(error: GrammarError, rect: DOMRect): HTMLElement {
  const underline = document.createElement("div");
  underline.className = `grammar-underline grammar-underline--${error.type}`;
  underline.style.position = "fixed";
  underline.style.left = `${rect.left}px`;
  underline.style.top = `${rect.top}px`;
  underline.style.width = `${Math.max(rect.width, 8)}px`;
  underline.style.height = `${Math.max(rect.height, 4)}px`;
  underline.style.pointerEvents = "auto";
  underline.style.cursor = "pointer";
  return underline;
}

function getBlockedUnderlineRect(element: HTMLElement): DOMRect | null {
  const widgetRect = getWidgetRect(element);
  return widgetRect ? inflateRect(widgetRect, 4, 4) : null;
}

function buildUnderlineRect(anchorRect: DOMRect): DOMRect {
  return new DOMRect(
    anchorRect.left,
    anchorRect.bottom - 4,
    Math.max(anchorRect.width, 8),
    4
  );
}

function clipUnderlineRectToElement(underlineRect: DOMRect, elementRect: DOMRect): DOMRect | null {
  const left = Math.max(underlineRect.left, elementRect.left);
  const top = Math.max(underlineRect.top, elementRect.top);
  const right = Math.min(underlineRect.right, elementRect.right);
  const bottom = Math.min(underlineRect.bottom, elementRect.bottom);

  if (right - left < 2 || bottom - top < 2) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function inflateRect(rect: DOMRect, xPad: number, yPad: number): DOMRect {
  return new DOMRect(
    rect.left - xPad,
    rect.top - yPad,
    rect.width + xPad * 2,
    rect.height + yPad * 2
  );
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}

function getErrorClientRects(
  root: HTMLElement,
  error: GrammarError,
  snapshot = buildContentEditableSnapshot(root)
): DOMRect[] {
  const range = getContentEditableRangeForError(root, error, snapshot);
  if (range) {
    return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  }

  const insertionRect = getContentEditableInsertionRect(snapshot, error.offset);
  return insertionRect ? [insertionRect] : [];
}

function getInputInsertionAnchorRect(measurer: HTMLElement, offset: number, fallbackRect: DOMRect): DOMRect {
  const range = document.createRange();
  const walker = document.createTreeWalker(measurer, NodeFilter.SHOW_TEXT);
  let chars = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.textContent || "";
    const nextChars = chars + text.length;
    if (offset <= nextChars) {
      range.setStart(node, Math.max(0, offset - chars));
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return rect;
      }
      return new DOMRect(rect.left, rect.top, 8, 16);
    }
    chars = nextChars;
  }

  return new DOMRect(fallbackRect.right - 8, fallbackRect.bottom - 20, 8, 16);
}

function getSingleLineInputUnderlineTop(
  rect: DOMRect,
  computed: CSSStyleDeclaration
): number {
  const borderTop = parsePixelValue(computed.borderTopWidth);
  const borderBottom = parsePixelValue(computed.borderBottomWidth);
  const paddingTop = parsePixelValue(computed.paddingTop);
  const paddingBottom = parsePixelValue(computed.paddingBottom);
  const fontSize = parsePixelValue(computed.fontSize) || 16;
  const lineHeight = getResolvedLineHeight(computed, fontSize);
  const innerHeight = Math.max(rect.height - borderTop - borderBottom, lineHeight);
  const centeredTop = rect.top + borderTop + Math.max((innerHeight - lineHeight) / 2, 0);
  const contentTop = rect.top + borderTop + paddingTop;
  const contentBottom = rect.bottom - borderBottom - paddingBottom;
  const textTop = Math.max(centeredTop, contentTop);
  const textBottom = Math.min(textTop + lineHeight, contentBottom || rect.bottom);
  return Math.max(rect.top, textBottom - 4);
}

function getResolvedLineHeight(computed: CSSStyleDeclaration, fontSize: number): number {
  const raw = computed.lineHeight;
  if (!raw || raw === "normal") {
    return fontSize * 1.2;
  }
  const parsed = parseFloat(raw);
  if (Number.isNaN(parsed)) {
    return fontSize * 1.2;
  }
  if (raw.endsWith("px")) {
    return parsed;
  }
  return parsed * fontSize;
}

function parsePixelValue(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getContentEditableInsertionRect(
  snapshot: ReturnType<typeof buildContentEditableSnapshot>,
  offset: number
): DOMRect | null {
  const range = getContentEditableRange(snapshot, offset, 0);
  if (!range) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }
  return new DOMRect(rect.left, rect.top, 8, 16);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
