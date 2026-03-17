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
    z-index: 2147483647;
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
    z-index: 2147483647;
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
    transition: all 0.2s ease;
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

  .grammar-widget--errors {
    background: #e53e3e;
  }

  .grammar-widget--clean {
    background: #48bb78;
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

  .grammar-widget__check {
    color: #fff;
    font-size: 13px;
    line-height: 1;
    animation: grammar-checkmark-in 0.3s ease-out;
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


  /* ===== ERROR PANEL ===== */
  .grammar-error-panel {
    position: fixed;
    z-index: 2147483647;
    width: 360px;
    max-height: 400px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1a202c;
    animation: grammar-fade-in 0.15s ease-out;
  }

  .grammar-error-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid #e2e8f0;
  }

  .grammar-error-panel__title {
    font-size: 13px;
    font-weight: 700;
  }

  .grammar-error-panel__header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .grammar-error-panel__close {
    border: none;
    background: transparent;
    color: #718096;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }

  .grammar-error-panel__list {
    max-height: 340px;
    overflow: auto;
    padding: 8px;
  }

  .grammar-error-panel__item {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 8px;
    background: #f7fafc;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }

  .grammar-error-panel__item--removing {
    opacity: 0;
    transform: translateX(10px);
  }

  .grammar-error-panel__badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .grammar-error-panel__badge--spelling {
    background: #fed7d7;
    color: #c53030;
  }

  .grammar-error-panel__badge--grammar {
    background: #bee3f8;
    color: #2b6cb0;
  }

  .grammar-error-panel__badge--punctuation {
    background: #c6f6d5;
    color: #276749;
  }

  .grammar-error-panel__correction {
    margin-top: 8px;
    font-size: 14px;
  }

  .grammar-error-panel__original {
    color: #e53e3e;
    text-decoration: line-through;
  }

  .grammar-error-panel__arrow {
    color: #a0aec0;
    margin: 0 6px;
  }

  .grammar-error-panel__suggestion {
    color: #38a169;
    font-weight: 600;
  }

  .grammar-error-panel__explanation {
    margin-top: 8px;
    color: #718096;
    font-size: 12px;
    line-height: 1.4;
  }

  .grammar-error-panel__actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .grammar-error-panel__btn {
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .grammar-error-panel__btn--primary {
    background: #4299e1;
    color: #fff;
  }

  .grammar-error-panel__btn--primary:hover {
    background: #3182ce;
  }

  .grammar-error-panel__btn--secondary {
    background: #edf2f7;
    color: #4a5568;
  }

  .grammar-error-panel__btn--secondary:hover {
    background: #e2e8f0;
  }

  .grammar-error-panel__success {
    text-align: center;
    padding: 24px 12px;
    color: #38a169;
    font-weight: 700;
    font-size: 15px;
  }

  .grammar-error-panel--dark {
    background: #1a202c;
    border-color: #4a5568;
    color: #e2e8f0;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .grammar-error-panel--dark .grammar-error-panel__header,
  .grammar-error-panel--dark .grammar-error-panel__item {
    border-color: #4a5568;
  }

  .grammar-error-panel--dark .grammar-error-panel__item {
    background: #2d3748;
  }

  .grammar-error-panel--dark .grammar-error-panel__close,
  .grammar-error-panel--dark .grammar-error-panel__explanation {
    color: #a0aec0;
  }

  .grammar-error-panel--dark .grammar-error-panel__btn--secondary {
    background: #2d3748;
    color: #a0aec0;
  }

  .grammar-error-panel--dark .grammar-error-panel__btn--secondary:hover {
    background: #4a5568;
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
`;
