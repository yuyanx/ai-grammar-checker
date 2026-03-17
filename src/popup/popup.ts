import { getSettings, saveSettings, isConfigured } from "../shared/storage.js";

async function init(): Promise<void> {
  const settings = await getSettings();
  const configured = await isConfigured();

  // Status
  const statusDot = document.getElementById("statusDot")!;
  const statusText = document.getElementById("statusText")!;

  if (!configured) {
    statusDot.classList.add("popup__status-dot--error");
    statusText.textContent = "No API key configured";
  } else {
    statusDot.classList.add("popup__status-dot--ok");
    const provider = settings.provider === "openai" ? "OpenAI" : "Gemini";
    statusText.textContent = `Connected to ${provider}`;
  }

  // Toggle
  const toggle = document.getElementById("enableToggle") as HTMLInputElement;
  toggle.checked = settings.enabled;
  toggle.addEventListener("change", async () => {
    await saveSettings({ enabled: toggle.checked });
  });

  // Settings button
  document.getElementById("settingsBtn")!.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
