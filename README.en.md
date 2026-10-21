<p align="center">
  <img src="web/public/logo.svg" width="96" height="96" alt="Baka Mail" />
</p>

<h1 align="center">Baka Mail</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b> · <a href="README.ja.md">日本語</a>
</p>

Baka Mail is a webmail client and admin console for a self-hosted [Maddy](https://maddy.email/) mail server. Users send and receive mail in the browser; administrators manage accounts, invitation codes and security policies from the console.

It is not a mail server. Delivery, IMAP, SMTP, domain signing and storage are still handled by Maddy. Baka Mail is only a web layer in front of it: the browser talks to this site's `/api/*` only, and the server connects to Maddy.

## Features

**Mailbox**

- Message list, search, reading, reply, forward, compose, attachments, drafts, folders and contacts
- Message bodies are rendered in an isolated sandbox; external images are blocked by default
- New-mail alerts are pushed from the server and fall back to polling when the push connection drops
- Sidebar on desktop and capsule navigation on mobile; reduced-motion and keyboard support

**Accounts and security**

- Invitation-only sign-up, password reset, and admin-initiated mailbox password reset
- Login, sign-up and password reset all have an image captcha, rate limits and per-source cool-downs; Cloudflare Turnstile is optional
- Admins and mailbox accounts are independent: creating an admin does not create a mailbox
- Admin login always uses the built-in captcha; optional TOTP two-step verification with recovery codes
- Write operations are protected by CSRF and same-origin checks, and admin actions are audited

**Admin console**

- Mailbox accounts, invitation codes, admins and role permissions
- Operations pages: redacted mail logs, outbound queue, certificate check
- Site settings: security policies, human verification, notification motion
- SEO management: site name, home page title and description, keywords, canonical URL, sitemap, share card and webmaster verification, with a score and suggestions
- The admin entry path is chosen by you during first-time setup and can be changed later

## Tech stack

Frontend: Vue 3, TypeScript, Vite, Pinia, Vue Router.
Backend: Node.js 24+, Express 5, Node's built-in SQLite, scrypt.
Mail: ImapFlow, Nodemailer, Mailparser.

The app's own database stores only admins, sessions, invitation codes, drafts, contacts and settings. The mail itself stays in Maddy.

## Directory layout

```text
server/src/    Server: authentication, mail, admin APIs, setup
server/test/   Server tests (use a temporary database and mocked Maddy commands)
web/src/       Frontend pages, components, state and styles
web/test/      Frontend tests
shared/        Conventions shared by frontend and backend
deploy/        Dockerfile, Compose file, example environment, optional log collection
scripts/       Local start, check and maintenance scripts
```

## Deployment

You need a Maddy server that already sends and receives mail, a domain pointing at the web app, and an HTTPS certificate. Every `example.com` in the examples is a placeholder; replace it with your own.

Baka Mail creates and deletes mailboxes through Maddy's own command line, using the `local_authdb` and `local_mailboxes` configuration blocks of the standard configuration by default. If your configuration renames them, the server adapter must be adjusted to match. For installing Maddy and configuring TLS, see the [official tutorial](https://maddy.email/tutorials/setting-up/).

### Deploy with Docker Compose

This is the recommended way. The app container and Maddy share a Docker network, and the image ships a command line matching Maddy 0.9.5, so the Docker socket does not need to be mounted. The command line in the image must match the Maddy version you run.

1. Prepare the configuration file:

   ```sh
   git clone https://github.com/saubaka/bakamail.git
   cd bakamail
   cp deploy/bakamail.env.example deploy/bakamail.env
   chmod 600 deploy/bakamail.env
   ```

2. Look up the network and data volume of the Maddy container:

   ```sh
   docker inspect maddy --format '{{json .NetworkSettings.Networks}}'
   docker inspect maddy --format '{{range .Mounts}}{{.Name}} {{.Destination}}{{println}}{{end}}'
   ```

3. Edit `deploy/bakamail.env`. At least change these:

   | Variable | Description |
   | --- | --- |
   | `SECRET_KEY` | Signing key; generate with `openssl rand -base64 48`. Keep it fixed and do not regenerate it on restart or update |
   | `MAIL_DOMAIN` | Domain of the mailbox addresses, e.g. `example.com` |
   | `MAIL_HOSTNAME` | Host name covered by Maddy's certificate, e.g. `mail.example.com` |
   | `MAIL_HOST` | Service name of Maddy on the same network |
   | `MADDY_NETWORK`, `MADDY_VOLUME` | Network name and data volume name found in the previous step |
   | `PUBLIC_ORIGIN` | HTTPS address of the web app, without a trailing slash |
   | `TRUSTED_PROXY_IPS` | Exact IP of the reverse proxy; only list addresses you have verified |

   In production keep `COOKIE_SECURE=1` and `HUMAN_CHECK_TEST_MODE=0`.

4. Build and start. Every command below needs `--env-file`:

   ```sh
   docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
   curl --fail http://127.0.0.1:8790/api/health
   ```

   The app listens only on `127.0.0.1:8790` of the host; public access goes through a reverse proxy.

5. Configure the HTTPS reverse proxy, then open your domain and complete [first-time setup](#first-time-setup).

### Reverse proxy

Nginx or OpenResty on the host (including a reverse-proxy site created in 1Panel) can be configured like this:

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

`proxy_buffering off` and the long read timeout are for real-time new-mail push. The forwarding headers must be overwritten by this proxy itself; do not pass through values sent by the client.

### Error pages

Error pages returned by the app (404, 500 and so on) already share one style. When the backend is down, 502/503/504 are returned by the reverse proxy itself (behind a service such as Cloudflare, 502/504 are replaced by its own plain-text pages, so the example configuration returns them as 503). The static pages in `deploy/error-pages/` keep the same look: copy them to the server, put the contents of `openresty.conf.example` into the site configuration and fix the directory. Do not enable `proxy_intercept_errors`, or it will override the app's own error pages.

### First-time setup

A fresh database has no admin. After the service starts it creates a `setup.key` in the data directory that only you can read:

```sh
# Docker deployment
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml exec bakamail cat /app/data/setup.key

# Running locally (default data directory)
cat data/setup.key
```

Open the web page, enter this key, and set the account, password and admin page path of the first super admin. The key is invalidated immediately afterwards and setup cannot run again. Bookmark the admin path; you can change it later in "System settings".

The admin path must be a single lowercase segment and must not collide with existing pages such as login, mailbox or API. The path is only an entry, not a password; permissions, captcha, CSRF and rate limits still apply.

## Running locally

Requires Node.js 24 or newer.

```sh
git clone https://github.com/saubaka/bakamail.git
cd bakamail
npm ci
cp .env.example .env
chmod 600 .env
```

Edit `.env`: generate `SECRET_KEY` with `openssl rand -base64 48` and fill in your own `MAIL_DOMAIN`, `MAIL_HOST` and `MAIL_HOSTNAME`. Local use is plain HTTP, so keep `COOKIE_SECURE=0`, `TRUST_LOOPBACK_PROXY=0` and `HUMAN_CHECK_TEST_MODE=0`.

```sh
node scripts/start-local.mjs --no-open
```

The script checks the environment, builds the frontend and starts the service; then open `http://127.0.0.1:8790/`. On macOS you can also double-click `启动BakaMail.command`. Press Control+C to stop.

You can also run `npm run build` and then `npm start`. For development run `npm run dev:server` and `npm run dev:web` separately; the frontend runs on port 5190 and proxies to 8790 on the same machine. See the [local start guide](本地启动说明.md) (in Chinese) for more.

### How the local setup connects to Maddy

`MADDY_RUNNER` decides how account-management commands run:

| Value | Usage |
| --- | --- |
| `local` | Calls the local `maddy` command directly; set `MADDY_BIN` and `MADDY_DATA_DIR`, and the user running the service must be able to read and write Maddy's data |
| `docker-exec` | Calls an existing Maddy container through the host's Docker command; set `MADDY_CONTAINER`; only for a local environment you fully trust |
| `disabled` | No account management. You can sign in to existing mailboxes and send and receive mail, but cannot create mailboxes, invite sign-ups or reset mailbox passwords from the web |

Maddy usually listens on 993 (IMAP, implicit TLS) and 465 (submission, implicit TLS); set `MAIL_IMAP_PORT` and `MAIL_SMTP_PORT` to your actual ports. `MAIL_HOST` is the address to connect to and `MAIL_HOSTNAME` is the name in the certificate; they may differ. Do not turn off certificate verification.

You can first confirm that the command line works with the same system user:

```sh
maddy creds list --cfg-block local_authdb
maddy imap-acct list --cfg-block local_mailboxes
```

## Optional features

### Cloudflare Turnstile

The built-in image captcha is used by default and depends on no external service. To switch to Turnstile:

1. Add a site for your domain on Cloudflare's Turnstile page and get the site key and secret key.
2. In the console under "Security → Human verification", enter both keys and complete one real verification; only then can it be enabled.
3. Mailbox login, sign-up and password-reset requests can be enabled separately.

Admin login is not affected by this setting, so a wrong key cannot lock you out of the console. The secret key is stored encrypted and is never returned by the page or the API. Cloudflare's published test keys let anyone pass and are only suitable for trying the flow.

### Mail logs

The console's mail log reads a read-only JSON snapshot, so the app container never touches the Docker socket. `deploy/export-mail-logs.py` on the host exports the recent redacted log on a schedule; an example cron job is in `deploy/mail-log-export.cron`. Mount the snapshot directory into the container and set `MAIL_LOG_DIRECTORY` and `MAIL_LOG_SNAPSHOT_PATH`. Without the collector, sending and receiving mail are unaffected; the console just cannot show the mail log.

## Site name and SEO

In the console's "SEO management" you can change the site name to your own (for example "Acme Mail"); the browser title and the names on the home, login and mailbox pages change together. The open-source repository link and copyright mark at the bottom of the pages are fixed and are not affected by the settings.

The home page's title, description, canonical URL, share card and structured data are written into the page by the server, so crawlers that do not run scripts can read them. Login, sign-up, mailbox and console pages are never indexed. When the canonical URL is empty, the environment variable `PUBLIC_ORIGIN` is used; if neither is set, the canonical link, share image and sitemap cannot be generated and the score in the page says so. `/robots.txt` only disallows the API and never reveals the admin path; `/sitemap.xml` contains only the home page.

## Updating and backups

Before updating, back up the app data volume, Maddy's data and the environment file. SQLite cannot be backed up by copying a single database file while it is being written; use a consistent backup or stop writes first.

```sh
git pull --ff-only
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
```

Do not update with `docker compose down -v`; it deletes the data volumes. An update restarts the service, so mailbox sessions held in process memory are lost and users must sign in again.

## Development

```sh
npm run typecheck   # type-check server and frontend
npm test            # all tests
npm run build       # production frontend build
BAKAMAIL_PINNED_VENDOR=1 npm run check   # style contract and protocol-leak checks
```

Tests use a temporary database and mocked Maddy commands and never connect to a real mail server. When a test needs to make HTTP requests, use `server/test/support/loopback-request.ts` and do not import supertest directly.

Conventions to follow when changing code:

- The browser only requests this site's `/api/*`; the frontend build must not contain the mail server's host name or ports.
- Do not edit the style snapshots under `web/src/styles/vendor/`; write new styles in the incremental style files.
- Treat all mail HTML as untrusted and do not loosen the sandbox.
- Keep the confirmation dialog for destructive operations.

## FAQ

- **Creating or resetting a mailbox fails**: check `MADDY_RUNNER`, the command-line version, the configuration block names, the data volume and file permissions.
- **Signed out right after local login**: local HTTP needs `COOKIE_SECURE=0`; production must use HTTPS and secure cookies.
- **Certificate errors**: check `MAIL_HOSTNAME` and the certificate chain; do not turn off certificate verification.
- **Cannot find the admin address**: use the bookmark saved during setup or when you changed it. The normal login page does not show the admin entry.
- **Port 8790 is in use**: first find out what is using it; the start script will not end other processes.
- **A new install only shows the setup page**: read `setup.key` and complete setup; an existing database is never re-initialized.

Actually sending and receiving mail on the public internet also needs correct MX, SPF, DKIM, DMARC and PTR records and open ports. Those belong to Maddy and DNS configuration, and a web reverse proxy cannot replace them.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) (in Chinese).

## License

This project is released under the [MIT License](LICENSE). Third-party dependencies follow their own licenses.
