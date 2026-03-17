// This script runs in the MAIN world (page context).
// The content script (isolated world) sets the selection on the target element,
// then sends a postMessage here. We just call execCommand to insert the text.
// execCommand only works in the MAIN world, but selection state is shared across worlds.

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "AI_GRAMMAR_APPLY_FIX") return;

  try {
    document.execCommand("insertText", false, event.data.suggestion);
  } catch {
    // Ignore errors
  }
});
