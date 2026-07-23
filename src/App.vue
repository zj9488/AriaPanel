<script setup lang="ts">
import { onMounted, provide, shallowRef, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useAria2, type Aria2Api } from '@/composables/useAria2'
import AppShell from '@/components/AppShell.vue'

const aria = useAria2()
const apiRef = shallowRef<Aria2Api | null>(null)
provide<Ref<Aria2Api | null>>('aria2-api', apiRef)

onMounted(async () => {
  await aria.start()
  apiRef.value = aria.getApi()

  await listen('aria2://restarted', (e) => {
    const ep = e.payload as { url: string; secret: string; dir: string }
    aria.reconnect(ep)
    apiRef.value = aria.getApi()
  })
  await listen('tray://pause-all', async () => {
    await apiRef.value?.client.pauseAll()
    apiRef.value?.refresh()
  })
  await listen('tray://resume-all', async () => {
    await apiRef.value?.client.unpauseAll()
    apiRef.value?.refresh()
  })
})
</script>

<template>
  <AppShell>
    <router-view />
  </AppShell>
</template>
