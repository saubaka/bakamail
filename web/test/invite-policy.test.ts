import test from 'node:test';
import assert from 'node:assert/strict';
import {inviteLimitsProblem,inviteStatus,inviteRemaining,type InviteSummary} from '../../shared/invitePolicy.ts';
const base:InviteSummary={id:1,code_hint:'TEST',bound_address:'',bound_domain:'',note:'',created_by:'test',created_at:'2026-01-01',expires_at:null,used_at:null,used_by:'',revoked_at:null,max_uses:3,used_count:1,reserved_count:1};
test('邀请码状态区分部分使用/用完/预约/过期/撤销；无限制不覆盖其他限制',()=>{
  assert.equal(inviteStatus(base),'available');assert.equal(inviteRemaining(base),1);
  assert.equal(inviteStatus({...base,used_count:3}),'exhausted');
  assert.equal(inviteStatus({...base,reserved_count:2}),'reserved');
  assert.equal(inviteStatus({...base,max_uses:null,used_count:100}),'available');assert.equal(inviteRemaining({...base,max_uses:null}),null);
  assert.equal(inviteStatus({...base,max_uses:null,expires_at:'2020-01-01'}),'expired');
  assert.equal(inviteStatus({...base,expires_at:'invalid'}),'expired');
  assert.equal(inviteStatus({...base,revoked_at:'2026-01-01'}),'revoked');
});
test('次数和有效期的缺省、独立无限制及整数边界契约',()=>{
  for(const body of [{},{maxUses:1,ttlHours:720},{maxUses:1_000_000,ttlHours:1},{maxUses:null},{ttlHours:null},{maxUses:null,ttlHours:null}])assert.equal(inviteLimitsProblem(body),null);
  for(const body of [{maxUses:0},{maxUses:1.5},{maxUses:'1'},{maxUses:NaN},{maxUses:1_000_001},{ttlHours:0},{ttlHours:721},{ttlHours:Infinity},{ttlHours:'72'}])assert.ok(inviteLimitsProblem(body));
});
