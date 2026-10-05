import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:8790';
const options = new Set(process.argv.slice(2));
if ([...options].some(option => !['--no-open', '--check'].includes(option))) {
  console.error('用法：启动BakaMail.command [--no-open] [--check]');
  process.exit(1);
}
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('需要 Node.js 24 或更新版本。');
  process.exit(1);
}
process.chdir(root);
let child;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    if (child) child.kill(signal);
    else process.exit(0);
  });
}
function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (stopping) process.exit(0);
      if (code === 0) resolveRun();
      else reject(new Error(`${command} 未正常结束（${code ?? signal}）`));
    });
  });
}
async function checkPort() {
  await new Promise((resolveCheck, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('8790 端口已占用。请先停止已有服务；脚本不会结束其他进程。')));
    probe.listen(8790, '127.0.0.1', () => probe.close(resolveCheck));
  });
}
try {
  await checkPort();
  if (!existsSync(resolve(root, '.env'))) {
    throw new Error('缺少项目根目录 .env。请按「本地启动说明.md」配置，不要复制线上密钥。');
  }
  if (options.has('--check')) {
    console.log('检查通过：Node.js 版本、.env、8790 端口可用。未启动或更改任何服务。');
    process.exit(0);
  }
  if (!existsSync(resolve(root, 'node_modules/vite/package.json')) ||
      !existsSync(resolve(root, 'node_modules/express/package.json'))) {
    console.log('首次启动：按 package-lock.json 安装项目依赖……');
    await run('npm', ['ci']);
  }
  console.log('构建前端……');
  await run('npm', ['run', 'build']);
  await checkPort();
  console.log(`启动本地 BakaMail：${url}\n按 Control+C 停止；请保持此终端打开。`);
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '8790', COOKIE_SECURE: '0',
    MADDY_RUNNER: 'disabled', HUMAN_CHECK_TEST_MODE: '0' };
  // Observe failures immediately while health polling is still in progress.
  const server = run(process.execPath, ['server/src/index.ts'], env)
    .then(() => null, error => error);
  let ready = false;
  for (let attempt = 0; attempt < 40 && child; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) });
      const body = await response.json();
      if (response.ok && body?.data?.status === 'ok') { ready = true; break; }
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  if (!ready) {
    child?.kill('SIGTERM');
    const failure = await server;
    if (failure) console.error(failure.message);
    throw new Error('本地健康检查未通过，已停止本次服务。请检查上方启动日志。');
  }
  console.log(`健康检查通过。浏览器访问：${url}/`);
  if (process.platform === 'darwin' && !options.has('--no-open')) {
    const opener = spawn('open', [`${url}/`], { stdio: 'ignore' });
    opener.on('error', () => console.log('自动打开失败，请手动访问上述地址。'));
  }
  const failure = await server;
  if (failure) throw failure;
} catch (error) {
  console.error(`启动失败：${error.message}`);
  process.exitCode = 1;
}
