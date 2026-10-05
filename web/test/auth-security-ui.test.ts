import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("真实登录页面不再提供冷却绕过，管理员从首次挂载即要求挑战", () => {
  const ordinary = source("views/LoginView.vue"); const admin = source("views/admin/AdminLoginView.vue");
  assert.doesNotMatch(ordinary + admin, /humanCooldownBypass|完成验证码后立即尝试一次|验证并登录/);
  assert.match(admin, /const humanVisible = ref\(true\)/);
  assert.match(ordinary + admin, /error\.retryAfterSeconds/);
  assert.doesNotMatch(ordinary + admin, /location\.reload|window\.location/);
});

test("验证码刷新预算、过期、取消与服务端填写时间均实际接入组件", () => {
  const human = source("components/HumanCheck.vue"); const register = source("views/RegisterView.vue");
  assert.match(human, /loading \|\| retrySeconds > 0/);
  assert.match(human, /aria-live="polite"/);
  assert.match(human, /tick\.value >= expiresAt/);
  assert.match(human, /controller\?\.abort\(\)/);
  assert.match(register, /v-model:formReadyAt="formReadyAt"/);
  assert.match(register, /tick\.value >= formReadyAt\.value/);
});
