<script setup lang="ts">
import { NButton, NSpace, NInput, useMessage } from 'naive-ui'
import { inject, type Ref } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import type { Aria2Api } from '@/composables/useAria2'

const conn = useConnectionStore()
const tasks = useTaskStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')
const message = useMessage()
const { themeMode, setTheme } = useTheme()

const emit = defineEmits<{ settings: []; 'new-task': [] }>()

async function run(fn: 'pauseAll' | 'unpauseAll', ok: string) {
  const c = api?.value?.client
  if (!c) return
  try {
    await c[fn]()
    api?.value?.refresh()
  } catch (e) {
    message.error(`${ok} 失败：${String(e)}`)
  }
}

const themeIcons: Record<ThemeMode, string> = { light: '☀', dark: '🌙', system: '💻' }
function cycleTheme() {
  const order: ThemeMode[] = ['system', 'light', 'dark']
  const next = order[(order.indexOf(themeMode.value) + 1) % order.length]
  setTheme(next)
}
</script>

<template>
  <div
    style="
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--n-border-color, #eee);
    "
  >
    <strong>AriaPanel</strong>
    <NButton size="small" type="primary" @click="emit('new-task')">+ 新建</NButton>
    <NSpace :size="8">
      <NButton size="small" @click="run('pauseAll', '全部暂停')">全部暂停</NButton>
      <NButton size="small" @click="run('unpauseAll', '全部继续')">全部继续</NButton>
    </NSpace>
    <NInput v-model:value="tasks.searchQuery" placeholder="搜索任务…" clearable size="small" style="width: 200px" />
    <span style="margin-left: auto; font-size: 12px; opacity: 0.7">{{ conn.status }}</span>
    <NButton size="small" quaternary :title="`主题: ${themeMode}`" @click="cycleTheme">{{
      themeIcons[themeMode]
    }}</NButton>
    <NButton size="small" quaternary @click="emit('settings')">⚙</NButton>
  </div>
</template>
