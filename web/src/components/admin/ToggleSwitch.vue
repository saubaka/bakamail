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
.toggle.is-disabled { cursor: not-allowed; opacity: .6; }
/* 全局样式会覆盖原生复选框，必须 !important 才能真正藏起来。 */
.toggle > input { position: absolute !important; width: 1px !important; height: 1px !important; margin: 0 !important; padding: 0 !important; opacity: 0 !important; pointer-events: none !important; }
.toggle__track { position: relative; width: 44px; height: 26px; border: 1px solid var(--line-blue); border-radius: 999px; background: #e9eff4; transition: background 180ms var(--ease, ease), border-color 180ms var(--ease, ease); }
.toggle__track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(72, 105, 131, .25); transition: transform 220ms var(--spring, ease); }
.toggle > input:checked + .toggle__track { border-color: var(--line-blue); background: var(--blue-200); }
.toggle > input:checked + .toggle__track::after { transform: translateX(18px); }
.toggle > input:focus-visible + .toggle__track { outline: 3px solid rgba(143, 198, 232, .4); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .toggle__track, .toggle__track::after { transition: none; } }
</style>
