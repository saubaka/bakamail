<template>
  <header class="site-header mail-page-header">
    <nav class="site-nav" aria-label="邮箱功能">
      <router-link class="site-brand" to="/mail">
        <span class="brand-mark">
          <span class="window-symbol" aria-hidden="true"><i></i><i></i></span>
        </span>
        <span>BakaMail<small>{{ subtitle }}</small></span>
      </router-link>
      <div class="site-nav__links mail-page-links">
        <router-link to="/mail">邮箱</router-link>
        <router-link to="/mail/search">搜索</router-link>
        <router-link to="/mail/drafts">草稿</router-link>
        <router-link to="/mail/contacts">联系人</router-link>
        <router-link to="/mail/settings">设置</router-link>
      </div>
      <div class="site-nav__actions">
        <span class="mail-account-label">{{ session.mailbox }}</span>
        <button class="button button--soft" type="button" :disabled="logoutBusy" @click="logout">{{ logoutBusy ? "退出中…" : "退出" }}</button>
      </div>
    </nav>
  </header>

  <nav class="mobile-bottom-nav mail-utility-capsule" aria-label="移动端邮箱功能">
    <router-link to="/mail">邮箱</router-link>
    <router-link to="/mail/search">搜索</router-link>
    <router-link to="/mail/drafts">草稿</router-link>
    <router-link to="/mail/contacts">联系人</router-link>
    <router-link to="/mail/settings">设置</router-link>
  </nav>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, toast } from "../api";
import { useSessionStore } from "../stores/session";

withDefaults(defineProps<{ subtitle?: string }>(), { subtitle: "邮箱工具" });

const router = useRouter();
const session = useSessionStore();
const logoutBusy = ref(false);

async function logout(): Promise<void> {
  if (logoutBusy.value) return;
  logoutBusy.value = true;
  try {
    await session.logout();
    await router.push("/");
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "退出失败，请重试", "error");
  } finally {
    logoutBusy.value = false;
  }
}
</script>
