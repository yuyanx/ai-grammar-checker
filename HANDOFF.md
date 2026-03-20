# Handoff Notes

## Branch
`claude/angry-wu-k70YE`

## Build
```bash
npm run build
```
Load `dist/` as unpacked extension in Chrome.

## Current State
- Current package/manifest version: `1.8.10`
- `npm run build` passes locally
- Error panel feature complete: clicking the red badge opens a panel listing all errors with Fix/Dismiss per error and Fix All
- Automatic single retry on transient API failures with visible orange "!" widget feedback
- Instagram compact badge placement is explicitly anchored to visible action labels like `Post`, with a hard left-side safety gap
- Compact error dots are `12px` for crowded editors
- X home search box compact tooltip clipping is a known issue for now; outside badge placement is kept, but the hover issue-count tag can still clip in that edge case
- `AGENTS.md` is still untracked locally and should stay out of the commit unless explicitly requested

## Recent Changes (newest first)
1. **Known issue recorded** (v1.6.14) — X home search box can still clip the compact badge's hover issue-count tooltip near the viewport edge; defer further work on this edge case for now
2. **Error panel feature** (v1.6.6) — `error-panel.ts` new file: click the red badge to see all errors listed with Fix/Dismiss per error, Fix All button, success state, dark mode, auto-close on typing/scroll/Escape
3. **Automatic retry** (v1.6.6) — `text-monitor.ts` retries once after 2s on transient API failures; `status-widget.ts` shows orange "!" widget during retry; rate-limited errors skip retry
4. **Instagram compact badge fix** (v1.6.5) — `status-widget.ts` explicitly detects visible action labels (`Post`, `Comment`, `Reply`, `Send`) and anchors the compact dot with a hard safety gap
5. **Compact badge sizing/placement cleanup** — compact error dots are `12px`, placement uses rendered text bounds instead of the full contenteditable box
6. **Contenteditable offset integrity** — shared visible-text snapshot/mapping utility (`contenteditable-snapshot.ts`) for consistent offsets across underlines, popovers, and fixes

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
- X home search box still clips the compact badge's hover tooltip in some layouts even after outside-badge fallback; treat as deferred edge case unless it becomes higher priority
- Gmail long-draft `Fix All` still needs convergence work in some cases; repeated Fix All clicks can cascade remaining issues and punctuation can oscillate (`though -> though,` then `though,. -> though.`). This work is now deferred from the active roadmap until the other correctness/UX issues are handled.
- Gmail/Grok ready-state widget lifecycle still needs stabilization; blue ready badges can occasionally fail to appear, linger on stale editors, or flicker/re-render during scroll/layout changes
- Ready/error widget size logic is currently geometry-based in `status-widget.ts`: editors with `getBoundingClientRect().height < 44` use the compact dot path, otherwise the full circular badge path
- Underline rendering can still become visually messy or stale in some layouts and needs a render-cancellation / stale-overlay cleanup pass
- Add deterministic local punctuation heuristics for obvious cases the model can miss (for example duplicated terminal punctuation or comma-period conflicts) instead of relying entirely on provider output
- No English-only gating exists yet, so non-English text can still be sent to the provider and chat composers like Grok can feel translation-biased instead of English-correction-only
- Long-draft checking should stay in one stable `checking` state, but chunked work currently still needs a dedicated UX-stability pass

## Active Roadmap (Fix All Deferred)

### Phase 1: Detection Reliability
1. Add deterministic local punctuation rules for obvious malformed punctuation patterns
2. Add English-only gating in both content script and service worker so non-English text is suppressed before provider calls

### Phase 2: Stable UX
3. Keep one stable long-draft `checking` state during chunked checks
4. Stabilize ready-badge lifecycle so transient badges only belong to the active editor
5. Stop badge flicker/re-animation on scroll and resize
6. Refine compact/full badge sizing and placement for chat composers so the badge never overlaps active text
7. Fix stale underline rendering and badge/tooltip collision cleanup

### Phase 3: Performance
8. Parallelize chunk checks with a small concurrency cap
9. Add per-chunk caching

## Deferred Backlog
- Long-draft `Fix All` convergence
- Contenteditable whole-editor `Fix All` replacement experiments
- Post-`Fix All` validation and oscillation suppression work

## Commands
```bash
npm run build          # Build extension to dist/
npx tsc                # Type-check only
```
