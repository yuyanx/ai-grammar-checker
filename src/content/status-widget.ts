import { getOrCreateContainer, getShadowRoot, getShadowHost } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";

export type WidgetState = "idle" | "ready" | "checking" | "errors" | "clean" | "error";

const widgetMap = new WeakMap<HTMLElement, string>();
const widgetElements = new Set<HTMLElement>();
const widgetStates = new WeakMap<HTMLElement, {
  state: WidgetState;
  errorCount: number;
  onClickErrors?: () => void;
  hideAt?: number;
}>();
const lastRenderedStates = new WeakMap<HTMLElement, {
  state: WidgetState;
  errorCount: number;
  isCompact: boolean;
}>();
let widgetCounter = 0;
const VIEWPORT_MARGIN = 8;
const COMPACT_INSET = 8;
const COMPACT_SEARCH_STEP = 2;
const COMPACT_ACTION_GAP = 16;
const COMPACT_OUTSIDE_GAP = 6;

/**
 * Show or update the floating status widget near a text field.
 * Looks like Grammarly's green "G" circle in the bottom-right of the field.
 */
export function updateWidget(
  element: HTMLElement,
  state: WidgetState,
  errorCount: number = 0,
  onClickErrors?: () => void
): void {
  const current = widgetStates.get(element);
  if (
    current &&
    current.state === state &&
    current.errorCount === errorCount &&
    current.onClickErrors === onClickErrors &&
    state !== "clean"
  ) {
    return;
  }

  widgetStates.set(element, {
    state,
    errorCount,
    onClickErrors,
    hideAt: state === "clean" ? Date.now() + 3000 : undefined,
  });
  widgetElements.add(element);
  renderWidget(element);
}

export function refreshWidget(element: HTMLElement): void {
  renderWidget(element);
}

