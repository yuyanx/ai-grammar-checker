# Changelog

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
