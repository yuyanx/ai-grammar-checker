export const CONTENT_CSS = `
  /* ===== ANIMATIONS ===== */
  @keyframes grammar-fade-in {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes grammar-fade-out {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(2px); }
  }

  @keyframes grammar-underline-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes grammar-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  @keyframes grammar-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes grammar-flash-green {
    0% { background: rgba(72, 187, 120, 0.35); }
    100% { background: transparent; }
  }

  @keyframes grammar-checkmark-in {
    from { opacity: 0; transform: scale(0.5); }
    to { opacity: 1; transform: scale(1); }
  }

  /* ===== UNDERLINES ===== */
  .grammar-underline {
    position: absolute;
    pointer-events: auto;
    cursor: pointer;
    height: 4px;
    bottom: 0;
    background-repeat: repeat-x;
    background-size: 4px 4px;
    background-position: bottom;
    z-index: 2147483645;
    animation: grammar-underline-in 0.3s ease-out;
    transition: opacity 0.2s, height 0.15s;
  }

  .grammar-underline:hover {
    height: 5px;
    filter: brightness(1.2);
  }

  .grammar-underline--spelling {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Cpath d='M0 3 Q1 0 2 3 Q3 6 4 3' fill='none' stroke='%23e53e3e' stroke-width='1'/%3E%3C/svg%3E");
  }

  .grammar-underline--grammar {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Cpath d='M0 3 Q1 0 2 3 Q3 6 4 3' fill='none' stroke='%233182ce' stroke-width='1'/%3E%3C/svg%3E");
  }

  .grammar-underline--punctuation {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Cpath d='M0 3 Q1 0 2 3 Q3 6 4 3' fill='none' stroke='%2338a169' stroke-width='1'/%3E%3C/svg%3E");
  }

  .grammar-underline--removing {
    animation: grammar-fade-out 0.2s ease-out forwards;
  }

  /* ===== POST-FIX GREEN FLASH ===== */
  .grammar-fix-flash {
    position: fixed;
    pointer-events: none;
    border-radius: 3px;
    z-index: 2147483646;
    animation: grammar-flash-green 0.6s ease-out forwards;
  }

  /* ===== POPOVER ===== */
  .grammar-popover {
    position: fixed;
    z-index: 2147483647;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
    padding: 14px 18px;
    max-width: 380px;
    min-width: 240px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1a202c;
    pointer-events: auto;
    animation: grammar-fade-in 0.15s ease-out;
    transform-origin: top left;
  }

  .grammar-popover--above {
    transform-origin: bottom left;
  }

  .grammar-popover--closing {
    animation: grammar-fade-out 0.12s ease-out forwards;
  }

  /* Popover arrow */
  .grammar-popover__caret {
    position: absolute;
    width: 12px;
    height: 12px;
    background: #fff;
    border: 1px solid #e2e8f0;
    transform: rotate(45deg);
    border-right: none;
    border-bottom: none;
    top: -7px;
    left: 20px;
  }

  .grammar-popover__caret--bottom {
    top: auto;
    bottom: -7px;
    border-top: none;
    border-left: none;
    border-right: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
  }

  .grammar-popover__header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .grammar-popover__badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .grammar-popover__badge--spelling {
    background: #fed7d7;
    color: #c53030;
  }

  .grammar-popover__badge--grammar {
    background: #bee3f8;
    color: #2b6cb0;
  }

  .grammar-popover__badge--punctuation {
    background: #c6f6d5;
    color: #276749;
  }

  .grammar-popover__correction {
    margin: 8px 0;
    padding: 10px 14px;
    background: #f7fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .grammar-popover__correction:hover {
    background: #edf2f7;
    border-color: #cbd5e0;
  }

  .grammar-popover__original {
    text-decoration: line-through;
    color: #e53e3e;
    margin-right: 8px;
  }

  .grammar-popover__arrow {
    color: #a0aec0;
    margin-right: 8px;
  }

  .grammar-popover__suggestion {
    color: #38a169;
    font-weight: 600;
  }

  .grammar-popover__explanation {
    color: #718096;
    font-size: 13px;
    margin: 6px 0 12px;
    line-height: 1.4;
  }

  .grammar-popover__actions {
    display: flex;
    gap: 8px;
  }

  .grammar-popover__btn {
    padding: 7px 16px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .grammar-popover__btn--accept {
    background: #4299e1;
    color: #fff;
    flex: 1;
  }

  .grammar-popover__btn--accept:hover {
    background: #3182ce;
    box-shadow: 0 2px 8px rgba(66, 153, 225, 0.4);
  }

  .grammar-popover__btn--dismiss {
    background: #edf2f7;
    color: #4a5568;
  }

  .grammar-popover__btn--dismiss:hover {
    background: #e2e8f0;
  }

  /* ===== FLOATING STATUS WIDGET (Grammarly-style) ===== */
  .grammar-widget {
    position: fixed;
    z-index: 2147483646;
    pointer-events: auto;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #48bb78;
    border: 2px solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    animation: grammar-fade-in 0.2s ease-out;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .grammar-widget:hover {
    transform: scale(1.15);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  }

  .grammar-widget--checking {
    background: #a0aec0;
  }

  .grammar-widget--ready {
    background: #2563eb;
    border-color: #ffffff;
  }

  .grammar-widget--errors {
    background: #e53e3e;
  }

  .grammar-widget--clean {
    background: #48bb78;
  }

  .grammar-widget--error {
    background: #ed8936;
  }

  .grammar-widget__error-icon {
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }

  .grammar-widget--compact .grammar-widget__error-icon {
    font-size: 10px;
  }

  .grammar-widget__spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: grammar-spin 0.6s linear infinite;
  }

  .grammar-widget__count {
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  .grammar-widget--wide-count {
    min-width: 28px;
    width: auto;
    padding: 0 6px;
    border-radius: 999px;
  }

  .grammar-widget__check {
    color: #fff;
    font-size: 13px;
    line-height: 1;
    animation: grammar-checkmark-in 0.3s ease-out;
  }

  /* Compact widget for small editors (comment boxes) */
  .grammar-widget.grammar-widget--compact {
    width: 20px;
    height: 20px;
    border-width: 1.5px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  }
  .grammar-widget.grammar-widget--compact-dot {
    width: 20px;
    height: 20px;
    border-width: 0;
    background: transparent;
    box-shadow: none;
  }
  .grammar-widget.grammar-widget--compact-dot::before {
    content: "";
    position: absolute;
    left: 4px;
    top: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }
  .grammar-widget--ready.grammar-widget--compact-dot::before {
    background: #2563eb;
  }
  .grammar-widget--errors.grammar-widget--compact-dot::before {
    background: #e53e3e;
  }
  .grammar-widget--compact .grammar-widget__count {
    font-size: 9px;
  }
  .grammar-widget--compact-dot .grammar-widget__count {
    display: none;
  }
  .grammar-widget--compact .grammar-widget__check {
    font-size: 10px;
  }
  .grammar-widget--compact .grammar-widget__spinner {
    width: 10px;
    height: 10px;
  }
  .grammar-widget--compact-dot .grammar-widget__tooltip {
    margin-bottom: 8px;
  }

  /* Widget tooltip on hover */
  .grammar-widget__tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 6px;
    padding: 4px 10px;
    background: #2d3748;
    color: #fff;
    font-size: 11px;
    border-radius: 4px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }

  .grammar-widget:hover .grammar-widget__tooltip {
    opacity: 1;
  }

  /* ===== DARK MODE ===== */
  :host-context([data-grammar-dark="true"]) .grammar-popover,
  .grammar-popover--dark {
    background: #1a202c;
    border-color: #4a5568;
    color: #e2e8f0;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .grammar-popover--dark .grammar-popover__caret {
    background: #1a202c;
    border-color: #4a5568;
  }

  .grammar-popover--dark .grammar-popover__correction {
    background: #2d3748;
    border-color: #4a5568;
  }

  .grammar-popover--dark .grammar-popover__correction:hover {
    background: #4a5568;
    border-color: #718096;
  }

  .grammar-popover--dark .grammar-popover__explanation {
    color: #a0aec0;
  }

  .grammar-popover--dark .grammar-popover__arrow {
    color: #718096;
  }

  .grammar-popover--dark .grammar-popover__btn--accept {
    background: #4299e1;
  }

  .grammar-popover--dark .grammar-popover__btn--accept:hover {
    background: #63b3ed;
  }

  .grammar-popover--dark .grammar-popover__btn--dismiss {
    background: #2d3748;
    color: #a0aec0;
  }

  .grammar-popover--dark .grammar-popover__btn--dismiss:hover {
    background: #4a5568;
  }

  .grammar-popover--dark .grammar-popover__badge--spelling {
    background: #742a2a;
    color: #feb2b2;
  }

  .grammar-popover--dark .grammar-popover__badge--grammar {
    background: #2a4365;
    color: #90cdf4;
  }

  .grammar-popover--dark .grammar-popover__badge--punctuation {
    background: #22543d;
    color: #9ae6b4;
  }

  .grammar-widget__tooltip--dark {
    background: #e2e8f0;
    color: #1a202c;
  }

  /* ===== ERROR PANEL ===== */
  .grammar-error-panel {
    position: fixed;
    z-index: 2147483647;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1a202c;
    width: 360px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    animation: grammar-fade-in 0.15s ease-out;
    pointer-events: auto;
  }

  .grammar-error-panel--closing {
    animation: grammar-fade-out 0.12s ease-out forwards;
  }

  .grammar-error-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .grammar-error-panel__title {
    font-weight: 600;
    font-size: 14px;
  }

  .grammar-error-panel__header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .grammar-error-panel__fix-all {
    padding: 5px 14px;
    border-radius: 6px;
    border: none;
    background: #4299e1;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .grammar-error-panel__fix-all:hover {
    background: #3182ce;
    box-shadow: 0 2px 8px rgba(66, 153, 225, 0.4);
  }

  .grammar-error-panel__close {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: #a0aec0;
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    line-height: 1;
  }

  .grammar-error-panel__close:hover {
    background: #edf2f7;
    color: #4a5568;
  }

  .grammar-error-panel__list {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }

  .grammar-error-panel__item {
    padding: 10px 16px;
    border-bottom: 1px solid #f0f0f0;
    transition: opacity 0.25s, max-height 0.3s ease, padding 0.3s ease;
    max-height: 200px;
    overflow: hidden;
  }

  .grammar-error-panel__item:last-child {
    border-bottom: none;
  }

  .grammar-error-panel__item--removing {
    opacity: 0;
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
  }

  .grammar-error-panel__item-header {
    margin-bottom: 4px;
  }

  .grammar-error-panel__item-correction {
    margin: 4px 0;
    padding: 6px 10px;
    background: #f7fafc;
    border-radius: 6px;
    font-size: 13px;
  }

  .grammar-error-panel__item-explanation {
    color: #718096;
    font-size: 12px;
    margin: 4px 0 8px;
    line-height: 1.4;
  }

  .grammar-error-panel__item-actions {
    display: flex;
    gap: 6px;
  }

  .grammar-error-panel__item-btn {
    padding: 4px 12px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .grammar-error-panel__item-btn--fix {
    background: #4299e1;
    color: #fff;
  }

  .grammar-error-panel__item-btn--fix:hover {
    background: #3182ce;
  }

  .grammar-error-panel__item-btn--dismiss {
    background: #edf2f7;
    color: #4a5568;
  }

  .grammar-error-panel__item-btn--dismiss:hover {
    background: #e2e8f0;
  }

  .grammar-error-panel__success {
    padding: 24px 16px;
    text-align: center;
    color: #38a169;
    font-weight: 600;
    font-size: 14px;
  }

  .grammar-error-panel__success span {
    display: block;
    font-size: 28px;
    margin-bottom: 8px;
    animation: grammar-checkmark-in 0.3s ease-out;
  }

  /* Error panel dark mode */
  .grammar-error-panel--dark {
    background: #1a202c;
    border-color: #4a5568;
    color: #e2e8f0;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .grammar-error-panel--dark .grammar-error-panel__header {
    border-bottom-color: #4a5568;
  }

  .grammar-error-panel--dark .grammar-error-panel__close {
    color: #718096;
  }

  .grammar-error-panel--dark .grammar-error-panel__close:hover {
    background: #4a5568;
    color: #e2e8f0;
  }

  .grammar-error-panel--dark .grammar-error-panel__item {
    border-bottom-color: #2d3748;
  }

  .grammar-error-panel--dark .grammar-error-panel__item-correction {
    background: #2d3748;
  }

  .grammar-error-panel--dark .grammar-error-panel__item-explanation {
    color: #a0aec0;
  }

  .grammar-error-panel--dark .grammar-error-panel__item-btn--dismiss {
    background: #2d3748;
    color: #a0aec0;
  }

  .grammar-error-panel--dark .grammar-error-panel__item-btn--dismiss:hover {
    background: #4a5568;
  }

  .grammar-error-panel--dark .grammar-error-panel__success {
    color: #68d391;
  }
`;