function renderWidget(element: HTMLElement): void {
  const widgetState = widgetStates.get(element);
  if (!widgetState) return;

  const { state, errorCount, onClickErrors, hideAt } = widgetState;
  console.log("[AI Grammar Checker] updateWidget called, state:", state, "errorCount:", errorCount, "hasCallback:", !!onClickErrors);
  const containerId = getWidgetContainerId(element);
  const container = getOrCreateContainer(containerId);

  // Don't show for idle state
  if (state === "idle") {
    container.innerHTML = "";
    lastRenderedStates.delete(element);
    return;
  }
  if (state === "clean" && hideAt && Date.now() >= hideAt) {
    container.innerHTML = "";
    lastRenderedStates.delete(element);
    return;
  }

  const rect = element.getBoundingClientRect();
  const compactTextRect = rect.height >= 44 ? getCompactTextRect(element, rect) : rect;
  let isCompact = shouldUseCompactWidget(rect, compactTextRect);
  let compactAnchor = isCompact ? getCompactAnchor(element, rect) : null;
  let anchorRect = compactAnchor?.rect || rect;

  // Don't show widget for hidden/invisible elements.
  // For compact editors like Instagram, the editable span can be tiny even when the
  // full composer row is visible, so gate on the chosen anchor rect instead.
  if (anchorRect.width < 50 || anchorRect.height < 20) {
    container.innerHTML = "";
    lastRenderedStates.delete(element);
    return;
  }

  const lastRendered = lastRenderedStates.get(element);
  const existingWidget = container.firstElementChild instanceof HTMLElement
    ? container.firstElementChild
    : null;

  // Use smaller widget for compact editors (e.g. comment boxes)
  let size = isCompact ? getCompactWidgetSize(state) : 28;
  const inset = isCompact ? COMPACT_INSET : 6;

  let position = isCompact && compactAnchor
    ? getCompactWidgetPosition(element, compactTextRect, compactAnchor, size)
    : getCornerWidgetPosition(anchorRect, size, inset);

  if (!isCompact && fullWidgetOverlapsText(position, size, compactTextRect)) {
    isCompact = true;
    compactAnchor = getCompactAnchor(element, rect);
    anchorRect = compactAnchor.rect;
    size = getCompactWidgetSize(state);
    position = getOutsideCompactWidgetPosition(anchorRect, size, getPreferredCompactTop(anchorRect, size));
  }

  if (
    existingWidget &&
    lastRendered &&
    lastRendered.state === state &&
    lastRendered.errorCount === errorCount &&
    lastRendered.isCompact === isCompact
  ) {
    existingWidget.style.top = `${position.top}px`;
    existingWidget.style.left = `${position.left}px`;
    positionWidgetTooltip(existingWidget);
    return;
  }

  container.innerHTML = "";

  const widget = document.createElement("div");
  const dark = isDarkMode();

  widget.style.position = "fixed";
  widget.style.top = `${position.top}px`;
  widget.style.left = `${position.left}px`;
  // Build class name including compact modifier
  const compactClass = isCompact ? " grammar-widget--compact" : "";

  if (state === "checking") {
    widget.className = `grammar-widget grammar-widget--checking${compactClass}`;
    widget.innerHTML = `
      <div class="grammar-widget__spinner"></div>
      <div class="grammar-widget__tooltip${dark ? " grammar-widget__tooltip--dark" : ""}">Checking...</div>
    `;
  } else if (state === "ready") {
    const dotClass = isCompact ? " grammar-widget--compact-dot" : "";
    widget.className = `grammar-widget grammar-widget--ready${compactClass}${dotClass}`;
    widget.innerHTML = `
      <div class="grammar-widget__tooltip${dark ? " grammar-widget__tooltip--dark" : ""}">Ready to check</div>
    `;
  } else if (state === "errors") {
    const dotClass = isCompact ? " grammar-widget--compact-dot" : "";
    const wideCountClass = !isCompact && errorCount >= 10 ? " grammar-widget--wide-count" : "";
    widget.className = `grammar-widget grammar-widget--errors${compactClass}${dotClass}${wideCountClass}`;
    widget.innerHTML = `
      <div class="grammar-widget__tooltip${dark ? " grammar-widget__tooltip--dark" : ""}">${errorCount} issue${errorCount !== 1 ? "s" : ""} found</div>
    `;
    if (!isCompact) {
      widget.insertAdjacentHTML("afterbegin", `<span class="grammar-widget__count">${formatErrorCount(errorCount)}</span>`);
    }
    widget.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (onClickErrors) onClickErrors();
    });
  } else if (state === "clean") {
    widget.className = `grammar-widget grammar-widget--clean${compactClass}`;
    widget.innerHTML = `
      <span class="grammar-widget__check">\u2713</span>
      <div class="grammar-widget__tooltip${dark ? " grammar-widget__tooltip--dark" : ""}">No issues found</div>
    `;
    // Auto-hide after 3 seconds
    setTimeout(() => {
      const current = widgetStates.get(element);
      if (!current || current.state !== "clean" || current.hideAt !== hideAt) return;
      widgetStates.set(element, { state: "idle", errorCount: 0 });
      lastRenderedStates.delete(element);
      widget.style.opacity = "0";
      widget.style.transition = "opacity 0.3s";
      setTimeout(() => container.innerHTML = "", 300);
    }, 3000);
  } else if (state === "error") {
    widget.className = `grammar-widget grammar-widget--error${compactClass}`;
    widget.innerHTML = `
      <span class="grammar-widget__error-icon">!</span>
      <div class="grammar-widget__tooltip${dark ? " grammar-widget__tooltip--dark" : ""}">Check failed — will retry</div>
    `;
    // Auto-hide after 4 seconds
    setTimeout(() => {
      const current = widgetStates.get(element);
      if (!current || current.state !== "error") return;
      widgetStates.set(element, { state: "idle", errorCount: 0 });
      lastRenderedStates.delete(element);
      widget.style.opacity = "0";
      widget.style.transition = "opacity 0.3s";
      setTimeout(() => container.innerHTML = "", 300);
    }, 4000);
  }

  container.appendChild(widget);
  positionWidgetTooltip(widget);
  lastRenderedStates.set(element, { state, errorCount, isCompact });
}

