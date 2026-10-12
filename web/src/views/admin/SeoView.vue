<template>
  <form class="admin-page-stack seo" novalidate :aria-busy="loading || saving" @submit.prevent="save">
    <section v-motion="{ kind: 'feature' }" class="admin-panel" aria-labelledby="seo-score-title">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">SEO 管理</span>
          <h2 id="seo-score-title">首页达标情况</h2>
        </div>
        <span class="badge" :class="gradeTone">{{ state ? report.grade : "未读取" }}</span>
      </div>
      <p v-if="loading && !state" class="admin-page-state" role="status">正在读取 SEO 设置…</p>
      <p v-if="loadError" v-capsule-notice class="form-error" role="alert">
        {{ loadError }}
        <button class="button button--soft" type="button" :disabled="loading" @click="load">重试读取</button>
      </p>

      <template v-if="state">
        <div class="seo-score">
          <strong class="seo-score__number" aria-live="polite">{{ report.score }}<small>分</small></strong>
          <div class="seo-score__meter" role="meter" aria-label="SEO 达标得分" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="report.score">
            <i :class="gradeTone" :style="{ width: `${report.score}%` }"></i>
          </div>
          <p class="seo-score__counts">
            <span>{{ report.counts.pass }} 项达标</span>
            <span :class="{ 'is-warn': report.counts.warn > 0 }">{{ report.counts.warn }} 项建议改进</span>
            <span :class="{ 'is-bad': report.counts.fail > 0 }">{{ report.counts.fail }} 项未达标</span>
          </p>
        </div>
        <div class="seo-groups">
          <section v-for="group in groups" :key="group.name" class="seo-group">
            <h3>{{ group.name }}</h3>
            <ul>
              <li v-for="check in group.checks" :key="check.id" class="seo-check" :class="`is-${check.level}`">
                <span class="seo-check__mark" aria-hidden="true"></span>
                <div>
                  <button v-if="fieldFor[check.id]" class="seo-check__label" type="button" @click="jumpTo(check.id)">{{ check.label }}</button>
                  <strong v-else class="seo-check__label">{{ check.label }}</strong>
                  <span class="seo-check__state">{{ levelText[check.level] }}</span>
                  <p>{{ check.detail }}</p>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </section>

    <template v-if="state">
      <section v-motion="{ kind: 'compact', delay: 40 }" class="admin-panel" aria-labelledby="seo-name-title">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">站点名称</span>
            <h2 id="seo-name-title">名称与副标题</h2>
          </div>
        </div>
        <div class="seo-fields">
          <label class="field">
            <span class="field__label">站点名称</span>
            <input id="seo-site-name" v-model="form.siteName" maxlength="30" autocomplete="off" placeholder="例如：某某邮箱" :disabled="saving" aria-describedby="seo-site-name-count" />
            <small id="seo-site-name-count" class="seo-count" :class="tone('site-name')">{{ chars(form.siteName) }}/30 字符</small>
          </label>
          <label class="field">
            <span class="field__label">副标题</span>
            <input id="seo-tagline" v-model="form.tagline" maxlength="40" autocomplete="off" :placeholder="SEO_DEFAULT_TAGLINE" :disabled="saving" aria-describedby="seo-tagline-count" />
            <small id="seo-tagline-count" class="seo-count">{{ form.tagline ? `${chars(form.tagline)}/40 字符` : "留空使用默认" }}</small>
          </label>
        </div>
        <p class="hint-line">页面底部的开源仓库链接和版权标记固定显示，不受这里的设置影响。</p>
      </section>

      <section v-motion="{ kind: 'compact', delay: 80 }" class="admin-panel" aria-labelledby="seo-search-title">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">搜索结果</span>
            <h2 id="seo-search-title">标题、描述与关键词</h2>
          </div>
        </div>
        <div class="seo-fields">
          <label class="field is-wide">
            <span class="field__label">首页标题</span>
            <input id="seo-title" v-model="form.homeTitle" maxlength="80" autocomplete="off" :placeholder="autoTitle" :disabled="saving" aria-describedby="seo-title-count" />
            <small id="seo-title-count" class="seo-count" :class="tone('title-length')">
              {{ form.homeTitle ? "" : "自动生成 · " }}约 {{ approxChars(eff.title) }} 字（建议 8–30 字）
              <button v-if="form.homeTitle" class="seo-link" type="button" @click="form.homeTitle = ''">恢复自动</button>
            </small>
          </label>
          <label class="field is-wide">
            <span class="field__label">首页描述</span>
            <textarea id="seo-description" v-model="form.description" rows="4" maxlength="300" :placeholder="autoDescription" :disabled="saving" aria-describedby="seo-description-count"></textarea>
            <small id="seo-description-count" class="seo-count" :class="tone('description-length')">
              {{ form.description ? "" : "自动生成 · " }}约 {{ approxChars(eff.description) }} 字（建议 50–80 字）
              <button v-if="form.description" class="seo-link" type="button" @click="form.description = ''">恢复自动</button>
            </small>
          </label>
          <label class="field is-wide">
            <span class="field__label">关键词</span>
            <textarea id="seo-keywords" v-model="form.keywordsText" rows="2" placeholder="每行一个，或用逗号分隔；留空自动生成" :disabled="saving" aria-describedby="seo-keywords-count"></textarea>
            <small id="seo-keywords-count" class="seo-count" :class="tone('keywords')">
              {{ keywordList.length ? `${keywordList.length} 个（建议 3–8 个）` : `自动生成 ${eff.keywords.length} 个` }}
            </small>
          </label>
        </div>
        <SeoPreview class="seo-preview-block" :site-name="eff.siteName" :title="eff.title" :description="eff.description" :origin="originValue" :image-url="previewImage" :card="eff.twitterCard" />
      </section>

      <section v-motion="{ kind: 'compact', delay: 120 }" class="admin-panel" aria-labelledby="seo-index-title">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">收录与地址</span>
            <h2 id="seo-index-title">让搜索引擎找到你</h2>
          </div>
        </div>
        <div class="seo-fields">
          <label class="field is-wide">
            <span class="field__label">规范网址</span>
            <input id="seo-origin" v-model="form.canonicalOrigin" inputmode="url" autocapitalize="none" spellcheck="false" autocomplete="off" :placeholder="state.envOrigin || 'https://mail.example.com'" :disabled="saving" aria-describedby="seo-origin-help" />
            <small id="seo-origin-help" class="seo-count" :class="tone('canonical')">
              {{ form.canonicalOrigin ? "使用这里填写的地址" : state.envOrigin ? `留空使用服务器配置的 ${state.envOrigin}` : "留空且服务器没有配置公开地址时，canonical、分享图片和站点地图都无法生成" }}
            </small>
          </label>
        </div>
        <ul class="seo-switches">
          <li>
            <div><strong>允许搜索引擎收录首页</strong><small>登录、注册、邮箱和后台页面始终不收录</small></div>
            <ToggleSwitch id="seo-index-home" v-model="form.indexHome" label="允许搜索引擎收录首页" :disabled="saving" />
          </li>
          <li>
            <div><strong>站点地图</strong><small>输出 /sitemap.xml，并写入 robots.txt</small></div>
            <ToggleSwitch id="seo-sitemap" v-model="form.sitemap" label="输出站点地图" :disabled="saving" />
          </li>
          <li>
            <div><strong>结构化数据</strong><small>在首页输出 JSON-LD，内容与页面一致</small></div>
            <ToggleSwitch id="seo-structured-data" v-model="form.structuredData" label="输出结构化数据" :disabled="saving" />
          </li>
        </ul>
        <div class="seo-files">
          <div>
            <div class="seo-files__head">
              <h3>robots.txt</h3>
              <a class="seo-link" href="/robots.txt" target="_blank" rel="noopener noreferrer">打开线上文件</a>
            </div>
            <pre class="seo-code" tabindex="0" aria-label="robots.txt 预览">{{ robotsPreview }}</pre>
          </div>
          <div>
            <div class="seo-files__head">
              <h3>站点地图</h3>
              <a class="seo-link" href="/sitemap.xml" target="_blank" rel="noopener noreferrer">打开线上文件</a>
            </div>
            <pre class="seo-code" tabindex="0" aria-label="站点地图预览">{{ sitemapPreview }}</pre>
          </div>
        </div>
        <p class="hint-line">预览按当前填写的内容生成；点击“保存”后，线上文件才会更新。</p>
      </section>

      <section v-motion="{ kind: 'compact', delay: 160 }" class="admin-panel" aria-labelledby="seo-share-title">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">分享</span>
            <h2 id="seo-share-title">分享卡片与主题色</h2>
          </div>
        </div>
        <div class="seo-fields">
          <label class="field is-wide">
            <span class="field__label">分享图片</span>
            <input id="seo-og-image" v-model="form.ogImage" inputmode="url" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="留空使用内置图片，或填 https://… 地址" :disabled="saving" aria-describedby="seo-og-image-help" />
            <small id="seo-og-image-help" class="seo-count" :class="tone('og-image')">建议 1200×630，png、jpg 或 webp，小于 1MB。</small>
          </label>
          <label class="field">
            <span class="field__label">卡片样式</span>
            <select v-theme-control v-model="form.twitterCard" :disabled="saving">
              <option value="summary_large_image">大图卡片</option>
              <option value="summary">小图卡片</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">主题色</span>
            <span class="seo-color">
              <i class="seo-color__swatch" :style="{ background: swatch }" aria-hidden="true"></i>
              <input id="seo-theme-color" v-model="form.themeColor" maxlength="7" autocomplete="off" spellcheck="false" placeholder="#F7F9FC" :disabled="saving" />
            </span>
          </label>
        </div>
      </section>

      <section v-motion="{ kind: 'compact', delay: 200 }" class="admin-panel" aria-labelledby="seo-verify-title">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">站长平台</span>
            <h2 id="seo-verify-title">所有权验证</h2>
          </div>
        </div>
        <div class="seo-fields">
          <label v-for="item in verificationFields" :key="item.key" class="field">
            <span class="field__label">{{ item.label }}</span>
            <input :id="`seo-verify-${item.key}`" v-model="form.verification[item.key]" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="粘贴验证码，或整段 meta 标签" :disabled="saving" @blur="tidyVerification(item.key)" />
          </label>
        </div>
      </section>

      <section v-motion="{ kind: 'compact', delay: 240 }" class="admin-panel" aria-labelledby="seo-head-title">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">页面头部</span>
            <h2 id="seo-head-title">首页输出的标签</h2>
          </div>
        </div>
        <details class="seo-details">
          <summary>查看按当前内容生成的 &lt;head&gt; 标签</summary>
          <pre class="seo-code seo-code--tall" tabindex="0" aria-label="首页头部标签预览">{{ headPreview }}</pre>
        </details>
      </section>

      <div class="seo-savebar" role="region" aria-label="保存 SEO 设置">
        <p class="seo-savebar__state" :class="{ 'is-bad': Boolean(problem) || Boolean(saveError) }" role="status">{{ barText }}</p>
        <div class="seo-savebar__actions">
          <button class="button button--soft" type="button" :disabled="busy" @click="resetDefaults">{{ resetting ? "正在恢复…" : "恢复默认" }}</button>
          <button class="button button--soft" type="button" :disabled="busy || !dirty" @click="discard">放弃修改</button>
          <button v-if="conflict" class="button button--soft" type="button" :disabled="busy" @click="reloadDiscarding">重新读取</button>
          <button v-press-feedback="'submit'" class="button button--primary" type="submit" :disabled="!canSave" :aria-busy="saving">{{ saving ? "正在保存…" : "保存" }}</button>
        </div>
      </div>
    </template>
  </form>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ApiError, toast } from "../../api";
