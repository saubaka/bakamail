#!/bin/sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST="$ROOT/web/dist"

if [ ! -d "$DIST" ]; then
  echo "FAIL: 还没有构建产物 $DIST，先运行 npm run build" >&2
  exit 1
fi

PATTERNS='maddymail|imap://|smtp://|IMAP4rev1|AUTH PLAIN|imapflow|nodemailer|:993|:465|:587|STARTTLS|submission'

if grep -rInE "$PATTERNS" "$DIST" > /tmp/bakamail-leak.txt 2>/dev/null; then
  echo "FAIL: 前端产物里出现了邮件协议相关字样" >&2
  cat /tmp/bakamail-leak.txt >&2
  exit 1
fi

echo "OK: 前端产物不含邮件协议、邮局主机名或端口"

if ! grep -rIq "/api/" "$DIST"; then
  echo "FAIL: 产物里找不到任何 /api/ 调用，扫描可能失效" >&2
  exit 1
fi
echo "OK: 扫描有效（产物中确实存在 /api/ 调用）"
