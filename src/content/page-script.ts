// This script runs in the MAIN world (page context).
// The content script (isolated world) sets the selection on the target element,
// then sends a postMessage here. We call execCommand to insert the text.
// execCommand only works in the MAIN world, but selection state is shared across worlds.

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "AI_GRAMMAR_APPLY_FIX") return;

  const suggestion = event.data.suggestion;
  if (typeof suggestion !== "string") return;

  try {
    // The content script has already set the selection on the target element.
    // We just need to call execCommand here in the MAIN world where it works.
    const activeEl = document.activeElement;

    if (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement) {
      // For textareas/inputs, execCommand('insertText') replaces the current selection
      document.execCommand("insertText", false, suggestion);
    } else if (activeEl && (activeEl as HTMLElement).isContentEditable) {
      // For contentEditable, the selection/range is already set by the content script
      document.execCommand("insertText", false, suggestion);
    }
  } catch {
    // Ignore errors — the content script has a fallback for textareas
  }
});
