# AI Grammar Checker — Architecture Analysis & Implementation Roadmap

## Files Inspected

- **Handoff files**: `CLAUDE.md`, `HANDOFF.md`
- **Source files** (full reads):
  - `src/content/text-monitor.ts` (722 lines) — editor discovery, debounce, state orchestration, recheck, reverse-fix protection
  - `src/content/status-widget.ts` (621 lines) — badge rendering, compact/full, obstacle scanning
  - `src/content/error-panel.ts` (436 lines) — panel UI, Fix All pipeline, sequential application
  - `src/content/underline-renderer.ts` (361 lines) — overlay rendering, stubbed recalculate
  - `src/content/contenteditable-snapshot.ts` (223 lines) — TreeWalk offset mapping
  - `src/content/popover.ts` (388 lines) — fix application, execCommand
  - `src/background/service-worker.ts` (505 lines) — API calls, chunking, merging, caching
  - `src/shared/api-parsers.ts` (581 lines) — parsing, validation, deriveErrorsFromCorrectedText
  - `src/shared/prompts.ts` (105 lines) — grammar check/recheck prompts
  - `src/shared/constants.ts` (7 lines), `src/shared/types.ts` (59 lines)
  - `manifest.json`, `package.json` — both at v1.8.9

---

## Current Architecture Understanding

### Data Flow

```
User types in editor
  → text-monitor.ts discovers element (focusin + MutationObserver)
  → attachListeners: input, keyup, mutation events
  → debounce (500ms default) → checkElement()
  → chrome.runtime.sendMessage({ type: "CHECK_GRAMMAR", text, sourceId })
  → service-worker.ts handleCheckGrammar()
      ├─ cache hit? → return cached
      ├─ abort prior in-flight for same tab:frame:sourceId
      ├─ shouldChunkText()? → checkTextInChunks() [serial loop]
      │   ├─ splitTextIntoChunks() (sentence-based, max 3 sentences / 260 chars)
      │   ├─ for each chunk: checkSingleText() → API call → validateErrors()
      │   ├─ offset-adjust errors by chunk.start
      │   ├─ concatenate correctedText from each chunk
      │   ├─ normalizeCorrectedText() (preserve trailing whitespace)
      │   └─ deriveErrorsFromCorrectedText(fullText, mergedCorrected) ← current re-derivation
      └─ else: checkSingleText()
          ├─ buildGrammarCheckPrompt() → callConfiguredProvider()
          ├─ parseOpenAIResponse() or parseGeminiResponse()
          ├─ validateErrors(parsed.errors, text)
          ├─ if 0 errors + correctedText differs → deriveErrorsFromCorrectedText()
          └─ if still 0 errors + text is long → high-recall fallback (2nd API call)
  → CheckResponse { errors, correctedText? } back to content script
  → text-monitor.ts stores state.errors, state.correctedText
  → renderErrors() → underline-renderer.ts (shadow DOM overlays, position:fixed)
  → updateWidget() → status-widget.ts (badge: ready/checking/errors/clean/error)
```

### Fix All Flow

```
User clicks Fix All → error-panel.ts applyAllFixes()
  ├─ textarea/input + correctedText available → one-shot value replacement
  ├─ textarea/input + no correctedText → build from errors (reverse offset order)
  └─ contenteditable → ALWAYS sequential: applyFixesSequentially()
      └─ for each error: applyFix() + waitForContentEditableFixSettle(180ms poll)
  → onAccept callback: clear errors, set lastText="", setTimeout(checkElement, 300ms, autoShowPanel=true)
```

### Badge Lifecycle (current, before fixes)

```
focusin → updateWidget("ready") + clearTransientWidgetsExcept(activeElement)
checking → updateWidget("checking")
errors → updateWidget("errors", count) with click handler
clean → updateWidget("clean") — auto-hides after 3s
error → updateWidget("error") — auto-hides after 4s

renderWidget(): always clears container.innerHTML and rebuilds
compact threshold: element rect.height < 44px
```

---

## Root Cause Hypotheses

### 1. Fix All Cascade / Non-Convergence

