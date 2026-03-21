import { getOrCreateContainer, getShadowRoot, getShadowHost } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";

export type WidgetState = "idle" | "ready" | "checking" | "errors" | "clean" | "error";
type WidgetPresentation = "compact" | "full";

const widgetMap = new WeakMap<HTMLElement, string>();
const widgetElements = new Set<HTMLElement>();
const widgetStates = new WeakMap<HTMLElement, {
  state: WidgetState;
  errorCount: number;
  onClickErrors?: () => void;
  hideAt?: number;
}>();
const widgetRenderMeta = new WeakMap<HTMLElement, {
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
const STABLE_COMPACT_SLOT_SIZE = 20;
const STABLE_COMPACT_MAX_HEIGHT = 180;
const EXPANDED_WIDGET_SOURCE_MAX_HEIGHT = 72;

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
  renderWidget(element, true);
}

export function getWidgetState(element: HTMLElement): WidgetState | null {
  return widgetStates.get(element)?.state ?? null;
}

export function getWidgetRect(element: HTMLElement): DOMRect | null {
  const containerId = widgetMap.get(element);
  if (!containerId) return null;
  const container = getOrCreateContainer(containerId);
  const widget = container.firstElementChild;
  return widget instanceof HTMLElement ? widget.getBoundingClientRect() : null;
}

function renderWidget(element: HTMLElement, positionOnly = false): void {
  const widgetState = widgetStates.get(element);
  if (!widgetState) return;

  const { state, errorCount, onClickErrors, hideAt } = widgetState;
  console.log("[AI Grammar Checker] updateWidget called, state:", state, "errorCount:", errorCount, "hasCallback:", !!onClickErrors);
  const containerId = getWidgetContainerId(element);
  const container = getOrCreateContainer(containerId);

  // Don't show for idle state
  if (state === "idle" || (state === "clean" && hideAt && Date.now() >= hideAt)) {
    container.innerHTML = "";
    widgetRenderMeta.delete(element);
    return;
  }

  const source = getWidgetSource(element);
  const rect = source.rect;
  if (!isRectViewportVisible(rect)) {
    container.innerHTML = "";
    widgetRenderMeta.delete(element);
    return;
  }
  const baseAnchor = getWidgetAnchor(source.element, rect);
  const compactAnchorCandidate = getCompactAnchor(source.element, rect);
  const textRect = getCompactTextRect(source.element, rect);
  const forceCompact = shouldForceCompactPresentation(compactAnchorCandidate, source.element, rect);
  const preferExpandedPresentation = shouldPreferExpandedPresentation(baseAnchor.rect, rect);
  const presentation = preferExpandedPresentation
    ? "full"
    : forceCompact
      ? "compact"
      : getWidgetPresentation(source.element, baseAnchor.rect, textRect);
  const isCompact = presentation === "compact";
  const compactAnchor = isCompact ? compactAnchorCandidate : null;
  const ignoreInlinePlaceholderText = !!(isCompact && compactAnchor && shouldIgnoreCompactPlaceholderText(source.element, compactAnchor));
  const anchorRect = compactAnchor?.rect || baseAnchor.rect;
  const compactTextRect = isCompact ? textRect : rect;
  const useSidePlacement = shouldUseSideWidgetPlacement(anchorRect, rect, isCompact);

  // Don't show widget for hidden/invisible elements.
  // For compact editors like Instagram, the editable span can be tiny even when the
  // full composer row is visible, so gate on the chosen anchor rect instead.
  if (anchorRect.width < 50 || anchorRect.height < 20) {
    container.innerHTML = "";
    widgetRenderMeta.delete(element);
    return;
  }

  const dark = isDarkMode();

  // Use smaller widget for compact editors (e.g. comment boxes)
  const size = isCompact ? getCompactWidgetSize() : 28;
  const inset = isCompact ? COMPACT_INSET : 6;

  const position = isCompact && compactAnchor
    ? getCompactWidgetPosition(source.element, compactTextRect, compactAnchor, size, rect, ignoreInlinePlaceholderText)
    : useSidePlacement
      ? getSideWidgetPosition(anchorRect, size, inset)
      : getCornerWidgetPosition(anchorRect, size, inset);
  const existing = container.firstElementChild;
  const lastRendered = widgetRenderMeta.get(element);
  if (
    positionOnly &&
    existing instanceof HTMLElement &&
    lastRendered &&
    lastRendered.state === state &&
    lastRendered.errorCount === errorCount &&
    lastRendered.isCompact === isCompact
  ) {
    positionWidgetElement(existing, position);
    positionWidgetTooltip(existing);
    return;
  }

  container.innerHTML = "";

  const widget = document.createElement("div");
  widget.style.position = "fixed";
  positionWidgetElement(widget, position);
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
      widgetRenderMeta.delete(element);
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
      widgetRenderMeta.delete(element);
      widget.style.opacity = "0";
      widget.style.transition = "opacity 0.3s";
      setTimeout(() => container.innerHTML = "", 300);
    }, 4000);
  }

  container.appendChild(widget);
  widgetRenderMeta.set(element, { state, errorCount, isCompact });
  positionWidgetTooltip(widget);
}

