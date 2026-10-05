# Baka Mail

Baka Mail 是对接自托管 Maddy 邮局的 Web 邮箱。桌面端使用可折叠侧栏，移动端使用胶囊导航，页面切换不刷新浏览器。它不是独立邮件服务器：投递、IMAP、SMTP、域名签名和邮件存储由 Maddy 负责。

## 功能与架构

- 邀请制注册、账号密码登录、密码重置、验证码及分层防爆破。
- 邮件列表、搜索、安全正文、受控媒体、回复/转发/写信、附件、文件夹、草稿、联系人。
- 网页首次初始化：创建首位超级管理员、自定义后台页面入口。
- 独立管理员会话、权限、账号/邀请管理、审计、邮件运维与站点设置；后台入口之后仍可修改。
- 五类胶囊通知的动画与显示时长设置、减少动画、键盘操作与本地邮件摘要缓存。

Vue 3 + TypeScript + Vite + Pinia + Vue Router；后端 Node.js 24+、Express 5、Node 内置 SQLite WAL、scrypt。邮件访问使用 ImapFlow、Nodemailer、Mailparser。

浏览器仅调用本站 `/api/*`；BFF 在服务端连接 Maddy。管理员不是邮箱账号，创建管理员不会创建邮局邮箱。应用数据库保存管理数据、会话、草稿、联系人和设置，真实邮件留在 Maddy。

## 源码目录

```text
server/src/      服务端、认证、邮件、管理和初始化接口
server/test/     临时库与模拟邮局测试
web/src/         Vue 页面、组件、状态和主题
web/test/        前端测试与隔离夹具
shared/          路径与通知配置契约
deploy/          容器、环境示例、可选日志采集
scripts/         本地启动、检查、维护与源码同步
CHANGELOG.md     简体中文版本记录
```

仓库不包含依赖、数据库、真实环境、密钥、服务器私有发布脚本或用户邮件。配置示例中的域名均为占位符，请换成实际参数；不会绑定任何特定运营者的邮件域名。不要在开发目录的发布镜像内安装依赖，请克隆到独立工作目录运行。

## 本地启动与首次初始化

需要 Node.js 24+ 和 npm：

```sh
git clone https://github.com/saubaka/bakamail.git
cd bakamail
npm ci
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，使用 `openssl rand -base64 48` 生成独立 `SECRET_KEY`。本地 HTTP 保持 `COOKIE_SECURE=0`、`TRUST_LOOPBACK_PROXY=0`、`HUMAN_CHECK_TEST_MODE=0`。填写真实邮件域名、主机及 TLS 证书主机名，不要复制示例域名作为真实投递域名。

```sh
node scripts/start-local.mjs --no-open
```

macOS 也可双击 `启动BakaMail.command`。访问 `http://127.0.0.1:8790/`；空数据库会进入初始化页。服务端会生成权限为 600 的 `DATA_DIR/setup.key`，从终端读取后在初始化页填写：

```sh
# 使用默认 DATA_DIR=./data 时
cat data/setup.key
```

填写首位管理员账号名、强密码与自己的后台路径，完成后保存地址为书签并正常登录。初始化密钥不会在网页/API/日志中公开；成功后失效并删除，初始化不能重复执行。已有安装不会进入初始化，也不会更改已有账号、密码、权限、邮件或当前入口。不要删除数据库来找回后台；管理员入口可在“系统设置 → 自定义管理员路径”中修改。

后台路径必须为单层小写路径，不能与登录、邮箱、接口、初始化等现有页面冲突。修改后旧页面地址停用，管理 API 命名空间和会话不变；其他管理员保存冲突需重新读取。路径不是安全凭据，不能替代验证码、权限或防爆破。

按 Control+C 停止；`--check` 仅检查环境和端口。手动启动为 `npm run build` 后 `npm start`。开发可分别运行 `npm run dev:server` 和 `npm run dev:web`，Vite 5190 代理本机 BFF 8790。详见 [本地启动说明](本地启动说明.md)。

## 本地连接 Maddy 的两种方式

