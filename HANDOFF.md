# Handoff Notes

## Branch
`claude/angry-wu-k70YE`

## Build
```bash
npm run build    # uses build.sh + bun bundler, output in dist/
```
Load `dist/` as unpacked extension in Chrome.

## Current State
- Build is clean, no errors
- Latest commit: `c747112` — SPA navigation cleanup fix
- All work has been pushed to the branch

## Recent Changes (newest first)
1. **SPA cleanup** — periodic interval detects URL changes and disconnected DOM elements, clears stale underlines/widgets, re-scans for new inputs
2. **Disabled Gemini thinking** — speeds up grammar checks
3. **Fix oscillation** — AI was reversing its own corrections; now tracks applied fixes
4. **Offset adjustment** — after applying a fix, remaining error positions are shifted
5. **Model upgrade** — Gemini 2.0-flash (deprecated) -> 2.5-flash-lite
6. **One-pass error detection** — find all errors in single API call instead of one-by-one

## Architecture

### Extension Structure
- **Content scripts** (`src/content/`) — injected into web pages
- **Background** (`src/background/service-worker.ts`) — handles API calls
- **Popup** (`src/popup/`) — extension popup UI
- **Options** (`src/options/`) — settings page
- **Shared** (`src/shared/`) — types, constants, storage, API parsers, prompts

### Key Content Script Files
| File | Role |
|---|---|
| `text-monitor.ts` | Main orchestrator: scans for text inputs, debounces checks, calls API, manages state |
| `underline-renderer.ts` | Draws red underlines under errors using shadow DOM overlays |
| `popover.ts` | Tooltip that appears on hover/click showing error + fix button |
| `error-panel.ts` | Side panel listing all errors |
| `status-widget.ts` | Badge showing error count, positioned near each input |
| `shadow-host.ts` | Creates/manages shadow DOM containers for isolation |
| `content-css.ts` | Injects CSS into shadow roots |
| `dark-mode.ts` | Detects dark mode for styling |
| `page-script.ts` | Runs in MAIN world for execCommand access (applying fixes) |

### How It Works
1. `text-monitor.ts` uses MutationObserver to find `<textarea>` and `contenteditable` elements
2. On text change (debounced 1s), sends text to background service worker
3. Service worker calls AI API (OpenAI/Gemini/Anthropic, configurable in options)
4. Errors returned as `{original, suggestion, explanation}` with character offsets
5. Underlines rendered in shadow DOM overlay positioned over the input
6. Clicking underline shows popover with fix button
7. Fix applies via `execCommand` (delegated to page-script.ts in MAIN world)

### Shadow DOM Pattern
All UI (underlines, popovers, widgets) lives in shadow DOM to avoid CSS conflicts with host pages. `shadow-host.ts` provides `getOrCreateContainer()` and `getShadowRoot()`.

### State Management
- `elementStates` Map in `text-monitor.ts` tracks per-element: errors, lastText, debounceTimer
- `trackedElements` Set tracks all monitored elements
- `lastUrl` tracks URL for SPA navigation detection

## Known Issues / Potential Work
- No automated tests exist
- Error detection quality depends on AI prompt tuning (`src/shared/prompts.ts`)
- Large text inputs may be slow (entire text sent to API each time)
- No support for `<input type="text">` (only textarea/contenteditable)

## Settings
Users configure API provider + key in the options page. Stored via `chrome.storage.sync`. See `src/shared/storage.ts` for schema.
