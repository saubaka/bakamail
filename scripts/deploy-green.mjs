/** Explicit, checked releases only: never sync secrets, local databases, or untested edits. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadArchiveByExec } from "./upload-archive.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = "/Applications/ATerminal.app/Contents/Resources/aterminal-cli";
const cliEnv = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" };
const source = "/root/mail/bakamail";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const backup = `/root/mail/backups/bakamail-${stamp}`;
const stage = `/root/mail/bakamail.next-${stamp}`;
const marker = `BAKAMAIL_RELEASE_OK_${stamp}`;
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? `${binary} failed (${result.status}): ${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

const sessions = JSON.parse(run(cli, ["sessions", "--json"], { env: cliEnv })).sessions;
const requestedSession = process.argv.includes("--session") ? process.argv[process.argv.indexOf("--session") + 1] : null;
const candidates = sessions.filter((session) => session.connected && session.name === "green-2C4G"
  && session.host === "91.199.209.106" && session.username === "root"
  && session.protocol === "ssh" && session.supportsExec && session.supportsSftp
  && (!requestedSession || session.id === requestedSession));
if (candidates.length !== 1) throw new Error("必须有唯一、已连接的 green-2C4G root SSH 会话；可用 --session 明确指定。");
const session = candidates[0].id;

function remote(command, timeout = 60) {
  // ATerminal's process exit code does not reflect the remote shell status.
  const wrapped = `set -eu\n${command}\nprintf '\\n${marker}\\n'`;
  const result = JSON.parse(run(cli, ["exec", "--session", session, "--timeout", String(timeout), "--json", "--cmd", wrapped], { env: cliEnv, timeout: (timeout + 5) * 1000 }));
  if (!result.ok || !result.output?.trimEnd().endsWith(marker)) {
    throw new Error(`远端步骤未确认成功：${result.output ?? "无响应"}`);
  }
  return result.output.replace(`\n${marker}\n`, "").trim();
}

const work = mkdtempSync(join(tmpdir(), "bakamail-release-"));
const archive = join(work, "release.tar.gz");
let oldImage = "";
let swapped = false;
let published = false;
try {
  console.log("核对 green-2C4G、容器、持久卷与配置权限…");
  if (remote("hostname -f") !== "mail.saubaka.com") throw new Error("远端主机名不匹配，停止部署");
  oldImage = remote("docker inspect bakamail --format '{{.Image}}'");
  if (!/^sha256:[a-f0-9]{64}$/.test(oldImage)) throw new Error("无法确认当前镜像");
  const mounts = remote("docker inspect bakamail --format '{{range .Mounts}}{{.Name}} {{.Destination}}{{println}}{{end}}'");
  if (!mounts.includes("bakamail_bakamail-data /app/data") || !mounts.includes("maddydata /data")) {
    throw new Error("持久卷与预期不一致，停止部署");
  }
  if (remote(`stat -c '%a' ${quote(`${source}/deploy/bakamail.env`)}`) !== "600") throw new Error("线上环境文件权限不是 600");
  remote("test \"$(docker inspect 1Panel-maddy-mail-izag --format '{{.Config.Image}}|{{.State.Running}}')\" = 'foxcpp/maddy:0.9.5|true'\ntest -x /usr/bin/python3\nsystemctl is-active --quiet cron");
  const proxyPeer = remote("docker network inspect 1panel-network --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'");
  if (proxyPeer !== "172.18.0.1") throw new Error("代理网络网关变化，需重新核验真实代理来源");

  console.log("运行类型、测试、构建和架构检查…");
  for (const command of ["typecheck", "test", "build", "check"]) run("npm", ["run", command], {
    stdio: "inherit", env: { ...process.env, BAKAMAIL_PINNED_VENDOR: "1" },
  });
  run("tar", ["--no-xattrs", "-czf", archive,
    "--exclude=./.env", "--exclude=./data", "--exclude=./node_modules", "--exclude=./web/dist", "--exclude=./bakagit",
    "--exclude=./deploy/bakamail.env", "--exclude=./.DS_Store", "--exclude=./.git",
    "--exclude=./docs/handoff/conversation.md", "--exclude=./docs/handoff/session-visible.jsonl",
    "--exclude=./docs/handoff/session-manifest.json", "--exclude=*.db", "--exclude=*.db-wal",
    "--exclude=*.db-shm", "--exclude=*.log", "."],
  { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const inventory = run("tar", ["-tzf", archive]);
  if (/(^|\n)(\.\/)?(\.env|data\/|node_modules\/|deploy\/bakamail\.env|docs\/handoff\/(?:conversation\.md|session-visible\.jsonl|session-manifest\.json))(\n|$|\/)/.test(inventory)) {
    throw new Error("发布包含禁止上传的文件");
  }
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");

  console.log(`创建源码、环境文件和 SQLite 一致性备份：${backup}`);
  const backupJs = `const {DatabaseSync,backup}=require("node:sqlite"); const db=new DatabaseSync("/app/data/bakamail.db",{readOnly:true}); backup(db,"/tmp/bakamail-${stamp}.db").then(()=>db.close()).catch(e=>{console.error(e.message);process.exit(1)});`;
  remote(`test ! -e ${quote(backup)}\ntest ! -e ${quote(stage)}\ninstall -d -m 700 ${quote(backup)}\ntar -C /root/mail -czf ${quote(`${backup}/source.tar.gz`)} bakamail\ndocker tag ${quote(oldImage)} ${quote(`bakamail:rollback-${stamp.toLowerCase()}`)}\ndocker exec bakamail node -e ${quote(backupJs)}\ndocker cp ${quote(`bakamail:/tmp/bakamail-${stamp}.db`)} ${quote(`${backup}/bakamail.db`)}\ndocker exec bakamail rm ${quote(`/tmp/bakamail-${stamp}.db`)}\nchmod 600 ${quote(`${backup}/source.tar.gz`)} ${quote(`${backup}/bakamail.db`)}`);

  console.log("上传发布包并核对 SHA-256…");
  let uploaded = false;
  if (!process.argv.includes("--ssh-exec-upload")) {
    try {
      const upload = JSON.parse(run(cli, ["sftp", "upload", "--session", session, "--json", "--local", archive, "--remote", `${backup}/release.tar.gz`], { env: cliEnv, timeout: 120_000 }));
      uploaded = Boolean(upload.ok);
    } catch { console.log("SFTP 未完成，改用同一 SSH 会话的有界分块传输…"); }
  }
  if (!uploaded) uploadArchiveByExec(readFileSync(archive), `${backup}/release.tar.gz`, remote);
  if (remote(`sha256sum ${quote(`${backup}/release.tar.gz`)} | cut -d ' ' -f 1`) !== digest) throw new Error("上传校验失败");
  remote(`install -d -m 700 ${quote(stage)}\ntar --no-same-owner -C ${quote(stage)} -xzf ${quote(`${backup}/release.tar.gz`)}\ninstall -m 600 ${quote(`${source}/deploy/bakamail.env`)} ${quote(`${stage}/deploy/bakamail.env`)}`);
  // Existing tabs still need the previous release's hashed lazy chunks.
  remote(`install -d ${quote(`${stage}/web/dist`)}\ndocker cp bakamail:/app/web/dist/. ${quote(`${stage}/web/dist/`)}`);
  const envProgram = `from pathlib import Path\np=Path(${JSON.stringify(`${stage}/deploy/bakamail.env`)})\nlines=p.read_text().splitlines()\nupdates={"PUBLIC_ORIGIN":"https://mail.saubaka.com","TRUSTED_PROXY_IPS":${JSON.stringify(proxyPeer)}}\nfor key,value in updates.items():\n    old=[line.split("=",1)[1] for line in lines if line.startswith(key+"=")]\n    assert not old or all(v in ("",value) for v in old),"unexpected proxy/origin config"\n    lines=[line for line in lines if not line.startswith(key+"=")]\n    lines.append(key+"="+value)\np.write_text("\\n".join(lines)+"\\n")\np.chmod(0o600)`;
  remote(`python3 -c ${quote(envProgram)}`);
  console.log("隔离目录构建镜像，当前服务保持运行…");
  remote(`docker compose -f ${quote(`${stage}/deploy/docker-compose.yml`)} build bakamail`, 900);
  console.log("验证新运行镜像及数据库副本迁移（隔离网络、不改真实库）…");
  // All writes below are confined to a disposable copy, with no Maddy/network access.
  const migrationJs = `const fs=require("node:fs");
fs.mkdirSync("/tmp/migration");fs.copyFileSync("/tmp/source.db","/tmp/migration/bakamail.db");
(async()=>{
  const {db}=await import("./server/src/db.ts");
  const assert=(ok)=>{if(!ok)throw Error("migration validation failed")};
  const admins=()=>JSON.stringify(db.prepare("select username,role,is_active from admin_users order by id").all());
  const row=()=>JSON.stringify(db.prepare("select * from ui_appearance where id=1").get()??null);
  const before=admins(),appearanceBefore=row();
  const {createApp}=await import("./server/src/app.ts");
  const {isUiConfig}=await import("./shared/notificationMotion.ts");
  const {isUiConfigV2,projectUiConfigV1}=await import("./shared/notificationDisplay.ts");
  const {saveAppearance,readAppearanceV2}=await import("./server/src/admin/appearance.ts");
  const s=createApp({bootstrapAdmin:false,log:()=>{}}).listen(0,"127.0.0.1");
  await new Promise(r=>s.once("listening",r));
  const base="http://127.0.0.1:"+s.address().port;
  const legacy=await fetch(base+"/api/ui-config"),modern=await fetch(base+"/api/ui-config?schemaVersion=2");
  const v1=(await legacy.json()).data,v2=(await modern.json()).data;
  assert(legacy.status===200&&modern.status===200&&isUiConfig(v1)&&isUiConfigV2(v2));
  assert(JSON.stringify(v1)===JSON.stringify(projectUiConfigV1(v2))&&appearanceBefore===row());
  assert(legacy.headers.get("etag")!==modern.headers.get("etag"));
  assert((await fetch(base+"/api/ui-config?schemaVersion=2",{headers:{"if-none-match":modern.headers.get("etag")}})).status===304);
  assert((await fetch(base+"/api/admin/appearance?schemaVersion=2")).status===401);
  v2.notificationDisplay.types.success={mode:"timed",durationMs:1000};
  const saved=saveAppearance(v2,{actor:"release-copy-probe"});
  assert(saved.schemaVersion===2&&saved.revision===v2.revision+1&&readAppearanceV2().notificationDisplay.types.success.durationMs===1000);
  const oldEdit=projectUiConfigV1(saved);oldEdit.notificationMotion.stackMs=oldEdit.notificationMotion.stackMs===0?320:0;
  saveAppearance(oldEdit,{actor:"release-copy-probe"});
  assert(readAppearanceV2().notificationDisplay.types.success.durationMs===1000);
  assert(db.prepare("pragma quick_check").get().quick_check==="ok"&&before===admins());
  await new Promise(r=>s.close(r));db.close();
  console.log("MIGRATION_IMAGE_OK: v1/v2, read-only upgrade, ETag, auth boundary, copy-only save and legacy preservation");
})().catch(()=>{console.error("MIGRATION_IMAGE_FAILED");process.exit(1)});`;
  remote(`docker run --rm --network none --env-file ${quote(`${stage}/deploy/bakamail.env`)} -e DATA_DIR=/tmp/migration -e MADDY_RUNNER=disabled -v ${quote(`${backup}/bakamail.db:/tmp/source.db:ro`)} bakamail:local node -e ${quote(migrationJs)}`);
  console.log("安装有界日志采集任务（应用仅只读挂载，无 Docker socket）…");
  remote(`for file in /root/mail/bakamail-mail-logs /root/mail/export-bakamail-mail-logs.py /etc/cron.d/bakamail-mail-log-export; do test ! -L "$file"; done
if [ -e /root/mail/bakamail-mail-logs ]; then test -d /root/mail/bakamail-mail-logs; test "$(stat -c '%u:%a' /root/mail/bakamail-mail-logs)" = '0:700'; else install -d -m 700 /root/mail/bakamail-mail-logs; fi
for file in /root/mail/export-bakamail-mail-logs.py /etc/cron.d/bakamail-mail-log-export; do if [ -e "$file" ]; then test -f "$file"; test "$(stat -c '%u' "$file")" = 0; cp -p "$file" ${quote(backup)}/; fi; done
install -m 700 ${quote(`${stage}/deploy/export-mail-logs.py`)} ${quote(`/root/mail/export-bakamail-mail-logs.py.next-${stamp}`)}
mv ${quote(`/root/mail/export-bakamail-mail-logs.py.next-${stamp}`)} /root/mail/export-bakamail-mail-logs.py
/usr/bin/python3 -B /root/mail/export-bakamail-mail-logs.py
install -m 644 ${quote(`${stage}/deploy/mail-log-export.cron`)} ${quote(`/etc/cron.d/bakamail-mail-log-export.next-${stamp}`)}
mv ${quote(`/etc/cron.d/bakamail-mail-log-export.next-${stamp}`)} /etc/cron.d/bakamail-mail-log-export
test "$(stat -c '%u:%a' /root/mail/bakamail-mail-logs/maddy.json)" = '0:600'`);
  console.log("切换代码并启动新镜像…");
  remote(`mv ${quote(source)} ${quote(`${backup}/previous-source`)}\nif ! mv ${quote(stage)} ${quote(source)}; then mv ${quote(`${backup}/previous-source`)} ${quote(source)}; exit 1; fi`);
  swapped = true;
  remote(`docker compose -f ${quote(`${source}/deploy/docker-compose.yml`)} up -d --no-build`);
  remote("ready=0\nfor attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do\nif curl --noproxy '*' -fsS -o /dev/null http://127.0.0.1:8790/api/health && [ \"$(docker inspect bakamail --format '{{.State.Health.Status}}')\" = healthy ]; then ready=1; break; fi\nsleep 2\ndone\n[ \"$ready\" = 1 ]");

  console.log("验证公网 HTML、资源字节、健康接口及未登录边界…");
  remote("test \"$(docker inspect bakamail --format '{{.HostConfig.Init}}')\" = true");
  const curl = (url, extra = []) => run("curl", ["--max-time", "30", "-sS", ...extra, url]);
  const base = "https://mail.saubaka.com";
  const localHtml = readFileSync(join(root, "web/dist/index.html"), "utf8");
  const publicHtml = curl(`${base}/login`, ["--fail"]);
  if (!publicHtml.includes('http-equiv="Content-Security-Policy" content="connect-src &#39;self&#39;"')
    && !publicHtml.includes('http-equiv="Content-Security-Policy" content="connect-src \'self\'"')) {
    throw new Error("公网 HTML 缺少仅同源连接策略");
  }
  if (!/content-security-policy:\s*connect-src 'self'/i.test(curl(`${base}/login`, ["-I"]))) {
    throw new Error("公网响应未强制执行仅同源连接策略");
  }
  const assets = [...localHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  if (!assets.length) throw new Error("无法确认本地入口资源");
  for (const asset of assets) {
    if (!publicHtml.includes(asset)) throw new Error(`公网仍未返回本批资源：${asset}`);
    const publicBytes = curl(`${base}${asset}`, ["--fail"]);
    const localBytes = readFileSync(join(root, "web/dist", asset.slice(1)), "utf8");
    if (createHash("sha256").update(publicBytes).digest("hex") !== createHash("sha256").update(localBytes).digest("hex")) throw new Error(`公网资源内容不一致：${asset}`);
  }
  const health = JSON.parse(curl(`${base}/api/health`, ["--fail"]));
  if (!health.ok || health.data?.status !== "ok") throw new Error("公网健康接口异常");
  if (JSON.stringify(Object.keys(health.data).sort()) !== JSON.stringify(["status"])) {
    throw new Error("公网健康接口暴露了不应匿名提供的内部信息");
  }
  const missing = curl(`${base}/assets/nonexistent-${stamp}.js`, ["-I"]);
  if (!/HTTP\/\S+ 404/.test(missing) || !/cache-control: no-store/i.test(missing)) throw new Error("失效资源不是 404/no-store");
  for (const path of ["/api/auth/me", "/api/admin/auth/me"]) {
    if (curl(`${base}${path}`, ["-o", "/dev/null", "-w", "%{http_code}"]) !== "401") throw new Error(`未登录访问边界异常：${path}`);
  }
  published = true;
  console.log(`发布成功。回滚镜像：${oldImage}；备份：${backup}`);
  console.log("本脚本不代表真实登录、收发邮件、管理员写操作或恢复演练已验收。");
} catch (error) {
  if (swapped && !published) {
    console.error("发布验收失败，恢复上一版代码和镜像；不覆盖上线期间产生的数据…");
    try {
      remote(`docker tag ${quote(oldImage)} bakamail:local\nmv ${quote(source)} ${quote(`${backup}/failed-source`)}\nmv ${quote(`${backup}/previous-source`)} ${quote(source)}\ndocker compose -f ${quote(`${source}/deploy/docker-compose.yml`)} up -d --no-build\ncurl --noproxy '*' -fsS -o /dev/null http://127.0.0.1:8790/api/health`);
      console.error("上一版已恢复。");
    } catch (rollbackError) { console.error(`自动回滚需要人工检查：${rollbackError.message}`); }
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // This is the exact mkdtemp directory created above, never the workspace or a user-selected path.
  rmSync(work, { recursive: true, force: true });
}
