<script setup lang="ts">
import { inject, type Ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import TaskTable from '@/components/TaskTable.vue'
import AddUrlBar from '@/components/AddUrlBar.vue'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'
import type { TaskOp } from '@/lib/task-op'

const tasks = useTaskStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!

async function onAdd(url: string) {
  const c = api.value?.client
  if (!c) return
  await c.addUri([url])
  api.value?.refresh()
}

function operate(_gid: string, _op: TaskOp) {}
</script>

<template>
  <AppShell>
    <AddUrlBar :on-add="onAdd" />
    <TaskTable :tasks="tasks.visibleTasks" :operate="operate" />
  </AppShell>
</template>
