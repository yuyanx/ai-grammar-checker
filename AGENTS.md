# Project Instructions

## Versioning Rules

Version numbers must be updated in **both** `manifest.json` and `package.json` with every change:

- **Bug fixes / small changes**: bump patch version (`x.y.Z` → `x.y.Z+1`)
- **Feature additions / UI changes**: bump minor version (`x.Y.z` → `x.Y+1.0`)

## After Every Push

After pushing changes, always remind the user to sync and rebuild locally:

```
cd /Users/ryanxu/Documents/ai-grammar-checker
git pull origin Codex/angry-wu-k70YE
npm run build
```

Then refresh the extension in `chrome://extensions`.
