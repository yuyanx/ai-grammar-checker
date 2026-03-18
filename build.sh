#!/bin/bash
set -e

echo "Building AI Grammar Checker..."

ESBUILD="./node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "Error: local esbuild binary not found at $ESBUILD"
  echo "Run 'npm install' first so the build uses the pinned local dependency."
  exit 1
fi

# Clean dist
rm -rf dist
mkdir -p dist/background dist/content dist/popup dist/options dist/icons

# Bundle with esbuild (Chrome extensions need bundled files, not ES modules)
"$ESBUILD" src/background/service-worker.ts \
  --bundle --outfile=dist/background/service-worker.js \
  --format=iife --target=es2020

"$ESBUILD" src/content/index.ts \
  --bundle --outfile=dist/content/index.js \
  --format=iife --target=es2020

"$ESBUILD" src/content/page-script.ts \
  --bundle --outfile=dist/content/page-script.js \
  --format=iife --target=es2020

"$ESBUILD" src/popup/popup.ts \
  --bundle --outfile=dist/popup/popup.js \
  --format=iife --target=es2020

"$ESBUILD" src/options/options.ts \
  --bundle --outfile=dist/options/options.js \
  --format=iife --target=es2020

# Copy static assets
cp manifest.json dist/
cp src/content/content.css dist/content/
cp src/popup/popup.html dist/popup/
cp src/popup/popup.css dist/popup/
cp src/options/options.html dist/options/
cp src/options/options.css dist/options/
cp src/icons/*.png dist/icons/

echo "Build complete! Load dist/ as unpacked extension in Chrome."
