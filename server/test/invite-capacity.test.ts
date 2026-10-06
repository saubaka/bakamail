import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'bakamail-invite-capacity-'));
const legacy = new DatabaseSync(join(directory, 'bakamail.db'));
legacy.exec(`create table invites(id integer primary key autoincrement,code_hash text not null unique,code_hint text not null,
  bound_address text not null default '',bound_domain text not null default '',note text not null default '',
  created_by text not null default '',created_at text not null,expires_at text not null,
  used_at text,used_by text not null default '',revoked_at text);`);
for (const [id,used,revoked,expiry] of [[1,null,null,'2099-01-01'],[2,'2026-01-01',null,'2099-01-01'],[3,null,'2026-01-01','2099-01-01'],[4,null,null,'2020-01-01']] as const) {
  legacy.prepare('insert into invites(id,code_hash,code_hint,created_at,expires_at,used_at,revoked_at) values(?,?,?,?,?,?,?)')
    .run(id,`legacy-${id}`,'OLD0','2026-01-01',expiry,used,revoked);
}
const legacyRows=JSON.stringify(legacy.prepare('select * from invites order by id').all()); legacy.close();
Object.assign(process.env,{DATA_DIR:directory,NODE_ENV:'test',SECRET_KEY:'isolated-invite-capacity-secret',
  BOOTSTRAP_ADMIN:'invite-test-admin',BOOTSTRAP_ADMIN_PASSWORD:'isolated-admin-pass-2026',HUMAN_CHECK_TEST_MODE:'1',
  MIN_FORM_SECONDS:'1',COOKIE_SECURE:'0',MADDY_RUNNER:'local',MADDY_BIN:fileURLToPath(new URL('./fixtures/fake-maddy.sh',import.meta.url)),
  MADDY_DATA_DIR:directory,FAKE_MADDY_STATE:directory,MAIL_DOMAIN:'example.test',REGISTER_MAX_PER_HOUR:'100',REGISTER_MAX_PER_DAY:'1000'});
const {db}=await import('../src/db.ts');
const invites=await import('../src/admin/invites.ts');
const {createApp}=await import('../src/app.ts');
const {hashToken}=await import('../src/security/identity.ts');
const {createAdmin}=await import('../src/admin/accounts.ts');
const {default:request}=await import('supertest');
const app=createApp({bootstrapAdmin:true,log:()=>{}}),admin=request.agent(app); let csrf='';
const row=(id:number)=>invites.listInvites(1000).find(row=>row.id===id)!;
test.before(async()=>{
  const challenge=await admin.get('/api/admin/human-check');
  const response=await admin.post('/api/admin/auth/login').send({username:'invite-test-admin',password:'isolated-admin-pass-2026',humanNonce:challenge.body.data.nonce,humanAnswer:'ABCD'});
  assert.equal(response.status,200);csrf=response.body.data.csrfToken;
});
test.afterEach(()=>db.exec('delete from security_budgets'));
test.after(()=>db.close());

