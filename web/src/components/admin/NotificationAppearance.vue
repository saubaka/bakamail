<template>
  <section v-motion="{ kind: 'feature' }" class="admin-panel is-wide appearance-panel" :aria-busy="state.loading || state.saving">
    <div class="panel-heading">
      <div><span class="eyebrow">主题与动效</span><h2>胶囊通知设置</h2><p>显示时间决定停留多久，动画时间决定如何出现。五类反馈分别设置。</p></div>
      <span class="badge badge--gray">{{ !state.saved ? '尚未读取' : dirty ? '有未保存编辑' : `已保存 · 版本 ${state.saved.revision}` }}</span>
    </div>
    <p v-if="state.loading" class="admin-page-state" role="status">正在读取通知设置…</p>
    <p v-if="state.error" class="appearance-state" role="status">{{ state.error }}</p>
    <button v-if="state.blocked && !state.incoming" class="button button--soft" type="button" :disabled="state.loading || state.saving" @click="reload">重新读取已保存配置</button>
    <section v-if="state.incoming" class="appearance-review" aria-labelledby="appearance-review-heading">
      <h3 id="appearance-review-heading">重新读取后的配置审阅</h3>
      <p class="appearance-help">服务器版本 {{ state.incoming.revision }}。保留草稿只更换版本基线，不会自动保存；请审阅全部显示和动画值后再提交。</p>
      <div class="appearance-review-grid">
        <section><h4>本次草稿</h4><p v-for="type in types" :key="type">{{ describe(editor.candidate(), type) }}</p><p>堆叠 {{ state.draft.notificationMotion.stackMs }} 毫秒</p></section>
        <section><h4>服务器已保存</h4><p v-for="type in types" :key="type">{{ describe(state.incoming, type) }}</p><p>堆叠 {{ state.incoming.notificationMotion.stackMs }} 毫秒</p></section>
      </div>
      <div class="appearance-actions">
        <button class="button button--soft" type="button" @click="editor.review(false)">放弃本次草稿，采用已保存配置</button>
        <button class="button button--soft" type="button" @click="editor.review(true)">保留本次草稿，按新版本继续审阅</button>
      </div>
    </section>
    <form v-if="state.saved" class="appearance-form" novalidate @submit.prevent="save">
      <fieldset class="appearance-display" :disabled="disabled">
        <legend class="appearance-legend">显示与关闭（秒）</legend>
        <p class="appearance-help" id="appearance-display-help">可设为 1–120 秒的整数，从通知完整显示后开始计时，不含动画时间。鼠标悬停、键盘聚焦、被其他通知盖住或页面在后台时会暂停计时。选“手动关闭”则一直显示，直到点关闭。</p>
        <div class="appearance-types">
          <section v-for="type in types" :key="type" class="appearance-type">
            <h3>{{ labels[type] }}</h3>
            <div class="appearance-fields">
              <label class="field"><span class="field__label">{{ labels[type] }}显示方式</span>
                <select v-theme-control :value="state.draft.notificationDisplay.types[type].mode" :disabled="disabled" aria-describedby="appearance-display-help" @change="changeMode(type, $event)">
                  <option :value="type === 'loading' ? 'timedHide' : 'timed'">{{ type === 'loading' ? '指定时间后收起' : '定时关闭' }}</option>
                  <option :value="type === 'loading' ? 'untilSettled' : 'manual'">{{ type === 'loading' ? '等待任务结束' : '手动关闭' }}</option>
                </select>
              </label>
              <label v-if="timed(type)" class="field"><span class="field__label">{{ labels[type] }}停留秒数</span>
                <input v-theme-control v-model.number="state.seconds[type]" :disabled="disabled" type="number" min="1" max="120" step="1" inputmode="numeric" :aria-label="`${labels[type]}停留秒数`" aria-describedby="appearance-display-help" :aria-invalid="validSeconds(type) ? undefined : 'true'" />
              </label>
              <p v-else class="appearance-policy-note">{{ type === 'loading' ? '任务未结束时保持提示，可手动关闭。' : '保持显示，直到手动关闭。' }}</p>
            </div>
            <p v-if="type === 'loading'" class="appearance-help">收起或关闭提示不会取消请求、改变超时或中止邮件操作；有效任务结束后仍显示结果。</p>
          </section>
        </div>
        <div class="appearance-actions">
          <button class="button button--soft" type="button" @click="editor.displayPreset('quick')">简短阅读预设</button>
          <button class="button button--soft" type="button" @click="editor.displayPreset('gentle')">充裕阅读预设</button>
          <button class="button button--soft" type="button" @click="editor.displayPreset('default')">恢复显示默认</button>
        </div>
        <p class="appearance-help">预设只改显示时间：简短为 3/4/6 秒，充裕为 8/10/12 秒（依次对应成功、提示、警告）。错误仍需手动关闭，加载仍等任务结束。下方的动画设置不受影响。</p>
      </fieldset>
      <fieldset class="appearance-motion" :disabled="disabled">
        <legend class="appearance-legend">动画与切换（毫秒）</legend>
        <p class="appearance-help" id="appearance-help">可以填 0，表示没有动画。入场、退场最长 3000 毫秒，文字切换最长 1000 毫秒。系统或本机开启“减少动态效果”时以它为准；动画不会缩短阅读时间。</p>
        <div class="appearance-types">
          <section v-for="type in types" :key="type" class="appearance-type">
            <h3>{{ labels[type] }}</h3>
            <div class="appearance-fields">
              <label v-for="field in fields" :key="field.key" class="field"><span class="field__label">{{ field.label }}</span>
                <input v-theme-control v-model.number="state.draft.notificationMotion.types[type][field.key]" :disabled="disabled" type="number" min="0" :max="field.max" step="1" inputmode="numeric"
                  :aria-label="`${labels[type]}${field.label}毫秒`" aria-describedby="appearance-help" :aria-invalid="valid ? undefined : 'true'" />
              </label>
            </div>
          </section>
        </div>
        <label class="field appearance-stack-field"><span class="field__label">堆叠切换时长（0–1500 毫秒）</span>
          <input v-theme-control v-model.number="state.draft.notificationMotion.stackMs" :disabled="disabled" type="number" min="0" max="1500" step="1" inputmode="numeric" :aria-invalid="valid ? undefined : 'true'" />
        </label>
        <div class="appearance-actions">
          <button class="button button--soft" type="button" @click="editor.motionPreset('quick')">轻快动画预设</button>
          <button class="button button--soft" type="button" @click="editor.motionPreset('gentle')">舒缓动画预设</button>
          <button class="button button--soft" type="button" @click="editor.motionPreset('default')">恢复动画默认</button>
        </div>
      </fieldset>
      <p v-if="!valid" class="appearance-state" id="appearance-validation" role="status">请填写范围内的整数；空值、小数和越界值不能预览或保存。</p>
      <div class="appearance-save-row">
        <p class="appearance-help">{{ state.blocked ? '读取失败或版本冲突：保存已禁用，请重新读取并审阅。' : '显示与动画一起保存；预设只修改草稿，保存后才影响后续全局通知。' }}</p>
        <button class="button button--soft" type="button" :disabled="disabled || !dirty" @click="undo">撤销未保存编辑</button>
        <button v-press-feedback="'submit'" class="button button--primary" type="submit" :disabled="disabled || !valid || !dirty">{{ state.saving ? '保存中…' : '保存通知设置' }}</button>
      </div>
    </form>
    <section v-if="state.saved" class="appearance-preview" aria-labelledby="appearance-preview-heading">
      <h3 id="appearance-preview-heading">预览当前草稿</h3>
      <p class="appearance-help">预览使用真实的通知计时，不会保存，也不影响其他通知或邮件。关闭预览会清除模拟任务。剩余秒数只在通知可读、页面活跃时才会减少。</p>
      <div class="appearance-actions">
        <button v-for="tone in tones" :key="tone" class="button button--soft" type="button" :disabled="!canPreview" @click="preview(tone)">预览{{ labels[tone] }}</button>
        <button class="button button--soft" type="button" :disabled="!canPreview" @click="progress()">预览加载</button>
        <button class="button button--soft" type="button" :disabled="!canPreview" @click="progress('success')">加载→成功</button>
        <button class="button button--soft" type="button" :disabled="!canPreview" @click="progress('error')">加载→失败</button>
        <button class="button button--soft" type="button" :disabled="!canPreview || !timed('loading')" @click="progress('success', true)">加载收起后结果</button>
        <button class="button button--soft" type="button" :disabled="!canPreview" @click="preview('error', true)">长文字与重试</button>
        <button class="button button--soft" type="button" :disabled="!canPreview" @click="previews.stack(editor.candidate())">多条堆叠</button>
        <button class="button button--soft" type="button" @click="previews.finishWaiting">完成等待预览</button>
        <button class="button button--soft" type="button" @click="previews.clear">关闭所有预览</button>
      </div>
      <p class="appearance-help">“加载收起后结果”要求加载提示设为定时收起，模拟任务会在收起之后才结束。悬停或页面在后台时，收起计时会暂停。普通错误和重试提示都按上面的设置显示。只有“发送结果未确认”必须手动关闭，以免重复发送；关闭通知不会解除发送锁，仍要核对记录后人工确认。</p>
      <div v-if="previewRows.length" class="appearance-preview-states" aria-label="预览计时状态" aria-live="off">
        <article v-for="row in previewRows" :key="row.id" class="appearance-preview-state">
          <strong>{{ row.label }} · {{ labels[row.type] }}</strong><span>{{ phaseName(row.phase) }} · 版本 {{ row.revision }}</span>
          <span>剩余前景 {{ row.remainingMs === null ? '不限时' : `${(row.remainingMs / 1000).toFixed(1)} 秒` }}</span>
          <span>暂停：{{ row.pauseReasons.length ? row.pauseReasons.map(reasonName).join('、') : '无' }}</span>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api/client.ts';