import { loadSeo, resetSeo, saveSeo, type SeoState } from "../../api/seo";
import { confirmDialog } from "../../dialog";
import { applySiteInfo, siteInfo } from "../../siteInfo";
import SeoPreview from "../../components/admin/SeoPreview.vue";
import ToggleSwitch from "../../components/admin/ToggleSwitch.vue";
import {
  SEO_DEFAULT_TAGLINE, VERIFICATION_KEYS, VERIFICATION_LABELS, approxChars, defaultDescription, defaultSeoConfig, defaultTitle,
  evaluateSeo, extractVerification, parseKeywords, parseSeoConfig, renderHomeHead, renderRobotsTxt, renderSitemapXml, resolveSeo, siteInfoOf,
  type SeoCheck, type SeoConfig, type SeoLevel, type VerificationKey,
} from "../../../../shared/seo";

const state = ref<SeoState | null>(null);
const loading = ref(false);
const saving = ref(false);
const resetting = ref(false);
const loadError = ref("");
const saveError = ref("");
const conflict = ref(false);
const busy = computed(() => saving.value || resetting.value || loading.value);

type Form = Omit<SeoConfig, "keywords"> & { keywordsText: string };
const blank = (): Form => { const { keywords: _keywords, ...rest } = defaultSeoConfig(); return { ...rest, keywordsText: "" }; };
const form = reactive<Form>(blank());

