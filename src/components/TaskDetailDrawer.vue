<script setup lang="ts">
import { NButton, NCheckbox, NDrawer, NDrawerContent, NInput, NProgress, NTag } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'
import type { TaskOp } from '@/lib/task-op'
import BtPeerSection from './BtPeerSection.vue'
import { fmtSpeed, fmtBytes, fmtProgress, taskName } from '@/lib/format'

const props = defineProps<{
  show: boolean
  detail: Aria2TaskDetail | null
  taskOptions: Record<string, string>
  operate: (gid: string, op: TaskOp) => void
  changeOption: (gid: string, options: Record<string, string>) => void
}>()
const emit = defineEmits<{ 'update:show': [v: boolean] }>()

const t = computed(() => props.detail)

const dlLimit = ref('0')
const ulLimit = ref('0')
const seedRatio = ref('0')

watch(
  () => props.taskOptions,
  (opts) => {
    dlLimit.value = opts['max-download-limit'] ?? '0'
    ulLimit.value = opts['max-upload-limit'] ?? '0'
    seedRatio.value = opts['seed-ratio'] ?? '0'
  },
  { immediate: true },
)

const isMultiFileBt = computed(() => {
  const d = t.value
  return !!(d?.bittorrent && d.files.length > 1)
})

const isSeeding = computed(() => {
  const d = t.value
  if (!d?.bittorrent) return false
  return Number(d.completedLength) >= Number(d.totalLength) && Number(d.totalLength) > 0
})

function applyDlLimit() {
  if (!t.value) return
  const val = dlLimit.value.trim()
  if (val === (props.taskOptions['max-download-limit'] ?? '0')) return
  props.changeOption(t.value.gid, { 'max-download-limit': val })
}

function applyUlLimit() {
  if (!t.value) return
  const val = ulLimit.value.trim()
  if (val === (props.taskOptions['max-upload-limit'] ?? '0')) return
  props.changeOption(t.value.gid, { 'max-upload-limit': val })
}

function applySeedRatio() {
  if (!t.value) return
  const val = seedRatio.value.trim()
  if (val === (props.taskOptions['seed-ratio'] ?? '0')) return
  props.changeOption(t.value.gid, { 'seed-ratio': val })
}

const editMode = ref(false)
const localSelected = ref<number[]>([])

const applyDisabled = computed(() => localSelected.value.length === 0)

function enterEditMode() {
  const d = t.value
  if (!d) return
  localSelected.value = d.files.map((f, i) => (f.selected === 'true' ? i + 1 : -1)).filter((i) => i > 0)
  editMode.value = true
}

function exitEditMode() {
  editMode.value = false
}

function toggleFileLocal(index: number) {
  const idx = index + 1
  const pos = localSelected.value.indexOf(idx)
  if (pos >= 0) localSelected.value.splice(pos, 1)
  else localSelected.value.push(idx)
  localSelected.value.sort((a, b) => a - b)
}

function selectAllLocal() {
  const d = t.value
  if (!d) return
  localSelected.value = d.files.map((_, i) => i + 1)
}

function deselectAllLocal() {
  localSelected.value = []
}

function applySelection() {
  const d = t.value
  if (!d || localSelected.value.length === 0) return
  props.changeOption(d.gid, { 'select-file': localSelected.value.join(',') })
  editMode.value = false
}

watch(
  () => props.show,
  (show) => {
    if (!show) editMode.value = false
  },
)

watch(
  () => t.value?.gid,
  () => {
    editMode.value = false
  },
)

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
          <div style="font-size: 13px; line-height: 1.8; margin-top: 8px">
            <label style="display: flex; align-items: center; gap: 8px">
              下载限速
              <NInput
                v-model:value="dlLimit"
                data-test="dl-limit"
                size="small"
                placeholder="0=不限"
                style="width: 120px"
                @blur="applyDlLimit"
              />
            </label>
            <label style="display: flex; align-items: center; gap: 8px">
              上传限速
              <NInput
                v-model:value="ulLimit"
                data-test="ul-limit"
                size="small"
                placeholder="0=不限"
                style="width: 120px"
                @blur="applyUlLimit"
              />
            </label>
          </div>
        </section>

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">分块进度</h4>
          <div style="font-size: 13px; line-height: 1.8">
            {{ completedPieces(t) }}/{{ t.numPieces }} 块已完成，{{ t.connections }} 个活跃连接<br />
            分块大小：{{ fmtBytes(t.pieceLength) }}
          </div>
        </section>

        <section v-if="t.bittorrent">
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">做种设置</h4>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px">
            做种比例
            <NInput
              v-model:value="seedRatio"
              data-test="seed-ratio"
              size="small"
              placeholder="0=跟随全局"
              style="width: 100px"
              @blur="applySeedRatio"
            />
          </label>
        </section>

        <BtPeerSection v-if="t?.bittorrent" :detail="t" />

        <section>
          <div style="display: flex; align-items: center; justify-content: space-between">
            <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">文件列表</h4>
            <div v-if="isMultiFileBt && !editMode" style="display: flex; gap: 4px">
              <NButton size="tiny" data-test="edit-files" @click="enterEditMode">编辑选择</NButton>
            </div>
            <div v-if="isMultiFileBt && editMode" style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap">
              <NButton size="tiny" data-test="select-all-files" @click="selectAllLocal">全选</NButton>
              <NButton size="tiny" data-test="deselect-all-files" @click="deselectAllLocal"> 全不选 </NButton>
              <NButton
                size="tiny"
                type="primary"
                data-test="apply-files"
                :disabled="applyDisabled"
                @click="applySelection"
              >
                应用
              </NButton>
              <NButton size="tiny" data-test="cancel-edit-files" @click="exitEditMode">取消</NButton>
              <span v-if="applyDisabled" style="font-size: 12px; opacity: 0.6">至少保留一个文件</span>
            </div>
          </div>
          <div
            v-for="(f, i) in t.files"
            :key="i"
            style="font-size: 13px; line-height: 1.6; display: flex; align-items: center; gap: 6px"
          >
            <NCheckbox
              v-if="isMultiFileBt"
              :checked="editMode ? localSelected.includes(i + 1) : f.selected === 'true'"
              :disabled="!editMode"
              data-test="file-checkbox"
              @update:checked="toggleFileLocal(i)"
            />
            <span style="flex: 1">
              {{ f.path.split(/[\\/]/).pop() }} — {{ fmtBytes(f.length) }}
              <NProgress
                :percentage="Number(f.length) ? Math.round((Number(f.completedLength) / Number(f.length)) * 100) : 0"
                :height="6"
              />
            </span>
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
          <NButton v-if="t.status === 'active'" size="small" @click="operate(t.gid, 'pause')">
            {{ isSeeding ? '停止做种' : '暂停' }}
          </NButton>
          <NButton
            v-if="t.status === 'paused' || t.status === 'waiting'"
            size="small"
            @click="operate(t.gid, 'unpause')"
          >
            {{ isSeeding ? '开始做种' : '恢复' }}
          </NButton>
          <NButton size="small" @click="operate(t.gid, 'copyLink')">复制链接</NButton>
          <NButton size="small" @click="operate(t.gid, 'openFolder')">打开目录</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