test('旧单次邀请码增量迁移保留所有原字段，已用/撤销/过期不重新开放',()=>{
  assert.equal(JSON.stringify(db.prepare('select id,code_hash,code_hint,bound_address,bound_domain,note,created_by,created_at,expires_at,used_at,used_by,revoked_at from invites where id<=4 order by id').all()),legacyRows);
  for(let id=1;id<=4;id++){assert.equal(row(id).max_uses,1);assert.equal(row(id).used_count,id===2?1:0);assert.equal(row(id).reserved_count,0);}
  assert.equal(invites.consumeInvite(2,'legacy@example.test'),null);
  assert.equal(invites.consumeInvite(3,'legacy@example.test'),null);
  assert.equal(invites.consumeInvite(4,'legacy@example.test'),null);
});
test('后台默认保持单次72小时；次数和有效期可各自独立无限制',async()=>{
  for(const body of [{},{maxUses:null},{ttlHours:null},{maxUses:null,ttlHours:null},{maxUses:5,ttlHours:1}]){
    const response=await admin.post('/api/admin/invites').set('x-csrf-token',csrf).send(body);assert.equal(response.status,200);
    const saved=row(response.body.data.id);assert.equal(saved.max_uses,'maxUses'in body?body.maxUses:1);
    assert.equal(saved.expires_at===null,body.ttlHours===null);assert.equal(saved.used_count,0);assert.equal(saved.reserved_count,0);
  }
});
test('后台拒绝零、负数、浮点、字符串、布尔和超界限制，不写入或审计成功',async()=>{
  const before=db.prepare('select count(*) as n from invites').get();
  for(const [key,values]of [['maxUses',[0,-1,1.5,'2',true,1000001]],['ttlHours',[0,-1,1.5,'72',false,721]]] as const){
    for(const value of values){const response=await admin.post('/api/admin/invites').set('x-csrf-token',csrf).send({[key]:value});assert.equal(response.status,400);}
  }assert.deepEqual(db.prepare('select count(*) as n from invites').get(),before);
});
test('列表不泄漏完整邀请码、哈希或预约令牌；写操作保持鉴权/权限/CSRF',async()=>{
  const created=invites.createInvite({createdBy:'isolated',maxUses:3});
  const response=await admin.get('/api/admin/invites');assert.equal(response.status,200);
  assert.doesNotMatch(JSON.stringify(response.body),/code_hash|"token"/);assert.ok(!JSON.stringify(response.body).includes(created.code));
  assert.equal((await request(app).get('/api/admin/invites')).status,401);
  assert.equal((await admin.post('/api/admin/invites').send({maxUses:null,ttlHours:null})).status,403);
  createAdmin('invite-auditor','isolated-auditor-pass-2026','auditor','隔离只读账号');
  const auditor=request.agent(app),c=await auditor.get('/api/admin/human-check');
  const login=await auditor.post('/api/admin/auth/login').send({username:'invite-auditor',password:'isolated-auditor-pass-2026',humanNonce:c.body.data.nonce,humanAnswer:'ABCD'});
  assert.equal(login.status,200);
  assert.equal((await auditor.post('/api/admin/invites').set('x-csrf-token',login.body.data.csrfToken).send({maxUses:null})).status,403);
});
test('预约不计成功，逐次确认或释放仅作用于对应令牌，重放不重复计数',()=>{
  const invite=invites.createInvite({createdBy:'isolated',maxUses:2,ttlHours:null});
  const a=invites.consumeInvite(invite.id,'claim-a@example.test')!,b=invites.consumeInvite(invite.id,'claim-b@example.test')!;
  assert.ok(a&&b&&a!==b);assert.equal(row(invite.id).used_count,0);assert.equal(row(invite.id).reserved_count,2);
  assert.equal(invites.consumeInvite(invite.id,'claim-c@example.test'),null);
  assert.equal(invites.releaseInviteClaim(invite.id,'claim-b@example.test',a),false);
  assert.equal(invites.completeInviteClaim(invite.id,'claim-a@example.test',a),true);
  assert.equal(invites.completeInviteClaim(invite.id,'claim-a@example.test',a),false);
  assert.equal(invites.releaseInviteClaim(invite.id,'claim-a@example.test',a),false);
  assert.equal(invites.releaseInviteClaim(invite.id,'claim-b@example.test',b),true);
  assert.equal(invites.releaseInviteClaim(invite.id,'claim-b@example.test',b),false);
  assert.equal(row(invite.id).used_count,1);assert.equal(row(invite.id).reserved_count,0);assert.equal(row(invite.id).used_by,'claim-a@example.test');
});
test('多个进程竞争仅取得上限内的名额，重启不重置成功或保留名额',async()=>{
  const invite=invites.createInvite({createdBy:'isolated',maxUses:2,ttlHours:null});
  const moduleUrl=new URL('../src/admin/invites.ts',import.meta.url).href;
  const claims=await Promise.all(Array.from({length:6},(_,i)=>new Promise<string>((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(moduleUrl)});console.log(JSON.stringify(m.consumeInvite(${invite.id},${JSON.stringify(`process-${i}@example.test`)})));`],{env:process.env});
    let out='',error='';child.stdout.on('data',bytes=>out+=bytes);child.stderr.on('data',bytes=>error+=bytes);child.on('error',reject);
    child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(Error(error)));
  })));
  assert.equal(claims.filter(Boolean).length,2);assert.equal(row(invite.id).reserved_count,2);assert.equal(row(invite.id).used_count,0);
  const output=execFileSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(moduleUrl)});console.log(JSON.stringify(m.listInvites(1000).find(r=>r.id===${invite.id})));`],{env:process.env,encoding:'utf8'});
  assert.equal(JSON.stringify(JSON.parse(output)),JSON.stringify(row(invite.id)));
});
test('时间无限制仍检查绑定、次数及撤销；部分使用后可撤销并保留计数',()=>{
  const invite=invites.createInvite({createdBy:'isolated',ttlHours:null,maxUses:3,boundDomain:'example.test'});
  assert.equal(invites.checkInvite(invite.code,'outside@else.test').ok,false);
  assert.equal(invites.consumeInvite(invite.id,'outside@else.test'),null);
  const token=invites.consumeInvite(invite.id,'inside@example.test')!;invites.completeInviteClaim(invite.id,'inside@example.test',token);
  assert.equal(invites.revokeInvite(invite.id),true);assert.equal(invites.revokeInvite(invite.id),false);
  assert.equal(row(invite.id).used_count,1);assert.equal(invites.checkInvite(invite.code,'again@example.test').ok,false);
  assert.equal(invites.consumeInvite(invite.id,'again@example.test'),null);
});
test('次数无限制不忽略过期；最终预约重新检查到期/撤销而不是信任旧预检',()=>{
  const invite=invites.createInvite({createdBy:'isolated',maxUses:null});
  assert.equal(invites.checkInvite(invite.code,'time@example.test').ok,true);
  db.prepare('update invites set expires_at=? where id=?').run('2020-01-01',invite.id);
  assert.equal(invites.checkInvite(invite.code,'time@example.test').ok,false);assert.equal(invites.consumeInvite(invite.id,'time@example.test'),null);
});
test('结果未确认的名额不自动释放；计数事务故障不会丢失预约或部分计数',()=>{
  const invite=invites.createInvite({createdBy:'isolated',maxUses:1,ttlHours:null});
  const token=invites.consumeInvite(invite.id,'unknown@example.test')!;invites.retainInviteClaim(invite.id,'unknown@example.test',token);
  assert.equal(row(invite.id).used_count,0);assert.equal(row(invite.id).reserved_count,1);assert.equal(invites.releaseInviteClaim(invite.id,'unknown@example.test',token),false);
  assert.equal(invites.consumeInvite(invite.id,'another@example.test'),null);
  const other=invites.createInvite({createdBy:'isolated',maxUses:2});const t=invites.consumeInvite(other.id,'fault@example.test')!;
  db.exec(`create trigger reject_invite_count before update of used_count on invites when new.id=${other.id} begin select raise(abort,'isolated failure'); end;`);
  assert.throws(()=>invites.completeInviteClaim(other.id,'fault@example.test',t));
  assert.equal(row(other.id).used_count,0);assert.equal(row(other.id).reserved_count,1);db.exec('drop trigger reject_invite_count');
  assert.equal(invites.completeInviteClaim(other.id,'fault@example.test',t),true);
});

