<template><span ref="surface" class="line-outline-host" aria-hidden="true" /></template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { attachSurfaceLines } from '../surfaceLines';
const surface=ref<HTMLElement|null>(null);
let dispose:(()=>void)|undefined;
onMounted(()=>{if(surface.value)dispose=attachSurfaceLines(surface.value);});
onBeforeUnmount(()=>dispose?.());
</script>