export function removeWidget(element: HTMLElement): void {
  widgetStates.set(element, { state: "idle", errorCount: 0 });
  lastRenderedStates.delete(element);
  const containerId = widgetMap.get(element);
  if (containerId) {
    const container = getOrCreateContainer(containerId);
    container.innerHTML = "";
  }
  widgetElements.delete(element);
}

export function getWidgetRect(element: HTMLElement): DOMRect | null {
  const containerId = widgetMap.get(element);
  if (!containerId) return null;

  const container = getOrCreateContainer(containerId);
  const widget = container.firstElementChild;
  if (!(widget instanceof HTMLElement)) return null;
  return widget.getBoundingClientRect();
}

/**
 * Nuclear clear: remove all widget containers from the shadow DOM.
 * Used when element-specific clear isn't working (e.g., SPA navigation).
 */
export function removeAllWidgets(): void {
  const root = getShadowRoot();
  const containers = root.querySelectorAll("[id^='widget-']");
  containers.forEach((c) => { c.innerHTML = ""; });
  widgetElements.clear();
}

export function clearTransientWidgetsExcept(activeElement: HTMLElement): void {
  for (const element of Array.from(widgetElements)) {
    if (element === activeElement) continue;
    if (!element.isConnected) {
      widgetElements.delete(element);
      continue;
    }

    const state = widgetStates.get(element);
    if (!state) continue;
    if (state.state === "errors" || state.state === "error") continue;

    widgetStates.set(element, { state: "idle", errorCount: 0 });
    lastRenderedStates.delete(element);
    const containerId = widgetMap.get(element);
    if (!containerId) continue;
    const container = getOrCreateContainer(containerId);
    container.innerHTML = "";
  }
}

function getWidgetContainerId(element: HTMLElement): string {
  let id = widgetMap.get(element);
  if (!id) {
    id = `widget-${widgetCounter++}`;
    widgetMap.set(element, id);
  }
  return id;
}

function shouldUseCompactWidget(rect: DOMRect, textRect: DOMRect): boolean {
  if (rect.height < 44) return true;
  if (rect.height >= 100) return false;

  const verticalSpace = rect.bottom - textRect.bottom;
  return verticalSpace < 36;
}

function fullWidgetOverlapsText(
  position: { top: number; left: number },
  size: number,
  textRect: DOMRect
): boolean {
  const widgetRect = new DOMRect(position.left, position.top, size, size);
  return rectsOverlap(widgetRect, inflateRect(textRect, 4, 4));
}

function getPreferredCompactTop(anchorRect: DOMRect, size: number): number {
  const minTop = clamp(anchorRect.top + COMPACT_INSET, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN);
  const maxTop = clamp(anchorRect.bottom - size - COMPACT_INSET, minTop, window.innerHeight - size - VIEWPORT_MARGIN);
  return clamp(anchorRect.top + (anchorRect.height - size) / 2, minTop, maxTop);
}

function getCornerWidgetPosition(rect: DOMRect, size: number, inset: number): { top: number; left: number } {
  const top = clamp(rect.bottom - size - inset, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN);
  const left = clamp(rect.right - size - inset, VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN);
  return { top, left };
}

function getCompactWidgetSize(state: WidgetState): number {
  if (state === "errors" || state === "ready") return 12;
  return 18;
}

function formatErrorCount(errorCount: number): string {
  if (errorCount > 99) return "99+";
  return String(errorCount);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function positionWidgetTooltip(widget: HTMLElement): void {
  const tooltip = widget.querySelector<HTMLElement>(".grammar-widget__tooltip");
  if (!tooltip) return;

  tooltip.style.left = "50%";
  tooltip.style.right = "auto";
  tooltip.style.transform = "translateX(-50%)";

  const rect = tooltip.getBoundingClientRect();
  if (rect.left < VIEWPORT_MARGIN) {
    tooltip.style.left = "0";
    tooltip.style.right = "auto";
    tooltip.style.transform = "none";
    return;
  }

  if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
    tooltip.style.left = "auto";
    tooltip.style.right = "0";
    tooltip.style.transform = "none";
  }
}

