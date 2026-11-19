<template>
  <span class="site-brand" :class="{ 'auth-brand': auth }">
    <span>{{ title ?? siteInfo.siteName }}<small>{{ subtitle }}</small></span>
  </span>
</template>

<script setup lang="ts">
import { siteInfo } from "../siteInfo";

withDefaults(
  defineProps<{ title?: string; subtitle?: string; auth?: boolean }>(),
  { title: undefined, subtitle: "自建邮局", auth: false },
);
</script>