export function removeWidget(element: HTMLElement): void {
  widgetStates.set(element, { state: "idle", errorCount: 0 });
  widgetRenderMeta.delete(element);
  const containerId = widgetMap.get(element);
  if (containerId) {
    const container = getOrCreateContainer(containerId);
    container.innerHTML = "";
  }
  widgetElements.delete(element);
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

export function clearTransientWidgetsExcept(activeElement: HTMLElement | null): void {
  for (const element of Array.from(widgetElements)) {
    if (activeElement && element === activeElement) continue;
    if (!element.isConnected) {
      widgetElements.delete(element);
      continue;
    }

    const state = widgetStates.get(element);
    if (!state) continue;
    if (state.state === "errors") continue;

    widgetStates.set(element, { state: "idle", errorCount: 0 });
    widgetRenderMeta.delete(element);
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

function getCornerWidgetPosition(rect: DOMRect, size: number, inset: number): { top: number; left: number } {
  const top = clamp(rect.bottom - size - inset, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN);
  const left = clamp(rect.right - size - inset, VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN);
  return { top, left };
}

function getSideWidgetPosition(rect: DOMRect, size: number, inset: number): { top: number; left: number } {
  const top = clamp(rect.top + (rect.height - size) / 2, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN);
  const left = clamp(rect.right - size - inset, VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN);
  return { top, left };
}

function positionWidgetElement(widget: HTMLElement, position: { top: number; left: number }): void {
  widget.style.top = `${position.top}px`;
  widget.style.left = `${position.left}px`;
}

function getCompactWidgetSize(): number {
  return STABLE_COMPACT_SLOT_SIZE;
}

function getWidgetPresentation(
  element: HTMLElement,
  rect: DOMRect,
  textRect: DOMRect
): WidgetPresentation {
  if (element instanceof HTMLInputElement && !(element instanceof HTMLTextAreaElement)) {
    return "compact";
  }
  if (rect.height < 44) {
    return "compact";
  }

  const fullWouldOverlapText = doesFullWidgetOverlapText(rect, textRect);
  if (rect.height >= 100) {
    return fullWouldOverlapText ? "compact" : "full";
  }

  const verticalSpace = rect.bottom - textRect.bottom;
  if (verticalSpace < 36) {
    return "compact";
  }

  return fullWouldOverlapText ? "compact" : "full";
}

function doesFullWidgetOverlapText(rect: DOMRect, textRect: DOMRect): boolean {
  if (textRect === rect) return false;
  const position = getCornerWidgetPosition(rect, 28, 6);
  const badgeRect = new DOMRect(position.left, position.top, 28, 28);
  return rectsOverlap(badgeRect, inflateRect(textRect, 8, 6));
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
  size: number,
  sourceRect: DOMRect,
  ignoreInlinePlaceholderText: boolean = false
): { top: number; left: number } {
  const minLeft = clamp(anchor.rect.left + COMPACT_INSET, VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN);
  const maxLeft = clamp(anchor.rect.right - size - COMPACT_INSET, minLeft, window.innerWidth - size - VIEWPORT_MARGIN);
  const minTop = clamp(anchor.rect.top + COMPACT_INSET, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN);
  const maxTop = clamp(anchor.rect.bottom - size - COMPACT_INSET, minTop, window.innerHeight - size - VIEWPORT_MARGIN);
  const preferredTop = clamp(sourceRect.top + (sourceRect.height - size) / 2, minTop, maxTop);
  if (isInlineRowRect(anchor.rect)) {
    return getInlineRightSafeCompactPosition(editorElement, anchor, size, minLeft, maxLeft, minTop, maxTop);
  }
  const stableActionStart = getStableCompactActionStart(anchor.element, editorElement, sourceRect, anchor.rect);
  if (stableActionStart !== null && isStableCompactAnchorRect(anchor.rect)) {
    const stableLeft = clamp(stableActionStart - size - COMPACT_ACTION_GAP, minLeft, maxLeft);
    const stableCandidate = new DOMRect(stableLeft, preferredTop, size, size);
    if (
      isWithinRect(stableCandidate, anchor.rect) &&
      stableCandidate.right + COMPACT_ACTION_GAP <= stableActionStart + 1
    ) {
      return { top: preferredTop, left: stableLeft };
    }
  }
  const hasMeasuredText = !ignoreInlinePlaceholderText && !rectApproximatelyEquals(textRect, anchor.rect);
  const effectiveTextRight = ignoreInlinePlaceholderText ? anchor.rect.left + COMPACT_INSET : textRect.right;
  const textBoundary = hasMeasuredText ? textRect.right + COMPACT_INSET : minLeft;
  const rowObstacles = [
    ...getCompactRowObstacles(anchor.element, editorElement, anchor.rect),
    ...getEmbeddedControlObstacles(editorElement, textRect, anchor.rect),
  ];
  const actionStart = getExplicitActionStart(anchor.element, editorElement, effectiveTextRight, anchor.rect)
    ?? getInlineActionStart(rowObstacles, effectiveTextRight, anchor.rect);
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

  const obstacleRects = hasMeasuredText
    ? [inflateRect(textRect, 10, 6), ...rowObstacles]
    : rowObstacles;
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

function getInlineRightSafeCompactPosition(
  editorElement: HTMLElement,
  anchor: { element: HTMLElement; rect: DOMRect },
  size: number,
  minLeft: number,
  maxLeft: number,
  minTop: number,
  maxTop: number
): { top: number; left: number } {
  const preferredTop = clamp(
    anchor.rect.top + (anchor.rect.height - size) / 2,
    minTop,
    maxTop
  );
  const obstacles = [
    ...getCompactRowObstacles(anchor.element, editorElement, anchor.rect),
    ...getEmbeddedControlObstacles(editorElement, anchor.rect, anchor.rect),
  ];
  const actionStart = getExplicitActionStart(anchor.element, editorElement, anchor.rect.left, anchor.rect)
    ?? getInlineActionStart(obstacles, anchor.rect.left, anchor.rect);

  if (actionStart !== null) {
    const left = clamp(actionStart - size - COMPACT_ACTION_GAP, minLeft, maxLeft);
    const candidate = new DOMRect(left, preferredTop, size, size);
    if (isWithinRect(candidate, anchor.rect) && candidate.right + COMPACT_ACTION_GAP <= actionStart + 1) {
      return { top: preferredTop, left };
    }
  }

  return {
    top: preferredTop,
    left: clamp(anchor.rect.right - size - COMPACT_INSET, minLeft, maxLeft),
  };
}

function shouldForceCompactPresentation(
  anchor: { element: HTMLElement; rect: DOMRect },
  editorElement: HTMLElement,
  sourceRect: DOMRect
): boolean {
  if (!isStableCompactAnchorRect(anchor.rect)) return false;
  if (shouldPreferExpandedPresentation(anchor.rect, sourceRect)) return false;
  return getStableCompactActionStart(anchor.element, editorElement, sourceRect, anchor.rect) !== null;
}

function shouldPreferExpandedPresentation(anchorRect: DOMRect, sourceRect: DOMRect): boolean {
  return (
    anchorRect.width >= 280 &&
    anchorRect.height >= 120 &&
    sourceRect.height <= EXPANDED_WIDGET_SOURCE_MAX_HEIGHT &&
    anchorRect.height > sourceRect.height * 1.8
  );
}

function getStableCompactActionStart(
  anchorElement: HTMLElement,
  editorElement: HTMLElement,
  sourceRect: DOMRect,
  anchorRect: DOMRect
): number | null {
  const rowObstacles = [
    ...getCompactRowObstacles(anchorElement, editorElement, anchorRect),
    ...getEmbeddedControlObstacles(editorElement, sourceRect, anchorRect),
  ];
  return getExplicitActionStart(anchorElement, editorElement, anchorRect.left, anchorRect)
    ?? getInlineActionStart(rowObstacles, anchorRect.left, anchorRect);
}

function shouldIgnoreCompactPlaceholderText(
  editorElement: HTMLElement,
  anchor: { element: HTMLElement; rect: DOMRect }
): boolean {
  if (!isInlineRowRect(anchor.rect)) return false;
  return !hasUserAuthoredText(editorElement);
}

function hasUserAuthoredText(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value.trim().length > 0;
  }

  const text = normalizeCompactText(element.innerText || element.textContent || "");
  if (!text) return false;

  const placeholders = getPlaceholderSignals(element);
  if (placeholders.some((placeholder) => normalizeCompactText(placeholder) === text)) {
    return false;
  }

  return true;
}

function getPlaceholderSignals(element: HTMLElement): string[] {
  const signals = new Set<string>();
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && depth < 5) {
    for (const value of [
      current.getAttribute("placeholder"),
      current.getAttribute("aria-placeholder"),
      current.getAttribute("data-placeholder"),
      current.getAttribute("aria-label"),
    ]) {
      if (normalizeCompactText(value || "")) {
        signals.add(value || "");
      }
    }

    current = current.parentElement;
    depth += 1;
  }

  return Array.from(signals);
}

function normalizeCompactText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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
  type CandidateAnchor = { element: HTMLElement; rect: DOMRect; score: number };
  const candidates: CandidateAnchor[] = [];
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && depth < 10) {
    const rect = current.getBoundingClientRect();
    const usable = current === element || isUsableCompactAnchor(rect, fallbackRect);
    if (usable) {
      const hasControls = hasCompactRowControls(current, element, fallbackRect, rect);
      const rowLike = isInlineRowRect(rect);
      const widthPenalty = Math.max(0, rect.width - Math.max(fallbackRect.width + 220, 520)) / 10;
      const heightPenalty = Math.max(0, rect.height - 110) * 3;
      const depthPenalty = depth * 6;
      const score =
        (hasControls ? 500 : 0) +
        (rowLike ? 160 : 0) +
        Math.min(rect.width, 1200) / 6 -
        widthPenalty -
        heightPenalty -
        depthPenalty;

      candidates.push({ element: current, rect, score });
    }

    current = current.parentElement;
    depth += 1;
  }

  if (candidates.length === 0) {
    return { element, rect: fallbackRect };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return { element: best.element, rect: best.rect };
}

function isStableCompactAnchorRect(rect: DOMRect): boolean {
  return rect.width >= 220 && rect.height >= 32 && rect.height <= STABLE_COMPACT_MAX_HEIGHT;
}

function getWidgetAnchor(element: HTMLElement, fallbackRect: DOMRect): { element: HTMLElement; rect: DOMRect } {
  const siteSpecificAnchor = getSiteSpecificExpandedAnchor(element, fallbackRect);
  if (siteSpecificAnchor) {
    return siteSpecificAnchor;
  }

  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 12) {
    const rect = current.getBoundingClientRect();
    if (isExpandedWidgetAnchor(rect, fallbackRect)) {
      return { element: current, rect };
    }
    current = current.parentElement;
    depth += 1;
  }

  if (fallbackRect.width >= 120 && fallbackRect.height >= 28) {
    return { element, rect: fallbackRect };
  }

  return { element, rect: fallbackRect };
}

