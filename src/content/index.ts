import { getSettings, isConfigured } from "../shared/storage.js";
import { getShadowRoot } from "./shadow-host.js";
import { startMonitoring } from "./text-monitor.js";

let initialized = false;

async function init(): Promise<void> {
  if (initialized) return;

  // Skip tiny/invisible iframes (tracking pixels, analytics, ad frames).
  // These have no user-editable content and waste resources.
  try {
    if (window !== window.top) {
      const w = window.innerWidth || document.documentElement?.clientWidth || 0;
      const h = window.innerHeight || document.documentElement?.clientHeight || 0;
      if (w < 100 || h < 100) {
        return; // too small to contain a real editor
      }
      // Skip known tracking/analytics domains
      const host = location.hostname;
      if (/demdex\.net|doubleclick|googlesyndication|facebook\.com\/tr|analytics|pixel/i.test(host)) {
        return;
      }
    }
  } catch {
    // cross-origin access error — we're in a cross-origin iframe, skip it
    return;
  }

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
