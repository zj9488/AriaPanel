<script setup lang="ts">
import { NButton, NDrawer, NDrawerContent, NProgress, NTag } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'
import type { TaskOp } from '@/lib/task-op'
import { fmtSpeed, fmtBytes, fmtProgress, taskName } from '@/lib/format'

const props = defineProps<{
  show: boolean
  detail: Aria2TaskDetail | null
  operate: (gid: string, op: TaskOp) => void
}>()
const emit = defineEmits<{ 'update:show': [v: boolean] }>()

const t = computed(() => props.detail)

function completedPieces(d: Aria2TaskDetail): number {
  if (!d.bitfield) return 0
  let count = 0
  for (const ch of d.bitfield) {
    const nibble = parseInt(ch, 16)
    if (isNaN(nibble)) continue
    count += (nibble & 8 ? 1 : 0) + (nibble & 4 ? 1 : 0) + (nibble & 2 ? 1 : 0) + (nibble & 1 ? 1 : 0)
  }
  return count
}
function uriStatusColor(s: string): 'success' | 'warning' | 'error' | 'default' {
  switch (s) {
    case 'used':
      return 'success'
    case 'waiting':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'default'
  }
}
</script>

<template>
  <NDrawer :show="show" :width="420" placement="right" @update:show="emit('update:show', $event)">
    <NDrawerContent v-if="t" :title="taskName(t)" closable>
      <div style="display: flex; flex-direction: column; gap: 16px">
        <NProgress :percentage="fmtProgress(t)" />

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">基本信息</h4>
          <div style="font-size: 13px; line-height: 1.8">
            状态：{{ t.status }}<br />
            大小：{{ fmtBytes(t.totalLength) }}<br />
            已下载：{{ fmtBytes(t.completedLength) }}<br />
            速度：↓ {{ fmtSpeed(t.downloadSpeed) }} ↑ {{ fmtSpeed(t.uploadSpeed) }}<br />
            保存路径：{{ t.dir }}
          </div>
        </section>

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">分块进度</h4>
          <div style="font-size: 13px; line-height: 1.8">
            {{ completedPieces(t) }}/{{ t.numPieces }} 块已完成，{{ t.connections }} 个活跃连接<br />
            分块大小：{{ fmtBytes(t.pieceLength) }}
          </div>
        </section>

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">文件列表</h4>
          <div v-for="(f, i) in t.files" :key="i" style="font-size: 13px; line-height: 1.6">
            {{ f.path.split(/[\\/]/).pop() }} — {{ fmtBytes(f.length) }}
            <NProgress
              :percentage="Number(f.length) ? Math.round((Number(f.completedLength) / Number(f.length)) * 100) : 0"
              :height="6"
            />
          </div>
        </section>

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">链接列表</h4>
          <div v-for="(f, i) in t.files" :key="'u' + i">
            <div
              v-for="(u, j) in f.uris"
              :key="j"
              style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 2px"
            >
              <NTag :type="uriStatusColor(u.status)" size="small" round>{{ u.status }}</NTag>
              <span style="word-break: break-all">{{ u.uri }}</span>
            </div>
          </div>
        </section>

        <section v-if="t.errorCode">
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7; color: #e88080">错误详情</h4>
          <div style="font-size: 13px; line-height: 1.6">
            错误码：{{ t.errorCode }}<br />
            {{ t.errorMessage }}
          </div>
        </section>
      </div>

      <template #footer>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <NButton v-if="t.status === 'active'" size="small" @click="operate(t.gid, 'pause')">暂停</NButton>
          <NButton
            v-if="t.status === 'paused' || t.status === 'waiting'"
            size="small"
            @click="operate(t.gid, 'unpause')"
            >恢复</NButton
          >
          <NButton size="small" @click="operate(t.gid, 'copyLink')">复制链接</NButton>
          <NButton size="small" @click="operate(t.gid, 'openFolder')">打开目录</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
