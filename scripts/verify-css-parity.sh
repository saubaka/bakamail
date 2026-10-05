#!/bin/sh
# 兼容旧命令；完整样式合同由 Node 校验器负责。
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node "$ROOT/scripts/verify-style-contract.mjs"