function isExpandedWidgetAnchor(rect: DOMRect, fallbackRect: DOMRect): boolean {
  if (rect.width < Math.max(200, fallbackRect.width + 40)) return false;
  if (rect.height < Math.max(40, fallbackRect.height + 12)) return false;
  if (rect.height > 260) return false;
  if (rect.top > fallbackRect.top + 40) return false;
  if (rect.left > fallbackRect.left + 80) return false;
  if (rect.right < fallbackRect.right - 8) return false;
  if (rect.bottom < fallbackRect.bottom - 8) return false;
  return true;
}

function getSiteSpecificExpandedAnchor(
  element: HTMLElement,
  fallbackRect: DOMRect
): { element: HTMLElement; rect: DOMRect } | null {
  const host = location.hostname.toLowerCase();
  if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) {
    return null;
  }

  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 12) {
    const rect = current.getBoundingClientRect();
    const role = (current.getAttribute("role") || "").toLowerCase();
    const signals = [
      current.getAttribute("aria-label"),
      current.getAttribute("aria-placeholder"),
      current.getAttribute("data-placeholder"),
      current.getAttribute("title"),
      current.textContent,
    ].join(" ").toLowerCase();

    const looksLikeComposeDialog =
      role === "dialog" ||
      current.getAttribute("aria-modal") === "true" ||
      /\b(share your thoughts|start a post|create a post)\b/i.test(signals);

    if (
      looksLikeComposeDialog &&
      rect.width >= Math.max(500, fallbackRect.width + 120) &&
      rect.height >= 220 &&
      rect.height <= 1200 &&
      rectContainsRect(rect, fallbackRect, 20)
    ) {
      return { element: current, rect };
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function isUsableCompactAnchor(rect: DOMRect, fallbackRect: DOMRect): boolean {
  if (rect.width <= fallbackRect.width + 8) return false;
  if (rect.height < fallbackRect.height - 8) return false;
  if (rect.height > 180) return false;
  if (rect.top > fallbackRect.top + 12) return false;
  if (rect.bottom < fallbackRect.bottom - 12) return false;
  if (rect.left > fallbackRect.left + 16) return false;
  if (rect.right < fallbackRect.right + 8) return false;
  return true;
}

function hasCompactRowControls(
  anchorElement: HTMLElement,
  editorElement: HTMLElement,
  fallbackRect: DOMRect,
  anchorRect: DOMRect
): boolean {
  if (anchorRect.height > 180) return false;

  const rowMidY = fallbackRect.top + fallbackRect.height / 2;
  const interactiveSelector = [
    "button",
    "[role='button']",
    "[aria-haspopup]",
    "[aria-expanded]",
    "[aria-pressed]",
    "select",
    "label",
  ].join(", ");

  for (const candidate of Array.from(anchorElement.querySelectorAll<HTMLElement>(interactiveSelector))) {
    if (candidate === editorElement) continue;
    if (candidate.contains(editorElement) || editorElement.contains(candidate)) continue;

    const rect = candidate.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;
    if (!isVisibleRect(rect, anchorRect)) continue;
    if (rect.top > rowMidY || rect.bottom < rowMidY) continue;

    if (rect.left >= fallbackRect.right - 4 || rect.right <= fallbackRect.left + 4) {
      return true;
    }
  }

  return false;
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

function getEmbeddedControlObstacles(
  editorElement: HTMLElement,
  textRect: DOMRect,
  anchorRect: DOMRect
): DOMRect[] {
  const obstacles: DOMRect[] = [];
  const interactiveSelector = [
    "button",
    "[role='button']",
    "[aria-haspopup]",
    "[aria-expanded]",
    "[aria-pressed]",
    "select",
    "label",
  ].join(", ");

  editorElement.querySelectorAll<HTMLElement>(interactiveSelector).forEach((candidate) => {
    if (candidate === editorElement) return;

    const rect = candidate.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    if (!isVisibleRect(rect, anchorRect)) return;
    if (rect.right <= textRect.right + COMPACT_INSET) return;

    const style = window.getComputedStyle(candidate);
    if (style.display === "none" || style.visibility === "hidden") return;

    obstacles.push(inflateRect(rect, 4, 4));
  });

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

function rectApproximatelyEquals(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.left - b.left) <= 1 &&
    Math.abs(a.top - b.top) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1
  );
}

function getWidgetSource(element: HTMLElement): { element: HTMLElement; rect: DOMRect } {
  const directRect = element.getBoundingClientRect();
  const activeSource = getActiveEditableSource(element) ?? getBestRenderableEditableDescendant(element);
  if (!activeSource) {
    return { element, rect: directRect };
  }

  const activeRect = activeSource.getBoundingClientRect();
  if (activeRect.width < 4 || activeRect.height < 4) {
    return { element, rect: directRect };
  }

  if (!rectContainsRect(directRect, activeRect, 6)) {
    return { element, rect: directRect };
  }

  return { element: activeSource, rect: activeRect };
}

function getBestRenderableEditableDescendant(root: HTMLElement): HTMLElement | null {
  const selector = [
    "textarea",
    "input[type='text']",
    "input[type='search']",
    "input:not([type])",
    "[contenteditable='true']",
    "[contenteditable='']",
    "[contenteditable='plaintext-only']",
    "[role='textbox']",
    "[spellcheck='true']",
    "[aria-multiline='true']",
  ].join(", ");

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector))
    .filter((candidate) => isRenderableEditableCandidate(candidate))
    .filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 4 && rect.height >= 4;
    });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => scoreRenderableEditableCandidate(b, root) - scoreRenderableEditableCandidate(a, root));
  return candidates[0] ?? null;
}

