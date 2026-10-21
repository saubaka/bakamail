<p align="center">
  <img src="web/public/logo.svg" width="96" height="96" alt="Baka Mail" />
</p>

<h1 align="center">Baka Mail</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <b>日本語</b>
</p>

Baka Mail は、自前運用の [Maddy](https://maddy.email/) メールサーバー向けのウェブメールと管理コンソールです。ユーザーはブラウザーでメールを送受信し、管理者はコンソールでアカウント、招待コード、セキュリティポリシーを管理します。

メールサーバーそのものではありません。配送、IMAP、SMTP、ドメイン署名、保存は引き続き Maddy が担当し、Baka Mail はその前段に置くウェブ層にすぎません。ブラウザーはこのサイトの `/api/*` にだけアクセスし、サーバー側が Maddy に接続します。

## 機能

**メールボックス**

- メール一覧、検索、閲覧、返信、転送、作成、添付ファイル、下書き、フォルダー、連絡先
- 本文は隔離されたサンドボックス内で表示され、外部画像は既定でブロックされます
- 新着メールはサーバープッシュで通知され、プッシュが途切れるとポーリングに自動で切り替わります
- デスクトップではサイドバー、モバイルではカプセル型ナビゲーション。動きの軽減とキーボード操作に対応

**アカウントとセキュリティ**

- 招待制の登録、パスワードのリセット、管理者によるメールボックスのパスワードリセット
- ログイン、登録、パスワードリセットのすべてに画像 CAPTCHA、レート制限、接続元ごとのクールダウンがあり、Cloudflare Turnstile も任意で利用できます
- 管理者とメールボックスのアカウントは独立しています。管理者を作ってもメールボックスは作られません
- 管理者ログインは常に組み込みの CAPTCHA を使い、任意で TOTP による二段階認証とリカバリーコードを使えます
- 書き込み操作には CSRF と同一オリジンの検証があり、管理操作は監査記録に残ります

**管理コンソール**

- メールボックスのアカウント、招待コード、管理者とロール権限
- 運用ページ：マスキング済みのメールログ、送信キュー、証明書チェック
- サイト設定：セキュリティポリシー、人間確認、通知のアニメーション
- SEO 管理：サイト名、トップページのタイトルと説明、キーワード、正規 URL、サイトマップ、シェアカード、ウェブマスター認証。スコアと改善案も表示されます
- 管理画面の入口パスは初回セットアップ時にご自身で決め、後から変更できます

## 技術スタック

フロントエンド：Vue 3、TypeScript、Vite、Pinia、Vue Router。
バックエンド：Node.js 24 以上、Express 5、Node 組み込みの SQLite、scrypt。
メール：ImapFlow、Nodemailer、Mailparser。

アプリ自身のデータベースに保存するのは、管理者、セッション、招待コード、下書き、連絡先、設定だけです。メール本体は Maddy に残ります。

## ディレクトリ構成

```text
server/src/    サーバー：認証、メール、管理 API、初期設定
server/test/   サーバーのテスト（一時データベースと模擬の Maddy コマンドを使用）
web/src/       フロントエンドのページ、コンポーネント、状態、スタイル
web/test/      フロントエンドのテスト
shared/        フロントエンドとバックエンドで共有する取り決め
deploy/        Dockerfile、Compose ファイル、環境変数の例、任意のログ収集
scripts/       ローカル起動、チェック、保守用のスクリプト
```

## デプロイ

事前に、すでに正常に送受信できる Maddy、ウェブに向けたドメイン、HTTPS 証明書が必要です。設定例の `example.com` はすべてプレースホルダーですので、ご自身のものに置き換えてください。

Baka Mail は Maddy 付属のコマンドラインでメールボックスを作成・削除します。既定では標準設定の `local_authdb` と `local_mailboxes` という 2 つの設定ブロックを使います。設定でこれらの名前を変えている場合は、サーバー側のアダプターも合わせて調整する必要があります。Maddy のインストールと TLS の設定は[公式チュートリアル](https://maddy.email/tutorials/setting-up/)を参照してください。

### Docker Compose でデプロイする

推奨の方法です。アプリのコンテナーと Maddy を同じ Docker ネットワークに置きます。イメージには Maddy 0.9.5 に対応するコマンドラインが同梱されているため、Docker ソケットをマウントする必要はありません。イメージ内のコマンドラインのバージョンは、実際に動かしている Maddy と一致している必要があります。

1. 設定ファイルを用意します：

   ```sh
   git clone https://github.com/saubaka/bakamail.git
   cd bakamail
   cp deploy/bakamail.env.example deploy/bakamail.env
   chmod 600 deploy/bakamail.env
   ```

2. Maddy コンテナーのネットワークとデータボリュームを確認します：

   ```sh
   docker inspect maddy --format '{{json .NetworkSettings.Networks}}'
   docker inspect maddy --format '{{range .Mounts}}{{.Name}} {{.Destination}}{{println}}{{end}}'
   ```

3. `deploy/bakamail.env` を編集します。少なくとも次の項目を変更してください：

   | 変数 | 説明 |
   | --- | --- |
   | `SECRET_KEY` | 署名用の鍵。`openssl rand -base64 48` で生成します。固定のままにし、再起動や更新のたびに作り直さないでください |
   | `MAIL_DOMAIN` | メールアドレスのドメイン（例：`example.com`） |
   | `MAIL_HOSTNAME` | Maddy の証明書がカバーするホスト名（例：`mail.example.com`） |
   | `MAIL_HOST` | 同じネットワーク内での Maddy のサービス名 |
   | `MADDY_NETWORK`、`MADDY_VOLUME` | 前の手順で確認したネットワーク名とデータボリューム名 |
   | `PUBLIC_ORIGIN` | ウェブの HTTPS アドレス（末尾にスラッシュを付けない） |
   | `TRUSTED_PROXY_IPS` | リバースプロキシの正確な IP。確認済みのアドレスだけを記入します |

   本番環境では `COOKIE_SECURE=1` と `HUMAN_CHECK_TEST_MODE=0` のままにしてください。

4. ビルドして起動します。以下のコマンドにはすべて `--env-file` が必要です：

   ```sh
   docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
   curl --fail http://127.0.0.1:8790/api/health
   ```

   アプリはホストの `127.0.0.1:8790` だけで待ち受け、外部からのアクセスはリバースプロキシを通します。

5. HTTPS のリバースプロキシを設定し、ドメインを開いて[初回セットアップ](#初回セットアップ)を完了します。

### リバースプロキシ

ホスト上の Nginx や OpenResty（1Panel で作成したリバースプロキシのサイトを含む）では、次のように書けます：

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

`proxy_buffering off` と長めの読み取りタイムアウトは、新着メールのリアルタイムプッシュのためです。転送ヘッダーはこのプロキシ自身が上書きする必要があり、クライアントから送られてきた値をそのまま転送してはいけません。

### エラーページ

アプリが返す 404、500 などのエラーページは、すでに同じスタイルに統一されています。バックエンドが起動していないとき、502/503/504 はリバースプロキシ自身が返します（Cloudflare のようなサービスの背後では 502/504 がそのサービスのプレーンテキストのページに置き換えられるため、設定例ではこれらを 503 として返します）。`deploy/error-pages/` の静的ページを使うと同じ見た目を保てます。静的ページをサーバーにコピーし、`openresty.conf.example` の内容をサイト設定に入れてディレクトリを直してください。`proxy_intercept_errors` は有効にしないでください。アプリ自身のエラーページが上書きされてしまいます。

### 初回セットアップ

新しいデータベースには管理者がいません。サービスの起動後、データディレクトリにあなただけが読める `setup.key` が生成されます：

```sh
# Docker でのデプロイ
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml exec bakamail cat /app/data/setup.key

# ローカル実行（既定のデータディレクトリ）
cat data/setup.key
```

ウェブページを開いてこの鍵を入力し、最初のスーパー管理者のアカウント、パスワード、管理ページのパスを設定します。完了すると鍵はただちに無効になり、セットアップを再実行することはできません。管理パスはブックマークに保存してください。後から「システム設定」で変更できます。

管理パスは小文字の 1 階層のパスで、ログイン、メールボックス、API などの既存ページと衝突してはいけません。パスは入口にすぎずパスワードではありません。権限、CAPTCHA、CSRF、レート制限は通常どおり機能します。

## ローカルで実行する

Node.js 24 以降が必要です。

```sh
git clone https://github.com/saubaka/bakamail.git
cd bakamail
npm ci
cp .env.example .env
chmod 600 .env
```

`.env` を編集します。`openssl rand -base64 48` で `SECRET_KEY` を生成し、ご自身の `MAIL_DOMAIN`、`MAIL_HOST`、`MAIL_HOSTNAME` を記入します。ローカルは HTTP なので、`COOKIE_SECURE=0`、`TRUST_LOOPBACK_PROXY=0`、`HUMAN_CHECK_TEST_MODE=0` のままにしてください。

```sh
node scripts/start-local.mjs --no-open
```

スクリプトが環境をチェックし、フロントエンドをビルドしてサービスを起動します。その後 `http://127.0.0.1:8790/` にアクセスしてください。macOS では `启动BakaMail.command` をダブルクリックしても起動できます。Control+C で停止します。

`npm run build` のあとに `npm start` を実行しても構いません。開発時は `npm run dev:server` と `npm run dev:web` を別々に実行します。フロントエンドは 5190 番ポートで動き、同じマシンの 8790 にプロキシされます。詳しくは[ローカル起動の説明](本地启动说明.md)（中国語）を参照してください。

### ローカルでの Maddy への接続

`MADDY_RUNNER` が、アカウント管理コマンドの実行方法を決めます：

| 値 | 使い方 |
| --- | --- |
| `local` | ローカルの `maddy` コマンドを直接呼び出します。`MADDY_BIN` と `MADDY_DATA_DIR` を設定し、サービスを実行するユーザーが Maddy のデータを読み書きできる必要があります |
| `docker-exec` | ホストの Docker コマンド経由で既存の Maddy コンテナーを呼び出します。`MADDY_CONTAINER` を設定してください。完全に信頼できるローカル環境でのみ使います |
| `disabled` | アカウント管理を行いません。既存のメールボックスにログインして送受信はできますが、ウェブ上でのメールボックス作成、招待による登録、メールボックスのパスワードリセットはできません |

Maddy は通常、993（IMAP、暗黙の TLS）と 465（サブミッション、暗黙の TLS）で待ち受けます。実際のポートに合わせて `MAIL_IMAP_PORT` と `MAIL_SMTP_PORT` を設定してください。`MAIL_HOST` は接続先のアドレス、`MAIL_HOSTNAME` は証明書に載っている名前で、両者は異なっていても構いません。証明書の検証は無効にしないでください。

まず同じシステムユーザーでコマンドラインが使えることを確認できます：

```sh
maddy creds list --cfg-block local_authdb
maddy imap-acct list --cfg-block local_mailboxes
```

## オプション機能

### Cloudflare Turnstile

既定では組み込みの画像 CAPTCHA を使い、外部サービスには依存しません。Turnstile に切り替えるには：

1. Cloudflare の Turnstile ページでドメインのサイトを追加し、サイトキーとシークレットキーを取得します。
2. コンソールの「セキュリティ → 人間確認」で 2 つのキーを入力し、実際の確認を 1 回完了します。成功して初めて有効にできます。
3. メールボックスのログイン、登録、パスワードリセットの申請は、それぞれ個別に有効にできます。

管理者ログインはこの設定の影響を受けないので、キーを間違えてもコンソールに入れなくなることはありません。シークレットキーは暗号化して保存され、ページにも API にも返されません。Cloudflare が公開しているテスト用キーは誰でも通過できるため、流れを試すときだけに使ってください。

### メールログ

コンソールのメールログは読み取り専用の JSON スナップショットを読むので、アプリのコンテナーは Docker ソケットに触れません。ホスト上の `deploy/export-mail-logs.py` が、マスキング済みの最近のログを定期的に書き出します。cron の例は `deploy/mail-log-export.cron` にあります。スナップショットのディレクトリをコンテナーにマウントし、`MAIL_LOG_DIRECTORY` と `MAIL_LOG_SNAPSHOT_PATH` を設定してください。収集用のスクリプトを入れなくても、メールの送受信には影響しません。コンソールでメールログが見られないだけです。

## サイト名と SEO

コンソールの「SEO 管理」で、サイト名をご自身のもの（例：「○○メール」）に変更できます。ブラウザーのタイトルと、トップ、ログイン、メールボックスの各ページの名前がまとめて変わります。ページ下部のオープンソースリポジトリへのリンクと著作権表示は固定で、設定の影響を受けません。

トップページのタイトル、説明、正規 URL、シェアカード、構造化データはサーバーがページに直接書き込むので、スクリプトを実行しないクローラーでも読み取れます。ログイン、登録、メールボックス、コンソールのページは一切インデックスされません。正規 URL が空の場合は環境変数 `PUBLIC_ORIGIN` を使い、どちらもない場合は canonical リンク、シェア画像、サイトマップを生成できず、ページ内のスコアでその旨が示されます。`/robots.txt` は API だけを禁止し、管理パスを書き出すことはありません。`/sitemap.xml` にはトップページだけが含まれます。

## 更新とバックアップ

更新の前に、アプリのデータボリューム、Maddy のデータ、環境ファイルをバックアップしてください。SQLite は書き込み中にデータベースファイルを 1 つだけコピーしてもバックアップになりません。整合性のあるバックアップを取るか、書き込みを止めてから行ってください。

```sh
git pull --ff-only
docker compose --env-file deploy/bakamail.env -f deploy/docker-compose.yml up -d --build
```

更新に `docker compose down -v` を使わないでください。データボリュームが削除されます。更新するとサービスが再起動し、プロセス内に保持しているメールボックスのセッションが失われるため、ユーザーは再ログインが必要です。

## 開発

```sh
npm run typecheck   # サーバーとフロントエンドの型チェック
npm test            # すべてのテスト
npm run build       # フロントエンドの本番ビルド
BAKAMAIL_PINNED_VENDOR=1 npm run check   # スタイル規約とプロトコル漏えいのチェック
```

テストは一時データベースと模擬の Maddy コマンドを使い、実際のメールサーバーには接続しません。テストで HTTP リクエストを発行する場合は `server/test/support/loopback-request.ts` を使い、supertest を直接インポートしないでください。

変更するときに守る取り決め：

- ブラウザーはこのサイトの `/api/*` だけにリクエストします。フロントエンドの成果物にメールサーバーのホスト名やポートを含めてはいけません。
- `web/src/styles/vendor/` のスタイルスナップショットは直接編集せず、新しいスタイルは追加のスタイルファイルに書きます。
- メールの HTML はすべて信頼できないものとして扱い、サンドボックスを緩めないでください。
- 破壊的な操作には確認ダイアログを残します。

## よくある質問

- **メールボックスの作成やリセットに失敗する**：`MADDY_RUNNER`、コマンドラインのバージョン、設定ブロックの名前、データボリューム、ファイルの権限を確認してください。
- **ローカルでログインした直後にログアウトされる**：ローカルの HTTP では `COOKIE_SECURE=0` が必要です。本番では HTTPS と Secure な Cookie を使う必要があります。
- **証明書エラー**：`MAIL_HOSTNAME` と証明書チェーンを確認してください。証明書の検証は無効にしないでください。
- **管理画面のアドレスが分からない**：セットアップ時や変更時に保存したブックマークを使ってください。通常のログインページには管理画面の入口は表示されません。
- **8790 番ポートが使用中**：まず何が使っているかを確認してください。起動スクリプトは他のプロセスを終了しません。
- **新規インストールでセットアップページしか表示されない**：`setup.key` を読んでセットアップを完了してください。既存のデータベースは再初期化されません。

インターネットで実際にメールを送受信するには、正しい MX、SPF、DKIM、DMARC、PTR レコードとポートの開放も必要です。これらは Maddy と DNS の設定に属するもので、ウェブのリバースプロキシでは代替できません。

## 変更履歴

[CHANGELOG.md](CHANGELOG.md)（中国語）を参照してください。

## ライセンス

このプロジェクトは [MIT ライセンス](LICENSE) で公開されています。サードパーティの依存関係は、それぞれのライセンスに従います。
