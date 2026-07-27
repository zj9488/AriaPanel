<script setup lang="ts">
import { onMounted, provide, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useAria2, type Aria2Api } from '@/composables/useAria2'
import AppShell from '@/components/AppShell.vue'
import TaskListView from '@/views/TaskListView.vue'

const aria = useAria2()
provide<Ref<Aria2Api | null>>('aria2-api', aria.apiRef)

onMounted(async () => {
  await aria.start()

  await listen('tray://pause-all', async () => {
    const api = aria.getApi()
    await api?.client.pauseAll()
    api?.refresh()
  })
  await listen('tray://resume-all', async () => {
    const api = aria.getApi()
    await api?.client.unpauseAll()
    api?.refresh()
  })
})
</script>

<template>
  <AppShell>
    <TaskListView />
  </AppShell>
</template>
