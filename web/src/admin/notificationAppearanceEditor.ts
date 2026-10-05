import { computed, reactive } from 'vue';
import { NOTIFICATION_TYPES, type NotificationType } from '../../../shared/notificationMotion.ts';
import { copyUiConfigV2, defaultUiConfigV2, DEFAULT_TIMED_DISPLAY_MS, isUiConfigV2, type UiConfigV2 } from '../../../shared/notificationDisplay.ts';

type Dependencies = {
  request: (path: string, options: { method?: 'PATCH'; body?: UiConfigV2; signal: AbortSignal }) => Promise<unknown>;
  apply: (config: UiConfigV2) => void;
  feedback: (message: string, tone: 'error' | 'success') => void;
};
export const notificationLabels = { success: '成功', info: '提示', warning: '警告', error: '错误', loading: '加载 / 进度' };
type Seconds = Record<NotificationType, number | string>;
function secondsOf(config: UiConfigV2): Seconds {
  return Object.fromEntries(NOTIFICATION_TYPES.map(type => {
    const policy = config.notificationDisplay.types[type];
    return [type, 'durationMs' in policy ? policy.durationMs / 1000 : DEFAULT_TIMED_DISPLAY_MS[type] / 1000];
  })) as Seconds;
}
export function createNotificationAppearanceEditor(deps: Dependencies) {
  const state = reactive({ saved: null as UiConfigV2 | null, draft: defaultUiConfigV2(), seconds: secondsOf(defaultUiConfigV2()),
    incoming: null as UiConfigV2 | null, loading: false, saving: false, blocked: true, error: '' });
  let active = true;
  const controller = new AbortController();
  async function request(path: string, options: { method?: 'PATCH'; body?: UiConfigV2 } = {}) {
    const child = new AbortController();
    let rejectAbort!: (reason: Error) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abort = () => { child.abort(); rejectAbort(new Error('读取或保存已取消')); };
    controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { child.abort(); rejectAbort(new Error('请求超时，结果需重新读取核对')); }, 15000);
    try { return await Promise.race([deps.request(path, { ...options, signal: child.signal }), interrupted]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
  }
  const editable = () => active && Boolean(state.saved) && !state.blocked && !state.loading && !state.saving;
  function candidate(): UiConfigV2 {
    const config = copyUiConfigV2(state.draft);
    for (const type of NOTIFICATION_TYPES) {
      const policy = config.notificationDisplay.types[type], seconds = state.seconds[type];
      if ('durationMs' in policy) policy.durationMs = typeof seconds === 'number' ? seconds * 1000 : NaN;
    }
    return config;
  }
  const valid = computed(() => isUiConfigV2(candidate()));
  const dirty = computed(() => state.saved !== null && JSON.stringify(candidate()) !== JSON.stringify(state.saved));
  function adopt(config: UiConfigV2) {
    state.saved = copyUiConfigV2(config); state.draft = copyUiConfigV2(config); state.seconds = secondsOf(config);
    state.incoming = null; state.blocked = false; state.error = '';
  }
  async function load() {
    if (!active || state.loading || state.saving) return;
    state.loading = true; state.blocked = true; state.error = ''; state.incoming = null;
    try {
      const result = await request('/api/admin/appearance?schemaVersion=2');
      if (!active) return;
      // Never turn a management v1/future/invalid response into editable defaults.
      if (!isUiConfigV2(result)) throw new Error('配置版本或格式不兼容，保存已禁用');
      deps.apply(copyUiConfigV2(result));
      if (state.saved && dirty.value) {
        state.incoming = copyUiConfigV2(result);
        state.error = '已读取服务器配置，本次草稿仍保留。请核对下方差异并选择审阅方式，尚未提交任何修改。';
      } else adopt(result);
    } catch (caught) {
      if (active) { state.error = caught instanceof Error ? caught.message : '读取失败，保存已禁用'; deps.feedback(state.error, 'error'); }
    } finally { if (active) state.loading = false; }
  }
  function review(keepDraft: boolean) {
    if (!active || !state.incoming || state.loading || state.saving) return;
    const incoming = copyUiConfigV2(state.incoming);
    if (!keepDraft) adopt(incoming);
    else {
      state.saved = incoming; state.draft.revision = incoming.revision; state.incoming = null; state.blocked = false;
      state.error = '本次草稿已按新版本保留，请逐项审阅显示和动画数值；点击保存才会提交全部设置。';
    }
  }
  function undo() { if (editable() && state.saved) adopt(state.saved); }
  function mode(type: NotificationType, timed: boolean) {
    if (!editable()) return;
    if (type === 'loading') state.draft.notificationDisplay.types.loading = timed
      ? { mode: 'timedHide', durationMs: DEFAULT_TIMED_DISPLAY_MS.loading } : { mode: 'untilSettled' };
    else state.draft.notificationDisplay.types[type] = timed
      ? { mode: 'timed', durationMs: DEFAULT_TIMED_DISPLAY_MS[type] } : { mode: 'manual' };
  }
  function displayPreset(name: 'default' | 'quick' | 'gentle') {
    if (!editable()) return;
    const config = defaultUiConfigV2();
    if (name !== 'default') for (const type of ['success', 'info', 'warning'] as const)
      config.notificationDisplay.types[type] = { mode: 'timed', durationMs: (name === 'quick' ? { success: 3, info: 4, warning: 6 } : { success: 8, info: 10, warning: 12 })[type] * 1000 };
    state.draft.notificationDisplay = config.notificationDisplay; state.seconds = secondsOf(config);
  }
  function motionPreset(name: 'default' | 'quick' | 'gentle') {
    if (!editable()) return;
    const motion = defaultUiConfigV2().notificationMotion;
    if (name !== 'default') {
      for (const type of NOTIFICATION_TYPES) motion.types[type] = name === 'quick'
        ? { enterMs: 420, exitMs: 380, textOutMs: 100, textInMs: 220 }
        : { enterMs: 1100, exitMs: 900, textOutMs: 240, textInMs: 480 };
      motion.stackMs = name === 'quick' ? 240 : 480;
    }
    state.draft.notificationMotion = motion;
  }
  async function save() {
    if (!editable() || !valid.value || !dirty.value) return;
    const submitted = candidate(); state.saving = true; state.error = '';
    try {
      const result = await request('/api/admin/appearance?schemaVersion=2', { method: 'PATCH', body: submitted });
      if (!active) return;
      // A valid but wrong response does not prove that this editor's whole draft was saved.
      if (!isUiConfigV2(result) || result.revision !== submitted.revision + 1
        || JSON.stringify({ ...copyUiConfigV2(result), revision: submitted.revision }) !== JSON.stringify(submitted))
        throw new Error('无法确认完整保存结果');
      adopt(result); deps.apply(copyUiConfigV2(result)); deps.feedback('胶囊通知设置已保存，后续通知使用新设置', 'success');
    } catch (caught) {
      if (!active) return;
      state.blocked = true;
      state.error = caught && typeof caught === 'object' && 'status' in caught && caught.status === 409
        ? '其他管理员已修改配置，请重新读取并审阅；本次草稿未覆盖对方设置。'
        : `${caught instanceof Error ? caught.message : '保存结果未确认'}；请重新读取核对后再保存。`;
      deps.feedback(state.error, 'error');
    } finally { if (active) state.saving = false; }
  }
  function dispose() { active = false; controller.abort(); }
  return { state, valid, dirty, candidate, load, save, undo, mode, displayPreset, motionPreset, review, dispose };
}
