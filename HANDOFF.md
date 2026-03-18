# Handoff Notes

## Branch
`claude/angry-wu-k70YE`

## Build
```bash
npm run build
```
Load `dist/` as unpacked extension in Chrome.

## Current State
- Current package/manifest version: `1.6.6`
- `npm run build` passes locally
- Error panel feature complete: clicking the red badge opens a panel listing all errors with Fix/Dismiss per error and Fix All
- Automatic single retry on transient API failures with visible orange "!" widget feedback
- Instagram compact badge placement is explicitly anchored to visible action labels like `Post`, with a hard left-side safety gap
- Compact error dots are `12px` for crowded editors
- `AGENTS.md` is still untracked locally and should stay out of the commit unless explicitly requested

## Recent Changes (newest first)
1. **Error panel feature** (v1.6.6) — `error-panel.ts` new file: click the red badge to see all errors listed with Fix/Dismiss per error, Fix All button, success state, dark mode, auto-close on typing/scroll/Escape
2. **Automatic retry** (v1.6.6) — `text-monitor.ts` retries once after 2s on transient API failures; `status-widget.ts` shows orange "!" widget during retry; rate-limited errors skip retry
3. **Instagram compact badge fix** (v1.6.5) — `status-widget.ts` explicitly detects visible action labels (`Post`, `Comment`, `Reply`, `Send`) and anchors the compact dot with a hard safety gap
4. **Compact badge sizing/placement cleanup** — compact error dots are `12px`, placement uses rendered text bounds instead of the full contenteditable box
5. **Contenteditable offset integrity** — shared visible-text snapshot/mapping utility (`contenteditable-snapshot.ts`) for consistent offsets across underlines, popovers, and fixes
6. **Retry-state fix** — unchanged text is retryable after transient API failures via `pendingText` tracking

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

## Commands
```bash
npm run build          # Build extension to dist/
npx tsc                # Type-check only
```
