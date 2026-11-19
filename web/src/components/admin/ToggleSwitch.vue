<template>
  <label class="toggle" :class="{ 'is-disabled': disabled }">
    <input :id="id" type="checkbox" :checked="modelValue" :disabled="disabled" :aria-label="label" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
    <span class="toggle__track" aria-hidden="true"></span>
  </label>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; disabled?: boolean; id?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<style scoped>
.toggle { position: relative; display: inline-flex; flex: 0 0 auto; cursor: pointer; }
.toggle.is-disabled { opacity: .6; cursor: not-allowed; }
.toggle > input { position: absolute !important; width: 1px !important; height: 1px !important; margin: 0 !important; padding: 0 !important; opacity: 0 !important; pointer-events: none !important; }
.toggle__track { position: relative; width: 46px; height: 28px; border-radius: var(--r-pill); background: var(--chip); box-shadow: inset 0 0 0 1px var(--line-2); transition: background-color var(--t-std) var(--ease), box-shadow var(--t-std) var(--ease); }
.toggle__track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--surface); box-shadow: var(--shadow-press); transition: transform .5s var(--spring); }
.toggle:hover > input:not(:disabled) + .toggle__track { box-shadow: inset 0 0 0 1px var(--blue-300); }
.toggle > input:checked + .toggle__track { background: var(--blue-400); box-shadow: inset 0 0 0 1px var(--blue-400); }
.toggle > input:checked + .toggle__track::after { transform: translateX(18px); }
.toggle:active > input:not(:disabled) + .toggle__track::after { width: 26px; }
.toggle:active > input:checked:not(:disabled) + .toggle__track::after { transform: translateX(14px); }
.toggle > input:focus-visible + .toggle__track { outline: 2px solid var(--blue-400); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .toggle__track, .toggle__track::after { transition: none; } }
</style>