let sourceIndex=10;
async function register(code:string,account:string){
  const address=`198.51.100.${++sourceIndex}`;
  const c=await request(app).get('/api/auth/human-check?purpose=register').set('x-real-ip',address);assert.equal(c.status,200);
  db.prepare('update form_tokens set issued_at=issued_at-5000 where token_hash=?').run(hashToken(c.body.data.formToken));
  return request(app).post('/api/auth/register').set('x-real-ip',address).send({inviteCode:code,account,password:'isolated-mail-pass-2026',confirmPassword:'isolated-mail-pass-2026',humanNonce:c.body.data.nonce,humanAnswer:'ABCD',formToken:c.body.data.formToken});
}
test('真实BFF与SQLite：同一码两次注册成功，第三次拒绝且两类计数准确',async()=>{
  const invite=invites.createInvite({createdBy:'isolated',maxUses:2,ttlHours:null});
  assert.equal((await register(invite.code,'quota-one')).status,200);assert.equal((await register(invite.code,'quota-two')).status,200);
  assert.equal((await register(invite.code,'quota-three')).status,400);assert.equal(row(invite.id).used_count,2);assert.equal(row(invite.id).reserved_count,0);
  const accounts=readFileSync(join(directory,'accounts'),'utf8');assert.match(accounts,/quota-one@example.test/);assert.match(accounts,/quota-two@example.test/);assert.doesNotMatch(accounts,/quota-three/);
});
test('真实BFF：两个无限制支持重复注册，干净失败只回退自己的预约不影响既有成功',async()=>{
  const invite=invites.createInvite({createdBy:'isolated',maxUses:null,ttlHours:null});
  assert.equal((await register(invite.code,'unlimited-one')).status,200);
  process.env.FAKE_MADDY_FAIL_IMAP_CREATE='1';
  try{const failed=await register(invite.code,'unlimited-fail');assert.equal(failed.status,502);assert.equal(failed.body.data.inviteRestored,true);}finally{delete process.env.FAKE_MADDY_FAIL_IMAP_CREATE;}
  assert.equal(row(invite.id).used_count,1);assert.equal(row(invite.id).reserved_count,0);
  assert.equal((await register(invite.code,'unlimited-two')).status,200);assert.equal(row(invite.id).used_count,2);
});
