<p align="center">
  <img src="web/public/logo.svg" width="96" height="96" alt="Baka Mail" />
</p>

<h1 align="center">Baka Mail</h1>

Baka Mail 是给自建 [Maddy](https://maddy.email/) 邮局用的网页邮箱和管理后台。用户在浏览器里收发邮件，管理员在后台管理账号、邀请码和安全策略。

它不是邮件服务器。邮件的投递、IMAP、SMTP、域名签名和存储仍由 Maddy 负责，Baka Mail 只是它前面的一层网页：浏览器只访问本站的 `/api/*`，由服务端去连接 Maddy。

## 功能

**邮箱**

- 邮件列表、搜索、阅读、回复、转发、写信、附件、草稿、文件夹和联系人
- 邮件正文在隔离的沙箱里显示，外部图片默认拦截
- 新邮件通过服务端推送提醒，推送中断时自动改为轮询
- 桌面端侧栏、移动端胶囊导航；支持减少动画和键盘操作

**账号与安全**

- 邀请制注册、密码重置、管理员代为重置邮箱密码
- 登录、注册、重置密码都有图片验证码、限流和来源冷却；可选接入 Cloudflare Turnstile
- 管理员与邮箱账号相互独立：创建管理员不会创建邮箱
- 管理员登录始终使用内置验证码，可选 TOTP 二步验证和恢复码
- 写操作有 CSRF 和同源校验，管理操作留有审计记录

**管理后台**

- 邮箱账号、邀请码、管理员和角色权限
- 邮局日志（脱敏）、出站队列、证书检查等运维页面
- 安全策略、人机验证、通知动画等站点设置
- SEO 管理：站点名称、首页标题和描述、关键词、规范网址、站点地图、分享卡片、站长平台验证，并给出达标评分和修改建议
- 后台入口路径由你在首次初始化时自己选择，之后可以修改

## 技术栈

前端：Vue 3、TypeScript、Vite、Pinia、Vue Router。
后端：Node.js 24+、Express 5、Node 内置 SQLite、scrypt。
邮件：ImapFlow、Nodemailer、Mailparser。

应用自己的数据库只保存管理员、会话、邀请码、草稿、联系人和设置。邮件本身留在 Maddy 里。

## 目录结构

```text
server/src/    服务端：认证、邮件、管理接口、初始化
server/test/   服务端测试（使用临时数据库和模拟的 Maddy 命令）
web/src/       前端页面、组件、状态和样式
web/test/      前端测试
shared/        前后端共用的约定
deploy/        Dockerfile、Compose 文件、环境变量示例、可选的日志采集
scripts/       本地启动、检查和维护脚本
```

## 部署

部署前需要有一个已经能正常收发的 Maddy，以及一个指向网页的域名和 HTTPS 证书。配置示例里的 `example.com` 都是占位符，请换成你自己的。

Baka Mail 通过 Maddy 自带的命令行创建和删除邮箱，默认使用标准配置里的 `local_authdb` 和 `local_mailboxes` 两个配置块。如果你的配置改过这两个名字，需要同步调整服务端的适配。Maddy 的安装和 TLS 配置请看[官方教程](https://maddy.email/tutorials/setting-up/)。

### 用 Docker Compose 部署

这是推荐的方式。应用容器和 Maddy 在同一个 Docker 网络里，镜像内自带与 Maddy 0.9.5 对应的命令行，不需要挂载 Docker socket。镜像里的命令行版本需要和你运行的 Maddy 一致。

1. 准备配置文件：

   ```sh
   git clone https://github.com/saubaka/bakamail.git
   cd bakamail
   cp deploy/bakamail.env.example deploy/bakamail.env
   chmod 600 deploy/bakamail.env
   ```

2. 查看 Maddy 容器所在的网络和数据卷：

   ```sh
   docker inspect maddy --format '{{json .NetworkSettings.Networks}}'
   docker inspect maddy --format '{{range .Mounts}}{{.Name}} {{.Destination}}{{println}}{{end}}'
   ```

3. 编辑 `deploy/bakamail.env`，至少改这些：

   | 变量 | 说明 |
   | --- | --- |
   | `SECRET_KEY` | 签名密钥，用 `openssl rand -base64 48` 生成。固定不变，重启或更新时不要重新生成 |
   | `MAIL_DOMAIN` | 邮箱地址的域名，例如 `example.com` |
   | `MAIL_HOSTNAME` | Maddy 证书覆盖的主机名，例如 `mail.example.com` |
   | `MAIL_HOST` | 同一网络里 Maddy 的服务名 |
   | `MADDY_NETWORK`、`MADDY_VOLUME` | 上一步查到的网络名和数据卷名 |
   | `PUBLIC_ORIGIN` | 网页的 HTTPS 地址，末尾不带斜线 |
   | `TRUSTED_PROXY_IPS` | 反向代理的精确 IP，只填确认过的地址 |

   生产环境保持 `COOKIE_SECURE=1` 和 `HUMAN_CHECK_TEST_MODE=0`。

4. 构建并启动。下面的命令都需要带 `--env-file`：

   ```sh
   docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
   curl --fail http://127.0.0.1:8790/api/health
   ```

   应用只监听宿主机的 `127.0.0.1:8790`，对外访问通过反向代理。

5. 配置 HTTPS 反向代理，然后打开你的域名完成[首次初始化](#首次初始化)。

### 反向代理

宿主机上的 Nginx 或 OpenResty（包括 1Panel 里新建的反向代理网站）可以这样写：

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

`proxy_buffering off` 和较长的读超时是为了新邮件的实时推送。转发头必须由这台代理自己覆盖，不要原样转发客户端发来的值。

### 错误页面

应用返回的 404、500 等错误页已是统一风格。后端没起来时，502/503/504 由反向代理自己返回，可以用 `deploy/error-pages/` 里的静态页保持同样外观：把四个页面复制到服务器，把 `openresty.conf.example` 里的内容放进站点配置并改好目录即可。不要开启 `proxy_intercept_errors`，否则会盖掉应用自己的错误页。

### 首次初始化

全新的数据库没有任何管理员。服务启动后会在数据目录生成一个只有你能读的 `setup.key`：

```sh
# Docker 部署
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml exec bakamail cat /app/data/setup.key

# 本地运行（默认数据目录）
cat data/setup.key
```

打开网页，填入这个密钥，设置第一位超级管理员的账号、密码和后台页面路径。完成后密钥立即作废，初始化不能再次执行。后台路径请保存为书签，之后可以在“系统设置”里修改。

后台路径必须是单层小写路径，不能和登录、邮箱、接口等已有页面冲突。路径只是入口，不是密码；权限、验证码、CSRF 和限流照常生效。

## 本地运行

需要 Node.js 24 或更新版本。

```sh
git clone https://github.com/saubaka/bakamail.git
cd bakamail
npm ci
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：用 `openssl rand -base64 48` 生成 `SECRET_KEY`，填写自己的 `MAIL_DOMAIN`、`MAIL_HOST` 和 `MAIL_HOSTNAME`。本地用 HTTP，所以保留 `COOKIE_SECURE=0`、`TRUST_LOOPBACK_PROXY=0` 和 `HUMAN_CHECK_TEST_MODE=0`。

```sh
node scripts/start-local.mjs --no-open
```

脚本会检查环境、构建前端并启动服务，然后访问 `http://127.0.0.1:8790/`。macOS 上也可以双击 `启动BakaMail.command`。按 Control+C 停止。

也可以手动执行 `npm run build` 然后 `npm start`。开发时分别运行 `npm run dev:server` 和 `npm run dev:web`，前端在 5190 端口，会代理到本机的 8790。更多说明见[本地启动说明](本地启动说明.md)。

### 本地如何连接 Maddy

`MADDY_RUNNER` 决定账号管理命令怎么执行：

| 值 | 用法 |
| --- | --- |
| `local` | 直接调用本机的 `maddy` 命令，需要设置 `MADDY_BIN` 和 `MADDY_DATA_DIR`，并且运行服务的用户能读写 Maddy 的数据 |
| `docker-exec` | 通过宿主机的 Docker 命令调用已有的 Maddy 容器，需要设置 `MADDY_CONTAINER`；仅适合你完全信任的本机环境 |
| `disabled` | 不管理账号。可以登录已有邮箱收发邮件，但不能在网页里创建邮箱、邀请注册或重置邮箱密码 |

Maddy 通常监听在 993（IMAP，隐式 TLS）和 465（提交，隐式 TLS），请按你的实际端口填写 `MAIL_IMAP_PORT` 和 `MAIL_SMTP_PORT`。`MAIL_HOST` 是连接地址，`MAIL_HOSTNAME` 是证书里的名字，两者可以不同，证书校验不要关闭。

可以先用同一个系统用户确认命令行可用：

```sh
maddy creds list --cfg-block local_authdb
maddy imap-acct list --cfg-block local_mailboxes
```

## 可选功能

### Cloudflare Turnstile

默认使用内置的图片验证码，不依赖外部服务。想换成 Turnstile：

1. 在 Cloudflare 的 Turnstile 页面为你的域名添加站点，得到站点密钥和私有密钥。
2. 在后台“安全 → 人机验证”填入两个密钥并完成一次真实验证，通过后才能启用。
3. 邮箱登录、注册、申请重置密码可以分别开启。

管理员登录不受这项配置影响，所以密钥填错也不会让你进不了后台。私有密钥加密保存，页面和接口都不会返回。Cloudflare 公布的测试密钥会让任何人通过，只适合试流程。

### 邮局日志

后台的邮局日志读取的是一个只读的 JSON 快照，应用容器不接触 Docker socket。主机上的 `deploy/export-mail-logs.py` 按计划任务导出脱敏后的最近日志，示例计划任务在 `deploy/mail-log-export.cron`。把快照目录挂进容器，并设置 `MAIL_LOG_DIRECTORY` 和 `MAIL_LOG_SNAPSHOT_PATH` 即可。不部署采集器时，邮件收发不受影响，只是后台看不到邮局日志。

## 站点名称与 SEO

在后台“SEO 管理”里可以把站点名改成自己的（例如“某某邮箱”），浏览器标题、首页、登录页和邮箱页面里的名称会一起变化。页面底部的开源仓库链接和版权标记固定显示，不受设置影响。

首页的标题、描述、规范网址、分享卡片和结构化数据由服务器直接写进页面，不执行脚本的抓取工具也能读到。登录、注册、邮箱和后台页面一律不收录。规范网址留空时使用环境变量 `PUBLIC_ORIGIN`，两者都没有时，canonical、分享图片和站点地图都无法生成，页面里的评分会提示。`/robots.txt` 只禁止接口，不会写出后台路径；`/sitemap.xml` 只包含首页。

## 更新与备份

更新前先备份应用数据卷、Maddy 数据和环境文件。SQLite 在写入时不能只复制单个数据库文件，请使用一致性备份或停写后备份。

```sh
git pull --ff-only
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
```

不要用 `docker compose down -v` 来更新，它会删除数据卷。更新会重启服务，保存在进程内的邮箱会话会失效，用户需要重新登录。

## 开发

```sh
npm run typecheck   # 服务端和前端的类型检查
npm test            # 全部测试
npm run build       # 前端生产构建
BAKAMAIL_PINNED_VENDOR=1 npm run check   # 样式约定和协议泄漏检查
```

测试使用临时数据库和模拟的 Maddy 命令，不会连接真实邮局。需要在测试里发起 HTTP 请求时，请使用 `server/test/support/loopback-request.ts`，不要直接引入 supertest。

几条改动时需要遵守的约定：

- 浏览器只请求本站的 `/api/*`，前端产物里不能出现邮局的主机名或端口。
- `web/src/styles/vendor/` 下的样式快照不要直接修改，新样式写在增量样式文件里。
- 邮件 HTML 一律视为不可信，不要放宽沙箱。
- 破坏性操作保留确认对话框。

## 常见问题

- **创建或重置邮箱失败**：检查 `MADDY_RUNNER`、命令行版本、配置块名称、数据卷和文件权限。
- **本地登录后马上退出**：本地 HTTP 需要 `COOKIE_SECURE=0`；正式环境必须用 HTTPS 和安全 Cookie。
- **证书错误**：核对 `MAIL_HOSTNAME` 和证书链，不要关闭证书校验。
- **找不到后台地址**：使用初始化或修改时保存的书签。普通登录页不会显示后台入口。
- **8790 端口被占用**：先确认占用它的是什么，启动脚本不会结束别的进程。
- **新安装只看到初始化页**：读取 `setup.key` 完成初始化；已有数据库不会重新初始化。

真正对外收发邮件还需要正确的 MX、SPF、DKIM、DMARC、PTR 记录和开放的端口，这些属于 Maddy 和 DNS 的配置，网页反向代理无法代替。

## 版本记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

本项目以 [MIT 许可证](LICENSE) 发布。第三方依赖遵循各自的许可。