function fill(config: SeoConfig): void {
  const { keywords, ...rest } = config;
  Object.assign(form, rest, { keywordsText: keywords.join("\n"), verification: { ...config.verification } });
}

const candidate = computed(() => {
  const { keywordsText, ...rest } = form;
  return { ...rest, keywords: parseKeywords(keywordsText), verification: { ...form.verification } };
});
const parsed = computed(() => parseSeoConfig(candidate.value));
const problem = computed(() => (parsed.value.ok ? "" : parsed.value.message));
const keywordList = computed(() => parseKeywords(form.keywordsText));

// 输入暂时不合法时，评分和预览沿用上一次合法的内容，避免整页跳变。
const lastGood = ref<SeoConfig>(defaultSeoConfig());
watch(parsed, (value) => { if (value.ok) lastGood.value = value.config; }, { immediate: true });
const live = computed(() => (parsed.value.ok ? parsed.value.config : lastGood.value));
const originValue = computed(() => live.value.canonicalOrigin || state.value?.envOrigin || "");
const eff = computed(() => resolveSeo(live.value, originValue.value));
const report = computed(() => evaluateSeo(live.value, originValue.value));

const dirty = computed(() => Boolean(state.value) && (!parsed.value.ok || JSON.stringify(parsed.value.config) !== JSON.stringify(state.value!.config)));
const canSave = computed(() => dirty.value && parsed.value.ok && !busy.value);

