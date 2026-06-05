#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/lambda-package"
ZIP_PATH="$REPO_ROOT/dist/customer-simulator-lambda.zip"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR" "$REPO_ROOT/dist"

cp "$REPO_ROOT/Lambda.js" "$DIST_DIR/index.js"
(
  cd "$DIST_DIR"
  zip -q -r "$ZIP_PATH" index.js
)

echo "Packaged $ZIP_PATH"
echo ""
echo "Upload with:"
echo "aws s3 cp $ZIP_PATH s3://customer-simulator-deploy/customer-simulator-lambda.zip"
