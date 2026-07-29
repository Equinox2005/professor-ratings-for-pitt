#!/usr/bin/env bash
# Builds two zips:
#   dist/professor-ratings-for-pitt-vX.Y.Z.zip  -- store upload (runtime only)
#   dist/source-vX.Y.Z.zip                      -- full source incl. tests
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/professor-ratings-for-pitt-v${VERSION}.zip" "dist/source-v${VERSION}.zip"

# Store package: only what the extension executes.
zip -rq "dist/professor-ratings-for-pitt-v${VERSION}.zip" \
  manifest.json src icons vendor \
  -x "*.DS_Store"

# Source package: everything except dependencies and build output.
zip -rq "dist/source-v${VERSION}.zip" . \
  -x "node_modules/*" "dist/*" "package-lock.json" "*.DS_Store"

echo "Built:"
ls -lh dist/