import { NOTIFICATION_TYPES, type NotificationTiming, type NotificationType } from '../../../../shared/notificationMotion.ts';
import type { UiConfigV2 } from '../../../../shared/notificationDisplay.ts';
import { applySavedUiConfig } from '../../notificationConfig.ts';
import { notify, type NotificationTone } from '../../notifications.ts';
import { createNotificationAppearanceEditor, notificationLabels as labels } from '../../admin/notificationAppearanceEditor.ts';
import { createNotificationAppearancePreview, type PreviewRow } from '../../admin/notificationAppearancePreview.ts';

const editor = createNotificationAppearanceEditor({ request: (path, options) => api<unknown>(path, options), apply: applySavedUiConfig,
  feedback: (message, tone) => { notify(message, tone); } });
const { state, valid, dirty } = editor;
const disabled = computed(() => state.blocked || state.loading || state.saving);
const canPreview = computed(() => valid.value && !disabled.value);
const types = NOTIFICATION_TYPES, tones: NotificationTone[] = ['success', 'info', 'warning', 'error'];
const fields: { key: keyof NotificationTiming; label: string; max: number }[] = [
  { key: 'enterMs', label: '入场', max: 3000 }, { key: 'exitMs', label: '退场', max: 3000 },
  { key: 'textOutMs', label: '文字退场', max: 1000 }, { key: 'textInMs', label: '文字入场', max: 1000 },
];
const previewRows = ref<PreviewRow[]>([]);
const previews = createNotificationAppearancePreview(rows => { previewRows.value = rows; });
function timed(type: NotificationType) { return ['timed', 'timedHide'].includes(state.draft.notificationDisplay.types[type].mode); }
function validSeconds(type: NotificationType) { const value = state.seconds[type]; return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 120; }
function changeMode(type: NotificationType, event: Event) { editor.mode(type, ['timed', 'timedHide'].includes((event.target as HTMLSelectElement).value)); }
function describe(config: UiConfigV2, type: NotificationType) {
  const policy = config.notificationDisplay.types[type], motion = config.notificationMotion.types[type];
  return `${labels[type]}：${'durationMs' in policy ? `${policy.mode === 'timedHide' ? '收起' : '定时'} ${policy.durationMs / 1000} 秒` : policy.mode === 'manual' ? '手动关闭' : '等待结束'}；动画 ${motion.enterMs}/${motion.exitMs}/${motion.textOutMs}/${motion.textInMs} 毫秒`;
}
function phaseName(phase: string) { return ({ enter: '入场', capsule: '可读', complete: '结果可读', 'text-out': '文字退场', 'text-in': '文字入场', exit: '出场', hidden: '等待提示已收起，任务继续', disposed: '已结束' } as Record<string, string>)[phase] ?? phase; }
function reasonName(reason: string) { return ({ enter: '入场', background: '背景堆叠', hidden: '页面隐藏', blur: '页面失焦', hover: '悬停', focus: '通知内焦点', text: '文字切换', stack: '堆叠切换', action: '按钮执行', leaving: '出场', 'hidden-view': '提示已收起' } as Record<string, string>)[reason] ?? reason; }
function preview(tone: NotificationTone, long = false) { if (canPreview.value) previews.result(editor.candidate(), tone, long); }
function progress(tone?: 'success' | 'error', afterHide = false) { if (canPreview.value) previews.progress(editor.candidate(), tone, afterHide); }
function reload() { previews.clear(); void editor.load(); }
function undo() { previews.clear(); editor.undo(); }
async function save() { previews.clear(); await editor.save(); }
onMounted(() => { void editor.load(); });
onBeforeUnmount(() => { editor.dispose(); previews.dispose(); });
</script>
