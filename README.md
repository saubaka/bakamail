# BakaMail

BakaMail 是为自托管 Maddy 邮局开发的 Web 邮箱，提供日常收发邮件和独立管理后台。桌面端采用可折叠侧栏，移动端使用底部导航，页面切换不需要整页刷新。

它不是独立邮件服务器。投递、IMAP、SMTP、域名签名和邮箱存储由 Maddy 负责；BakaMail 负责网页界面、应用会话、邀请注册和管理功能。

## 功能

- 邀请制注册、账号密码登录、密码重置、验证码及分层防爆破。
- 邮件列表、搜索、正文安全净化、受控媒体加载、回复/转发/写信、附件、文件夹及草稿。
- 联系人、偏好设置、本地摘要缓存和邮件同步。
- 桌面可折叠侧栏、移动胶囊导航、SPA 面板切换、浅色实线主题和减少动画支持。
- 独立管理员入口 `/bakaadmin`：账号、邀请、安全审计、邮件运维、管理员权限、站点及通知设置。
- 五类胶囊通知的动画与显示时间可分别配置。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 前端 | Vue 3、TypeScript、Vite、Pinia、Vue Router |
| 后端 | Node.js 24+、Express 5、TypeScript 源码直接运行 |
| 应用数据 | Node 内置 `node:sqlite`、SQLite WAL 模式 |
| 邮件访问 | ImapFlow、Nodemailer、Mailparser |
| 邮局 | Maddy；容器内 CLI 固定来自 `foxcpp/maddy:0.9.5` |
| 安全 | Node 内置 scrypt、独立会话、CSRF、一次性验证码、请求预算 |
| 部署 | Docker Compose、Nginx/OpenResty 或 1Panel 反向代理 |
| 测试 | Node Test Runner、Supertest、TypeScript 与 Vue 类型检查 |

浏览器只调用本站 `/api/*`，BFF 在服务端与 Maddy 通信。SQLite 保存应用管理数据、会话、草稿、联系人和设置，邮件本身保存在 Maddy 数据卷中。

## 目录结构

```text
server/src/        后端、认证、邮件操作和管理接口
server/test/       后端测试与模拟邮局
web/src/           Vue 页面、组件、状态和样式
web/test/          前端测试与隔离验收夹具
shared/            前后端共享路径和通知配置
deploy/            Docker、环境示例和日志采集
scripts/           启动、同步、验证和维护工具
CHANGELOG.md       版本变更记录
```

## 本地启动

需要 Node.js 24+ 和 npm。本目录只包含源码、测试、配置示例及依赖锁文件，没有已安装依赖、数据库或真实环境配置。主题 CSS 是运行所需的源样式，不是 `node_modules`。

```sh
git clone https://github.com/saubaka/bakamail.git
cd bakamail
npm ci
cp .env.example .env
```

编辑根目录 `.env`。本地 HTTP 可以参考以下设置，其他字段按 `.env.example` 配置：

```dotenv
HOST=127.0.0.1
PORT=8790
COOKIE_SECURE=0
TRUST_LOOPBACK_PROXY=0
TRUSTED_PROXY_IPS=
PUBLIC_ORIGIN=
MAIL_HOST=mail.example.com
MAIL_HOSTNAME=mail.example.com
MAIL_DOMAIN=example.com
MAIL_TLS_REJECT_UNAUTHORIZED=true
MADDY_RUNNER=disabled
HUMAN_CHECK_TEST_MODE=0
BOOTSTRAP_ADMIN=admin
BOOTSTRAP_ADMIN_PASSWORD=填写自己的管理员密码
SECRET_KEY=填写独立生成的随机密钥
```

使用 `openssl rand -base64 48` 生成密钥，替换示例值。管理员只在数据库中没有管理员时创建；修改引导变量不会重置已有管理员密码。不要提交 `.env` 或真实密码。

`MADDY_RUNNER=disabled` 适合没有 Maddy CLI 的本地开发，账号创建、邀请注册和邮箱密码重置不可用；现有邮箱收发仍需配置可连接、证书有效的邮局。

```sh
node scripts/start-local.mjs --no-open
```

脚本检查端口、构建前端并启动后端。macOS 也可以双击 `启动BakaMail.command`。访问 `http://127.0.0.1:8790/`，管理员入口为 `/bakaadmin`，按 Control+C 停止。详细说明见 [本地启动说明](本地启动说明.md)。

手动启动也可使用 `npm run build` 然后 `npm start`。开发时，在两个终端分别运行 `npm run dev:server` 和 `npm run dev:web`。Vite 默认端口 5190，`/api` 代理到本地 8790。

## Docker 部署到已有 Maddy 邮局

仓库的 Compose 文件对接已有 Maddy 和 1Panel 网络，不会自动创建完整邮局。先确认：

- Maddy 已正常运行，域名、投递和 IMAP/SMTP 证书已配置好。
- Maddy 版本与镜像内的 CLI 兼容；当前 Dockerfile 使用 0.9.5。
- 邮局与 BakaMail 在同一 Docker 网络中，应用可通过网络别名连接邮局。
- Maddy 数据卷包含实际配置、凭据库和邮箱存储，应用 CLI 有适当的读写权限。
- 邮局已独立配置 MX、SPF、DKIM、DMARC 及所需端口。网页反向代理不能替代邮件配置。

### 1. 配置环境文件

```sh
git clone https://github.com/saubaka/bakamail.git
cd bakamail
cp deploy/bakamail.env.example deploy/bakamail.env
chmod 600 deploy/bakamail.env
```

修改 `deploy/bakamail.env`：

