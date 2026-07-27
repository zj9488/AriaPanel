<script setup lang="ts">
import { NCheckbox, NPopconfirm, NProgress, NTable } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'
import type { TaskOp } from '@/lib/task-op'
import { useTaskStore } from '@/stores/task'
import { usePrefStore, type SortKey } from '@/stores/preferences'
import { fmtSpeed, fmtBytes, fmtProgress, taskName } from '@/lib/format'

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

function primaryOp(t: Aria2Task): { op: TaskOp; label: string } | null {
  switch (t.status) {
    case 'active':
      return { op: 'pause', label: '暂停' }
    case 'paused':
    case 'waiting':
      return { op: 'unpause', label: '恢复' }
    case 'error':
      return { op: 'retry', label: '重试' }
    default:
      return null
  }
}

const rows = computed(() =>
  props.tasks.map((t) => ({ t, name: taskName(t), pct: fmtProgress(t), primary: primaryOp(t) })),
)
const allChecked = computed(() => props.tasks.length > 0 && props.tasks.every((t) => store.selection.has(t.gid)))
function toggleAll(v: boolean) {
  if (v) store.selectAllVisible()
  else store.clearSelection()
}
</script>

<template>
  <NTable size="small" :bordered="false">
    <thead>
      <tr>
        <th style="width: 32px"><NCheckbox :checked="allChecked" @update:checked="toggleAll" /></th>
        <th
          v-for="col in sortableColumns"
          :key="col.key"
          style="cursor: pointer; user-select: none"
          @click="toggleSort(col.key)"
        >
          {{ col.label }} <span style="opacity: 0.6">{{ sortArrow(col.key) }}</span>
        </th>
        <th style="width: 160px">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="r in rows"
        :key="r.t.gid"
        @click="$emit('rowClick', r.t.gid)"
        @contextmenu.prevent="$emit('contextmenu', r.t.gid, $event)"
      >
        <td @click.stop>
          <NCheckbox :checked="store.selection.has(r.t.gid)" @update:checked="store.toggleSelect(r.t.gid)" />
        </td>
        <td>{{ r.name }}</td>
        <td style="width: 180px"><NProgress :percentage="r.pct" :height="10" /></td>
        <td style="width: 90px">{{ fmtBytes(r.t.totalLength) }}</td>
        <td>{{ fmtSpeed(r.t.downloadSpeed) }}</td>
        <td>{{ r.t.status }}</td>
        <td @click.stop>
          <template v-if="r.primary">
            <a
              v-if="r.primary.op === 'pause'"
              data-op="pause"
              style="margin-right: 8px; cursor: pointer"
              @click="operate(r.t.gid, r.primary!.op)"
              >{{ r.primary.label }}</a
            >
            <a
              v-else-if="r.primary.op === 'unpause'"
              data-op="unpause"
              style="margin-right: 8px; cursor: pointer"
              @click="operate(r.t.gid, r.primary!.op)"
              >{{ r.primary.label }}</a
            >
            <a
              v-else
              data-op="retry"
              style="margin-right: 8px; cursor: pointer"
              @click="operate(r.t.gid, r.primary!.op)"
              >{{ r.primary.label }}</a
            >
          </template>
          <NPopconfirm @positive-click="operate(r.t.gid, 'remove')">
            <template #trigger><a style="cursor: pointer">删除</a></template>
            确认删除该任务？（已下载部分保留，可重试续传）
          </NPopconfirm>
          <a data-op="more" style="margin-left: 8px; cursor: pointer" @click="$emit('more', r.t.gid, $event)">⋮</a>
        </td>
      </tr>
    </tbody>
  </NTable>
</template>
