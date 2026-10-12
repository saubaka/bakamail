<template>
  <ErrorPage v-if="fatalError.active" retryable retry-label="重新加载" :show-home="false" @retry="reload" />
  <router-view v-else v-slot="{ Component, route }">
    <transition name="baka-route" mode="out-in" @after-enter="focusMain">
      <component :is="Component" :key="workspaceRouteKey(route)" />
    </transition>
  </router-view>
  <BakaDialog />
</template>

<script setup lang="ts">
import { onErrorCaptured, watch } from "vue";
import { useRoute } from "vue-router";
import BakaDialog from "./components/BakaDialog.vue";
import ErrorPage from "./components/ErrorPage.vue";
import { workspaceRouteKey } from "./auth/workspaceRouteKey";
import { clearFatal, fatalError, reportFatal } from "./errorState";

const route = useRoute();

function focusMain(): void {
  const main = document.getElementById("main-content");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
}

// 只有渲染阶段出错才整页换成错误页；点击处理函数等地方的异常不应该把整个界面换掉。
const RENDER_STAGES = new Set(["render function", "setup function", "component update"]);
onErrorCaptured((error, _instance, info) => {
  if (!RENDER_STAGES.has(info)) return true;
  console.error(error);
  reportFatal(info);
  return false;
});

// 成功切换到别的页面后自动恢复。
watch(() => route.fullPath, () => { if (fatalError.active) clearFatal(); });

/** 用户明确点了按钮才重新加载整页；文件加载失败时重新请求才有效。 */
function reload(): void { window.location.reload(); }
</script>
