# AI Grammar Checker

A Grammarly-like Chrome extension that uses your own OpenAI or Google Gemini API keys to check grammar, spelling, and punctuation in real time.

## Features

- **Real-time checking** — Detects errors as you type with color-coded underlines (blue for grammar, red for spelling, green for punctuation)
- **One-click fixes** — Click any underline to see suggestions and accept with one click
- **Bring your own key** — Works with OpenAI (`gpt-4o-mini`) or Google Gemini (`gemini-2.5-flash-lite`)
- **Smart activation** — Only activates on real writing surfaces (email, chat, posts); ignores search bars, pickers, and utility inputs
- **Works everywhere** — Supports `<textarea>` and `contenteditable` editors on any website (input fields are excluded by design to avoid activating on search bars and utility fields)
- **English-only** — Automatically detects and skips non-English text
- **Local punctuation rules** — Catches obvious punctuation errors instantly without an API call
- **Privacy-aware** — Automatically skips password fields, credit card inputs, API key fields, and other sensitive elements
- **Dark mode** — Detects and adapts to dark-themed pages
- **Configurable** — Adjust debounce delay, toggle error types, and switch providers from the options page

## Installation

1. Clone or download this repository
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** and select the `dist/` folder

## Setup

1. Click the extension icon and go to **Settings**
2. Choose your API provider (OpenAI or Gemini)
3. Enter your API key
4. Click **Test Connection** to verify
5. Start typing on any webpage — errors will be underlined automatically

## Supported Providers

| Provider | Model | Free Tier |
|----------|-------|-----------|
| OpenAI | gpt-4o-mini | No (pay-per-use) |
| Google Gemini | gemini-2.5-flash-lite | Yes (15 req/min) |

## Project Structure

```
src/
├── background/
│   └── service-worker.ts          # API calls, chunking, caching, retries
├── content/
│   ├── index.ts                   # Content script entry point
│   ├── text-monitor.ts            # Element detection, debounce, checking logic
│   ├── editor-classifier.ts       # Editor-intent classification and activation gating
│   ├── underline-renderer.ts      # SVG wave underlines and positioning
│   ├── popover.ts                 # Error suggestion popover UI
│   ├── error-panel.ts             # Error list panel with Fix/Dismiss/Fix All
│   ├── status-widget.ts           # "Checking" / "N errors" indicator
│   ├── contenteditable-snapshot.ts # Visible-text snapshot and offset mapping
│   ├── shadow-host.ts             # Shadow DOM isolation
│   ├── dark-mode.ts               # Theme detection
│   ├── page-script.ts             # MAIN world script for DOM writes
│   └── content-css.ts             # Inline styles and animations
├── popup/
│   ├── popup.ts                   # Popup logic
│   └── popup.html                 # Popup UI
├── options/
│   ├── options.ts                 # Settings page logic
│   └── options.html               # Settings UI
└── shared/
    ├── types.ts                   # TypeScript interfaces
    ├── constants.ts               # API URLs and defaults
    ├── storage.ts                 # chrome.storage.sync wrapper
    ├── prompts.ts                 # Grammar check prompt with few-shot example
    ├── api-parsers.ts             # Response parsing and validation
    ├── punctuation-rules.ts       # Deterministic local punctuation detection
    ├── grammar-rules.ts           # Deterministic local grammar detection (modal structure, compound subjects)
    └── language-detect.ts         # English-only language gating
```

## Building

```bash
npm run build
```

Uses esbuild to bundle TypeScript into the `dist/` directory. The build copies static assets (HTML, CSS, icons) and bundles JS as IIFE modules for Chrome extension compatibility.

## How It Works

1. The content script classifies editable fields and monitors only real writing surfaces (email composers, chat boxes, comment editors)
2. After you stop typing (configurable debounce, default 800ms), text is sent to the service worker
3. The service worker checks its cache, then calls the selected API
4. Errors are returned with exact positions, validated against the original text
5. Underlines are rendered in a shadow DOM overlay, and clicking one shows a suggestion popover
6. Clicking **Accept** applies the fix directly to the text field

## License

MIT
