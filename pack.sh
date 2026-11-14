#!/usr/bin/env bash
# Builds two zips from the last commit, not the working tree, so commit first:
#   dist/professor-ratings-for-pitt-vX.Y.Z.zip  -- store upload (runtime only)
#   dist/source-vX.Y.Z.zip                      -- full source incl. tests
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist
rm -f "dist/professor-ratings-for-pitt-v${VERSION}.zip" "dist/source-v${VERSION}.zip"

# core.autocrlf is off for both archives so a Windows checkout cannot rewrite
# line endings, and vendor/ ships byte for byte as published upstream.

# Store package: only what the extension executes.
git -c core.autocrlf=false archive --format=zip -o "dist/professor-ratings-for-pitt-v${VERSION}.zip" \
  HEAD manifest.json src icons vendor

# Source package: every tracked file.
git -c core.autocrlf=false archive --format=zip -o "dist/source-v${VERSION}.zip" HEAD

echo "Built:"
ls -lh dist/
