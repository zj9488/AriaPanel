<script setup lang="ts">
import { NCheckbox, NPopconfirm, NProgress, NTable } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'
import type { TaskOp } from '@/lib/task-op'
import { useTaskStore } from '@/stores/task'
import { usePrefStore, type SortKey } from '@/stores/preferences'

const props = defineProps<{
  tasks: Aria2Task[]
  operate: (gid: string, op: TaskOp) => void
}>()

defineEmits<{
  contextmenu: [gid: string, e: MouseEvent]
  more: [gid: string, e: MouseEvent]
  rowClick: [gid: string]
}>()

const store = useTaskStore()
const prefs = usePrefStore()

const sortableColumns: { key: SortKey; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'progress', label: '进度' },
  { key: 'size', label: '大小' },
  { key: 'speed', label: '速度' },
  { key: 'status', label: '状态' },
]
function toggleSort(key: SortKey) {
  if (prefs.sortKey === key) {
    prefs.setSort(key, prefs.sortOrder === 'asc' ? 'desc' : 'asc')
  } else {
    prefs.setSort(key, 'asc')
  }
}
function sortArrow(key: SortKey): string {
  if (prefs.sortKey !== key) return ''
  return prefs.sortOrder === 'asc' ? '↑' : '↓'
}

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
function fmtSize(s: string): string {
  const n = Number(s)
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}
function primaryOp(t: Aria2Task): { op: TaskOp; label: string } | null {
  switch (t.status) {
    case 'active': return { op: 'pause', label: '暂停' }
    case 'paused': case 'waiting': return { op: 'unpause', label: '恢复' }
    case 'error': return { op: 'retry', label: '重试' }
    default: return null
  }
}

const rows = computed(() => props.tasks.map(t => ({ t, name: name(t), pct: pct(t), primary: primaryOp(t) })))
const allChecked = computed(() => props.tasks.length > 0 && props.tasks.every(t => store.selection.has(t.gid)))
function toggleAll(v: boolean) { v ? store.selectAllVisible() : store.clearSelection() }
</script>

<template>
  <NTable size="small" :bordered="false">
    <thead>
      <tr>
        <th style="width:32px"><NCheckbox :checked="allChecked" @update:checked="toggleAll" /></th>
        <th v-for="col in sortableColumns" :key="col.key"
          @click="toggleSort(col.key)"
          style="cursor:pointer;user-select:none">
          {{ col.label }} <span style="opacity:.6">{{ sortArrow(col.key) }}</span>
        </th>
        <th style="width:160px">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.t.gid" @click="$emit('rowClick', r.t.gid)" @contextmenu.prevent="$emit('contextmenu', r.t.gid, $event)">
        <td @click.stop><NCheckbox :checked="store.selection.has(r.t.gid)" @update:checked="store.toggleSelect(r.t.gid)" /></td>
        <td>{{ r.name }}</td>
        <td style="width:180px"><NProgress :percentage="r.pct" :height="10" /></td>
        <td style="width:90px">{{ fmtSize(r.t.totalLength) }}</td>
        <td>{{ fmtBytes(r.t.downloadSpeed) }}</td>
        <td>{{ r.t.status }}</td>
        <td @click.stop>
          <template v-if="r.primary">
            <a data-op="pause" v-if="r.primary.op === 'pause'" style="margin-right:8px;cursor:pointer" @click="operate(r.t.gid, r.primary!.op)">{{ r.primary.label }}</a>
            <a data-op="unpause" v-else-if="r.primary.op === 'unpause'" style="margin-right:8px;cursor:pointer" @click="operate(r.t.gid, r.primary!.op)">{{ r.primary.label }}</a>
            <a data-op="retry" v-else style="margin-right:8px;cursor:pointer" @click="operate(r.t.gid, r.primary!.op)">{{ r.primary.label }}</a>
          </template>
          <NPopconfirm @positive-click="operate(r.t.gid, 'remove')">
            <template #trigger><a style="cursor:pointer">删除</a></template>
            确认删除该任务？（已下载部分保留，可重试续传）
          </NPopconfirm>
          <a data-op="more" style="margin-left:8px;cursor:pointer" @click="$emit('more', r.t.gid, $event)">⋮</a>
        </td>
      </tr>
    </tbody>
  </NTable>
</template>
