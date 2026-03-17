import { getSettings, isConfigured } from "../shared/storage.js";
import { getShadowRoot } from "./shadow-host.js";
import { startMonitoring } from "./text-monitor.js";

let initialized = false;

async function init(): Promise<void> {
  if (initialized) return;

  try {
    const settings = await getSettings();
    if (!settings.enabled) return;

    const configured = await isConfigured();
    if (!configured) return;

    initialized = true;

    // Initialize shadow DOM
    getShadowRoot();

    // Start monitoring text fields
    startMonitoring();
  } catch {
    // Extension context invalidated (extension was reloaded) — ignore silently
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Re-try init when settings change (e.g., user just saved API key)
try {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      init();
    }
  });
} catch {
  // Extension context invalidated — ignore
}
