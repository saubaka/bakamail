#!/bin/sh
# 测试替身：模拟 maddy 的账号管理子命令。
# 只实现 BakaMail 用到的部分，状态存在 $FAKE_MADDY_STATE 目录里。
set -eu

STATE="${FAKE_MADDY_STATE:?fake-maddy 需要 FAKE_MADDY_STATE 环境变量}"
mkdir -p "$STATE"
[ -f "$STATE/credentials" ] || : > "$STATE/credentials"
[ -f "$STATE/accounts" ] || : > "$STATE/accounts"

group="${1:-}"
[ $# -gt 0 ] && shift
sub="${1:-}"
[ $# -gt 0 ] && shift

# 丢掉 --cfg-block X / --yes / --no-specialuse 之类的选项，剩下的就是位置参数
while [ $# -gt 0 ]; do
  case "$1" in
    --cfg-block)
      shift
      [ $# -gt 0 ] && shift
      ;;
    --yes|-y|--no-specialuse)
      shift
      ;;
    *)
      break
      ;;
  esac
done

address="${1:-}"

case "$group:$sub" in
  creds:list)
    if [ "${FAKE_MADDY_FAIL_LIST:-0}" = "1" ]; then
      echo "${FAKE_MADDY_FAIL_DETAIL:-forced account list failure}" >&2
      exit 1
    fi
    cut -d'|' -f1 "$STATE/credentials"
    ;;
  creds:create)
    [ -n "$address" ] || { echo "missing username" >&2; exit 2; }
    if grep -q "^${address}|" "$STATE/credentials"; then
      echo "user already exists" >&2
      exit 1
    fi
    IFS= read -r password || password=""
    if [ "${FAKE_MADDY_FAIL_CREDS_CREATE:-0}" = "1" ]; then
      echo "${FAKE_MADDY_FAIL_DETAIL:-forced credential creation failure}" >&2
      exit 1
    fi
    printf '%s|%s\n' "$address" "$password" >> "$STATE/credentials"
    ;;
  creds:password)
    [ -n "$address" ] || { echo "missing username" >&2; exit 2; }
    grep -q "^${address}|" "$STATE/credentials" || { echo "user does not exist" >&2; exit 1; }
    IFS= read -r password || password=""
    awk -F'|' -v OFS='|' -v addr="$address" -v pw="$password" \
      '{ if ($1 == addr) { print addr, pw } else { print } }' \
      "$STATE/credentials" > "$STATE/credentials.next"
    mv "$STATE/credentials.next" "$STATE/credentials"
    if [ "${FAKE_MADDY_FAIL_PASSWORD_AFTER_WRITE:-0}" = "1" ]; then
      echo "${FAKE_MADDY_FAIL_DETAIL:-forced password result failure}" >&2
      exit 1
    fi
    ;;
  creds:remove)
    if [ "${FAKE_MADDY_FAIL_CREDS_REMOVE:-0}" = "1" ]; then
      echo "${FAKE_MADDY_FAIL_DETAIL:-forced credential removal failure}" >&2
      exit 1
    fi
    # 真实 maddy 这里会问 "Are you sure? [y/N]"，没有 --yes 开关
    IFS= read -r confirmation || confirmation=""
    case "$confirmation" in
      y|Y|yes|YES) ;;
      *)
        echo 'app.Run failed	{"reason":"cancelled"}' >&2
        exit 0
        ;;
    esac
    awk -F'|' -v OFS='|' -v addr="$address" \
      '{ if ($1 != addr) { print } }' \
      "$STATE/credentials" > "$STATE/credentials.next"
    mv "$STATE/credentials.next" "$STATE/credentials"
    ;;
  imap-acct:list)
    if [ "${FAKE_MADDY_FAIL_LIST:-0}" = "1" ]; then
      echo "${FAKE_MADDY_FAIL_DETAIL:-forced account list failure}" >&2
      exit 1
    fi
    cat "$STATE/accounts"
    ;;
  imap-acct:create)
    if [ "${FAKE_MADDY_FAIL_IMAP_CREATE:-0}" = "1" ]; then
      echo "${FAKE_MADDY_FAIL_DETAIL:-forced mailbox creation failure}" >&2
      exit 1
    fi
    [ -n "$address" ] || { echo "missing username" >&2; exit 2; }
    grep -qx "$address" "$STATE/accounts" || printf '%s\n' "$address" >> "$STATE/accounts"
    ;;
  imap-acct:remove)
    if [ "${FAKE_MADDY_FAIL_IMAP_REMOVE:-0}" = "1" ]; then
      echo "${FAKE_MADDY_FAIL_DETAIL:-forced mailbox removal failure}" >&2
      exit 1
    fi
    awk -v addr="$address" '{ if ($0 != addr) { print } }' "$STATE/accounts" > "$STATE/accounts.next"
    mv "$STATE/accounts.next" "$STATE/accounts"
    ;;
  *)
    echo "fake-maddy: 不支持的子命令 $group $sub" >&2
    exit 64
    ;;
esac
