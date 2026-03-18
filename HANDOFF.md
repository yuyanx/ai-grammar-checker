# Handoff Notes

## Branch
`work`

## Build
```bash
npm install
npm run build
```
Load `dist/` as unpacked extension in Chrome.

## Current State
- Latest commit: `494e8ca` — Handle zero-length insertions, per-editor request scoping & caching; build and version updates
- Current package/manifest version: `1.5.4`
- In this container, local dependencies are not installed, so `npm run build` fails fast because `./node_modules/.bin/esbuild` is missing
- In this container, `npx tsc --noEmit` also fails because the `chrome` type definitions are not installed locally

## Recent Changes (newest first)
1. **Zero-length insertion support** — parser, renderer, and fix-application paths now handle insertion-style suggestions such as missing punctuation
2. **Per-editor request scoping** — grammar requests are scoped by tab/frame/editor source ID to avoid unrelated aborts and cross-editor races
3. **Observer cleanup** — tracked editor observers/timers are cleaned up when editors are removed or during SPA navigation cleanup
4. **Cache improvements** — response caching now accounts for provider/settings/prompt version and refreshes entries on read for LRU-like behavior
5. **Safer build script** — `build.sh` now expects the pinned local `node_modules/.bin/esbuild` binary instead of using `npx` to fetch tooling
6. **Settings test restore** — the options page restores prior settings after running “Test Connection”

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
- This container currently lacks installed dependencies, so build/typecheck cannot complete without `npm install`
- No automated unit/integration tests exist yet
- Error detection quality still depends heavily on prompt tuning (`src/shared/prompts.ts`)
- Large text inputs may still be slow because the full normalized text is sent to the API each time

## Commands Run In This Session
```bash
git log --oneline --decorate -n 8
git status --short --branch
npm run build
npx tsc --noEmit
```