function scoreRenderableEditableCandidate(candidate: HTMLElement, root: HTMLElement): number {
  const rect = candidate.getBoundingClientRect();
  const role = (candidate.getAttribute("role") || "").toLowerCase();
  let score = Math.min(rect.width * rect.height, 400000) / 1000;

  if (candidate.isContentEditable) score += 220;
  if (candidate.getAttribute("spellcheck") === "true") score += 80;
  if ((candidate.getAttribute("aria-multiline") || "").toLowerCase() === "true") score += 80;
  if (role === "textbox") score += 60;
  if (candidate instanceof HTMLTextAreaElement) score += 120;
  if (candidate instanceof HTMLInputElement) score += 40;

  let depth = 0;
  let current: HTMLElement | null = candidate;
  while (current && current !== root && depth < 12) {
    depth += 1;
    current = current.parentElement;
  }
  score -= depth * 6;

  return score;
}

function isInlineRowRect(rect: DOMRect): boolean {
  return rect.width >= 220 && rect.height >= 32 && rect.height <= 96;
}

function shouldUseSideWidgetPlacement(
  anchorRect: DOMRect,
  sourceRect: DOMRect,
  isCompact: boolean
): boolean {
  if (isCompact) return false;
  const host = location.hostname.toLowerCase();
  if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) {
    return shouldPreferExpandedPresentation(anchorRect, sourceRect);
  }

  return (
    anchorRect.height >= 220 &&
    anchorRect.width >= 400 &&
    anchorRect.height > sourceRect.height * 2
  ) || shouldPreferExpandedPresentation(anchorRect, sourceRect);
}