function getCompactWidgetPosition(
  editorElement: HTMLElement,
  textRect: DOMRect,
  anchor: { element: HTMLElement; rect: DOMRect },
  size: number
): { top: number; left: number } {
  const minLeft = clamp(anchor.rect.left + COMPACT_INSET, VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN);
  const maxLeft = clamp(anchor.rect.right - size - COMPACT_INSET, minLeft, window.innerWidth - size - VIEWPORT_MARGIN);
  const minTop = clamp(anchor.rect.top + COMPACT_INSET, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN);
  const maxTop = clamp(anchor.rect.bottom - size - COMPACT_INSET, minTop, window.innerHeight - size - VIEWPORT_MARGIN);
  const preferredTop = getPreferredCompactTop(anchor.rect, size);
  const textBoundary = textRect.right + COMPACT_INSET;
  const rowObstacles = getCompactRowObstacles(anchor.element, editorElement, anchor.rect);
  const actionStart = getExplicitActionStart(anchor.element, editorElement, textRect.right, anchor.rect)
    ?? getInlineActionStart(rowObstacles, textRect.right, anchor.rect);
  const safeActionLeft = actionStart !== null
    ? Math.max(minLeft, actionStart - size - COMPACT_ACTION_GAP)
    : null;
  const outsidePosition = getOutsideCompactWidgetPosition(anchor.rect, size, preferredTop);

  if (maxLeft < textBoundary) {
    return outsidePosition;
  }

  if (safeActionLeft !== null) {
    const pinnedLeft = clamp(safeActionLeft, minLeft, maxLeft);
    if (pinnedLeft >= textBoundary) {
      return { top: preferredTop, left: pinnedLeft };
    }
    return outsidePosition;
  }

  const obstacleRects = [
    inflateRect(textRect, 10, 6),
    ...rowObstacles,
  ];
  const topCandidates = buildTopCandidates(preferredTop, minTop, maxTop, COMPACT_SEARCH_STEP);

  for (let left = maxLeft; left >= minLeft; left -= COMPACT_SEARCH_STEP) {
    for (const top of topCandidates) {
      const candidate = new DOMRect(left, top, size, size);
      if (!isWithinRect(candidate, anchor.rect)) continue;
      if (candidate.left < textBoundary) continue;
      if (actionStart !== null && candidate.right + COMPACT_ACTION_GAP > actionStart) continue;
      if (obstacleRects.some((obstacle) => rectsOverlap(candidate, obstacle))) continue;
      if (!isCompactSlotFree(candidate, anchor.element, editorElement)) continue;
      return { top, left };
    }
  }

  return outsidePosition;
}

function getOutsideCompactWidgetPosition(
  anchorRect: DOMRect,
  size: number,
  preferredTop: number
): { top: number; left: number } {
  const top = clamp(preferredTop, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN);
  const outsideRight = anchorRect.right + COMPACT_OUTSIDE_GAP;
  if (outsideRight + size <= window.innerWidth - VIEWPORT_MARGIN) {
    return { top, left: outsideRight };
  }

  const outsideLeft = anchorRect.left - size - COMPACT_OUTSIDE_GAP;
  if (outsideLeft >= VIEWPORT_MARGIN) {
    return { top, left: outsideLeft };
  }

  return {
    top,
    left: clamp(anchorRect.right - size - COMPACT_INSET, VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN),
  };
}

function getCompactTextRect(element: HTMLElement, fallbackRect: DOMRect): DOMRect {
  const rects: DOMRect[] = [];

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!(node.textContent || "").trim()) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 2 || rect.height < 2) continue;
      rects.push(new DOMRect(rect.left, rect.top, rect.width, rect.height));
    }
  }

  if (rects.length === 0) return fallbackRect;

  const lastLineBottom = Math.max(...rects.map((rect) => rect.bottom));
  const lastLineRects = rects.filter((rect) => Math.abs(rect.bottom - lastLineBottom) <= 6);
  if (lastLineRects.length === 0) return fallbackRect;

  const left = Math.min(...lastLineRects.map((rect) => rect.left));
  const top = Math.min(...lastLineRects.map((rect) => rect.top));
  const right = Math.max(...lastLineRects.map((rect) => rect.right));
  const bottom = Math.max(...lastLineRects.map((rect) => rect.bottom));

  return new DOMRect(left, top, Math.max(right - left, 1), Math.max(bottom - top, 1));
}

