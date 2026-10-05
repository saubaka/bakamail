<template>
  <main id="main-content" class="auth-shell">
    <BrandMark auth subtitle="暂时无法连接" />
    <section v-motion="{ kind: 'feature', reversible: false }" class="auth-card card" aria-labelledby="unavailable-title">
      <span class="soft-icon soft-icon--blue auth-icon" aria-hidden="true">!</span>
      <span class="eyebrow">BAKAMAIL</span>
      <h1 id="unavailable-title">暂时无法连接</h1>
      <p>会话状态暂时无法确认，可能是网络或服务短暂不可用。我们没有将你退出，也没有清除当前会话。</p>
      <button class="button button--primary" type="button" @click="retry">重试进入页面</button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import { adminPagePaths, adminPathProblem, safeAdminDestination } from "../../../shared/adminPaths";

const route = useRoute();
const router = useRouter();
const destination = computed(() => {
  const candidate = typeof route.query.redirect === "string" ? route.query.redirect : "";
  const path = candidate.split(/[?#]/, 1)[0]!;
  const base = `/${path.split('/')[1] ?? ''}`;
  if (!adminPathProblem(base) && (path === base || Object.values(adminPagePaths(base)).includes(path))) return safeAdminDestination(candidate, true, base);
  if (candidate === '/setup') return '/setup';
  return /^\/(?!\/)(?:$|\?|login(?:\?|$)|mail(?:\/|\?|$))/.test(candidate) && !candidate.includes("\\") ? candidate : "/";
});

function retry(): void {
  void router.replace(destination.value);
}
</script>
