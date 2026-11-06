<template>
  <span class="site-brand" :class="{ 'auth-brand': auth }">
    <span class="brand-mark">
      <span class="window-symbol" aria-hidden="true"><i></i><i></i></span>
    </span>
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
