# Handoff Notes

## Branch
`claude/angry-wu-k70YE`

## Build
```bash
npm run build
```
Load `dist/` as unpacked extension in Chrome.

## Current State
- Current package/manifest version: `1.6.5`
- `npm run build` passes locally
- Instagram compact badge placement is now explicitly anchored to visible action labels like `Post`, with a hard left-side safety gap to avoid overlap
- Compact error dots are reduced to `12px` for crowded editors
- Verified with a rendered local fixture using the real widget code:
  - Fixture: `/tmp/ig-widget-test/index.html`
  - Screenshot: `/tmp/ig-widget-test/result.png`
  - Result: `PASS gap=16px widget=694-710 post=726-764`
- `AGENTS.md` is still untracked locally and should stay out of the commit unless explicitly requested

## Recent Changes (newest first)
1. **Instagram compact badge fix** — `status-widget.ts` now explicitly detects visible action labels such as `Post`, `Comment`, `Reply`, and `Send` and anchors the compact dot to the left of that label with a hard safety gap
2. **Compact badge sizing/placement cleanup** — compact error dots are now `12px`, and compact placement uses rendered text bounds instead of the full contenteditable box
3. **Rendered obstacle detection fix** — right-side action text in shared wrappers is now treated as occupied space instead of being filtered out
4. **Contenteditable offset integrity** — added a shared visible-text snapshot/mapping utility so multiline rich-text editors, duplicate words, and fix application all use the same offsets
5. **Retry-state fix** — unchanged text is retryable after transient API failures instead of being stuck until the user types again
6. **Version/changelog updates** — package/manifest/changelog were updated through `1.6.5`

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
| `underline-renderer.ts` | Draws error underlines and insertion anchors using shadow DOM overlays |
| `popover.ts` | Tooltip that appears on hover/click showing error + fix button |
| `error-panel.ts` | Side panel listing all errors |
| `status-widget.ts` | Badge showing error count, positioned near each input |
| `shadow-host.ts` | Creates/manages shadow DOM containers for isolation |
| `content-css.ts` | Injects CSS into shadow roots |
| `dark-mode.ts` | Detects dark mode for styling |
| `page-script.ts` | Runs in MAIN world for execCommand access (applying fixes) |

### How It Works
1. `text-monitor.ts` discovers editable fields and assigns per-editor tracking state
2. On text change, it debounces requests and sends a `CHECK_GRAMMAR` message with a per-editor `sourceId`
3. The background service worker checks the cache, scopes in-flight aborts, and calls the configured AI provider
4. Parser/validator logic normalizes suggestions, including insertion-style fixes
5. Underlines/widgets/popovers render in a shadow DOM overlay positioned over the host editor
6. Accepting a fix updates the editor directly and triggers a re-check

### State Management
- `elementStates` WeakMap in `text-monitor.ts` tracks per-element errors, timers, source IDs, and observers
- `trackedElements` Set tracks monitored editors for cleanup/rescan behavior
- Background worker maintains a scoped in-flight abort map and an in-memory response cache

## Known Issues / Potential Work
- No automated unit/integration tests exist yet
- Error detection quality still depends heavily on prompt tuning (`src/shared/prompts.ts`)
- Large text inputs may still be slow because the full normalized text is sent to the API each time
- Instagram placement is verified on a local fixture, but live-page DOM inspection in Safari is limited because `do JavaScript` from Apple Events is disabled on this machine

## Commands Run In This Session
```bash
git status --short --branch
npm run build
osascript -e 'tell application "Safari" to count windows'
osascript -e 'tell application "Safari" to get URL of current tab of front window'
./node_modules/.bin/esbuild /tmp/ig-widget-test/entry.ts --bundle --format=iife --outfile=/tmp/ig-widget-test/entry.js
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new --disable-gpu --virtual-time-budget=4000 --dump-dom file:///tmp/ig-widget-test/index.html
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new --disable-gpu --hide-scrollbars --window-size=900,400 --virtual-time-budget=4000 --screenshot=/tmp/ig-widget-test/result.png file:///tmp/ig-widget-test/index.html
```
