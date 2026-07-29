<script setup lang="ts">
import { NDropdown } from 'naive-ui'
import type { TaskOp } from '@/lib/task-op'

type TaskStatus = 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error'

const props = withDefaults(
  defineProps<{
    show: boolean
    x: number
    y: number
    status: TaskStatus
    isBittorrent: boolean
    categories?: { id: string; name: string; dir: string }[]
  }>(),
  { categories: () => [] },
)
const emit = defineEmits<{ select: [op: TaskOp]; close: []; reclassify: [categoryId: string] }>()

function options() {
  const base: { label: string; key: string; children?: { label: string; key: string }[] }[] = [
    { label: '复制链接', key: 'copyLink' },
  ]
  if (props.status === 'active') base.push({ label: '暂停', key: 'pause' })
  if (props.status === 'paused' || props.status === 'waiting') base.push({ label: '恢复', key: 'unpause' })
  base.push({ label: '打开文件夹', key: 'openFolder' })
  if (props.categories.length > 0) {
    base.push({
      label: '重新分类',
      key: 'reclassify',
      children: props.categories.map((c) => ({ label: c.name, key: `reclassify:${c.id}` })),
    })
  }
  base.push({ label: '强制暂停', key: 'forcePause' })
  if (!props.isBittorrent) base.push({ label: '更换链接重试', key: 'retryWithUrl' })
  base.push({ label: '删除', key: 'remove' })
  base.push({ label: '强制删除', key: 'forceRemove' })
  return base
}
function pick(key: string) {
  if (key.startsWith('reclassify:')) {
    emit('reclassify', key.slice('reclassify:'.length))
    emit('close')
    return
  }
  emit('select', key as TaskOp)
  emit('close')
}
</script>

<template>
  <NDropdown
    placement="bottom-start"
    trigger="manual"
    :show="show"
    :x="x"
    :y="y"
    :options="options()"
    @select="pick"
    @clickoutside="emit('close')"
  />
</template>
