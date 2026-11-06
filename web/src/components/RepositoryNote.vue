<template>
  <span class="repository-note"><a :href="repositoryUrl" target="_blank" rel="noopener noreferrer">Github</a></span>
</template>

<script setup lang="ts">
import { SEO_REPOSITORY_URL } from "../../../shared/seo";

const repositoryUrl = SEO_REPOSITORY_URL;
</script>
