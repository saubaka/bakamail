<template>
  <span class="site-brand" :class="{ 'auth-brand': auth }">
    <AppLogo class="site-brand__logo" />
    <span>{{ title ?? siteInfo.siteName }}<small>{{ subtitle }}</small></span>
  </span>
</template>

<script setup lang="ts">
import { siteInfo } from "../siteInfo";
import AppLogo from "./AppLogo.vue";

withDefaults(
  defineProps<{ title?: string; subtitle?: string; auth?: boolean }>(),
  { title: undefined, subtitle: "自建邮局", auth: false },
);
</script>
