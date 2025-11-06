#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/release"
VSIX_PATH="$OUT_DIR/wendy-vscode.vsix"

if [[ -z ${VSCE_PAT:-} ]]; then
  echo "VSCE_PAT environment variable is required to publish to the VS Code Marketplace" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

pushd "$ROOT_DIR" >/dev/null

echo "▶ Building extension bundle"
npm run package

echo "▶ Creating VSIX package at $VSIX_PATH"
npx vsce package --out "$VSIX_PATH"

echo "▶ Publishing to VS Code Marketplace"
npx vsce publish --packagePath "$VSIX_PATH" --pat "$VSCE_PAT"

popd >/dev/null

echo "✅ Publish flow completed"
