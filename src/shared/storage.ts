import { ApiProvider, UserSettings } from "./types.js";
import { DEFAULT_DEBOUNCE_MS } from "./constants.js";

const DEFAULT_SETTINGS: UserSettings = {
  provider: "openai",
  openaiApiKey: "",
  geminiApiKey: "",
  enabled: true,
  debounceMs: DEFAULT_DEBOUNCE_MS,
  checkGrammar: true,
  checkSpelling: true,
  checkPunctuation: true,
};

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

export async function saveSettings(
  partial: Partial<UserSettings>
): Promise<void> {
  const current = await getSettings();
  await chrome.storage.sync.set({ settings: { ...current, ...partial } });
}

export async function getApiKey(provider: ApiProvider): Promise<string> {
  const settings = await getSettings();
  return provider === "openai" ? settings.openaiApiKey : settings.geminiApiKey;
}

export async function isConfigured(): Promise<boolean> {
  const settings = await getSettings();
  const key =
    settings.provider === "openai"
      ? settings.openaiApiKey
      : settings.geminiApiKey;
  return key.length > 0;
}
