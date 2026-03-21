#!/bin/bash
set -e

echo "Building AI Grammar Checker..."

ESBUILD="./node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "Error: local esbuild binary not found at $ESBUILD"
  echo "Run 'npm install' first so the build uses the pinned local dependency."
  exit 1
fi

TMP_DIST="$(mktemp -d ./dist.build.XXXXXX)"
BACKUP_DIST="./dist.previous.$$"

cleanup() {
  rm -rf "$TMP_DIST"
  rm -rf "$BACKUP_DIST"
}

trap cleanup EXIT

mkdir -p "$TMP_DIST/background" "$TMP_DIST/content" "$TMP_DIST/popup" "$TMP_DIST/options" "$TMP_DIST/icons"

# Bundle with esbuild (Chrome extensions need bundled files, not ES modules)
"$ESBUILD" src/background/service-worker.ts \
  --bundle --outfile="$TMP_DIST/background/service-worker.js" \
  --format=iife --target=es2020

"$ESBUILD" src/content/index.ts \
  --bundle --outfile="$TMP_DIST/content/index.js" \
  --format=iife --target=es2020

"$ESBUILD" src/content/page-script.ts \
  --bundle --outfile="$TMP_DIST/content/page-script.js" \
  --format=iife --target=es2020

"$ESBUILD" src/popup/popup.ts \
  --bundle --outfile="$TMP_DIST/popup/popup.js" \
  --format=iife --target=es2020

"$ESBUILD" src/options/options.ts \
  --bundle --outfile="$TMP_DIST/options/options.js" \
  --format=iife --target=es2020

# Copy static assets
cp manifest.json "$TMP_DIST/"
cp src/content/content.css "$TMP_DIST/content/"
cp src/popup/popup.html "$TMP_DIST/popup/"
cp src/popup/popup.css "$TMP_DIST/popup/"
cp src/options/options.html "$TMP_DIST/options/"
cp src/options/options.css "$TMP_DIST/options/"
cp src/icons/*.png "$TMP_DIST/icons/"

if [ -d dist ]; then
  mv dist "$BACKUP_DIST"
fi
mv "$TMP_DIST" dist
TMP_DIST=""
rm -rf "$BACKUP_DIST"

echo "Build complete! Load dist/ as unpacked extension in Chrome."