1. **Contenteditable never uses correctedText** (error-panel.ts line 287): Always takes sequential `applyFixesSequentially()`, even when the service worker returned authoritative `correctedText`. Individual fixes applied with 180ms settle delays; offset drift between fixes.
2. **Individual panel fixes destroy correctedText** (error-panel.ts line 98): Per-error Fix button sets `correctedText = undefined`, so subsequent Fix All loses the one-shot path.
3. **Post-Fix-All recheck with autoShowPanel=true** (text-monitor.ts line 649): Recheck fires 300ms after Fix All. If new errors found, panel auto-reopens → visible cascade.
4. **Reverse-fix protection is narrow** (text-monitor.ts lines 37-48): Only suppresses exact `original↔suggestion` reversal within 10s TTL. Model can suggest a *different* correction for the same span.
5. **Chunked re-derivation can differ** (service-worker.ts line 246): Full-text `deriveErrorsFromCorrectedText()` after chunk merge can produce different errors than per-chunk validated ones, especially at boundaries.

### 2. Punctuation Oscillation

Model adds punctuation on one pass (e.g., `though → though,`), then subsequent pass treats the comma as wrong (`though, → though.` or back to `though`). `filterUnstableDerivedPunctuation()` (api-parsers.ts line 558) only filters *derived* toggles, not explicit model returns. No deterministic local rules for obvious patterns (doubled periods, comma-period conflicts, space-before-punctuation).

### 3. Blue Ready Badge Instability

1. **No focusout cleanup**: `clearTransientWidgetsExcept()` only called on `focusin` (line 194). No `focusout` listener.
2. **Full DOM rebuild on scroll/resize**: `refreshWidget()` → `renderWidget()` does `container.innerHTML = ""` every time.
3. **Memoization bypassed by refreshWidget**: `updateWidget()` memoizes, but `refreshWidget()` calls `renderWidget()` directly.

### 4. Stale Underlines

`recalculatePositions()` is stubbed (empty, lines 69-71). No generation tracking. Underlines from prior checks persist until new check response. No collision avoidance between underlines and badge/tooltip overlays.

### 5. Chat Composer Badge Overlap

Compact threshold is `rect.height < 44` (line 71). Chat composers taller than 44px but with limited space get 28px full badge overlapping text. No measurement of available space.

---

## Product-State Rules for Badge Behavior

These rules define the intended badge behavior. All Phase 2 implementation must conform to these rules.

### Badge State Ownership

| State | Scope | Persistence |
|-------|-------|-------------|
| `ready` (blue dot) | Active editor only | Disappears on blur or when checking starts |
| `checking` (spinner) | Active editor only | Disappears when check completes |
| `clean` (green check) | Active editor only | Auto-hides after 3s |
| `error` (yellow "!") | Active editor only | Auto-hides after 4s; indicates transient failure with retry |
| `errors` (red dot/count) | Per-editor, may persist on multiple editors simultaneously | Persists until errors are resolved or dismissed |

### Transient vs Persistent Rules

1. **Transient states** (`ready`, `checking`, `clean`, `error/warning`) belong **only to the currently focused editor**. When focus leaves an editor, its transient badge must be removed.
2. **Persistent states** (`errors` with count) may exist on **multiple editors at once**. They persist until the user resolves or dismisses the errors, or the editor is removed from the DOM.
3. **At most one transient badge** should be visible at any time (on the active editor).
4. **Scroll/resize must never re-animate** a transient badge if the widget state has not changed. Position updates must happen without DOM reconstruction.
5. **Yellow warning badge** indicates a failed check with retry behavior only. It must never appear during normal checking work.

### Compact vs Full Badge Rules

1. **Choose compact vs full based on safe available space**, not a fixed height threshold alone. The decision should consider whether a full-size badge (28px) can be placed without overlapping the active text line.
2. **Badge must never overlap the active text line**. If the editor has insufficient internal safe space, use compact mode.
3. **If no safe in-editor slot exists** (neither full nor compact fits without overlapping text), place the badge outside the editor boundary.
4. Numeric thresholds (e.g., `< 44px` always compact, `≥ 100px` always full) serve as fast-path defaults, not architectural constraints. The safe-space measurement is the authoritative decision.

---

## Phase 1 — Correctness

**Goal**: Correction pipeline produces reliable, convergent results. Fix All settles in one pass. Obvious punctuation caught locally. Non-English text suppressed at both content-script and service-worker layers.

### Task 1.1: Fix All One-Shot Convergence for Contenteditable

**Priority**: 1

**Current**: Contenteditable Fix All always uses `applyFixesSequentially()` (error-panel.ts line 287). Never uses `correctedText`.

**Change**: In `applyAllFixes()`, add a contenteditable + correctedText path before the sequential fallback:
1. Select full editor content via `window.getSelection()` + Range spanning root
2. `execCommand("insertText", false, correctedText)` for single-operation replacement
3. Verify via `getContentEditableText(element)` vs `correctedText`
4. On mismatch, fall back to existing sequential path
5. Dispatch `input` event after replacement to trigger editor state sync