const autoTitle = computed(() => defaultTitle(live.value.siteName));
const autoDescription = computed(() => defaultDescription(live.value.siteName));
// 预览直接用填写的值（站内路径同源加载，https 地址由浏览器加载），不依赖规范网址是否已经能访问。
const previewImage = computed(() => live.value.ogImage || "/og-image.png");
const swatch = computed(() => (/^#[0-9a-fA-F]{6}$/.test(form.themeColor.trim()) ? form.themeColor.trim() : "transparent"));

const robotsPreview = computed(() => renderRobotsTxt(eff.value).trimEnd());
const sitemapPreview = computed(() => renderSitemapXml(eff.value, state.value?.updatedAt ?? "")?.trimEnd()
  ?? (!eff.value.indexHome ? "（首页不收录，不输出站点地图）" : !eff.value.sitemap ? "（站点地图已关闭）" : "（需要先有规范网址）"));
const headPreview = computed(() => `<title>${eff.value.title}</title>\n${renderHomeHead(eff.value)}`);

const levelText: Record<SeoLevel, string> = { pass: "达标", warn: "建议改进", fail: "未达标", info: "提示" };
const gradeTone = computed(() => ({ 优秀: "badge--mint", 良好: "badge--blue", 需要改进: "badge--yellow", 不达标: "badge--danger" } as const)[report.value.grade]);
const groups = computed(() => {
  const order: SeoCheck["group"][] = ["标题与描述", "收录与地址", "分享与结构化", "站长平台"];
  return order.map((name) => ({ name, checks: report.value.checks.filter((check) => check.group === name) }));
});
const levelById = computed(() => Object.fromEntries(report.value.checks.map((check) => [check.id, check.level])) as Record<string, SeoLevel>);
const tone = (id: string): string => ({ pass: "is-good", warn: "is-warn", fail: "is-bad", info: "" } as const)[levelById.value[id] ?? "info"];
const chars = (text: string): number => [...text].length;

/** 评分项对应的输入框，点评分项直接定位过去。 */
const fieldFor: Record<string, string> = {
  "site-name": "seo-site-name", "title-length": "seo-title", "title-brand": "seo-title", "description-length": "seo-description",
  "description-distinct": "seo-description", keywords: "seo-keywords", canonical: "seo-origin", "index-home": "seo-index-home",
  sitemap: "seo-sitemap", "structured-data": "seo-structured-data", "og-image": "seo-og-image", "theme-color": "seo-theme-color", verification: "seo-verify-google",
};
function jumpTo(id: string): void {
  const element = document.getElementById(fieldFor[id] ?? "");
  if (!element) return;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  element.focus({ preventScroll: true });
}

const verificationFields = VERIFICATION_KEYS.map((key) => ({ key, label: `${VERIFICATION_LABELS[key]}验证码` }));
function tidyVerification(key: VerificationKey): void { form.verification[key] = extractVerification(form.verification[key]); }

const message = (reason: unknown, fallback: string): string => (reason instanceof ApiError ? reason.message : fallback);

function adopt(next: SeoState): void {
  state.value = next;
  fill(next.config);
  // 品牌和浏览器标题立即跟着新的站点名变化，不用刷新页面。
  applySiteInfo(siteInfoOf(next.effective));
  document.title = siteInfo.siteName;
}

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  loadError.value = "";
  try { adopt(await loadSeo()); conflict.value = false; saveError.value = ""; }
  catch (reason) { loadError.value = `SEO 设置读取失败：${message(reason, "请稍后重试")}`; }
  finally { loading.value = false; }
}

async function save(): Promise<void> {
  if (!canSave.value || !state.value || !parsed.value.ok) return;
  saving.value = true;
  saveError.value = "";
  try {
    adopt(await saveSeo(parsed.value.config, state.value.revision));
    conflict.value = false;
    toast("SEO 设置已保存，线上页面已更新");
  } catch (reason) {
    saveError.value = message(reason, "保存失败，请稍后重试");
    conflict.value = reason instanceof ApiError && reason.status === 409;
  } finally { saving.value = false; }
}

function discard(): void {
  if (!state.value) return;
  fill(state.value.config);
  saveError.value = "";
}

async function reloadDiscarding(): Promise<void> {
  if (!(await confirmDialog({ title: "重新读取", message: "会丢弃你现在填写的修改，改用服务器上最新保存的内容。", confirmLabel: "重新读取" }))) return;
  await load();
}

async function resetDefaults(): Promise<void> {
  if (busy.value) return;
  if (!(await confirmDialog({
    title: "恢复默认设置",
    message: "站点名称回到 Baka Mail，标题、描述、关键词、规范网址、分享图片和站长验证码都会清空或恢复为自动，线上页面立即更新。",
    confirmLabel: "恢复默认",
    tone: "danger",
  }))) return;
  resetting.value = true;
  saveError.value = "";
  try { adopt(await resetSeo()); conflict.value = false; toast("已恢复默认 SEO 设置"); }
  catch (reason) { saveError.value = message(reason, "恢复失败，请稍后重试"); }
  finally { resetting.value = false; }
}

const barText = computed(() => {
  if (saveError.value) return saveError.value;
  if (problem.value) return problem.value;
  if (dirty.value) return "有未保存的修改";
  return state.value?.updatedAt ? `已保存，最近一次 ${formatTime(state.value.updatedAt)}` : "当前使用默认设置";
});
const formatTime = (value: string): string => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); };

