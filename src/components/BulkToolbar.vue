<script setup lang="ts">
import { NButton, NPopconfirm, useMessage } from 'naive-ui'
import { inject, type Ref } from 'vue'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'

const tasks = useTaskStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()

async function deleteSelected() {
  const c = api.value?.client
  if (!c) return
  const gids = [...tasks.selection]
  try {
    for (const gid of gids) {
      const t = tasks.tasks.get(gid)
      await c.purge(gid, t?.status ?? 'active')
    }
    api.value!.refresh()
  } catch (e) {
    message.error(`删除失败：${String(e)}`)
    api.value!.refresh()
  }
}
</script>

<template>
  <div v-if="tasks.selection.size > 0" style="padding:6px 12px;display:flex;align-items:center;gap:8px;background:var(--n-color-target,#f5f5f5)">
    <span style="font-size:13px">已选 {{ tasks.selection.size }} 项</span>
    <NPopconfirm @positive-click="deleteSelected">
      <template #trigger><NButton size="tiny" type="error">删除选中</NButton></template>
      确认删除选中的 {{ tasks.selection.size }} 个任务？（已下载部分保留，可重试续传）
    </NPopconfirm>
    <NButton size="tiny" @click="tasks.clearSelection()">清空选择</NButton>
  </div>
</template>
