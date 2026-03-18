import { getSettings, isConfigured } from "../shared/storage.js";
import { getShadowRoot } from "./shadow-host.js";
import { startMonitoring } from "./text-monitor.js";

let initialized = false;

async function init(): Promise<void> {
  if (initialized) return;

  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      console.log("[AI Grammar Checker] Extension disabled, skipping init");
      return;
    }

    const configured = await isConfigured();
    if (!configured) {
      console.log("[AI Grammar Checker] API key not configured, skipping init");
      return;
    }

    initialized = true;
    console.log("[AI Grammar Checker] Initializing on", location.hostname);

    // Initialize shadow DOM
    getShadowRoot();

    // Start monitoring text fields
    startMonitoring();
  } catch (err) {
    // Extension context invalidated (extension was reloaded) — ignore silently
    console.log("[AI Grammar Checker] Init error:", err);
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
