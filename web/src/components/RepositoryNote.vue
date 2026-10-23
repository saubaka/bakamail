<template>
  <span class="repository-note"><a :href="repositoryUrl" target="_blank" rel="noopener noreferrer">Github</a></span>
</template>

<script setup lang="ts">
import { SEO_REPOSITORY_URL } from "../../../shared/seo";

// 开源仓库链接写死，站点名等任何设置都不会改动它（与首页页脚相同）。
const repositoryUrl = SEO_REPOSITORY_URL;
</script>
