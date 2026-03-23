# Handoff Notes

## Branch
`claude/review-grammarly-comparison-eV4RR`

## Build
```bash
npm run build
```
Load `dist/` as unpacked extension in Chrome.

## Current State
- Current package/manifest version: `1.12.49`
- Error panel feature complete: clicking the red badge opens a panel listing all errors with Fix/Dismiss per error and Fix All
- Automatic single retry on transient API failures with visible orange "!" widget feedback
- Editor-intent classifier gates activation to compose surfaces only; search bars, pickers, and utility inputs are suppressed
- Deterministic local punctuation rules catch obvious malformed patterns without an API call
- Deterministic modal parallel structure detection catches conjugated verbs after modals and coordinated base-form violations
- English-only gating suppresses non-English text before provider requests
- Parallel chunk checks (concurrency=2) with per-chunk caching (5-minute TTL)
- Stable compact/full badge placement across Gmail, LinkedIn, Grok, X, Instagram, GitHub, ChatGPT composers
- Scroll-locked badge positioning without animation lag
- Prompt includes few-shot examples for tense consistency (past and present narratives) and quantifier-noun agreement
- Fix All for contenteditable now uses stepwise fallback per fix (execCommand → MAIN world → DOM) with inline verification

## Key Milestones
1. **v1.9.0** — Deterministic punctuation rules (`punctuation-rules.ts`), English-only gating (`language-detect.ts`)
2. **v1.10.0** — Stable long-draft checking lifecycle, badge lifecycle cleanup, underline collision filtering, stale-render gating
3. **v1.11.0** — Parallel chunk checks with concurrency cap of 2, per-chunk caching with punctuation-rule versioning
4. **v1.12.0** — Editor-intent classifier (`editor-classifier.ts`): limits activation to compose surfaces, suppresses search/utility/picker fields
5. **v1.12.1** — Scroll-locked badge positioning (removed position animation from widget transitions)
6. **v1.12.2–v1.12.31** — Contenteditable Fix All refinements, LinkedIn/Grok/Instagram/GitHub badge placement stability, compact control-row anchoring for chat and email composers
7. **v1.12.41–v1.12.43** — Deterministic modal parallel structure detection in `grammar-rules.ts`; `filterModalProtectedErrors` prevents AI from oscillating base-form verbs after modals
8. **v1.12.45–v1.12.48** — Grammar prompt improvements: tense consistency examples (past + present), quantifier-noun agreement rule, corrected modal protection for conjugated-verb context
9. **v1.12.49** — Fix All contenteditable refactored: inline stepwise fallback per fix, always uses surfaced errors not canonical diff

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
| `editor-classifier.ts` | Classifies editors as compose/utility/sensitive before activation |
| `underline-renderer.ts` | Draws error underlines and insertion anchors using shadow DOM overlays |
| `popover.ts` | Tooltip that appears on hover/click showing error + fix button |
| `error-panel.ts` | Side panel listing all errors |
| `status-widget.ts` | Badge showing error count, positioned near each input |
| `shadow-host.ts` | Creates/manages shadow DOM containers for isolation |
| `content-css.ts` | Injects CSS into shadow roots |
| `dark-mode.ts` | Detects dark mode for styling |
| `page-script.ts` | Runs in MAIN world for execCommand access (applying fixes) |
| `contenteditable-snapshot.ts` | Visible-text snapshot/offset mapping for contenteditable |

### Key Shared Files
| File | Role |
|---|---|
| `punctuation-rules.ts` | Deterministic local punctuation detection |
| `language-detect.ts` | English-only language gating |
| `api-parsers.ts` | Response parsing, validation, corrected-text fallback |
| `prompts.ts` | Grammar check prompt with few-shot example |
| `types.ts` | TypeScript interfaces |
| `storage.ts` | chrome.storage.sync wrapper |
| `constants.ts` | API URLs and defaults |

### How It Works
1. `text-monitor.ts` discovers editable fields, `editor-classifier.ts` gates activation to compose surfaces only
2. On text change, it debounces requests and sends a `CHECK_GRAMMAR` message with a per-editor `sourceId`
3. The background service worker checks the cache, scopes in-flight aborts, and calls the configured AI provider
4. Parser/validator logic normalizes suggestions, including insertion-style fixes
5. Underlines/widgets/popovers render in a shadow DOM overlay positioned over the host editor
6. Accepting a fix updates the editor directly and triggers a re-check

### State Management
- `elementStates` WeakMap in `text-monitor.ts` tracks per-element errors, timers, source IDs, and observers
- `trackedElements` Set tracks monitored editors for cleanup/rescan behavior
- Background worker maintains a scoped in-flight abort map and an in-memory response cache

## Known Issues
- No automated unit/integration tests exist yet
- Fix All remains unstable on long Gmail drafts (deferred)
- Underline rendering can still become stale in rapid DOM-change scenarios
- No personal dictionary / custom word list
- No language variant selection (US/UK/CA/AU)
- Keyboard shortcuts are mouse-only (only Escape works)

## Deferred Backlog
- Long-draft `Fix All` convergence
- Contenteditable whole-editor `Fix All` replacement experiments
- Post-`Fix All` validation and oscillation suppression work

## Commands
```bash
npm run build          # Build extension to dist/
npx tsc --noEmit       # Type-check only
```
