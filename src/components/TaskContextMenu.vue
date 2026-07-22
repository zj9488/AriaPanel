<script setup lang="ts">
import { NDropdown } from 'naive-ui'
import type { TaskOp } from '@/lib/task-op'

type TaskStatus = 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error'

const props = defineProps<{ show: boolean; x: number; y: number; status: TaskStatus }>()
const emit = defineEmits<{ select: [op: TaskOp]; close: [] }>()

function options() {
  const base: { label: string; key: TaskOp }[] = [{ label: '复制链接', key: 'copyLink' }]
  if (props.status === 'active') base.push({ label: '暂停', key: 'pause' })
  if (props.status === 'paused' || props.status === 'waiting') base.push({ label: '恢复', key: 'unpause' })
  base.push({ label: '强制暂停', key: 'forcePause' })
  base.push({ label: '更换链接重试', key: 'retryWithUrl' })
  base.push({ label: '删除', key: 'remove' })
  base.push({ label: '强制删除', key: 'forceRemove' })
  return base
}
function pick(key: string) {
  emit('select', key as TaskOp)
  emit('close')
}
</script>

<template>
  <NDropdown
    placement="bottom-start"
    trigger="manual"
    :show="show"
    :x="x" :y="y"
    :options="options()"
    @select="pick"
    @clickoutside="emit('close')"
  />
</template>