function getActiveEditableSource(root: HTMLElement): HTMLElement | null {
  const candidates: HTMLElement[] = [];
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && root.contains(activeElement)) {
    candidates.push(activeElement);
  }

  const selection = document.getSelection();
  const selectionElement = selection?.focusNode?.parentElement;
  if (selectionElement && root.contains(selectionElement)) {
    candidates.push(selectionElement);
  }

  for (const candidate of candidates) {
    const editable = findEditableCandidate(candidate, root);
    if (editable) {
      return editable;
    }
  }

  return null;
}

function findEditableCandidate(start: HTMLElement, root: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = start;
  let depth = 0;

  while (current && depth < 8) {
    if (isRenderableEditableCandidate(current) && root.contains(current)) {
      return current;
    }
    if (current === root) break;
    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function isRenderableEditableCandidate(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return true;
  if (element.isContentEditable) return true;
  return (element.getAttribute("role") || "").toLowerCase() === "textbox";
}

function rectContainsRect(outer: DOMRect, inner: DOMRect, tolerance: number): boolean {
  return (
    inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

function isRectViewportVisible(rect: DOMRect, padding: number = VIEWPORT_MARGIN): boolean {
  return (
    rect.right > padding &&
    rect.left < window.innerWidth - padding &&
    rect.bottom > padding &&
    rect.top < window.innerHeight - padding
  );
}