先按 [Maddy 官方安装教程](https://maddy.email/tutorials/setting-up/) 配置邮局和 TLS。IMAP 与认证凭据分开管理，新邮箱需同时具备这两部分；本项目默认 CLI 适配标准配置块 `local_authdb` 与 `local_mailboxes`，自定义 Maddy 配置必须保留这些配置块或调整服务端适配。

### 方式一：本机 BFF 连接已经运行的邮局

同一台机器运行 Maddy 时，配置例如：

```dotenv
MAIL_HOST=127.0.0.1
MAIL_HOSTNAME=mail.example.com
MAIL_DOMAIN=example.com
MAIL_IMAP_PORT=993
MAIL_SMTP_PORT=465
MAIL_TLS_REJECT_UNAUTHORIZED=true
MADDY_RUNNER=local
MADDY_BIN=/usr/local/bin/maddy
MADDY_DATA_DIR=/var/lib/maddy
```

示例主机名需换成证书覆盖的真实名字。连接地址 `MAIL_HOST` 和 TLS 主机名 `MAIL_HOSTNAME` 可以不同；本项目 IMAP 使用隐式 TLS，请选对应监听端口，不要把普通 143 端口直接填成 TLS 端口。

Maddy CLI 必须与运行中的邮局版本、配置及数据目录一致，运行 BFF 的系统用户需要适当权限。先在相同用户身份下检查：

```sh
maddy creds list --cfg-block local_authdb
maddy imap-acct list --cfg-block local_mailboxes
```

没有本地 CLI 时使用 `MADDY_RUNNER=disabled`：可以连接已有邮箱进行收发，但无法通过网页创建邮箱、邀请注册或重置邮箱密码。一键脚本会保留你在环境中选择的 runner，不再强制覆盖为 disabled。

如果邮局在本机 Docker 中而 BFF 在宿主机，Maddy 的 993/465 必须已正确发布到回环地址。可用 `MADDY_RUNNER=docker-exec`、`MADDY_CONTAINER=实际容器名`，由宿主机 Docker CLI 调用现有容器；仅适用于受信任的本机管理员环境。不把 Docker socket 挂入网页容器。

### 方式二：BFF 与已有 Maddy 在同一 Docker 网络

推荐服务器使用此方式。Compose 不创建完整邮件服务器；Maddy 需先运行并配置好域名、证书、IMAP/Submission 及投递。当前应用镜像内的 CLI 固定为 `foxcpp/maddy:0.9.5`，请与邮局版本保持一致。

根据 [Maddy 官方 Docker 文档](https://maddy.email/docker/)，其配置和邮件状态位于 `/data`，标准容器配置使用 `MADDY_HOSTNAME`、`MADDY_DOMAIN`，证书位于该数据目录的 TLS 子目录。不要创建一个空卷冒充已有邮局卷。

```sh
cp deploy/bakamail.env.example deploy/bakamail.env
chmod 600 deploy/bakamail.env
# 只读确认实际容器网络与卷，不输出真实密码
docker inspect maddy --format '{{json .NetworkSettings.Networks}}'
docker inspect maddy --format '{{range .Mounts}}{{.Name}} {{.Destination}}{{println}}{{end}}'
```

编辑 `deploy/bakamail.env`：

- `SECRET_KEY`：独立固定密钥，更新与重启不得重新生成。
- `MAIL_DOMAIN`、`MAIL_HOSTNAME`：实际邮件域名和证书主机名。
- `MAIL_HOST`：与 BFF 同网络的 Maddy 服务名或别名。
- `MADDY_NETWORK`、`MADDY_VOLUME`：上面核验的外部网络与数据卷名。
- `PUBLIC_ORIGIN`：网页的真实 HTTPS 地址，末尾无斜线。
- `TRUSTED_PROXY_IPS`：只有核验过的精确代理来源，不照抄网关或信任整段内网。
- 生产保持 `COOKIE_SECURE=1`、`HUMAN_CHECK_TEST_MODE=0`。

Compose 只固定应用监听和容器内数据目录，不覆盖环境中的邮件域名/主机/端口。以下命令必须带 `--env-file`，否则 Compose 不会从服务 `env_file` 自动读取网络/卷等插值：

```sh
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml config --quiet
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml ps
curl --fail http://127.0.0.1:8790/api/health
# 仅新安装需要读取；不要把输出粘贴到公开日志
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml exec bakamail cat /app/data/setup.key
```

前端在镜像内构建，由 BFF 托管，8790 仅发布在宿主机回环。为实际网页域名设置 HTTPS 反向代理后，从根地址完成首次初始化。健康检查只证明应用启动，不代表真实邮局收发已验证。

无需网页创建时，也可按官方教程手动建立独立测试邮箱，密码通过交互输入：

```sh
docker exec -it maddy maddy creds create qa@example.com
docker exec -it maddy maddy imap-acct create qa@example.com
```

命令中的容器名与地址需替换为自己的。不要用真实用户邮箱做破坏性测试。真实外网投递还需 MX、SPF、DKIM、DMARC、PTR、证书和端口配置；网页反向代理不能代替邮局配置。

## 可选日志采集

网页容器不挂 Docker socket。后台通过只读 JSON 快照读取脱敏日志。主机脚本 `deploy/export-mail-logs.py` 接受 `MADDY_CONTAINER`、`MAIL_LOG_DIRECTORY` 环境变量；容器镜像身份需与脚本固定的 0.9.5 一致。

默认主机目录为 `/root/mail/bakamail-mail-logs`，使用 root 创建为 700；安装脚本为 `/root/mail/export-bakamail-mail-logs.py`、权限 700。修改 cron 的容器和目录参数后安装到 `/etc/cron.d/`。先运行脚本确认快照生成，再把应用环境的 `MAIL_LOG_DIRECTORY` 设为该目录、`MAIL_LOG_SNAPSHOT_PATH=/mail-logs/maddy.json`。

未部署采集器时保持快照路径为空；默认空目录挂载不表示日志就绪，不影响邮件收发。需要 Python 3、Docker CLI 和 cron。读取失败保留上次快照，不伪报空日志。

## HTTPS 反向代理

1Panel 可以新建反向代理网站并从网站列表启停。宿主机上游为 `http://127.0.0.1:8790`。Nginx/OpenResty 核心配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:8790;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    client_max_body_size 40m;
}
```

证书与 server_name 由实际网站配置提供。如果代理在容器内，回环指向代理自己，应选同网络应用地址。转发头由可信代理覆盖，只信任已核验来源。

## 更新、安全与验收

更新前备份应用数据、Maddy 数据和真实环境。SQLite 正在写入 WAL 时不能只复制单个数据库；用一致性备份或停写备份。保留旧镜像和旧 hashed assets，不强制刷新正在使用的网页。

```sh
git pull --ff-only
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
npm run typecheck
npm test
npm run test:bakagit
npm run build
BAKAMAIL_PINNED_VENDOR=1 npm run check
```

不要用 `docker compose down -v` 更新或重置初始化；不要把真实环境、密码、setup.key、数据库、备份或邮件提交 Git。自动化测试使用临时库和模拟邮局，不等于在用户服务器完成真实收发验收。后台入口变更不会降低管理员登录的验证码、防爆破、CSRF 和权限校验。

常见问题：

- 创建/重置邮箱失败：核对 runner、CLI 版本、配置块、数据卷和权限。
- 本地登录后又退出：HTTP 使用非 Secure Cookie；生产必须 HTTPS 和 Secure Cookie。
- 证书错误：核对 MAIL_HOSTNAME 和证书链，不关闭验证来掩盖故障。
- 后台地址找不到：使用初始化或设置时保存的书签；普通登录页不公开后台链接。
- 8790 被占用：先核对已有服务，一键脚本不会结束别人的进程。
- 新安装只显示初始化：读取服务端 setup.key；已有数据库应保持不变，不复用他人的管理员凭据。

## 版本与许可

变更见 [CHANGELOG.md](CHANGELOG.md)。

公开仓库不代表已授予开源许可；第三方软件遵循各自许可。
