#!/usr/bin/env bash
# Builds a zip of the extension source for submission to
# addons.mozilla.org (AMO). Since the extension ships as plain,
# unbundled JS, this archive doubles as both the reviewable
# package and the "source code" AMO may ask for.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

cd "$ROOT_DIR"

if ! jq -e . manifest.json >/dev/null 2>&1; then
  echo "error: manifest.json is not valid JSON" >&2
  exit 1
fi

VERSION="$(jq -r '.version' manifest.json)"
NAME="$(jq -r '.name' manifest.json | tr '[:upper:] ' '[:lower:]-')"

if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

ZIP_NAME="${NAME}-${VERSION}.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

# Files/directories shipped to AMO. Everything the extension needs at
# runtime, nothing else (no README, tools/, .git, dist/, etc).
FILES=(
  manifest.json
  background.js
  popup/popup.html
  popup/popup.css
  popup/popup.js
  options/options.html
  options/options.css
  options/options.js
  icons/icon-48.png
  icons/icon-96.png
  icons/icon-128.png
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: expected file missing: $f" >&2
    exit 1
  fi
done

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

# -X: no extra file attributes (deterministic-ish across platforms)
zip -X -q "$ZIP_PATH" "${FILES[@]}"

echo "Built $ZIP_PATH"
unzip -l "$ZIP_PATH"