function getCompactAnchor(element: HTMLElement, fallbackRect: DOMRect): { element: HTMLElement; rect: DOMRect } {
  let bestElement = element;
  let bestRect = fallbackRect;
  let current = element.parentElement;
  let depth = 0;

  while (current && depth < 6) {
    const rect = current.getBoundingClientRect();

    if (isUsableCompactAnchor(rect, fallbackRect)) {
      if (rect.width >= bestRect.width) {
        bestElement = current;
        bestRect = rect;
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  return { element: bestElement, rect: bestRect };
}

function isUsableCompactAnchor(rect: DOMRect, fallbackRect: DOMRect): boolean {
  if (rect.width <= fallbackRect.width + 24) return false;
  if (rect.height < fallbackRect.height - 8) return false;
  if (rect.height > 120) return false;
  if (rect.top > fallbackRect.top + 12) return false;
  if (rect.bottom < fallbackRect.bottom - 12) return false;
  if (rect.left > fallbackRect.left + 24) return false;
  if (rect.right < fallbackRect.right + 16) return false;
  return true;
}

function buildTopCandidates(preferredTop: number, minTop: number, maxTop: number, step: number): number[] {
  const candidates = [preferredTop];
  for (let delta = step; delta <= maxTop - minTop; delta += step) {
    const above = preferredTop - delta;
    const below = preferredTop + delta;
    if (above >= minTop) candidates.push(above);
    if (below <= maxTop) candidates.push(below);
  }
  return candidates;
}

function inflateRect(rect: DOMRect, xPad: number, yPad: number): DOMRect {
  return new DOMRect(
    rect.left - xPad,
    rect.top - yPad,
    rect.width + xPad * 2,
    rect.height + yPad * 2
  );
}

function isVisibleRect(rect: DOMRect, anchorRect: DOMRect): boolean {
  return !(
    rect.right <= anchorRect.left ||
    rect.left >= anchorRect.right ||
    rect.bottom <= anchorRect.top ||
    rect.top >= anchorRect.bottom
  );
}

function isWithinRect(inner: DOMRect, outer: DOMRect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
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

function getInlineActionStart(
  rowObstacles: DOMRect[],
  textRight: number,
  anchorRect: DOMRect
): number | null {
  const candidates = rowObstacles
    .filter((rect) => rect.left > textRight + COMPACT_INSET)
    .filter((rect) => rect.left > anchorRect.left + anchorRect.width * 0.45)
    .sort((a, b) => a.left - b.left);

  if (candidates.length === 0) return null;
  return candidates[0].left;
}

function getExplicitActionStart(
  anchorElement: HTMLElement,
  editorElement: HTMLElement,
  textRight: number,
  anchorRect: DOMRect
): number | null {
  const labelPattern = /^(post|comment|reply|send)$/i;
  const rowMidY = anchorRect.top + anchorRect.height / 2;
  const matches: number[] = [];

  const walker = document.createTreeWalker(anchorElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (editorElement.contains(node)) continue;

    const text = (node.textContent || "").trim();
    if (!labelPattern.test(text)) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 4 || rect.height < 4) continue;
      if (!isVisibleRect(rect, anchorRect)) continue;
      if (rect.right <= textRight + COMPACT_INSET) continue;
      if (rect.top > rowMidY || rect.bottom < rowMidY) continue;
      matches.push(rect.left);
    }
  }

  if (matches.length > 0) {
    return Math.min(...matches);
  }

  anchorElement.querySelectorAll<HTMLElement>("button, [role='button'], a").forEach((candidate) => {
    if (candidate === editorElement || editorElement.contains(candidate)) return;

    const label = (
      candidate.innerText ||
      candidate.getAttribute("aria-label") ||
      candidate.textContent ||
      ""
    ).trim();
    if (!labelPattern.test(label)) return;

    const rect = candidate.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    if (!isVisibleRect(rect, anchorRect)) return;
    if (rect.right <= textRight + COMPACT_INSET) return;
    if (rect.top > rowMidY || rect.bottom < rowMidY) return;
    matches.push(rect.left);
  });

  if (matches.length === 0) return null;
  return Math.min(...matches);
}

function isCompactSlotFree(candidate: DOMRect, anchorElement: HTMLElement, editorElement: HTMLElement): boolean {
  const sampleInset = 3;
  const samplePoints: Array<[number, number]> = [
    [candidate.left + candidate.width / 2, candidate.top + candidate.height / 2],
    [candidate.left + sampleInset, candidate.top + sampleInset],
    [candidate.right - sampleInset, candidate.top + sampleInset],
    [candidate.left + sampleInset, candidate.bottom - sampleInset],
    [candidate.right - sampleInset, candidate.bottom - sampleInset],
  ];

  for (const [x, y] of samplePoints) {
    const hit = getRelevantElementAtPoint(x, y);
    if (!hit) continue;
    if (hit === editorElement || hit.contains(editorElement) || editorElement.contains(hit)) {
      return false;
    }
    if (hit === anchorElement || hit.contains(anchorElement)) {
      continue;
    }
    if (anchorElement.contains(hit)) {
      return false;
    }
  }

  return true;
}

function getRelevantElementAtPoint(x: number, y: number): HTMLElement | null {
  const shadowHost = getShadowHost();
  const hits = document.elementsFromPoint(x, y);
  for (const hit of hits) {
    if (!(hit instanceof HTMLElement)) continue;
    if (shadowHost && (hit === shadowHost || shadowHost.contains(hit))) continue;
    const style = window.getComputedStyle(hit);
    if (style.pointerEvents === "none" || style.visibility === "hidden" || style.display === "none") continue;
    return hit;
  }
  return null;
}

function getCompactRowObstacles(
  anchorElement: HTMLElement,
  editorElement: HTMLElement,
  anchorRect: DOMRect
): DOMRect[] {
  const obstacles: DOMRect[] = [];
  const rowMidY = anchorRect.top + anchorRect.height / 2;

  anchorElement.querySelectorAll<HTMLElement>("*").forEach((candidate) => {
    if (candidate === editorElement) return;
    if (candidate.contains(editorElement) || editorElement.contains(candidate)) return;

    const rect = candidate.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) return;
    if (!isVisibleRect(rect, anchorRect)) return;

    const style = window.getComputedStyle(candidate);
    if (style.display === "none" || style.visibility === "hidden") return;

    if (rect.top <= rowMidY && rect.bottom >= rowMidY) {
      obstacles.push(inflateRect(rect, 4, 4));
    }
  });

  const walker = document.createTreeWalker(anchorElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent) continue;
    if (editorElement.contains(node)) continue;
    if (!(node.textContent || "").trim()) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    for (const rect of rects) {
      if (rect.width < 4 || rect.height < 4) continue;
      if (!isVisibleRect(rect, anchorRect)) continue;
      if (rect.top > rowMidY || rect.bottom < rowMidY) continue;
      obstacles.push(inflateRect(rect, 3, 2));
    }
  }

  return mergeObstacleRects(obstacles);
}

function mergeObstacleRects(rects: DOMRect[]): DOMRect[] {
  const merged: DOMRect[] = [];
  const sorted = [...rects].sort((a, b) => a.left - b.left);

  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      rect.left <= last.right + 6 &&
      Math.abs(rect.top - last.top) < 12
    ) {
      const left = Math.min(last.left, rect.left);
      const top = Math.min(last.top, rect.top);
      const right = Math.max(last.right, rect.right);
      const bottom = Math.max(last.bottom, rect.bottom);
      last.x = left;
      last.y = top;
      last.width = right - left;
      last.height = bottom - top;
    } else {
      merged.push(new DOMRect(rect.left, rect.top, rect.width, rect.height));
    }
  }

  return merged;
}
