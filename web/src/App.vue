<template>
  <router-view v-slot="{ Component, route }">
    <transition name="baka-route" mode="out-in" @after-enter="focusMain">
      <component :is="Component" :key="workspaceRouteKey(route)" />
    </transition>
  </router-view>
  <BakaDialog />
</template>

<script setup lang="ts">
import BakaDialog from "./components/BakaDialog.vue";
import { workspaceRouteKey } from "./auth/workspaceRouteKey";

function focusMain(): void {
  const main = document.getElementById("main-content");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
}
</script>
