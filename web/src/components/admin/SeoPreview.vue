<template>
  <div class="seo-preview">
    <figure class="seo-serp" aria-label="搜索结果预览">
      <figcaption class="seo-preview__caption">搜索结果</figcaption>
      <div class="seo-serp__site">
        <span class="seo-serp__icon" aria-hidden="true"><img src="/logo.svg" alt="" width="18" height="18" /></span>
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
// 搜索结果里标题约显示 30 个汉字、描述约 80 个汉字，超出的部分会被省略号替代。
const shownTitle = computed(() => truncateByWidth(props.title, 60));
const shownDescription = computed(() => truncateByWidth(props.description, 160));
</script>

<style scoped>
.seo-preview { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.seo-preview figure { margin: 0; min-width: 0; padding: 16px; border: 1px solid var(--line-blue); border-radius: 18px; background: var(--surface, #fff); }
.seo-preview__caption { margin: 0 0 12px; color: var(--text-soft); font-size: 12px; }
.seo-serp__site { display: flex; align-items: center; gap: 10px; min-width: 0; }
.seo-serp__icon { display: grid; place-items: center; flex: 0 0 auto; width: 28px; height: 28px; border: 1px solid var(--line-blue); border-radius: 50%; overflow: hidden; background: var(--cloud-blue); }
.seo-serp__icon img { display: block; width: 18px; height: 18px; }
.seo-serp__names { display: grid; min-width: 0; line-height: 1.35; }
.seo-serp__names strong { overflow: hidden; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.seo-serp__names small { overflow: hidden; color: var(--text-soft); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.seo-serp__title { margin: 10px 0 4px; color: var(--action-blue-ink, #3d5f9c); font-size: 18px; line-height: 1.4; overflow-wrap: anywhere; }
.seo-serp__desc { margin: 0; color: var(--text-soft); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.seo-share__card { overflow: hidden; border: 1px solid var(--line-blue); border-radius: 14px; }
.seo-share__image { display: grid; place-items: center; aspect-ratio: 1200 / 630; background: var(--cloud-blue); }
.seo-share__image img { display: block; width: 100%; height: 100%; object-fit: cover; }
.seo-share__empty { color: var(--text-soft); font-size: 12px; }
.seo-share__body { display: grid; gap: 4px; padding: 12px 14px 14px; min-width: 0; }
.seo-share__body small { color: var(--text-soft); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; overflow-wrap: anywhere; }
.seo-share__body strong { font-size: 14px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
.seo-share__body p { margin: 0; color: var(--text-soft); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.seo-share.is-compact .seo-share__card { display: grid; grid-template-columns: 96px minmax(0, 1fr); }
.seo-share.is-compact .seo-share__image { aspect-ratio: 1; height: 100%; }
@media (max-width: 900px) { .seo-preview { grid-template-columns: minmax(0, 1fr); } }
</style>
