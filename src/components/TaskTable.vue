<script setup lang="ts">
import { NProgress, NTable } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'

const props = defineProps<{ tasks: Aria2Task[] }>()

function name(t: Aria2Task): string {
  return t.bittorrent?.info?.name || t.files?.[0]?.path?.split(/[\\/]/).pop() || t.gid
}
function pct(t: Aria2Task): number {
  const total = Number(t.totalLength) || 0
  const done = Number(t.completedLength) || 0
  return total === 0 ? 0 : Math.round((done / total) * 100)
}
function fmtBytes(s: string): string {
  const n = Number(s)
  if (!n) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}
const rows = computed(() => props.tasks.map(t => ({ t, name: name(t), pct: pct(t) })))
</script>

<template>
  <NTable size="small" :bordered="false">
    <thead><tr><th>名称</th><th>进度</th><th>速度</th><th>状态</th></tr></thead>
    <tbody>
      <tr v-for="r in rows" :key="r.t.gid">
        <td>{{ r.name }}</td>
        <td style="width:180px"><NProgress :percentage="r.pct" :height="10" /></td>
        <td>{{ fmtBytes(r.t.downloadSpeed) }}</td>
        <td>{{ r.t.status }}</td>
      </tr>
    </tbody>
  </NTable>
</template>
