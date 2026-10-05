#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_ROOT=${BAKAMAIL_PROJECT1_ROOT:-"$ROOT/../1"}
TARGET="$ROOT/web/src/styles/vendor"

mkdir -p "$TARGET"
cp "$SOURCE_ROOT/app/static/styles/app.css" "$TARGET/project1-app.css"
cp "$SOURCE_ROOT/app/static/styles/small-window-theme.css" "$TARGET/project1-small-window-theme.css"
cp "$SOURCE_ROOT/docs/phase-2/prototype/styles.css" "$TARGET/project1-prototype.css"

node "$ROOT/scripts/verify-style-contract.mjs"
