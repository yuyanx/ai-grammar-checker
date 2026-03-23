# Project Instructions

## Versioning Rules

Version numbers must be updated in **both** `manifest.json` and `package.json` with every change:

- **Bug fixes / small changes**: bump patch version (`x.y.Z` → `x.y.Z+1`)
- **Feature additions / UI changes**: bump minor version (`x.Y.z` → `x.Y+1.0`)

## After Every Push

After pushing changes, always remind the user to sync and rebuild locally:

```
cd /Users/ryanxu/Documents/ai-grammar-checker
git pull origin claude/review-grammarly-comparison-eV4RR
npm run build
```

Then refresh the extension in `chrome://extensions`.

## Claude Code Handoff

### Project Overview

This repo is a Chrome browser extension for English grammar correction in live editors across the web.

Core characteristics:

- Content script architecture with overlays, underlines, popovers, status badges, and an error panel
- Heavy use of `contenteditable` editors, which creates offset-mapping, focus-lifecycle, and DOM-mutation challenges
- Long text detection now uses chunking/merging in the background service worker
- `Fix All` depends on a corrected-text pipeline plus editor-specific application behavior
- UX depends on stable badge states (`ready`, `checking`, `errors`, `clean`, transient warning) and non-stale underline rendering

Important areas:

- `src/content/text-monitor.ts`: editor discovery, debounce, state orchestration, widget lifecycle
- `src/content/status-widget.ts`: badge rendering, compact/full presentation, placement logic
- `src/content/editor-classifier.ts`: editor-intent classification and activation gating
- `src/content/error-panel.ts`: panel UI and `Fix All`
- `src/content/underline-renderer.ts`: underline overlays and hit targets
- `src/background/service-worker.ts`: API calls, chunking, merge logic, retries, caching
- `src/shared/api-parsers.ts`: parser normalization and corrected-text-derived fallback
- `src/shared/prompts.ts`: model instructions and detection behavior
- `src/shared/punctuation-rules.ts`: deterministic local punctuation detection
- `src/shared/grammar-rules.ts`: deterministic local grammar detection (modal parallel structure, `isVerbProtectedByModal`, `filterModalProtectedErrors`)
- `src/shared/language-detect.ts`: English-only language gating

### Current State (v1.12.53)

Implemented:

- Deterministic local punctuation rules for obvious malformed patterns (v1.9.0)
- English-only language gating in content script and service worker (v1.9.0)
- Stable long-draft checking lifecycle with stale-response suppression (v1.10.0)
- Parallel chunk checks with concurrency cap of 2 (v1.11.0)
- Per-chunk caching with punctuation-rule cache versioning (v1.11.0)
- Editor-intent classifier limiting activation to compose surfaces only (v1.12.0)
- Scroll-locked badge positioning without animation lag (v1.12.1)
- Stable compact/full badge placement for chat and email composers (v1.12.19–v1.12.31)
- Error panel with `Fix`, `Dismiss`, and `Fix All`
- Badge states: ready, checking, errors, clean, transient warning
- Corrected-text fallback and merge logic
- Coordinated phrase protection, quote boundary validation, reverse fix suppression
- Deterministic modal parallel structure detection: catches conjugated verbs after modals (v1.12.41) and filters oscillating AI suggestions via `filterModalProtectedErrors` (v1.12.43)
- `isVerbProtectedByModal` now protects coordinated verbs even when the modal-adjacent verb is conjugated (v1.12.45)
- Fix All for contenteditable uses stepwise inline fallback per fix with verification (v1.12.49)
- Reverted prompt to v1.12.36 baseline: removed tense consistency examples, number agreement rule, and dominant-tense instruction that degraded detection on chunked long text (v1.12.51)
- Reverted chunk size increase from v1.12.50 — small chunks (3 sentences/260 chars) produce better error detection (v1.12.51)
- Chunked corrected text is now rebuilt from the validated error list instead of concatenating chunk outputs, eliminating boundary artifacts like duplicated words (v1.12.52)
- Chunks now include surrounding sentence context in the prompt, helping the AI understand boundary text and catch cross-sentence agreement errors like "was"→"were" (v1.12.53)

Known issues still open:

- `Fix All` remains unstable on long Gmail drafts (deferred)
- Underline rendering can still become stale in rapid DOM-change scenarios
- No personal dictionary / custom word list
- No language variant selection (US/UK/CA/AU)
- Keyboard shortcuts are mouse-only (only Escape works)

### Design Intention

Follow this order:

1. **Correctness First**
2. **Stable UX**
3. **Performance**

Do not optimize speed first if the correction pipeline is still non-convergent or visually unstable.

### Completed Roadmap

#### Phase 1: Correctness (completed v1.9.0)

1. ~~Add deterministic punctuation rules~~ — `src/shared/punctuation-rules.ts`
2. ~~Add English-only gating~~ — `src/shared/language-detect.ts`

#### Phase 2: Stable UX (completed v1.10.0–v1.12.31)

3. ~~Keep one stable long-draft checking state~~ — v1.10.0
4. ~~Stabilize ready-badge lifecycle~~ — v1.10.0, refined through v1.12.31
5. ~~Refine badge size allocation and placement for chat composers~~ — v1.12.19–v1.12.31
6. ~~Fix stale underline rendering / collision cleanup~~ — v1.10.0 (generation gating + collision filtering)

#### Phase 3: Performance (completed v1.11.0)

7. ~~Parallelize chunk checks with capped concurrency~~ — concurrency cap of 2
8. ~~Add per-chunk caching~~ — 5-minute TTL with punctuation-rule versioning

#### Phase 4: Activation (completed v1.12.0)

9. ~~Editor-intent classifier~~ — `src/content/editor-classifier.ts`, limits activation to compose surfaces only

### Deferred Backlog

- Long-draft `Fix All` convergence and authoritative merged corrected-text application
- Contenteditable whole-editor `Fix All` replacement experiments
- Post-`Fix All` validation/recheck lifecycle work

### Specific Product Expectations To Preserve

- English input should be corrected; non-English input should not be translated or grammar-checked
- Yellow transient warning badge should only indicate a failed check path with retry behavior, not normal checking work
- Red issue badges may persist on editors with unresolved issues
- Ready/checking/clean/transient-warning states should behave like active-editor states, not page-global clutter
- Compact vs full badge behavior should be deliberate and predictable, especially in chat editors and cramped composers

