<script setup lang="ts">
import { ref, computed, inject, type Ref } from 'vue'
import { useMessage } from 'naive-ui'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
import BulkToolbar from '@/components/BulkToolbar.vue'
import TaskTable from '@/components/TaskTable.vue'
import TaskContextMenu from '@/components/TaskContextMenu.vue'
import RetryDialog from '@/components/RetryDialog.vue'
import AddUrlBar from '@/components/AddUrlBar.vue'
import { useTaskStore } from '@/stores/task'
import { usePrefStore } from '@/stores/preferences'
import type { Aria2Api } from '@/composables/useAria2'
import type { TaskOp } from '@/lib/task-op'

const tasks = useTaskStore()
const prefs = usePrefStore()

function pct(t: { totalLength: string; completedLength: string }): number {
  const total = Number(t.totalLength) || 0
  const done = Number(t.completedLength) || 0
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

const displayTasks = computed(() => {
  const list = [...tasks.visibleTasks]
  const key = prefs.sortKey
  const dir = prefs.sortOrder === 'asc' ? 1 : -1
  return list.sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'name': cmp = (a.bittorrent?.info?.name || a.files?.[0]?.path || a.gid).localeCompare(b.bittorrent?.info?.name || b.files?.[0]?.path || b.gid); break
      case 'size': cmp = Number(a.totalLength) - Number(b.totalLength); break
      case 'progress': cmp = pct(a) - pct(b); break
      case 'speed': cmp = Number(a.downloadSpeed) - Number(b.downloadSpeed); break
      case 'status': cmp = a.status.localeCompare(b.status); break
    }
    return cmp * dir
  })
})
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()

const ctx = ref({ show: false, x: 0, y: 0, gid: '', status: 'active' as 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error', isBittorrent: false })
const retry = ref({ show: false, gid: '', url: '', dir: '', filename: '', proxy: '', split: 5 })

function basename(p: string) { return p.split(/[\\/]/).pop() || p }

async function operate(gid: string, op: TaskOp) {
  const c = api.value?.client
  if (!c) return
  const t = tasks.tasks.get(gid)
  try {
    switch (op) {
      case 'pause': await c.pause(gid); break
      case 'unpause': await c.unpause(gid); break
      case 'remove': await c.purge(gid, t?.status ?? 'active'); break
      case 'forcePause': await c.forcePause(gid); break
      case 'forceRemove': await c.forcePurge(gid, t?.status ?? 'active'); break
      case 'copyLink':
        if (t) await navigator.clipboard?.writeText(t.files[0]?.uris[0]?.uri ?? '')
        return
      case 'retry': {
        if (!t) return
        const url = t.files[0]?.uris[0]?.uri ?? ''
        const out = basename(t.files[0]?.path ?? '')
        await c.purge(gid, t.status)
        await c.addUri([url], { dir: t.dir, out })
        break
      }
      case 'retryWithUrl': {
        if (!t) return
        const opts = await c.getOption(gid)
        retry.value = {
          show: true, gid,
          url: t.files[0]?.uris[0]?.uri ?? '',
          dir: t.dir,
          filename: basename(t.files[0]?.path ?? ''),
          proxy: opts['all-proxy'] ?? '',
          split: parseInt(opts['max-connection-per-server'] ?? '5', 10) || 5,
        }
        return
      }
    }
    api.value!.refresh()
  } catch (e) {
    message.error(`操作失败：${String(e)}`)
    api.value!.refresh()
  }
}

async function submitRetry(url: string, dir: string, filename: string, proxy: string, split: number) {
  const c = api.value?.client
  const t = tasks.tasks.get(retry.value.gid)
  if (!c || !t) return
  const options: Record<string, string> = { dir: dir || t.dir, split: String(split), 'max-connection-per-server': String(split) }
  if (filename) options.out = filename
  if (proxy) options['all-proxy'] = proxy
  try {
    await c.purge(retry.value.gid, t.status)
    await c.addUri([url], options)
    api.value!.refresh()
  } catch (e) {
    message.error(`重试失败：${String(e)}`)
    api.value!.refresh()
  }
}

function openContextMenu(gid: string, e: MouseEvent) {
  const t = tasks.tasks.get(gid)
  if (!t) return
  ctx.value = { show: true, x: e.clientX, y: e.clientY, gid, status: t.status, isBittorrent: !!t.bittorrent }
}

async function onAdd(url: string, dir: string, filename: string, proxy: string, split: number) {
  const c = api.value?.client
  if (!c) return
  const options: Record<string, string> = { dir, split: String(split), 'max-connection-per-server': String(split) }
  if (filename) options.out = filename
  if (proxy) options['all-proxy'] = proxy
  try {
    await c.addUri([url], options)
    api.value!.refresh()
  } catch (e) {
    message.error(`添加失败：${String(e)}`)
  }
}
</script>

<template>
  <div style="height:100vh;display:flex;flex-direction:column">
    <TopBar />
    <div style="display:flex;flex:1;min-height:0">
      <Sidebar />
      <div style="flex:1;display:flex;flex-direction:column;min-width:0">
        <BulkToolbar />
        <AddUrlBar :default-dir="api?.dir ?? ''" :on-add="onAdd" />
        <div style="flex:1;overflow:auto" @contextmenu.prevent>
          <TaskTable :tasks="displayTasks" :operate="operate" @contextmenu="openContextMenu" @more="openContextMenu" />
        </div>
      </div>
    </div>
    <TaskContextMenu
      :show="ctx.show" :x="ctx.x" :y="ctx.y" :status="ctx.status" :is-bittorrent="ctx.isBittorrent"
      @select="(op) => operate(ctx.gid, op)" @close="ctx.show = false"
    />
    <RetryDialog v-model:show="retry.show" :original-url="retry.url" :original-dir="retry.dir" :original-filename="retry.filename" :original-proxy="retry.proxy" :original-split="retry.split" @submit="submitRetry" />
  </div>
</template>
