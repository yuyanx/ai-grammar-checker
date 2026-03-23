# Changelog

## v1.14.0

### Features
- Run a second-pass recheck on the correctedText when the first pass found errors, so subtle grammar issues (pronoun-antecedent agreement, parallel structure) that get missed when the model is distracted by obvious errors can be caught in a cleaner second pass
- Merge second-pass errors with first-pass errors, deduplicating by offset

## v1.13.5

### Bug Fixes
- Revert model from gemini-2.5-flash back to gemini-2.5-flash-lite — Flash offered no detection improvement without thinking mode but was slower and more expensive
- Revert check request timeout from 30s back to 15s to match Flash Lite's faster response time

## v1.13.4

### Bug Fixes
- Increase check request timeout from 15s to 30s to accommodate Gemini 2.5 Flash which is slower than Flash Lite
- Downgrade timeout warning to console.log to avoid noise in the extensions error page

## v1.13.3

### Bug Fixes
- Revert thinking budget to 0 and restore JSON schema constraint to fix broken detection — thinking mode is incompatible with Gemini structured output and caused both slowness and missed errors

## v1.13.2

### Bug Fixes
- Remove `responseMimeType` and `responseSchema` from Gemini request when thinking is enabled, as structured JSON output is incompatible with thinking mode and causes empty responses
- Increase `maxOutputTokens` from 1024 to 2048 to accommodate thinking + response

## v1.13.1

### Bug Fixes
- Enable Gemini 2.5 Flash thinking with a budget of 1024 tokens so the model can reason about cross-clause grammar errors like pronoun-antecedent agreement and parallel structure, instead of being crippled by `thinkingBudget: 0`

## v1.13.0

### Features
- Upgrade Gemini model from `gemini-2.5-flash-lite` to `gemini-2.5-flash` for significantly better cross-clause grammar detection (pronoun-antecedent agreement, parallel structure, etc.)

## v1.12.35

