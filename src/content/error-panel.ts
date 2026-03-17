import { GrammarError } from "../shared/types.js";
import { getShadowRoot, getShadowHost } from "./shadow-host.js";
import { isDarkMode } from "./dark-mode.js";
import { applyFix, escapeHtml, showFixFlash } from "./popover.js";
import { errorKey } from "./underline-renderer.js";

type TargetElement = HTMLElement | HTMLTextAreaElement | HTMLInputElement;

interface ShowErrorPanelOptions {
  targetElement: TargetElement;
  errors: GrammarError[];
  anchorRect: DOMRect;
  onAccept: () => void;
  onDismiss: (error: GrammarError) => void;
}

let panelEl: HTMLElement | null = null;
let cleanupFns: Array<() => void> = [];
let workingErrors: GrammarError[] = [];
let appliedAnyFix = false;
let currentTarget: TargetElement | null = null;

export function isErrorPanelOpen(): boolean {
  return !!panelEl;
}

export function hideErrorPanel(): void {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  workingErrors = [];
  appliedAnyFix = false;
  currentTarget = null;
}

export function showErrorPanel(options: ShowErrorPanelOptions): void {
  hideErrorPanel();

  currentTarget = options.targetElement;
  workingErrors = [...options.errors];
  appliedAnyFix = false;

  const root = getShadowRoot();
  const panel = document.createElement("div");
  const dark = isDarkMode();
  panel.className = `grammar-error-panel${dark ? " grammar-error-panel--dark" : ""}`;
  panelEl = panel;

  const header = document.createElement("div");
  header.className = "grammar-error-panel__header";

  const title = document.createElement("div");
  title.className = "grammar-error-panel__title";

  const headerActions = document.createElement("div");
  headerActions.className = "grammar-error-panel__header-actions";

  const fixAllBtn = document.createElement("button");
  fixAllBtn.className = "grammar-error-panel__btn grammar-error-panel__btn--primary";
  fixAllBtn.textContent = "Fix All";

  const closeBtn = document.createElement("button");
  closeBtn.className = "grammar-error-panel__close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close errors panel");

  const list = document.createElement("div");
  list.className = "grammar-error-panel__list";

  headerActions.appendChild(fixAllBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(headerActions);
  panel.appendChild(header);
  panel.appendChild(list);

  root.appendChild(panel);
  positionPanel(panel, options.anchorRect);

  const updateTitle = () => {
    title.textContent = `${workingErrors.length} issue${workingErrors.length === 1 ? "" : "s"} found`;
    fixAllBtn.disabled = workingErrors.length === 0;
  };

  const showSuccessAndAutoClose = () => {
    list.innerHTML = `<div class="grammar-error-panel__success">All issues fixed! ✓</div>`;
    title.textContent = "0 issues found";
    fixAllBtn.disabled = true;

    if (appliedAnyFix) {
      options.onAccept();
    }

    window.setTimeout(() => {
      hideErrorPanel();
    }, 1500);
  };

  const removeErrorRow = (row: HTMLElement, error: GrammarError, fixed: boolean) => {
    row.classList.add("grammar-error-panel__item--removing");
    window.setTimeout(() => {
      const idx = workingErrors.findIndex((e) => errorKey(e) === errorKey(error));
      if (idx >= 0) {
        workingErrors.splice(idx, 1);
      }
      row.remove();
      updateTitle();
      if (workingErrors.length === 0) {
        showSuccessAndAutoClose();
      }
    }, 160);

    if (!fixed) {
      options.onDismiss(error);
    } else {
      appliedAnyFix = true;
    }
  };

  const renderRows = () => {
    list.innerHTML = "";

    for (const err of workingErrors) {
      const item = document.createElement("div");
      item.className = "grammar-error-panel__item";
      item.innerHTML = `
        <div class="grammar-error-panel__item-top">
          <span class="grammar-error-panel__badge grammar-error-panel__badge--${err.type}">${err.type}</span>
        </div>
        <div class="grammar-error-panel__correction">
          <span class="grammar-error-panel__original">${escapeHtml(err.original)}</span>
          <span class="grammar-error-panel__arrow">→</span>
          <span class="grammar-error-panel__suggestion">${escapeHtml(err.suggestion)}</span>
        </div>
        <div class="grammar-error-panel__explanation">${escapeHtml(err.explanation)}</div>
        <div class="grammar-error-panel__actions">
          <button class="grammar-error-panel__btn grammar-error-panel__btn--primary">Fix</button>
          <button class="grammar-error-panel__btn grammar-error-panel__btn--secondary">Dismiss</button>
        </div>
      `;

      const [fixBtn, dismissBtn] = Array.from(item.querySelectorAll<HTMLButtonElement>(".grammar-error-panel__btn"));

      fixBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentTarget) return;
        const rect = item.getBoundingClientRect();
        applyFix(currentTarget, err);
        showFixFlash(rect);
        removeErrorRow(item, err, true);
      });

      dismissBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeErrorRow(item, err, false);
      });

      list.appendChild(item);
    }

    updateTitle();
  };

  const applyFixAll = async () => {
    if (!currentTarget || workingErrors.length === 0) return;

    const errorsToApply = [...workingErrors].sort((a, b) => b.offset - a.offset);

    if (currentTarget instanceof HTMLInputElement || currentTarget instanceof HTMLTextAreaElement) {
      let text = currentTarget.value;
      for (const err of errorsToApply) {
        text = text.substring(0, err.offset) + err.suggestion + text.substring(err.offset + err.length);
      }
      currentTarget.value = text;
      currentTarget.dispatchEvent(new Event("input", { bubbles: true }));
      appliedAnyFix = true;
      workingErrors = [];
      showSuccessAndAutoClose();
      return;
    }

    for (const err of errorsToApply) {
      applyFix(currentTarget, err);
      appliedAnyFix = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    workingErrors = [];
    showSuccessAndAutoClose();
  };

  fixAllBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void applyFixAll();
  });

  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideErrorPanel();
  });

  const onMouseDown = (e: Event) => {
    const host = getShadowHost();
    const path = e.composedPath();
    if (panelEl && host && !path.includes(host)) {
      hideErrorPanel();
    }
  };
  document.addEventListener("mousedown", onMouseDown, true);
  cleanupFns.push(() => document.removeEventListener("mousedown", onMouseDown, true));

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      hideErrorPanel();
    }
  };
  document.addEventListener("keydown", onEscape, true);
  cleanupFns.push(() => document.removeEventListener("keydown", onEscape, true));

  const onUserInput = () => hideErrorPanel();
  options.targetElement.addEventListener("input", onUserInput);
  cleanupFns.push(() => options.targetElement.removeEventListener("input", onUserInput));

  const onViewportChange = () => hideErrorPanel();
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
  cleanupFns.push(() => window.removeEventListener("scroll", onViewportChange, true));
  cleanupFns.push(() => window.removeEventListener("resize", onViewportChange));

  renderRows();
}

function positionPanel(panel: HTMLElement, anchorRect: DOMRect): void {
  const gap = 8;
  const width = 360;
  const panelRect = panel.getBoundingClientRect();
  const panelWidth = panelRect.width || width;

  let top = anchorRect.bottom + gap;
  let left = anchorRect.right - panelWidth;

  if (top + panelRect.height > window.innerHeight - 8) {
    top = Math.max(8, anchorRect.top - panelRect.height - gap);
  }

  left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}
