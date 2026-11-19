<template>
  <svg class="app-logo" :class="{ 'is-small': small }" viewBox="0 0 128 128" aria-hidden="true" focusable="false">
    <rect class="app-logo__bg" width="128" height="128" rx="36" />
    <rect class="app-logo__body" x="18" y="38" width="92" height="56" rx="28" />
    <path class="app-logo__flap" d="M40 55 64 71 88 55" />
    <circle class="app-logo__dot" cx="101" cy="39" r="13" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ small?: boolean }>(), { small: false });
</script>