**Files**: `src/content/error-panel.ts` (lines 280-290)

**Acceptance criteria**:
- Fix All on Gmail compose with 4+ errors applies all in one DOM operation
- Post-replacement text matches `correctedText`
- Editors that reject whole-text replacement (X/Twitter) fall back to sequential without user-visible error

| Risk | Mitigation |
|------|------------|
| Rich editors with custom state reject replacement | Detect failure via text comparison; fall back to sequential |
| Undo history breaks | Acceptable: Fix All is a destructive batch action |

### Task 1.2: Suppress Post-Fix-All Oscillation (Targeted)

**Priority**: 2

**Current**: Post-Fix-All recheck with `autoShowPanel=true` (line 649) reopens panel on any new errors. Reverse-fix protection only catches exact reversals.

**Change**:
1. Add `fixAllAppliedText?: string` and `fixAllPriorErrors?: GrammarError[]` to `ElementState`
2. On Fix All completion, store `correctedText` and the list of errors that were just fixed
3. In `checkElement()` response handler: if `state.fixAllAppliedText === currentText`, classify each returned error:
   - **Known oscillation**: error whose `original` matches a prior fix's `suggestion` AND whose `suggestion` matches the prior fix's `original` (exact reversal) → suppress
   - **Oscillation descendant**: error at the same offset as a prior fix, where the `original` matches the prior fix's `suggestion` but the `suggestion` is a different alternative → suppress
   - **Genuine new error**: does not match any prior fix offset/original → allow through
4. Change post-Fix-All recheck to `autoShowPanel = false` — never auto-reopen the panel after Fix All
5. Clear `fixAllAppliedText` and `fixAllPriorErrors` after one recheck (consumed after first use)

**Files**: `src/shared/types.ts`, `src/content/text-monitor.ts` (lines 549-600, 641-651), `src/content/error-panel.ts`

