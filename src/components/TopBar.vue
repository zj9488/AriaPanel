<script setup lang="ts">
import { NButton, NSpace, useMessage } from 'naive-ui'
import { inject, type Ref } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import type { Aria2Api } from '@/composables/useAria2'

const conn = useConnectionStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()

async function run(fn: 'pauseAll' | 'unpauseAll', ok: string) {
  const c = api.value?.client
  if (!c) return
  try {
    await c[fn]()
    api.value!.refresh()
  } catch (e) {
    message.error(`${ok} 失败：${String(e)}`)
  }
}
</script>

<template>
  <div style="padding:8px 12px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--n-border-color,#eee)">
    <strong>AriaPanel</strong>
    <NSpace :size="8">
      <NButton size="small" @click="run('pauseAll','全部暂停')">全部暂停</NButton>
      <NButton size="small" @click="run('unpauseAll','全部继续')">全部继续</NButton>
    </NSpace>
    <span style="margin-left:auto;font-size:12px;opacity:.7">{{ conn.status }}</span>
  </div>
</template>
