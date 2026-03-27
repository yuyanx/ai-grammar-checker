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

### Current State (v1.13.8)

Implemented:

- Deterministic local punctuation rules for obvious malformed patterns (v1.9.0)
- English-only language gating in content script and service worker (v1.9.0)
- Stable long-draft checking lifecycle with stale-response suppression (v1.10.0)
- Parallel chunk checks with concurrency cap of 4 (v1.11.0, raised in v1.13.0)
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
- Fix All for contenteditable uses stepwise inline fallback per fix with verification (v1.12.49) and now executes in a fast synchronous loop applying the full canonical `correctedText` diff to avoid SPA interruptions and whack-a-mole checking loops (v1.13.7)
- Reverted prompt to v1.12.36 baseline: removed tense consistency examples, number agreement rule, and dominant-tense instruction that degraded detection on chunked long text (v1.12.51)
- Reverted chunk size increase from v1.12.50 — small chunks (3 sentences/260 chars) produce better error detection (v1.12.51)
- Chunked corrected text is now rebuilt from the validated error list instead of concatenating chunk outputs, eliminating boundary artifacts like duplicated words (v1.12.52)
- Chunks now include surrounding sentence context in the prompt, helping the AI understand boundary text and catch cross-sentence agreement errors like "was"→"were" (v1.12.53)
- Deterministic compound subject agreement rule: "X and Y, which was" → "were" catches cases the AI misses (v1.12.54)
- Added targeted tense consistency instruction to prompt: when correcting verb forms, keep all corrections in the same tense (v1.12.55)
- Default debounce reduced from 800ms to 500ms, chunk concurrency raised from 2 to 4 for faster checking (v1.13.0)
- ResizeObserver on tracked editors repositions underlines when editor geometry changes (v1.13.0)
- Enhanced underline CSS transitions with easing for smoother appearance (v1.13.0)
- Post-processing tense normalization: when AI corrections mix present/past verb forms, `normalizeTenseInCorrections` flips minority-direction suggestions to match the majority using a verb form lookup table (v1.13.1)
- `filterBadAgreementCorrections` rejects AI suggestions that break correct subject-verb agreement (e.g. "were"→"was" after "They") (v1.13.2)
- Text-level tense signals: "3rd person subject + base form verb" patterns in the original text provide present-tense evidence for normalization even when chunks have few corrections (v1.13.2)
- Deterministic past progressive → present progressive: "was/were [verb]ing" → "is/are [verb]ing" when text signals present tense (v1.13.3)
- Cache protection: worse results (fewer errors) don't overwrite richer cached results from concurrent checks (v1.13.3)
- "was"→"were" corrections upgraded to present progressive form during tense normalization to present (v1.13.3)
- Fuzzy text comparison (`textsEquivalent`) prevents spurious re-checks when contenteditable editors restructure DOM without changing visible text, preserving richer error results from earlier checks (v1.13.4)
- `visibilitychange` recovery now only fires for stale checks (>20s), preventing tab-switch from killing in-flight checks; all recovery/focus paths use `textsEquivalent` (v1.13.5)
- `Fix All` on contenteditable rewritten to execute in an instantaneous synchronous batch, preventing SPA lifecycle interruptions and shifted text offsets (v1.13.6)
- `Fix All` now computes a canonical token diff against the full `correctedText` (instead of only surfaced errors) to ensure text is truly perfected in one go with no follow-up passes (v1.13.7)
- `Fix All` handles long-draft convergence loops internally via API polling (max 3 rounds) to natively squash all secondary/stylistic errors in one user click (v1.13.8)

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

7. ~~Parallelize chunk checks with capped concurrency~~ — concurrency cap of 2, raised to 4 in v1.13.0
8. ~~Add per-chunk caching~~ — 5-minute TTL with punctuation-rule versioning

#### Phase 4: Activation (completed v1.12.0)

9. ~~Editor-intent classifier~~ — `src/content/editor-classifier.ts`, limits activation to compose surfaces only

#### Phase 5: Speed & Smoothness (completed v1.13.0)

10. ~~Reduce default debounce~~ — 800ms → 500ms
11. ~~Increase chunk concurrency~~ — 2 → 4
12. ~~Add ResizeObserver for stale underline repositioning~~
13. ~~Enhance underline CSS transitions~~

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

