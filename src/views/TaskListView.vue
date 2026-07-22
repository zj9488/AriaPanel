<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import TaskTable from '@/components/TaskTable.vue'
import AddUrlBar from '@/components/AddUrlBar.vue'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'
import type { Aria2Client } from '@/lib/aria2/rpc-client'

const conn = useConnectionStore()
const tasks = useTaskStore()
const client = inject<Ref<Aria2Client | null>>('aria2-client')!

const list = computed(() => [...tasks.active, ...tasks.waiting, ...tasks.stopped])

async function onAdd(url: string) {
  if (!client.value) return
  await client.value.addUri([url])
}
</script>

<template>
  <AppShell>
    <div style="padding:8px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--n-border-color,#eee)">
      <strong>AriaPanel</strong>
      <span style="margin-left:auto;font-size:12px;opacity:.7">{{ conn.status }}</span>
    </div>
    <AddUrlBar :on-add="onAdd" />
    <TaskTable :tasks="list" />
  </AppShell>
</template>