onBeforeRouteLeave(async () => !dirty.value || (await confirmDialog({
  title: "放弃未保存的修改？",
  message: "SEO 设置还没有保存，离开后这些修改会丢失。",
  confirmLabel: "放弃并离开",
  tone: "danger",
})));
const beforeUnload = (event: BeforeUnloadEvent): void => { if (dirty.value) { event.preventDefault(); event.returnValue = ""; } };
onMounted(() => { window.addEventListener("beforeunload", beforeUnload); void load(); });
onBeforeUnmount(() => { window.removeEventListener("beforeunload", beforeUnload); });
</script>

<style scoped>
.seo h3 { margin: 0; font-size: 14px; font-weight: 600; }
.seo-score { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px 22px; margin-top: 4px; }
.seo-score__number { font-size: 44px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
.seo-score__number small { margin-left: 4px; font-size: 14px; font-weight: 500; color: var(--text-soft); }
.seo-score__meter { height: 10px; overflow: hidden; border: 1px solid var(--line-blue); border-radius: 999px; background: #eef3f8; }
.seo-score__meter i { display: block; height: 100%; border-radius: 999px; background: #a8d0f4; transition: width 240ms var(--ease, ease); }
.seo-score__meter i.badge--mint { background: #7fcaa6; }
.seo-score__meter i.badge--yellow { background: #e6c273; }
.seo-score__meter i.badge--danger { background: #d98e8e; }
.seo-score__counts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; color: var(--text-soft); font-size: 13px; }
.seo-score__counts .is-warn { color: #8a6a24; }
.seo-score__counts .is-bad { color: var(--danger-700, #a24c4c); }
.seo-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 28px; margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--line-blue); }
.seo-group { min-width: 0; }
.seo-group ul { margin: 10px 0 0; padding: 0; list-style: none; }
.seo-check { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-top: 1px solid var(--line-blue); }
.seo-check:first-child { border-top: 0; }
.seo-check > div { min-width: 0; }
.seo-check p { margin: 4px 0 0; color: var(--text-soft); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.seo-check__label { display: inline; margin: 0; padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-size: 14px; font-weight: 600; text-align: left; }
button.seo-check__label { cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-blue-strong, #bed8ef); text-underline-offset: 3px; }
button.seo-check__label:focus-visible { outline: 3px solid rgba(143, 198, 232, .4); outline-offset: 2px; border-radius: 4px; }
.seo-check__state { margin-left: 8px; color: var(--text-soft); font-size: 12px; white-space: nowrap; }
.seo-check__mark { position: relative; width: 18px; height: 18px; margin-top: 2px; border-radius: 50%; background: #e9eff4; }
.seo-check__mark::after { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 700; line-height: 1; }
.seo-check.is-pass .seo-check__mark { background: #5fb98f; }
.seo-check.is-pass .seo-check__mark::after { content: "✓"; }
.seo-check.is-warn .seo-check__mark { background: #d9a93f; }
.seo-check.is-warn .seo-check__mark::after { content: "!"; }
.seo-check.is-fail .seo-check__mark { background: #cf7777; }
.seo-check.is-fail .seo-check__mark::after { content: "×"; font-size: 13px; }
.seo-check.is-info .seo-check__mark { background: #9bb7d3; }
.seo-check.is-info .seo-check__mark::after { content: "i"; }
.seo-check.is-warn .seo-check__state { color: #8a6a24; }
.seo-check.is-fail .seo-check__state { color: var(--danger-700, #a24c4c); }
.seo-check.is-pass .seo-check__state { color: #2c7a5a; }

.seo-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.seo-fields .field { min-width: 0; align-content: start; }
.seo-fields .is-wide { grid-column: 1 / -1; }
.seo-count { display: block; margin-top: 6px; color: var(--text-soft); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.seo-count.is-good { color: #2c7a5a; }
.seo-count.is-warn { color: #8a6a24; }
.seo-count.is-bad { color: var(--danger-700, #a24c4c); }
.seo-link { margin-left: 8px; padding: 0; border: 0; background: none; color: var(--action-blue-ink, #3d5f9c); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.seo-link:focus-visible { outline: 3px solid rgba(143, 198, 232, .4); outline-offset: 2px; border-radius: 4px; }
.seo-preview-block { margin-top: 20px; }
.seo .hint-line { margin: 14px 0 0; color: var(--text-soft); font-size: 12px; line-height: 1.7; }

.seo-switches { margin: 20px 0 0; padding: 0; list-style: none; }
.seo-switches li { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 10px 0; border-top: 1px solid var(--line-blue); }
.seo-switches li > div { display: grid; gap: 2px; min-width: 0; }
.seo-switches strong { font-size: 14px; font-weight: 600; }
.seo-switches small { color: var(--text-soft); font-size: 12px; line-height: 1.6; }
.seo-files { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
.seo-files > div { min-width: 0; }
.seo-files__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.seo-code { margin: 0; padding: 12px 14px; max-height: 190px; overflow: auto; border: 1px solid var(--line-blue); border-radius: 14px; background: #f6f9fc; color: var(--text); font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; tab-size: 2; }
.seo-code--tall { max-height: 320px; margin-top: 12px; }
.seo-code:focus-visible { outline: 3px solid rgba(143, 198, 232, .4); outline-offset: 2px; }
.seo-details summary { cursor: pointer; color: var(--text-soft); font-size: 13px; }

.seo-color { display: flex; align-items: center; gap: 10px; }
.seo-color input { min-width: 0; flex: 1 1 auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.seo-color__swatch { flex: 0 0 auto; width: 32px; height: 32px; border: 1px solid var(--line-blue); border-radius: 10px; }

.seo-savebar { position: sticky; bottom: 14px; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; padding: 12px 16px; border: 1px solid var(--line-blue); border-radius: 18px; background: var(--surface, #fff); box-shadow: 0 8px 28px rgba(72, 105, 131, .12); }
.seo-savebar__state { flex: 1 1 220px; min-width: 0; margin: 0; color: var(--text-soft); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.seo-savebar__state.is-bad { color: var(--danger-700, #a24c4c); }
.seo-savebar__actions { display: flex; flex-wrap: wrap; gap: 10px; }

@media (max-width: 900px) { .seo-groups, .seo-files { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) {
  .seo-fields { grid-template-columns: minmax(0, 1fr); }
  .seo-score { grid-template-columns: minmax(0, 1fr); }
  .seo-score__number { font-size: 38px; }
  .seo-savebar { bottom: 10px; padding: 12px; }
  .seo-savebar__actions { width: 100%; }
  .seo-savebar__actions .button { flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) { .seo-score__meter i { transition: none; } }
</style>
