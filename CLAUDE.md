# Project Instructions

## Versioning Rules

Version numbers must be updated in **both** `manifest.json` and `package.json` with every change:

- **Bug fixes / small changes**: bump patch version (`x.y.Z` → `x.y.Z+1`)
- **Feature additions / UI changes**: bump minor version (`x.Y.z` → `x.Y+1.0`)

## After Every Push

After pushing changes, always remind the user to sync and rebuild locally:

```
cd /Users/ryanxu/Documents/ai-grammar-checker
git pull origin claude/angry-wu-k70YE
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
- `src/content/error-panel.ts`: panel UI and `Fix All`
- `src/content/underline-renderer.ts`: underline overlays and hit targets
- `src/background/service-worker.ts`: API calls, chunking, merge logic, retries, caching
- `src/shared/api-parsers.ts`: parser normalization and corrected-text-derived fallback
- `src/shared/prompts.ts`: model instructions and detection behavior

### Current Progress From Codex

Implemented / present:

- Long-text chunking in the service worker
- Debounced checking in the content script
- Current chunk processing is still effectively serial
- Corrected-text fallback / merge logic exists
- Error panel with `Fix`, `Dismiss`, and `Fix All`
- Badge states for ready/checking/errors/clean/transient warning
- Geometry-based compact/full badge logic

Known issues still open:

- Punctuation can still be too model-dependent in some obvious cases
- Blue ready badge can be missing, stale, duplicated, or flicker/re-animate during scroll/layout changes
- No enforced English-only gating; non-English text can still be sent to the provider
- Chat-composer badge sizing/placement can still overlap text
- Underline rendering can become stale, messy, or collide visually with badge/tooltip UI
- `Fix All` remains unstable on long Gmail drafts and is now deferred from the active roadmap until the other correctness/UX issues are resolved

### Design Intention

Follow this order:

1. **Correctness First**
2. **Stable UX**
3. **Performance**

Do not optimize speed first if the correction pipeline is still non-convergent or visually unstable.

### Known Issue Review / Priority Context

#### Phase 1: Correctness

Highest priority:

1. Add deterministic punctuation rules
2. Add English-only gating / suppress non-English checks

Key intent:

- Punctuation should not rely entirely on the model for obvious malformed cases
- The extension is intended for English correction, so non-English input should be suppressed before request dispatch

#### Phase 2: Stable UX

Next priority:

3. Keep one stable long-draft checking state
4. Stabilize ready-badge lifecycle
5. Refine badge size allocation and placement for chat composers
6. Fix stale underline rendering / collision cleanup

Key intent:

- Long-draft checking should remain in one stable checking state until final results arrive
- Blue ready/checking/clean warning states should be attached only to the active editor lifecycle and should not linger or flicker
- Badge size should not be determined only by a crude height rule when safe-space-based allocation is needed
- Chat composers like Grok should not allow the badge to overlap the active text line
- Underlines and badge/tooltips should not visibly collide or render from stale layout state

#### Phase 3: Performance

Then optimize:

7. Parallelize chunk checks with a small concurrency cap instead of fully serial chunk checking
8. Add per-chunk caching

Key intent:

- Keep one stable “checking long draft” state during chunk work
- Improve long-draft speed only after correctness and UX stability are reliable

### Current Recommended Priority Sequence

1. Add deterministic local punctuation heuristics for obvious cases
2. Enforce English-only gating / suppress non-English checks and provider calls
3. Keep one stable long-draft checking state during chunked checks
4. Stabilize ready-badge focus lifecycle across Gmail/Grok-style editors
5. Refine badge size allocation and placement for chat composers based on safe space, not only editor height
6. Add stale-render cancellation and collision cleanup for underlines / badge tooltips
7. Parallelize chunk checks with capped concurrency
8. Add per-chunk caching

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

### Next Goal For Claude Code

Claude should act as the lead architect for the next work order.

Please:

- Analyze the codebase together with this file
- Reconstruct the current pipeline and known failure modes
- Produce an optimized roadmap with:
  - phased work breakdown
  - concrete sub-tasks per phase
  - acceptance criteria for each sub-task
  - risks and mitigations
  - implementation priorities and dependencies
- Prefer a roadmap that minimizes regressions while improving punctuation/language correctness first, then UX stability, then performance
- Exclude `Fix All` from the active implementation roadmap for now; treat it as deferred backlog unless explicitly re-opened

Do **not** start from a generic plan. Use the current implementation shape in this repo as the basis for the roadmap.
