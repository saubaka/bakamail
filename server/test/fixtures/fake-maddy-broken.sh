#!/bin/sh
# 复现一个真实踩过的坑：maddy 配置解析失败时，
# 它会往 stderr 打 app.Run failed，但退出码仍然是 0。
echo 'app.Run failed	{"reason":"/data/maddy.conf:98: invalid source routing rule: "}' >&2
exit 0
