#!/bin/bash
set -eu
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "需要先安装 Node.js 24 或更新版本。"
  exit 1
fi
exec node scripts/start-local.mjs "$@"
