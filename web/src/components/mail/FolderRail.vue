<template>
  <section class="mail-pane mail-pane--folders" aria-label="文件夹">
    <div class="mail-pane__head">
      <span class="mail-pane__title">文件夹</span>
      <button class="icon-button icon-button--small" type="button" aria-label="新建文件夹" :disabled="folderBusy" @click="emit('create')">＋</button>
    </div>
    <div class="mail-pane__body">
      <div class="folder-tree">
        <button
          v-for="folder in folders"
          :key="folder.path"
          class="folder-item"
          :class="{ 'is-current': folder.path === currentFolder }"
          type="button"
          :disabled="navigationBusy"
          :aria-current="folder.path === currentFolder ? 'page' : undefined"
          @click="emit('select', folder.path)"
        >
          <span class="folder-item__name">{{ folderLabel(folder) }}</span>
          <span v-if="folder.unseen > 0" class="folder-item__count">{{ folder.unseen }}</span>
        </button>
      </div>
      <div v-if="currentFolderMeta" class="folder-actions" aria-label="当前文件夹操作">
        <span class="folder-actions__label">{{ currentFolderLabel }}</span>
        <button v-if="canManageFolder" class="button button--soft" type="button" :disabled="folderBusy" @click="emit('rename')">重命名</button>
        <button class="button button--soft" type="button" :disabled="folderBusy" @click="emit('subscription')">
          {{ currentFolderMeta.subscribed ? "取消订阅" : "订阅" }}
        </button>
        <button class="button button--soft" type="button" :disabled="folderBusy || currentFolderMeta.messages === 0" @click="emit('empty')">清空</button>
        <button v-if="canManageFolder" class="button button--danger" type="button" :disabled="folderBusy" @click="emit('remove')">删除文件夹</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { folderLabel, type Folder } from "../../mail/types";

defineProps<{
  folders: Folder[];
  currentFolder: string;
  currentFolderLabel: string;
  currentFolderMeta?: Folder;
  canManageFolder: boolean;
  folderBusy: boolean;
  navigationBusy: boolean;
}>();

const emit = defineEmits<{
  create: [];
  select: [path: string];
  rename: [];
  subscription: [];
  empty: [];
  remove: [];
}>();
</script>
