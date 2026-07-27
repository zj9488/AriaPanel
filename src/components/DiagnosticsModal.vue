<script setup lang="ts">
import { NModal, NButton, NTag, NSpace, useMessage } from 'naive-ui'
import { ref, watch, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useConnectionStore } from '@/stores/connection'

const conn = useConnectionStore()
const message = useMessage()

const logs = ref<string[]>([])
const restarts = ref(0)
const restarting = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const statusConfig: Record<string, { type: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  connected: { type: 'success', label: '已连接' },
  connecting: { type: 'info', label: '连接中' },
  reconnecting: { type: 'warning', label: '重连中' },
  error: { type: 'error', label: '连接失败' },
  idle: { type: 'default', label: '未连接' },
}

async function fetchLogs() {
  try {
    logs.value = await invoke<string[]>('get_aria2_logs')
    restarts.value = await invoke<number>('get_restarts_count')
  } catch {}
}

async function doRestart() {
  restarting.value = true
  try {
    await invoke('restart_aria2')
    conn.setShowDiagnostics(false)
  } catch (e) {
    message.error(`重启失败：${String(e)}`)
  } finally {
    restarting.value = false
  }
}

watch(
  () => conn.showDiagnostics,
  (show) => {
    if (show) {
      fetchLogs()
      timer = setInterval(fetchLogs, 2000)
    } else {
      if (timer) clearInterval(timer)
      timer = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <NModal :show="conn.showDiagnostics" @update:show="conn.setShowDiagnostics">
    <div style="width: 600px; max-width: 90vw; background: var(--n-color, #fff); border-radius: 8px">
      <div style="padding: 24px">
        <h3 style="margin: 0 0 16px">aria2 诊断</h3>
        <NSpace vertical :size="12">
          <div>
            状态：
            <NTag :type="statusConfig[conn.status]?.type ?? 'default'" size="small">
              {{ statusConfig[conn.status]?.label ?? conn.status }}
            </NTag>
          </div>
          <div>重启次数：{{ restarts }}/3</div>
          <div style="font-size: 13px; opacity: 0.7; margin-bottom: 4px">aria2c 日志</div>
          <div
            style="
              max-height: 300px;
              overflow: auto;
              background: var(--n-color-target, #f5f5f5);
              border-radius: 4px;
              padding: 8px;
              font-family: monospace;
              font-size: 12px;
              white-space: pre-wrap;
              word-break: break-all;
            "
          >
            <div v-if="logs.length === 0" style="opacity: 0.5">暂无日志</div>
            <div v-for="(line, i) in logs" :key="i">{{ line }}</div>
          </div>
          <NSpace justify="end">
            <NButton :loading="restarting" type="primary" @click="doRestart">重启 aria2</NButton>
            <NButton @click="conn.setShowDiagnostics(false)">关闭</NButton>
          </NSpace>
        </NSpace>
      </div>
    </div>
  </NModal>
</template>
