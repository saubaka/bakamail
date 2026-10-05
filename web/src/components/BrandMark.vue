<template>
  <span class="site-brand" :class="{ 'auth-brand': auth }">
    <span class="brand-mark">
      <span class="window-symbol" aria-hidden="true"><i></i><i></i></span>
    </span>
    <span>{{ title }}<small>{{ subtitle }}</small></span>
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ title?: string; subtitle?: string; auth?: boolean }>(),
  { title: "BakaMail", subtitle: "自建邮局", auth: false },
);
</script>
