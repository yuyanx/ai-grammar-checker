import { getOrCreateContainer, getShadowRoot } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";

export type WidgetState = "idle" | "checking" | "errors" | "clean";

const widgetMap = new WeakMap<HTMLElement, string>();
let widgetCounter = 0;

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
  console.log("[AI Grammar Checker] updateWidget called, state:", state, "errorCount:", errorCount, "hasCallback:", !!onClickErrors);
  const containerId = getWidgetContainerId(element);
  const container = getOrCreateContainer(containerId);
  container.innerHTML = "";

  // Don't show widget for hidden/invisible elements
  const rect = element.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 20) return;

  // Don't show for idle state
  if (state === "idle") return;

  const widget = document.createElement("div");
  const dark = isDarkMode();

  // Use smaller widget for compact editors (e.g. comment boxes)
  const isCompact = rect.height < 44;
  const size = isCompact ? 20 : 28;
  const margin = isCompact ? 2 : 6;

  // Position: for compact editors, vertically center and offset from right edge
  // to avoid overlapping site buttons (send, emoji, etc.)
  widget.style.position = "fixed";
  if (isCompact) {
    widget.style.top = `${rect.top + (rect.height - size) / 2}px`;
    widget.style.left = `${rect.right - size - 36}px`;
  } else {
    widget.style.top = `${rect.bottom - size - margin}px`;
    widget.style.left = `${rect.right - size - margin}px`;
  }

  // Build class name including compact modifier
  const compactClass = isCompact ? " grammar-widget--compact" : "";

  if (state === "checking") {
    widget.className = `grammar-widget grammar-widget--checking${compactClass}`;
    widget.innerHTML = `
      <div class="grammar-widget__spinner"></div>
      <div class="grammar-widget__tooltip${dark ? " grammar-widget__tooltip--dark" : ""}">Checking...</div>
    `;
  } else if (state === "errors") {
    widget.className = `grammar-widget grammar-widget--errors${compactClass}`;
    widget.innerHTML = `
      <span class="grammar-widget__count">${errorCount > 9 ? "9+" : errorCount}</span>
      <div class="grammar-widget__tooltip${dark ? " grammar-widget__tooltip--dark" : ""}">${errorCount} issue${errorCount !== 1 ? "s" : ""} found</div>
    `;
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
      widget.style.opacity = "0";
      widget.style.transition = "opacity 0.3s";
      setTimeout(() => container.innerHTML = "", 300);
    }, 3000);
  }

  container.appendChild(widget);
}

export function removeWidget(element: HTMLElement): void {
  const containerId = widgetMap.get(element);
  if (containerId) {
    const container = getOrCreateContainer(containerId);
    container.innerHTML = "";
  }
}

/**
 * Nuclear clear: remove all widget containers from the shadow DOM.
 * Used when element-specific clear isn't working (e.g., SPA navigation).
 */
export function removeAllWidgets(): void {
  const root = getShadowRoot();
  const containers = root.querySelectorAll("[id^='widget-']");
  containers.forEach((c) => { c.innerHTML = ""; });
}

function getWidgetContainerId(element: HTMLElement): string {
  let id = widgetMap.get(element);
  if (!id) {
    id = `widget-${widgetCounter++}`;
    widgetMap.set(element, id);
  }
  return id;
}
