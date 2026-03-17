import { getSettings, saveSettings } from "../shared/storage.js";
import { ApiProvider } from "../shared/types.js";

async function init(): Promise<void> {
  const settings = await getSettings();

  // Provider radios
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="provider"]');
  radios.forEach((radio) => {
    radio.checked = radio.value === settings.provider;
    radio.addEventListener("change", () => updateProviderUI(radio.value as ApiProvider));
  });

  // API Keys
  const openaiInput = document.getElementById("openaiKey") as HTMLInputElement;
  const geminiInput = document.getElementById("geminiKey") as HTMLInputElement;
  openaiInput.value = settings.openaiApiKey;
  geminiInput.value = settings.geminiApiKey;

  // Toggle key visibility
  setupKeyToggle("toggleOpenaiKey", openaiInput);
  setupKeyToggle("toggleGeminiKey", geminiInput);

  // Show correct key group
  updateProviderUI(settings.provider);

  // Debounce slider
  const slider = document.getElementById("debounceSlider") as HTMLInputElement;
  const sliderValue = document.getElementById("debounceValue")!;
  slider.value = String(settings.debounceMs);
  sliderValue.textContent = `${settings.debounceMs}ms`;
  slider.addEventListener("input", () => {
    sliderValue.textContent = `${slider.value}ms`;
  });

  // Checkboxes
  (document.getElementById("checkGrammar") as HTMLInputElement).checked = settings.checkGrammar;
  (document.getElementById("checkSpelling") as HTMLInputElement).checked = settings.checkSpelling;
  (document.getElementById("checkPunctuation") as HTMLInputElement).checked = settings.checkPunctuation;

  // Test connection
  document.getElementById("testBtn")!.addEventListener("click", testConnection);

  // Save
  document.getElementById("saveBtn")!.addEventListener("click", save);
}

function updateProviderUI(provider: ApiProvider): void {
  const openaiGroup = document.getElementById("openaiKeyGroup")!;
  const geminiGroup = document.getElementById("geminiKeyGroup")!;
  openaiGroup.style.display = provider === "openai" ? "block" : "none";
  geminiGroup.style.display = provider === "gemini" ? "block" : "none";
}

function setupKeyToggle(buttonId: string, input: HTMLInputElement): void {
  const btn = document.getElementById(buttonId)!;
  btn.addEventListener("click", () => {
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });
}

async function testConnection(): Promise<void> {
  const resultEl = document.getElementById("testResult")!;
  resultEl.textContent = "Testing...";
  resultEl.className = "test-result test-result--pending";

  const provider = getSelectedProvider();
  const key = provider === "openai"
    ? (document.getElementById("openaiKey") as HTMLInputElement).value
    : (document.getElementById("geminiKey") as HTMLInputElement).value;

  if (!key) {
    resultEl.textContent = "Please enter an API key first.";
    resultEl.className = "test-result test-result--error";
    return;
  }

  // Save temporarily for the test
  await saveSettings({
    provider,
    ...(provider === "openai" ? { openaiApiKey: key } : { geminiApiKey: key }),
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHECK_GRAMMAR",
      text: "This are a test sentense.",
      requestId: "test-" + Date.now(),
    });

    if (response.error) {
      resultEl.textContent = `Error: ${response.error}`;
      resultEl.className = "test-result test-result--error";
    } else if (response.errors && response.errors.length > 0) {
      resultEl.textContent = `Success! Found ${response.errors.length} error(s) in test text.`;
      resultEl.className = "test-result test-result--success";
    } else {
      resultEl.textContent = "Connected, but no errors detected in test. API may still be working.";
      resultEl.className = "test-result test-result--success";
    }
  } catch (err) {
    resultEl.textContent = `Connection failed: ${err}`;
    resultEl.className = "test-result test-result--error";
  }
}

function getSelectedProvider(): ApiProvider {
  const checked = document.querySelector<HTMLInputElement>('input[name="provider"]:checked');
  return (checked?.value as ApiProvider) || "openai";
}

async function save(): Promise<void> {
  const resultEl = document.getElementById("saveResult")!;

  await saveSettings({
    provider: getSelectedProvider(),
    openaiApiKey: (document.getElementById("openaiKey") as HTMLInputElement).value,
    geminiApiKey: (document.getElementById("geminiKey") as HTMLInputElement).value,
    debounceMs: parseInt((document.getElementById("debounceSlider") as HTMLInputElement).value),
    checkGrammar: (document.getElementById("checkGrammar") as HTMLInputElement).checked,
    checkSpelling: (document.getElementById("checkSpelling") as HTMLInputElement).checked,
    checkPunctuation: (document.getElementById("checkPunctuation") as HTMLInputElement).checked,
  });

  resultEl.textContent = "Settings saved!";
  resultEl.className = "save-result save-result--success";
  setTimeout(() => {
    resultEl.textContent = "";
  }, 2000);
}

init();