**Acceptance criteria**:
- After Fix All: if recheck finds only oscillation patterns (e.g., `though, → though` reverting Fix All's `though → though,`), they are suppressed → shows "clean"
- After Fix All: if recheck finds a genuine spelling error at a different offset, it appears as an underline (but panel does NOT auto-open)
- After Fix All: if recheck finds a genuine punctuation error NOT related to any prior fix, it is shown
- No cascading Fix All loops

| Risk | Mitigation |
|------|------------|
| Oscillation detection misses a pattern | Conservative: only suppress at matching offsets with matching original text |
| Genuine error at same offset as prior fix suppressed | Only if original matches the fix's suggestion; offset + text match required |

### Task 1.3: Improve Chunk-Boundary Error Merging

**Priority**: 3

**Current**: `checkTextInChunks()` collects per-chunk validated errors with offset adjustment, then re-derives all errors from merged correctedText via `deriveErrorsFromCorrectedText()` (line 246). The re-derived errors become the authoritative return value.

**Change**:
1. Make per-chunk validated errors the **primary visible error list** returned to content script
2. Keep full-text `deriveErrorsFromCorrectedText()` as a **non-authoritative validation pass**: run it, log any errors it finds that weren't in the per-chunk list (for diagnostics), but do NOT use its output as the returned error list
3. If the validation pass finds errors that are NOT present in the per-chunk list, log them with `[AI Grammar Checker] chunk-merge validation: found N additional derived errors` for future investigation — but do not surface them to the user
4. Return merged `correctedText` for Fix All as before (concatenation of per-chunk correctedText, normalized)
5. Add deduplication: if two per-chunk errors overlap in offset range, keep the first

**Files**: `src/background/service-worker.ts` (lines 223-255)

**Acceptance criteria**:
- 6-sentence text chunked into 2 → returns union of per-chunk validated errors with correct global offsets
- Errors at chunk boundaries not duplicated
- `correctedText` in response is normalized concatenation of per-chunk correctedText
- Console logs any additional derived errors for visibility (non-blocking)

| Risk | Mitigation |
|------|------------|
| Per-chunk errors miss cross-sentence issues | Each chunk includes sentence context; validation pass logs discrepancies |
| Removing re-derivation authority misses some errors | Validation log provides visibility; can promote derived errors later if needed |

**Dependencies**: Must complete before Phase 3 (Tasks 3.1, 3.2)

### Task 1.4: Deterministic Local Punctuation Rules

**Priority**: 4

**Change**: Create `src/shared/punctuation-rules.ts` with `findLocalPunctuationErrors(text: string): GrammarError[]`:

**Rules**:
1. Doubled terminal punctuation: `..` `??` `!!` → single (NOT `...` ellipsis, NOT `?!`/`!?`)
2. Comma-period conflict: `,.` → `.` and `.,` → `.`
3. Space before punctuation: ` ,` ` .` ` ;` ` :` → remove space (NOT after newline)
4. Missing space after sentence-ending punctuation: `.Word` `,Word` → `. Word` `, Word` (NOT in URLs, emails, numbers like `3.14`, file paths, domain names)
5. Multiple consecutive spaces: `word  word` → `word word` (NOT at line start)

**Exclusion zones**: Identify URL (`https?://\S+`), email (`\S+@\S+\.\S+`), number (`\d+\.\d+`) spans before scanning. Skip matches overlapping exclusion zones.

**Integration**: In `handleCheckGrammar()` after API errors collected, run `findLocalPunctuationErrors(text)`. Merge with API errors. Deduplicate by offset overlap: local wins.

**Files**: `src/shared/punctuation-rules.ts` (new), `src/background/service-worker.ts`

**Acceptance criteria**:
- `"Hello..  world , how are you"` → 3 errors
- `"Visit https://example.com for details"` → 0 false positives
- `"I paid $3.14 for it"` → 0 false positives
- Local errors appear even if API misses them; no duplicates

| Risk | Mitigation |
|------|------------|
| False positives on URLs/code | Exclusion zone regex |
| Overlap with API errors | Dedup by offset overlap; local wins |

### Task 1.5: Two-Layer English-Only Gating

**Priority**: 5

**Change**: Create `src/shared/language-detect.ts` with `isLikelyEnglish(text: string): boolean`:

**Algorithm**:
1. Count character classes:
   - ASCII alpha `[A-Za-z]`
   - Non-Latin script (CJK `[\u4E00-\u9FFF]`, Cyrillic `[\u0400-\u04FF]`, Arabic `[\u0600-\u06FF]`, Devanagari `[\u0900-\u097F]`, Hangul `[\uAC00-\uD7AF]`, Kana `[\u3040-\u30FF]`)
2. If **any** non-Latin characters detected AND non-Latin > 15% of word characters → return `false`
3. If text ≥ 40 characters: check for at least 2 common English function words ("the", "is", "and", "to", "of", "in", "a", "that", "it", "for") with word-boundary matching. If < 2 found AND ASCII alpha < 70% → return `false`
4. If text < 40 characters: skip function-word check (too short for reliable word detection), but still enforce non-Latin and ASCII-ratio checks from steps 2-3
5. Return `true`

**Key**: Short non-Latin/CJK text (e.g., "你好世界" at 4 chars) is caught by step 2 (non-Latin characters detected, well above 15% threshold). No unconditional bypass for short text.

**Two-layer integration**:

**Layer 1 — Content script** (`src/content/text-monitor.ts`): In `checkElement()`, before sending `CHECK_GRAMMAR` message, call `isLikelyEnglish(text)`. If false:
- Do NOT send the message to the service worker
- Do NOT show "ready" or "checking" badge
- Clear any existing errors/underlines for the element
- Set widget to "idle"

**Layer 2 — Service worker** (`src/background/service-worker.ts`): In `handleCheckGrammar()`, as a defensive check before cache lookup or API call, call `isLikelyEnglish(text)`. If false, return `{ errors: [], correctedText: undefined }` immediately. This prevents non-English text from reaching the provider even if the content script check is bypassed.

**Files**: `src/shared/language-detect.ts` (new), `src/content/text-monitor.ts`, `src/background/service-worker.ts`

**Acceptance criteria**:
- English text → checked normally (both layers pass)
- Chinese "你好世界" (4 chars) → suppressed at content-script layer, no API call
- Japanese text → suppressed at content-script layer, no API call
- Mixed text with >85% English → checked normally
- Arabic script → suppressed
- Content script suppression means no badge/spinner appears for non-English input
- Service worker suppression means no API call even if content script check is somehow bypassed

| Risk | Mitigation |
|------|------------|
| False negative on English with many proper nouns | 70% ASCII threshold is permissive; function word check is secondary |
| Mixed-language text incorrectly gated | 15% non-Latin threshold allows reasonable mixing |
| Short English text with no function words | ASCII-ratio check still passes for pure English |

---

## Phase 2 — Stable UX

**Goal**: Badge states conform to product rules. Underlines don't go stale. No visual flicker, collision, or stale overlay artifacts.

### Task 2.1: Stable "Checking Long Draft" Badge State

**Priority**: 1 within phase

**Current**: During `checkTextInChunks()`, content script shows "checking" once. No intermediate state flips.

**Change**:
1. Verify that during chunk processing, no intermediate results are sent back (should already be the case — `handleCheckGrammar` returns once)
2. Add `chunked: boolean` flag to `CheckResponse` (types.ts) for future use by content script
3. Ensure no state transitions between "checking" and result — the badge must remain a stable spinner throughout

**Files**: `src/background/service-worker.ts`, `src/shared/types.ts`

**Acceptance criteria**:
- During 6-chunk check, badge shows single stable "checking" spinner, no flicker or state transitions
- Only one response sent back to content script

| Risk | Mitigation |
|------|------------|
| Low risk — mostly verification | Add integration note in code |

**Dependencies**: Task 1.3

### Task 2.2: Ready-Badge Focus Lifecycle

**Priority**: 2 within phase

**Product rules enforced**: Transient states belong only to active editor. At most one transient badge visible.

**Change**:
1. In `attachListeners()` (text-monitor.ts), add `focusout` listener:
   - Start 250ms timer
   - After 250ms: check `document.activeElement` is NOT this element or a descendant
   - Check `isErrorPanelOpen()` — if panel open for this editor, do NOT clear
   - If element has errors → keep `errors` badge (persistent per product rules)
   - If element has no errors → `updateWidget(element, "idle")`
2. In periodic maintenance (~line 217, every 2s), call `clearTransientWidgetsExcept(document.activeElement)` to catch missed stale badges

**Files**: `src/content/text-monitor.ts` (lines 295-335, 217-253)

**Acceptance criteria**:
- Focus editor → blue ready badge. Click elsewhere → badge disappears within 500ms
- Red error badge persists when focus leaves (persistent state)
- Error panel open → associated badge stays visible
- Gmail multiple compose windows → only focused one shows transient badge
- Multiple editors with errors → all show red badges simultaneously (persistent)

| Risk | Mitigation |
|------|------------|
| focusout during panel/popover interaction | 250ms delay + activeElement check + isErrorPanelOpen guard |

### Task 2.3: Prevent Badge Re-Animation on Scroll/Resize

**Priority**: 3 within phase

**Product rule enforced**: Scroll/resize must never re-animate a transient badge if state did not change.

**Change**:
1. Add `lastRendered` to widget tracking: `{ state, errorCount, isCompact }`
2. In `renderWidget()`, compute new position and mode first
3. If `state`, `errorCount`, and `isCompact` match `lastRendered`:
   - Only update `style.left`, `style.top` on existing DOM elements
   - Also update tooltip position via `positionWidgetTooltip()`
   - **Skip `container.innerHTML = ""` and DOM rebuild entirely**
4. If any differ → full rebuild as before
5. Update `lastRendered` after every render

**Files**: `src/content/status-widget.ts` (lines 56-158)

**Acceptance criteria**:
- Scroll with active "checking" badge → badge moves smoothly, no flash or re-animation
- Scroll with "ready" badge → repositions without flicker
- Resize → adjusts without DOM rebuild if state unchanged
- State change (ready → checking) → full rebuild as normal

| Risk | Mitigation |
|------|------------|
| Stale tooltip position | Always update tooltip position in position-only path |

### Task 2.4: Safe-Space Badge Placement for Chat Composers

**Priority**: 4 within phase

**Product rules enforced**: Choose compact vs full based on safe space. Badge never overlaps active text. Outside placement as fallback.

**Change**:
1. Replace the compact decision in `renderWidget()`:
   - **Fast path**: `rect.height < 44` → compact (tiny inputs, clearly no room)
   - **Fast path**: `rect.height ≥ 100` → full (large editors, definitely room)
   - **Measured path** (44-100px): call `getCompactTextRect()` to find last text line. Compute `verticalSpace = rect.bottom - lastLineBottom`. If `verticalSpace < 36` (28px badge + 8px margin) → compact. Else → full.
2. In compact mode, if `getCompactWidgetPosition()` returns no valid interior slot (all positions collide with text/buttons), use `getOutsideCompactWidgetPosition()` (existing function)
3. In full mode, verify the bottom-right corner position doesn't overlap last text line. If it does, switch to compact + outside.
4. Numeric thresholds (44px, 100px, 36px) are fast-path defaults. The safe-space measurement is the authoritative decision for the 44-100px range.

**Files**: `src/content/status-widget.ts` (line 71 and renderWidget decision tree)

**Acceptance criteria**:
- Grok composer (~60px, text fills width) → compact or outside badge, never overlapping text
- Gmail compose (~400px) → full badge, bottom-right
- Instagram comment (~36px) → compact 12px dot
- Editor 50px tall with text near bottom → compact or outside, never covering text
- No editor ever shows a badge overlapping the active text line

| Risk | Mitigation |
|------|------------|
| getCompactTextRect() performance cost | Only called for 44-100px range |
| Edge case: text exactly at bottom of 100px editor | Full mode verifies no overlap; switches to compact if needed |

### Task 2.5: Stale Underline Cleanup with Render Generation

**Priority**: 5 within phase

**Change**:
1. Add `renderGeneration: number` to `ElementState` (initialize to 0)
2. On every text change (input/mutation handler in text-monitor.ts), increment `renderGeneration` and call `clearErrors(element)` immediately — stale underlines vanish the instant user types
3. When calling `renderErrors()`, pass current `renderGeneration`
4. In `renderErrors()`, tag container with `data-generation`. Before rendering, check if container generation matches; if not (stale call), skip rendering
5. Delete the stubbed `recalculatePositions()` — not needed if we clear on text change and re-render on each check response. Existing `reRenderAll()` already handles scroll/resize

**Files**: `src/shared/types.ts`, `src/content/text-monitor.ts`, `src/content/underline-renderer.ts`

**Acceptance criteria**:
- Type a character → all underlines disappear instantly
- Check response arrives → fresh underlines at correct positions
- Scroll → underlines reposition (via reRenderAll)
- Rapid typing → no stale underlines from old check ever visible

| Risk | Mitigation |
|------|------------|
| Underlines flickering on every keystroke | Correct behavior — underlines are invalid once text changes |

### Task 2.6: Underline / Badge / Tooltip Collision Management

**Priority**: 6 within phase

**Change**:

**Z-index hierarchy** (in shadow DOM styles):
- Underline overlays: `z-index: 1`
- Status badge: `z-index: 2`
- Popover tooltip: `z-index: 3`
- Error panel: `z-index: 4`

**Collision avoidance**:
1. When rendering underlines, compute the badge's current bounding rect (from the widget container)
2. If an underline's rect overlaps the badge rect (within 4px margin), clip or skip that underline segment — do not render underline fragments that would be hidden behind the badge
3. When showing a popover tooltip, if the tooltip position would overlap an underline, the tooltip takes priority (z-index handles visual layering; no underline clipping needed for tooltips since z-index is sufficient)
4. Clip underline overlays to the editor's bounding rect — underlines extending beyond the editor boundary are not rendered

**Files**: `src/content/content-css.ts` (or inline styles), `src/content/underline-renderer.ts`, `src/content/status-widget.ts`

**Acceptance criteria**:
- Underline near badge → underline does not render under/behind badge area
- Popover appears above both underlines and badge
- Error panel above everything
- Underlines beyond editor boundary not visible
- Badge position change (e.g., scroll) → underline exclusion zone updates on next render

| Risk | Mitigation |
|------|------------|
| Performance cost of badge rect lookup per underline | Badge rect is a single getBoundingClientRect call, cached per render pass |
| Underline clipping creates visual gaps | Only clip segments directly under badge; rest of underline still visible |

---

## Phase 3 — Performance

**Goal**: Speed up long-draft checking. Preserve deterministic merge order and stable UI throughout.

### Task 3.1: Parallel Chunk Processing with Concurrency Cap

**Priority**: 1 within phase

**Current**: Serial `for...of await` loop in `checkTextInChunks()`.

**Change**:
1. Replace serial loop with batched concurrent executor:
   ```
   const CHUNK_CONCURRENCY = 3;
   for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
     const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
     const results = await Promise.all(batch.map(chunk => checkSingleText(chunk.text, ...)));
     // merge results in chunk index order
   }
   ```
2. Preserve deterministic merge order: collect results per-batch, merge in chunk index order
3. **On rate limit**: If any chunk in a batch returns a rate-limit error, **abort the entire check** and return the rate-limit signal to the content script. Do NOT return partial results. The content script's existing transient warning/retry path handles this (shows yellow "!" badge, retries after backoff). This is cleaner than partial results.
4. **On other errors**: If a chunk fails with a non-rate-limit error, use the original chunk text as fallback correctedText and empty errors for that chunk. Continue with remaining batches.
5. Badge shows stable "checking" throughout (no per-chunk UI updates)

**Files**: `src/background/service-worker.ts` (lines 223-255)

**Acceptance criteria**:
- 6-chunk text completes in ~2 round-trips (2 batches of 3)
- Errors merged in correct offset order
- Rate limit → clean abort → yellow warning badge → retry via existing path
- Non-rate-limit chunk failure → graceful degradation (no errors for that chunk, rest proceeds)

| Risk | Mitigation |
|------|------------|
| Rate limits hit more often | Cap at 3; abort entire check on rate limit (uses existing retry path) |
| AbortController interaction | Per-chunk abort controllers check parent signal |

**Dependencies**: Task 1.3 must be completed first

### Task 3.2: Per-Chunk Caching

**Priority**: 2 within phase

**Current**: Cache keyed on full text + settings. Any edit invalidates entire entry.

**Change**:
1. Per-chunk cache key: `JSON.stringify({ text: chunk.text, provider, model, settings, promptVersion })`
2. Before API call for a chunk, check per-chunk cache. If hit, use cached result.
3. Only send uncached chunks to API.
4. Merge cached + fresh results using same merge logic from Task 1.3.
5. Keep existing full-text cache as fast path for completely unchanged text.
6. Invalidate per-chunk caches if chunk boundaries change (different split points). Use boundary hash.
7. Separate 50-entry LRU, 60s TTL for per-chunk cache.

**Files**: `src/background/service-worker.ts`

**Acceptance criteria**:
- Edit last sentence of 6-sentence text → only 1 API call for changed chunk
- Unchanged chunks use cache
- If chunk boundaries shift (new sentence added mid-text) → all chunk caches invalidated
- Total response time scales with uncached chunk count

| Risk | Mitigation |
|------|------------|
| Context-dependent errors missed from cached chunks | 60s TTL limits staleness |
| Cache memory growth | Separate 50-entry LRU |

**Dependencies**: Tasks 1.3 and 3.1

---

## Versioning

Version bumps happen only at implementation time, not pre-planned per phase. Follow repo rules:
- **Patch** (`x.y.Z+1`) for bug fixes / small changes
- **Minor** (`x.Y+1.0`) for feature additions / UI changes
- Always update `manifest.json`, `package.json`, and `CHANGELOG.md` together

---

## Dependency Graph

```
Phase 1 (three independent workstreams):
  1.1 (Fix All one-shot)
  1.2 (oscillation suppress)  ── can proceed in parallel
  1.3 (chunk merge fix)
  1.4 (punctuation rules) → integrate into service-worker
  1.5 (English gating) → integrate into content-script + service-worker

Phase 2 (mostly independent, after Phase 1):
  2.1 (stable checking state) ← depends on 1.3
  2.2 (focus lifecycle)
  2.3 (scroll flicker)
  2.4 (chat composer placement)
  2.5 (underline stale cleanup)
  2.6 (collision management)

Phase 3 (sequential chain, after Phase 2):
  1.3 → 3.1 (parallel chunks) → 3.2 (per-chunk cache)
```

---

## Immediately Executable Work List

Ordered for step-by-step execution. No open design decisions.

**Versioning rule**: When a shipped implementation batch changes version, follow repo rules: patch for bug fixes / small changes, minor for feature/UI changes. Always update `manifest.json`, `package.json`, and `CHANGELOG.md` together.

### Phase 1 — Correctness

1. **Add `fixAllAppliedText` and `fixAllPriorErrors` to ElementState** — `src/shared/types.ts`: add `fixAllAppliedText?: string` and `fixAllPriorErrors?: GrammarError[]`. In `src/content/text-monitor.ts`, clear both on text change.

2. **Add one-shot contenteditable Fix All path** — `src/content/error-panel.ts` `applyAllFixes()` (~line 280): if `correctedText` exists and element is contenteditable, select all content, `execCommand("insertText", false, correctedText)`, verify with `getContentEditableText()`, fall back to sequential on mismatch.

3. **Suppress post-Fix-All oscillation (targeted)** — `src/content/error-panel.ts`: on Fix All success, set `state.fixAllAppliedText = correctedText` and `state.fixAllPriorErrors = errors`. In `src/content/text-monitor.ts` response handler: if text matches `fixAllAppliedText`, suppress only errors that are exact reversals or oscillation descendants of prior fixes (same offset, original matches prior suggestion). Allow all other errors through. Set `autoShowPanel = false` for post-Fix-All recheck. Clear after one recheck.

4. **Make per-chunk errors primary in chunk merging** — `src/background/service-worker.ts` `checkTextInChunks()`: return per-chunk validated errors (with offset adjustment) as primary. Keep `deriveErrorsFromCorrectedText()` as non-authoritative validation: run it, log discrepancies, but do not use as returned errors. Keep merged correctedText for Fix All.

5. **Create `src/shared/punctuation-rules.ts`** — Implement `findLocalPunctuationErrors(text)` with 5 rules (doubled terminal punctuation, comma-period, space-before-punctuation, missing-space-after-punctuation, doubled spaces) and URL/email/number exclusion zones.

6. **Integrate local punctuation rules** — `src/background/service-worker.ts` `handleCheckGrammar()`: after API errors, run `findLocalPunctuationErrors(text)`, merge, deduplicate by offset overlap (local wins).

7. **Create `src/shared/language-detect.ts`** — Implement `isLikelyEnglish(text)`: non-Latin character detection (catches short CJK text), ASCII ratio check, function-word check for longer text. No unconditional short-text bypass.

8. **Add content-script English gating** — `src/content/text-monitor.ts` `checkElement()`: before sending CHECK_GRAMMAR, call `isLikelyEnglish(text)`. If false, skip message, clear errors/underlines, set widget to "idle".

9. **Add service-worker English gating** — `src/background/service-worker.ts` `handleCheckGrammar()`: defensive `isLikelyEnglish(text)` check before cache/API. Return empty result if false.

### Phase 2 — Stable UX

10. **Verify stable checking state for chunked text** — Confirm no intermediate responses during chunk processing. Add `chunked` flag to CheckResponse.

11. **Add focusout badge cleanup** — `src/content/text-monitor.ts` `attachListeners()`: focusout handler with 250ms delay, activeElement check, isErrorPanelOpen guard. Only clear transient states; preserve error badges.

12. **Add periodic badge cleanup** — `src/content/text-monitor.ts` maintenance loop: call `clearTransientWidgetsExcept(document.activeElement)` every 2s.

13. **Prevent badge DOM rebuild on scroll** — `src/content/status-widget.ts`: add `lastRendered` tracking. If state/errorCount/isCompact unchanged, only update position styles. Skip `innerHTML = ""`.

14. **Implement safe-space badge placement** — `src/content/status-widget.ts`: replace height-only threshold with safe-space measurement for 44-100px editors. Verify full-mode doesn't overlap text. Outside fallback when no safe slot.

15. **Add render-generation tracking for underlines** — `src/shared/types.ts`: add `renderGeneration`. Text-monitor increments on change + calls `clearErrors()`. Underline renderer checks generation before rendering.

16. **Add collision management for underlines** — `src/content/underline-renderer.ts`: badge exclusion zone (skip underline segments under badge rect). Z-index hierarchy in shadow DOM styles. Clip underlines to editor bounds.

### Phase 3 — Performance

17. **Parallelize chunk processing** — `src/background/service-worker.ts`: batched `Promise.all` (cap 3). Deterministic merge order. Abort entire check on rate limit (feed into existing warning/retry path). Graceful degradation on non-rate-limit chunk errors.

18. **Add per-chunk caching** — Separate per-chunk LRU cache. Check before API call per chunk. Invalidate on boundary change. Merge cached + fresh results.

---

## Verification Plan

After each implementation step, verify:
1. `npm run build` passes
2. `npx tsc` passes
3. Manual testing per acceptance criteria above

| Test | Phase |
|------|-------|
| Fix All on Gmail 5-sentence email with 3+ errors → converges in 1 pass | 1 |
| Fix All → recheck finds only oscillation → shows "clean" | 1 |
| Fix All → recheck finds genuine new error → underline shown, panel NOT auto-opened | 1 |
| Type "你好世界" → no badge, no spinner, no API call | 1 |
| Type Chinese in service worker directly → empty response | 1 |
| `"Hello..  world , how"` → 3 local punctuation errors | 1 |
| Focus/unfocus editor → transient badge appears/disappears | 2 |
| Multiple editors with errors → all show red badges simultaneously | 2 |
| Scroll during checking → badge moves, no flicker/re-animation | 2 |
| Grok composer → badge never overlaps text | 2 |
| Type character → stale underlines vanish instantly | 2 |
| Underline near badge → no visual overlap | 2 |
| 6-sentence check → ~2 round-trips instead of 6 | 3 |
| Edit last sentence of cached text → 1 API call | 3 |
| Rate limit during parallel check → clean yellow warning + retry | 3 |