### Improvements
- Add parallel structure rule (#10) and a few-shot example to both grammar check and recheck prompts, so the model catches errors like "might relate... and needs" → "might relate... and need"
- Bump prompt cache version to invalidate stale cached responses

## v1.12.34

### Bug Fixes
- Remove "Runtime invalidated" and "Recovering desynced checking widget" log messages entirely so Chrome's extensions error page no longer fills with yellow warnings after reloading the extension

## v1.12.33

### Bug Fixes
- Downgrade "Runtime invalidated" and "Recovering desynced checking widget" from console warnings to log-level messages so the console doesn't fill with yellow noise after reloading the extension

## v1.12.32

### Improvements
- Add explicit pronoun-antecedent agreement rule (#9) and a few-shot example to both grammar check and recheck prompts, so the model is guided to catch errors like "the methods... it needs" → "they need"
- Bump prompt cache version to invalidate stale cached responses

## v1.12.31

### Bug Fixes
- Keep wide chat and email composers eligible for the stable compact control-row slot even after the editor grows taller, so Gmail and ChatGPT-style reply bars stop flipping from the inline-right-safe dot to overlapping large badges near the send button
- Align compact control-row detection with the same wide-composer eligibility rule, so row/chat badge placement remains stable as the composer height changes while typing

## v1.12.30

### Bug Fixes
- Keep row/chat composer badges on one stable control-row slot across ready, checking, and error states, so ChatGPT-style composer bars stop jumping onto the send button or moving above it as the composer height changes
- Use the actual focused editable strip for widget visibility and add stronger scroll/viewport refresh handling, so ready/checking badges on GitHub, X, and similar composers move with the editor and hide once the real input strip scrolls offscreen

## v1.12.29

### Bug Fixes
- Use the actual focused editable rect for widget visibility while letting large composers climb to a larger expanded anchor, so GitHub/X-style composers stay attached instead of falling into the compact outside-left fallback and stale badges hide once the real input strip scrolls offscreen
- Give inline comment/chat bars one stable compact slot anchored to the row itself instead of the live text line, so compact badges stop reallocating vertically or jumping between placements as the status changes

## v1.12.28

### Bug Fixes
- Hide the widget when the actual focused input line scrolls out of the viewport, so ready/checking badges on GitHub and X composers no longer stay pinned on the page after the editor itself has scrolled away
- Keep large multi-row composers on a stable expanded/side placement instead of forcing the compact outside-left fallback, so GitHub-style and X-style ask/compose surfaces stay attached to the editor instead of jumping to the far left edge

## v1.12.27

### Bug Fixes
- Keep compact comment/chat badges on one stable reserved slot across ready/checking/error states, so Instagram and Grok row composers stop jumping between inside and outside positions or switching allocation when the status changes
- Align compact row/bar badges vertically to the actual focused editable strip instead of the larger wrapper midpoint, so multi-row prompt bars like Grok image composers stay tied to the text row while still avoiding control clusters

## v1.12.26

### Bug Fixes
- Add a selection-aware LinkedIn post-composer resolver and broaden LinkedIn compose-shell discovery, so the main share-post modal can attach after its real rich-text node appears instead of staying completely inactive
- Make compact badge anchoring use the actual row geometry and fall back relative to that row, so narrow comment/chat composers keep the badge inline-right-safe instead of drifting to a larger wrapper or page edge

## v1.12.25

### Bug Fixes
- Use the actual focused editable node for text/obstacle detection while anchoring compact badges to the visible composer row, so narrow LinkedIn and Grok editors no longer inherit far-left or control-overlapping badge placement from the wrong geometry source
- Allow large LinkedIn compose dialogs to expand to a right-side modal anchor, so the main post composer can render a visible badge instead of disappearing when the inner textbox itself is too small to anchor

## v1.12.24

### Bug Fixes
- Scan LinkedIn share-post wrapper nodes for compose intent and resolve them to the inner textbox, so the main post composer can activate even when LinkedIn exposes the placeholder shell before the editable node itself

## v1.12.23

### Bug Fixes
- Resolve LinkedIn share-post wrapper focus targets down to their inner compose textbox, so the main post composer can activate even when focus lands on the placeholder shell instead of the editable node

## v1.12.22

### Bug Fixes
- Anchor widget geometry to the real focused editable sub-element instead of always using the tracked outer editor root, so LinkedIn and Grok composers stop inheriting badge placement from the wrong visual box
- Keep compact badge fallback placement close to the actual editor and stop expanding tiny editors to giant modal/page containers, so Grok no longer throws the blue dot far left and LinkedIn compact composers stay tied to the visible input row

## v1.12.21

### Bug Fixes
- Prefer the innermost actual editable surface over outer wrapper roots when tracking rich composers, so LinkedIn and Grok stop pinning widgets to the wrong ancestor and can activate the real editor instead of a stale outer shell

## v1.12.20

### Bug Fixes
- Let LinkedIn compose surfaces inherit compose intent from descendant and wrapper placeholders, so the main post composer no longer gets excluded when the visible "Share your thoughts" signal is not attached directly to the focused textbox node
- Make compact badge anchoring prefer the nearest composer row with controls instead of the widest ancestor, so LinkedIn comment and Grok home badges stay tied to the actual editor row instead of drifting into overlapping or far-left positions

## v1.12.19

### Bug Fixes
- Canonicalize nested editable fragments down to one tracked editor root, so rich composers such as LinkedIn and Grok no longer miss activation or leave duplicate stale widgets attached to different fragments of the same editor
- Resolve textarea and input fixes against the nearest matching occurrence instead of the first repeated word, so follow-up `Fix All` passes on GitHub-style editors stop applying corrections to the wrong repeated token
- Relax compact composer anchor selection so the blue badge can anchor to fuller control rows and stay clear of LinkedIn and Grok right-side action areas

## v1.12.18

### Bug Fixes
- Build the extension into a temporary directory and swap it into `dist/` only after the bundle is complete, so Chrome no longer sees a half-built unpacked extension and reports a bogus manifest-read failure during reload

## v1.12.17

### Bug Fixes
- Broaden LinkedIn compose-surface detection so the share-post dialog still activates when its placeholder lives in site-specific attributes or wrapper structures instead of the editable node itself
- Prefer compact anchors that include same-row sibling controls and relax compact anchor sizing thresholds, so compact badges stay clear of LinkedIn comment actions and Grok's right-side composer controls

## v1.12.16

### Bug Fixes
- Let supported site-specific compose surfaces such as LinkedIn's share-post editor override generic picker/search heuristics, so the main post composer is no longer accidentally excluded from grammar checking
- Treat interactive controls embedded inside compact composer roots as widget obstacles, so compact blue badges no longer sit on top of LinkedIn comment action buttons or Grok's right-side composer controls

## v1.12.15

### Bug Fixes
- Remove stale extension shadow hosts before a reinjected content script starts, so dead grey checking widgets from an invalidated old script do not linger alongside the fresh widget
- Make textarea Fix All prioritize the currently surfaced issue list over stale `correctedText`, so follow-up Fix All clicks on GitHub comment and Copilot-style editors no longer become no-ops after the first pass

## v1.12.14

### Bug Fixes
- Detect stale tabs whose old content script lost its extension runtime, clear the dead grey checking widget, and re-inject the current content script into existing tabs after an extension reload/update so old pages no longer depend on a manual refresh to recover

## v1.12.13

### Bug Fixes
- Add a stale pending-check recovery guard on focus and periodic maintenance, so old tabs recover from stuck grey checking states even when the normal visibility restore path is missed

## v1.12.12

### Bug Fixes
- Recover from stuck backgrounded checks by timing out hung content-script grammar requests and retrying them when the tab becomes visible again, so the grey checking badge no longer spins forever until a manual refresh

## v1.12.11

### Bug Fixes
- Reject coordinated-phrase noun-number changes such as `my friend and I` -> `my friends and I` in the derived corrected-text fallback path, so that bad fallback suggestion no longer leaks through as a spelling issue

## v1.12.10

### Bug Fixes
- Collapse competing explicit suggestions for the same exact text span down to one surfaced issue before rendering, so inflated counts and conflicting `Fix All` edits stop fighting over the same word
- Reject bogus grammar-number suggestions inside coordinated phrases like `my friend and I`, so bad model edits such as `friend` → `friends` no longer surface

## v1.12.9

### Bug Fixes
- Reject redundant explicit quote-closing and punctuation-appending suggestions when the same boundary characters already exist just outside the matched span, so bogus fixes like `leave.` → `leave."` no longer surface after the quote is already present
- Tighten the grammar-check prompt so the model stops suggesting quote-closing or punctuation additions when those boundary characters already exist immediately outside the selected span

## v1.12.8

### Bug Fixes
- Make contenteditable `Fix All` derive and apply one canonical non-overlapping edit set from the AI's `correctedText`, instead of replaying every overlapping surfaced issue one by one
- Stop contenteditable fallback matching from jumping to the first repeated word occurrence, so short fixes like `one` no longer drift into earlier words such as `none`

## v1.12.7

### Bug Fixes
- Reject explicit grammar suggestions that try to capitalize a mid-sentence word and add an introductory comma, so nonsense edits like `so` → `So,` no longer surface inside phrases such as `I wasn't so sure`

## v1.12.6

### Bug Fixes
- Restore contenteditable `Fix All` batching to the same `applyFix()` path used by individual Accept actions, instead of forcing tiny punctuation edits through direct DOM replacement first
- Stop the latest `Fix All` regression where simple punctuation-only batches could silently fail or keep resurfacing the same tiny issues even though accepting them one-by-one still worked

## v1.12.5

### Bug Fixes
- Stop quote-spacing punctuation rules from treating closing quotes like opening quotes, so `Fix All` no longer removes the valid space in patterns like `one" but` and reintroduces the same quote issues on the next check
- Apply tiny contenteditable punctuation fixes through the deterministic DOM replacement path during `Fix All`, so quote-boundary edits do not get skipped by the selection/execCommand path and reappear on the next check
- Detect malformed closing quote punctuation clusters like `pay"."` and `leave."."` as one canonical local punctuation fix per boundary, instead of letting them pass undetected or break into competing micro-fixes

## v1.12.4

### Bug Fixes
- Stop quote-spacing punctuation rules from treating closing quotes like opening quotes, so `Fix All` no longer removes the valid space in patterns like `one" but` and reintroduces the same quote issues on the next check
- Apply tiny contenteditable punctuation fixes through the deterministic DOM replacement path during `Fix All`, so quote-boundary edits do not get skipped by the selection/execCommand path and reappear on the next check

## v1.12.3

### Bug Fixes
- Restore the 1.12.1 contenteditable Fix All behavior for normal grammar-heavy drafts while keeping the blue badge scroll-position fix
- Detect quote-heavy punctuation mistakes such as repeated quotation marks and missing spaces before opening quotes without letting corrected-text fallback explode them into unrelated grammar/spelling cascades

## v1.12.2

### Bug Fixes
- Suspend contenteditable checks while Fix All is applying sequential edits and run one clean validation pass after the batch settles, so normal grammar corrections stop cascading across multiple passes
- Resolve repeated-word contenteditable ranges against the nearest matching occurrence instead of the first occurrence, so Fix All targets the intended span more reliably

## v1.12.1

### Bug Fixes
- Stop animating scroll-driven widget top/left position updates so the blue ready badge stays visually fixed to the editor instead of lagging while the page scrolls

## v1.12.0

### Features
- Add a Phase 4 editor-intent classifier so activation is limited to real composition surfaces instead of broad editable-field matching
- Suppress utility inputs such as search, branch, query, picker, and Ask Gmail fields before listener attachment, badge priming, or grammar requests
- Keep compose activation for supported multiline writing surfaces such as Gmail compose, Grok chat, and social post/comment editors

## v1.11.1

### Bug Fixes
- Stop surfacing broad unsafe grammar replacements from corrected-text fallback diffs, so derived suggestions no longer collapse whole phrases into nonsense edits
- Make chunked checks return deduped per-chunk validated errors as the primary result and keep whole-text corrected-text diffs as validation only

## v1.11.0

### Features
- Parallelize long-draft chunk checks with a small concurrency cap while preserving deterministic merge order and stable final responses
- Add a dedicated per-chunk cache so repeated long-draft edits can reuse unchanged chunk results instead of rechecking every chunk
- Include punctuation-rule cache versioning in grammar cache keys so local punctuation updates invalidate stale cached results

## v1.10.0

### Features
- Keep long-draft checks in a single stable active-editor checking lifecycle with stale-response suppression
- Limit transient badges to the active editor, add focusout cleanup, and stop scroll/resize from rebuilding unchanged widget DOM
- Refine compact/full badge presentation for chat-style editors and add underline collision filtering against the widget area
- Clear stale underlines immediately on text change and gate underline rendering with per-editor generations

## v1.9.0

### Features
- Add deterministic local punctuation detection for objective malformed patterns such as `,.`, `.,`, duplicated terminal punctuation, space-before-punctuation, and missing spaces after sentence-ending punctuation
- Add English-only gating in both the content script and service worker so clearly non-English input is suppressed before any provider request and does not show ready/checking badge states

## v1.8.10

### Notes
- Update the active handoff roadmap to defer `Fix All` work and prioritize punctuation rules, English-only gating, stable checking state, badge lifecycle/placement, underline cleanup, and later chunk-performance work

## v1.8.9

### Bug Fixes
- Rebuild long-draft Fix All results from one normalized corrected paragraph after chunked checking so repeated Fix All clicks stop chasing unstable leftover punctuation edits
- Filter unstable derived punctuation-only toggles from corrected-text fallback results so loops like though -> though, -> though. no longer persist in the panel

## v1.8.8

### Bug Fixes
- Wait for each contenteditable Fix All replacement to settle before applying the next one so rich editors like Gmail stop skipping or corrupting later fixes in long drafts
- Clear stale ready and checking badges from previously focused editors so Gmail does not show multiple blue ready dots at the same time

## v1.8.7

### Bug Fixes
- Show exact error counts on the non-compact issue badge up to 99 instead of collapsing everything above 9 into 9+, and switch to 99+ for larger totals

## v1.8.6

### Bug Fixes
- Split longer drafts into smaller sentence chunks before sending them to the AI so multi-sentence Gmail passages no longer fail as a single oversized zero-error request
- Invalidate cached clean results again so longer drafts are rechecked through the new chunked request path

## v1.8.5

### Bug Fixes
- Harden AI response parsing so longer replies that include fenced JSON or extra wrapper text no longer get treated as zero-error clean results
- Invalidate cached clean results again so Gmail drafts are rechecked through the more tolerant parser path

## v1.8.4

### Bug Fixes
- Add a high-recall second-pass grammar check for longer clean-looking paragraphs so pasted Gmail drafts do not trust a single weak zero-error response

## v1.8.3

### Bug Fixes
- Fall back to deriving issue spans from the AI's full corrected text when a provider returns a corrected paragraph but no usable per-error spans, preventing obvious multi-error drafts from collapsing to a false clean badge
- Invalidate cached clean results again so Gmail-style drafts are rechecked through the new corrected-text fallback path

## v1.8.2

### Bug Fixes
- Improve paragraph-level grammar detection prompts so realistic Gmail-style mixes of spelling, punctuation, capitalization, word-choice, tense, and agreement mistakes are requested in one pass instead of a too-narrow typo-only style check
- Normalize broader AI error categories such as capitalization, word choice, tense, article, and typo back into the extension's internal grammar, spelling, and punctuation buckets instead of silently dropping them
- Invalidate older cached check results after the prompt update so stale false-clean responses are not reused

## v1.8.1

### Bug Fixes
- Make the compact ready-state badge use the same small dot size as the compact issue badge instead of the larger compact widget size

## v1.8.0

### Improvements
- Simplify the new ready-state badge to a solid blue indicator
- Stop re-rendering identical widget states so the ready badge stays visually stable while users type in short drafts

## v1.7.0

### Features
- Prewarm the background worker on editor focus and show a lightweight ready badge immediately so supported editors feel prepared before typing starts
- Trigger a faster first grammar check when focusing an editor that already contains enough text, instead of waiting for the normal full debounce path

### Improvements
- Keep short focused editors in a neutral ready state instead of hiding the widget entirely, reducing visual pop-in when users start typing

## v1.6.14

### Notes
- Record the X home search compact tooltip clipping as a known deferred edge case; outside badge placement remains enabled, but further tooltip polish is postponed for now

## v1.6.13

### Bug Fixes
- Clamp compact widget tooltips from their real rendered bounds after layout so issue-count labels stay fully visible even when outside-positioned badges sit near the viewport edge

## v1.6.12

### Bug Fixes
- Preserve compact tooltip alignment classes after widget rendering so outside-positioned badges actually use the corrected left/right tooltip placement instead of falling back to clipped center alignment

## v1.6.11

### Bug Fixes
- Choose compact tooltip alignment from actual free space on each side of the badge so outside-positioned badges near the right edge no longer keep their issue labels clipped

## v1.6.10

### Bug Fixes
- Make compact widget tooltips viewport-aware so issue-count labels stay readable near screen edges instead of being clipped when badges sit outside tiny fields

## v1.6.9

### Bug Fixes
- Position underlines in single-line inputs from the input's own text baseline metrics instead of the mirror span box so custom search fields like X no longer draw underlines on top of the text

## v1.6.8

### Bug Fixes
- Add an outside-anchor fallback for compact badges so cramped editors like the X home search box place the dot just outside the field instead of overlapping text or built-in controls

## v1.6.7

### Bug Fixes
- Stop using one-shot full-content replacement for contenteditable Fix All so rich-text composers like X keep their visible editor state editable after grammar corrections

## v1.6.6

### Features
- Click the red error badge to open an error panel listing all issues with per-error Fix/Dismiss buttons and a global Fix All
- Error panel supports both textarea/input (one-shot string splice) and contentEditable (sequential fallback) editors
- Panel auto-closes on user typing, scroll, resize, Escape, or click outside
- Success state ("All issues fixed!") shown after last error resolved, auto-closes after 1.5s
- Dark mode support for the error panel matching existing popover theme

### Improvements
- Automatic single retry after 2 seconds on transient API failures (network errors, 500s)
- New orange "!" error widget state shows briefly when a check fails, auto-hides after 4 seconds
- Rate-limited errors skip retry since the service worker handles its own backoff

## v1.6.5

### Bug Fixes
- Detect visible action labels like Instagram Post explicitly and anchor compact dots to the left of that label with a hard safety gap instead of relying only on generic obstacle scanning

## v1.6.4

### Bug Fixes
- Enforce a hard safety gap before compact editor action labels like Instagram Post and shrink the red dot again so it cannot be placed inside the action area

## v1.6.3

### Bug Fixes
- Stop dropping rendered right-side action text from compact badge obstacle detection when Instagram wraps the editor and Post label in the same container

## v1.6.2

### Bug Fixes
- Position compact badges from the rendered text line inside contenteditable editors instead of the full editable box so Instagram comment dots stop being pushed on top of Post

## v1.6.1

### Bug Fixes
- Treat rendered inline text like Post as occupied space when placing compact badges so the dot no longer lands on top of visible action labels

## v1.6.0

### Improvements
- Change compact error badges to a tiny Grammarly-style red dot so crowded editors like Instagram comments can place the badge without the larger numbered chip covering nearby controls

## v1.5.17

### Bug Fixes
- Detect the visible inline action cluster by rendered hit scanning across the editor row so compact badges can align before Instagram's Post-plus-emoji area

## v1.5.16

### Bug Fixes
- Pin compact badges directly before the inline action block on the editor row so Instagram comment badges align like Grammarly's dot before Post

## v1.5.15

### Bug Fixes
- Use rendered hit-testing for compact badge placement so the badge chooses actual free space in the editor row instead of overlapping Instagram's visible Post and emoji area

## v1.5.14

### Bug Fixes
- Reserve the entire visible right-side action area in compact editors so badges sit left of Post and emoji content instead of relying on brittle control detection

## v1.5.13

### Bug Fixes
- Align compact editor badges against the full right-side action cluster so the badge sits before Post-plus-emoji groups instead of overlapping them

## v1.5.12

### Bug Fixes
- Place compact editor badges in the gap before right-side controls so the badge no longer overlaps buttons like Post, emoji, or Comment

## v1.5.11

### Bug Fixes
- Make compact editor badge placement collision-aware so the badge avoids overlapping existing controls like Post, emoji, and comment buttons

## v1.5.10

### Bug Fixes
- Rework compact editor badge anchoring so the badge pins to the editor container's bottom-right corner and repositions on layout changes such as zoom or resize

## v1.5.9

### Bug Fixes
- Refine compact editor badge placement so Instagram comments keep the badge closer to the typed text and away from the right-side action controls

## v1.5.8

### Bug Fixes
- Fix compact editor badges not rendering when the editable element is narrow but the surrounding composer row is visible, such as Instagram comments

## v1.5.7

### Bug Fixes
- Fix compact editor badge anchoring so Instagram comment rows position the badge against the full composer instead of the narrow text box

## v1.5.6

### Bug Fixes
- Fix compact editor badge placement so comment boxes like Instagram can still show the error badge and open Fix All

## v1.5.5

### Bug Fixes
- Fix contenteditable offset mapping so repeated words use the correct occurrence when accepting fixes
- Fix multiline rich-text editors drifting after block or line-break boundaries when drawing underlines or applying fixes
- Fix unchanged text getting stuck after transient API failures by allowing retries without extra typing

## v1.1.0

### Bug Fixes
- Fix Gemini 2.5 Flash "thinking" parts breaking response parsing, causing only 1 error to show
- Fix model only returning 1 error at a time (improved prompt with few-shot example)
- Fix apply-fix inserting text at wrong position
- Fix underlines persisting after clicking Accept
- Fix double text replacement and underlines persisting after accept
- Fix Accept button not working (delegated execCommand to MAIN world via postMessage)
- Fix quota loop by moving rate limit tracking to service worker

### Performance
- Speed up grammar checking for paid tier users (reduced debounce, parallel requests)
- Add request caching, abort in-flight requests, and reduced debounce delay
- Switch to gemini-2.5-flash-lite (15 RPM, best free tier throughput)
- Raise minimum text length to 30 chars to conserve free tier daily quota

### Improvements
- Add input[type=search] and contenteditable variants to element selectors

## v1.0.0

### Initial Release
- Grammar, spelling, and punctuation checking powered by OpenAI or Gemini API keys
- Real-time error detection with inline underlines
- Error popover with suggestions and one-click accept
- Support for text inputs, textareas, and contenteditable elements
- Configurable API provider (OpenAI / Gemini) with bring-your-own-key
- Options page for API key management and settings
- Chrome Extension Manifest V3
