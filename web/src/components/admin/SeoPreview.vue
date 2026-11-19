<template>
  <div class="seo-preview">
    <figure class="seo-serp" aria-label="搜索结果预览">
      <figcaption class="seo-preview__caption">搜索结果</figcaption>
      <div class="seo-serp__site">
        <span class="seo-serp__names"><strong>{{ siteName }}</strong><small>{{ shownUrl }}</small></span>
      </div>
      <p class="seo-serp__title">{{ shownTitle }}</p>
      <p class="seo-serp__desc">{{ shownDescription }}</p>
    </figure>

    <figure class="seo-share" :class="{ 'is-compact': card === 'summary' }" aria-label="分享卡片预览">
      <figcaption class="seo-preview__caption">分享卡片</figcaption>
      <div class="seo-share__card">
        <div class="seo-share__image">
          <img v-if="imageUrl && !imageFailed" :src="imageUrl" alt="" @error="imageFailed = true" />
          <span v-else class="seo-share__empty">{{ imageUrl ? "图片无法加载" : "没有图片" }}</span>
        </div>
        <div class="seo-share__body">
          <small>{{ host }}</small>
          <strong>{{ truncateByWidth(title, 70) }}</strong>
          <p>{{ truncateByWidth(description, 110) }}</p>
        </div>
      </div>
    </figure>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { truncateByWidth } from "../../../../shared/seo";

const props = defineProps<{
  siteName: string; title: string; description: string; origin: string; imageUrl: string; card: "summary" | "summary_large_image";
}>();

const imageFailed = ref(false);
watch(() => props.imageUrl, () => { imageFailed.value = false; });

const host = computed(() => props.origin ? props.origin.replace(/^https?:\/\//, "") : "your-domain.example");
const shownUrl = computed(() => props.origin ? `${props.origin} › ` : "https://your-domain.example › ");
const shownTitle = computed(() => truncateByWidth(props.title, 60));
const shownDescription = computed(() => truncateByWidth(props.description, 160));
</script>

<style scoped>
.seo-preview { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 16px; }
.seo-preview figure { min-width: 0; margin: 0; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-l); background: var(--surface-2); }
.seo-preview__caption { margin: 0 0 12px; color: var(--ink-3); font-size: 12.5px; }
.seo-serp__site { display: flex; align-items: center; gap: 10px; min-width: 0; }
.seo-serp__names { display: grid; min-width: 0; line-height: 1.35; }
.seo-serp__names strong { overflow: hidden; color: var(--ink); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.seo-serp__names small { overflow: hidden; color: var(--ink-3); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.seo-serp__title { margin: 10px 0 4px; color: var(--ink); font-size: 18px; font-weight: 650; line-height: 1.4; overflow-wrap: anywhere; }
.seo-serp__desc { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.seo-share__card { overflow: hidden; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--surface); }
.seo-share__image { display: grid; place-items: center; aspect-ratio: 1200 / 630; background: var(--blue-100); }
.seo-share__image img { display: block; width: 100%; height: 100%; object-fit: cover; }
.seo-share__empty { color: var(--ink-3); font-size: 12.5px; }
.seo-share__body { display: grid; gap: 4px; min-width: 0; padding: 12px 14px 14px; }
.seo-share__body small { color: var(--ink-3); font-size: 11.5px; letter-spacing: .04em; overflow-wrap: anywhere; text-transform: uppercase; }
.seo-share__body strong { color: var(--ink); font-size: 14px; font-weight: 650; line-height: 1.45; overflow-wrap: anywhere; }
.seo-share__body p { display: -webkit-box; margin: 0; overflow: hidden; color: var(--ink-2); font-size: 12.5px; line-height: 1.6; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.seo-share.is-compact .seo-share__card { display: grid; grid-template-columns: 96px minmax(0, 1fr); }
.seo-share.is-compact .seo-share__image { height: 100%; aspect-ratio: 1; }
@media (max-width: 900px) { .seo-preview { grid-template-columns: minmax(0, 1fr); } }
</style>