- `SECRET_KEY`：独立随机密钥，后续更新和重启保持不变。
- `MAIL_DOMAIN`：实际邮箱域名，例如 `example.com`。
- `PUBLIC_ORIGIN`：实际 HTTPS 网页地址，例如 `https://mail.example.com`，末尾不要加斜线。
- `BOOTSTRAP_ADMIN`、`BOOTSTRAP_ADMIN_PASSWORD`：新安装的管理员与强密码。
- 生产保持 `COOKIE_SECURE=1`、`HUMAN_CHECK_TEST_MODE=0`。
- `TRUSTED_PROXY_IPS`：核验后端实际收到的代理来源，填写精确 IP，不照抄网关或信任整段内网。

### 2. 调整 Compose

编辑 `deploy/docker-compose.yml`：

- `MAIL_HOST` 改成实际 Maddy 网络别名，`MAIL_HOSTNAME` 改成证书覆盖的主机名，两者可以不同。
- 顶层外部网络 `1panel-network` 和服务的 `networks` 改成实际网络。
- 外部卷 `maddydata` 改成实际 Maddy 数据卷，保持挂载到 `/data`。
- 核对 TLS 端口，默认 IMAP 993、SMTP 465。
- 核对日志快照的主机目录和只读挂载。

Compose 的 `environment` 优先于 `env_file`，例如只改环境文件不能覆盖 Compose 中的 `MAIL_HOSTNAME`。原文件的域名、容器、卷和路径属于既有部署示例，不要原样用于其他主机。

### 3. 配置日志采集

应用不挂 Docker socket。后台通过只读快照查看邮局日志，由主机上的 Python 脚本采集。

先修改 `deploy/export-mail-logs.py` 的 `CONTAINER` 为实际 Maddy 容器名，确认脚本检查的镜像版本匹配。默认目录是 `/root/mail/bakamail-mail-logs`；修改目录时，Compose 和脚本也要同步。

默认路径下，以 root 执行：

```sh
install -d -m 700 /root/mail/bakamail-mail-logs
install -m 700 deploy/export-mail-logs.py /root/mail/export-bakamail-mail-logs.py
python3 /root/mail/export-bakamail-mail-logs.py
install -m 644 deploy/mail-log-export.cron /etc/cron.d/bakamail-mail-logs
```

需要 Python 3、Docker 命令和正常运行的 cron 服务。首次采集成功后再启动应用。Compose 不会自动创建快照目录，缺少目录会拒绝启动。不需要日志面板时，可移除只读日志挂载并清空 `MAIL_LOG_SNAPSHOT_PATH`，不影响邮件收发。

### 4. 构建与启动

```sh
docker compose -f deploy/docker-compose.yml config --quiet
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
curl --fail http://127.0.0.1:8790/api/health
```

前端在镜像内构建，由后端直接托管。端口仅绑定服务器回环地址 `127.0.0.1:8790`。健康检查通过说明应用已启动，仍需用专用测试邮箱验收真实登录和收发。

`scripts/deploy-green.mjs` 是特定服务器的维护脚本，不是通用安装入口；普通部署使用上述 Compose 流程。

### 5. HTTPS 反向代理

在 1Panel 新建反向代理网站，域名填写实际网页域名，上游设置为 `http://127.0.0.1:8790`，开启 HTTPS。可以在网站列表启停反代，而不停止邮局。

使用 Nginx/OpenResty 时，核心代理配置可参考：

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

证书与 `server_name` 由实际网站配置提供。如果代理也在容器内，`127.0.0.1` 指向代理容器，需要使用同网络应用地址作为上游。转发头应由可信代理覆盖，应用只信任核验过的来源。关闭代理缓冲用于邮件事件流。

首次登录 `/bakaadmin` 后，可以创建邮箱或签发邀请，再测试注册、登录和收发。网页管理员不是邮箱账号，两种会话独立。

## 更新与备份

更新前备份应用数据卷、Maddy 数据卷与环境配置。SQLite 使用 WAL，写入期间不要只复制单个 `.db`；应使用一致性备份，或停写后完整备份。保留旧镜像便于回退。

```sh
git pull --ff-only
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
```

不要使用 `docker compose down -v` 做常规更新，不要重新生成现有 `SECRET_KEY`。前端保留旧 hashed assets 支持在线标签；切换到全新镜像时如有旧标签，应将旧资源一并保留。

## 检查与测试

```sh
npm run typecheck
npm test
npm run test:bakagit
npm run build
npm run check
```

测试使用临时数据库和模拟邮局，不等于在你的服务器完成真实收发验收。生产不得开启验证码测试模式，也不要对真实用户做破坏性测试。

## 常见问题

- **网页正常，创建邮箱失败**：检查 runner、CLI 版本、共享卷与权限。本地 `disabled` 模式不会创建邮箱。
- **登录后仍回登录页**：本地 HTTP 使用 `COOKIE_SECURE=0`，生产使用 HTTPS 和 `COOKIE_SECURE=1`；核对域名、代理头和 `PUBLIC_ORIGIN`。
- **证书错误**：检查 `MAIL_HOSTNAME` 是否在证书内和证书链是否完整，不要关闭 TLS 校验掩盖错误。
- **后台日志不可用**：检查容器名、镜像版本、采集目录、cron 和只读挂载，不要挂 Docker socket。
- **8790 被占用**：检查已有服务，一键脚本不会结束其他进程。

## 版本与许可

版本记录见 [CHANGELOG.md](CHANGELOG.md)。提交标题使用版本号，说明使用简体中文条列。

当前尚未指定项目许可证。仓库公开不代表已授予开源许可；第三方软件遵循各自的许可。使用或再分发前，请与项目所有者确认授权。
