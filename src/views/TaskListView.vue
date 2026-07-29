<script setup lang="ts">
import { ref, computed, inject, watch, type Ref } from 'vue'
import { useMessage, useNotification, NAlert, NButton } from 'naive-ui'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
import BulkToolbar from '@/components/BulkToolbar.vue'
import TaskTable from '@/components/TaskTable.vue'
import TaskContextMenu from '@/components/TaskContextMenu.vue'
import RetryDialog from '@/components/RetryDialog.vue'
import AddUrlBar from '@/components/AddUrlBar.vue'
import NewTaskModal from '@/components/NewTaskModal.vue'
import TaskDetailDrawer from '@/components/TaskDetailDrawer.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import DiagnosticsModal from '@/components/DiagnosticsModal.vue'
import { useTaskStore } from '@/stores/task'
import { usePrefStore } from '@/stores/preferences'
import { useConnectionStore } from '@/stores/connection'
import { useCategoryStore } from '@/stores/category'
import { invoke } from '@tauri-apps/api/core'
import type { Aria2Api } from '@/composables/useAria2'
import { useTaskOperations } from '@/composables/useTaskOperations'
import { useDetailPoller } from '@/composables/useDetailPoller'
import { useClipboardWatcher } from '@/composables/useClipboardWatcher'
import { fmtProgress, taskName } from '@/lib/format'

const tasks = useTaskStore()
const prefs = usePrefStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()
const notification = useNotification()
const conn = useConnectionStore()
const cats = useCategoryStore()

watch(
  () => api.value?.dir,
  (d) => cats.setDefaultDir(d ?? ''),
  { immediate: true },
)

const displayTasks = computed(() => {
  const list = [...tasks.visibleTasks]
  const key = prefs.sortKey
  const dir = prefs.sortOrder === 'asc' ? 1 : -1
  return list.sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'name':
        cmp = taskName(a).localeCompare(taskName(b))
        break
      case 'size':
        cmp = Number(a.totalLength) - Number(b.totalLength)
        break
      case 'progress':
        cmp = fmtProgress(a) - fmtProgress(b)
        break
      case 'speed':
        cmp = Number(a.downloadSpeed) - Number(b.downloadSpeed)
        break
      case 'status':
        cmp = a.status.localeCompare(b.status)
        break
    }
    return cmp * dir
  })
})

const { retry, operate, submitRetry, onAdd, changeTaskOption } = useTaskOperations(api, tasks, message)
const { detail, taskOptions } = useDetailPoller(api, tasks)

const ctx = ref({
  show: false,
  x: 0,
  y: 0,
  gid: '',
  status: 'active' as 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error',
  isBittorrent: false,
})
const detailShow = ref(false)
const settingsShow = ref(false)
const newTaskShow = ref(false)

function onRowClick(gid: string) {
  tasks.selectedGid = gid
  detailShow.value = true
}
function onDrawerClose(v: boolean) {
  detailShow.value = v
  if (!v) tasks.selectedGid = ''
}

const addUrlRef = ref<InstanceType<typeof AddUrlBar>>()
const { start: startClipboard } = useClipboardWatcher(notification, (url) => {
  addUrlRef.value?.setUrl(url)
})
invoke<{ clipboardWatch: boolean }>('get_settings').then((s) => {
  if (s.clipboardWatch) startClipboard()
})

function openContextMenu(gid: string, e: MouseEvent) {
  const t = tasks.tasks.get(gid)
  if (!t) return
  ctx.value = { show: true, x: e.clientX, y: e.clientY, gid, status: t.status, isBittorrent: !!t.bittorrent }
}
</script>

<template>
  <div style="height: 100vh; display: flex; flex-direction: column">
    <TopBar @settings="settingsShow = true" @new-task="newTaskShow = true" />
    <NAlert v-if="conn.status === 'reconnecting'" type="warning" :bordered="false" style="border-radius: 0">
      aria2 连接中…
    </NAlert>
    <NAlert v-if="conn.status === 'error' && conn.error" type="error" :bordered="false" style="border-radius: 0">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <span>{{ conn.error }}</span>
        <NButton size="small" type="error" @click="conn.setShowDiagnostics(true)">查看诊断</NButton>
      </div>
    </NAlert>
    <div style="display: flex; flex: 1; min-height: 0">
      <Sidebar />
      <div style="flex: 1; display: flex; flex-direction: column; min-width: 0">
        <BulkToolbar />
        <AddUrlBar ref="addUrlRef" :default-dir="api?.dir ?? ''" :on-add="onAdd" />
        <div style="flex: 1; overflow: auto" @contextmenu.prevent>
          <TaskTable
            :tasks="displayTasks"
            :operate="operate"
            @contextmenu="openContextMenu"
            @more="openContextMenu"
            @row-click="onRowClick"
          />
        </div>
      </div>
    </div>
    <TaskContextMenu
      :show="ctx.show"
      :x="ctx.x"
      :y="ctx.y"
      :status="ctx.status"
      :is-bittorrent="ctx.isBittorrent"
      :categories="cats.categories"
      @select="(op) => operate(ctx.gid, op)"
      @reclassify="(dir) => changeTaskOption(ctx.gid, { dir: dir || (api?.dir ?? '') })"
      @close="ctx.show = false"
    />
    <RetryDialog
      v-model:show="retry.show"
      :original-url="retry.url"
      :original-dir="retry.dir"
      :original-filename="retry.filename"
      :original-proxy="retry.proxy"
      :original-split="retry.split"
      @submit="submitRetry"
    />
    <TaskDetailDrawer
      :show="detailShow"
      :detail="detail"
      :task-options="taskOptions"
      :operate="operate"
      :change-option="changeTaskOption"
      @update:show="onDrawerClose"
    />
    <SettingsModal v-model:show="settingsShow" @saved="api?.refresh()" />
    <NewTaskModal v-model:show="newTaskShow" :default-dir="api?.dir ?? ''" @submitted="api?.refresh()" />
    <DiagnosticsModal />
  </div>
</template>
