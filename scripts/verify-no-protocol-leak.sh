#!/bin/sh
# 校验前端产物里没有直连邮局的痕迹。
#
# 架构约束（规划第 4 章）：浏览器只调用本站 /api/*，
# 邮件协议、邮局主机名与端口只能存在于后端。
#
# 用法: sh scripts/verify-no-protocol-leak.sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST="$ROOT/web/dist"

if [ ! -d "$DIST" ]; then
  echo "FAIL: 还没有构建产物 $DIST，先运行 npm run build" >&2
  exit 1
fi

# 这些都是「前端不许知道」的东西
PATTERNS='maddymail|imap://|smtp://|IMAP4rev1|AUTH PLAIN|imapflow|nodemailer|:993|:465|:587|STARTTLS|submission'

if grep -rInE "$PATTERNS" "$DIST" > /tmp/bakamail-leak.txt 2>/dev/null; then
  echo "FAIL: 前端产物里出现了邮件协议相关字样" >&2
  cat /tmp/bakamail-leak.txt >&2
  exit 1
fi

echo "OK: 前端产物不含邮件协议、邮局主机名或端口"

# 反向校验：确认扫描本身有效——构建产物里必须能找到 /api/ 调用
if ! grep -rIq "/api/" "$DIST"; then
  echo "FAIL: 产物里找不到任何 /api/ 调用，扫描可能失效" >&2
  exit 1
fi
echo "OK: 扫描有效（产物中确实存在 /api/ 调用）"
