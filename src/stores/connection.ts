import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GlobalStat } from '@/lib/aria2/types'

type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export const useConnectionStore = defineStore('connection', () => {
  const status = ref<ConnStatus>('idle')
  const error = ref<string | null>(null)
  const showDiagnostics = ref(false)
  const globalStat = ref<GlobalStat>({
    downloadSpeed: '0',
    uploadSpeed: '0',
    active: '0',
    waiting: '0',
    stoppedTotal: '0',
  })
  const setConnecting = () => {
    status.value = 'connecting'
  }
  const setConnected = () => {
    status.value = 'connected'
    error.value = null
  }
  const setReconnecting = () => {
    status.value = 'reconnecting'
  }
  const setError = (e: string) => {
    status.value = 'error'
    error.value = e
  }
  const setStat = (s: GlobalStat) => {
    globalStat.value = s
  }
  const setShowDiagnostics = (v: boolean) => {
    showDiagnostics.value = v
  }
  return {
    status,
    error,
    globalStat,
    showDiagnostics,
    setConnecting,
    setConnected,
    setReconnecting,
    setError,
    setStat,
    setShowDiagnostics,
  }
})
