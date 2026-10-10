<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="open" class="palette" @keydown.esc.prevent.stop="close">
        <div class="palette__scrim" @click="close"></div>
        <div ref="panel" class="palette__panel" role="dialog" aria-modal="true" aria-label="跳转到页面">
          <div class="palette__search">
            <AdminIcon name="search" :size="18" />
            <input
              ref="input"
              v-model="query"
              class="palette__input"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="admin-palette-list"
              aria-autocomplete="list"
              :aria-activedescendant="results.length ? `palette-option-${active}` : undefined"
              placeholder="输入页面名，例如 账号、验证"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              @keydown="onKeydown"
            />
            <kbd class="palette__esc">Esc</kbd>
          </div>
          <ul id="admin-palette-list" class="palette__list" role="listbox" aria-label="可跳转的页面">
            <li
              v-for="(entry, index) in results"
              :id="`palette-option-${index}`"
              :key="entry.id"
              class="palette__item"
              :class="{ 'is-active': index === active, 'is-danger': entry.danger }"
              role="option"
              :aria-selected="index === active ? 'true' : 'false'"
              @mousemove="active = index"
              @click="run(entry)"
            >
              <AdminIcon :name="entry.icon" :size="18" />
              <span class="palette__label">{{ entry.label }}</span>
              <small v-if="entry.group" class="palette__group">{{ entry.group }}</small>
              <kbd v-if="entry.shortcut" class="palette__keys">{{ entry.shortcut }}</kbd>
            </li>
          </ul>
          <p v-if="!results.length" class="palette__empty" role="status">没有匹配的页面</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AdminIcon from "./AdminIcon.vue";
import { matchItems, type IconName } from "../../admin/navModel";

export type PaletteEntry = {
  id: string;
  label: string;
  icon: IconName;
  keywords?: string;
  group?: string;
  shortcut?: string;
  danger?: boolean;
};

const props = defineProps<{ entries: PaletteEntry[] }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ run: [id: string] }>();

const query = ref("");
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

const results = computed(() => matchItems(props.entries, query.value));
watch(query, () => { active.value = 0; });

watch(open, async (value) => {
  if (value) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    query.value = "";
    active.value = 0;
    await nextTick();
    input.value?.focus();
  } else {
    const target = returnFocus;
    returnFocus = null;
    await nextTick();
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
});

function close(): void { open.value = false; }

function run(entry: PaletteEntry): void {
  open.value = false;
  emit("run", entry.id);
}

function onKeydown(event: KeyboardEvent): void {
  const count = results.value.length;
  if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
    event.preventDefault();
    if (count) active.value = (active.value + 1) % count;
  } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
    event.preventDefault();
    if (count) active.value = (active.value - 1 + count) % count;
  } else if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    const entry = results.value[active.value];
    if (entry) run(entry);
  } else if (event.key === "Tab") {
    // 面板里只有一个输入框，焦点不离开面板。
    event.preventDefault();
  }
}
</script>
