<script setup lang="ts">
import {
  NModal,
  NInput,
  NButton,
  NSelect,
  NInputNumber,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NTag,
  useMessage,
} from 'naive-ui'
import { ref, computed, watch, inject, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useDirBrowser } from '@/composables/useDirBrowser'
import { useCategoryDir } from '@/composables/useCategoryDir'
import type { Aria2Api } from '@/composables/useAria2'
import { fmtBytes } from '@/lib/format'

interface ParsedFile {
  path: string
  length: number
  selected: boolean
}

interface TorrentEntry {
  name: string
  base64: string
  parsedFiles?: ParsedFile[]
}

const props = defineProps<{ show: boolean; defaultDir: string }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; submitted: [] }>()

const api = inject<Ref<Aria2Api | null>>('aria2-api')
const message = useMessage()

const urls = ref('')
const dir = ref(props.defaultDir)
const filename = ref('')
const split = ref(5)
const maxConnPerServer = ref(5)
const proxy = ref('')
const expandedNames = ref<string[]>([])
const submitting = ref(false)
const torrentFiles = ref<TorrentEntry[]>([])

const { browse } = useDirBrowser(dir)
const { selectedCategory, categoryOptions } = useCategoryDir(dir)

watch(
  () => props.defaultDir,
  (v) => {
    if (!props.show) dir.value = v
  },
)

const urlList = computed(() =>
  urls.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
)

const detectedType = computed<'http' | 'bt' | 'mixed' | null>(() => {
  if (torrentFiles.value.length > 0) return 'bt'
  if (urlList.value.length === 0) return null
  const types = new Set(urlList.value.map((u) => (u.startsWith('magnet:') ? 'bt' : 'http')))
  return types.size === 1 ? ([...types][0] as 'http' | 'bt') : 'mixed'
})

const typeLabel = computed(() => {
  switch (detectedType.value) {
    case null:
      return ''
    case 'http':
      return 'HTTP'
    case 'bt':
      return 'BT'
    case 'mixed':
      return '混合'
    default:
      return ''
  }
})

const typeTagType = computed(() => {
  switch (detectedType.value) {
    case null:
      return 'default'
    case 'http':
      return 'info'
    case 'bt':
      return 'success'
    case 'mixed':
      return 'warning'
    default:
      return 'default'
  }
})

watch(
  () => props.show,
  (v) => {
    if (!v) {
      urls.value = ''
      selectedCategory.value = null
      dir.value = props.defaultDir
      filename.value = ''
      split.value = 5
      maxConnPerServer.value = 5
      proxy.value = ''
      torrentFiles.value = []
      expandedNames.value = []
    }
  },
  { flush: 'sync' },
)

function buildOptions(): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    dir: dir.value.trim() || props.defaultDir,
  }
  if (detectedType.value !== 'bt') {
    if (filename.value.trim() && urlList.value.length === 1) opts.out = filename.value.trim()
    opts.split = String(split.value)
    opts['max-connection-per-server'] = String(maxConnPerServer.value)
  }
  if (proxy.value.trim()) opts['all-proxy'] = proxy.value.trim()
  return opts
}

async function pickTorrent() {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Torrent', extensions: ['torrent'] }],
  })
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  for (const path of paths) {
    try {
      const base64 = await invoke<string>('read_torrent_base64', { path })
      const name = path.split(/[\\/]/).pop() ?? path
      torrentFiles.value.push({ name, base64 })
    } catch (e) {
      message.error(`读取种子文件失败：${String(e)}`)
    }
  }
  if (torrentFiles.value.length === 1) {
    try {
      const parsed = await invoke<{ name: string; files: { path: string; length: number }[] }>('parse_torrent_files', {
        b64: torrentFiles.value[0].base64,
      })
      if (parsed.files.length > 1) {
        torrentFiles.value[0].parsedFiles = parsed.files.map((f) => ({
          path: f.path,
          length: f.length,
          selected: true,
        }))
      }
    } catch {
      // parsing failed, skip file selection
    }
  }
}

function removeTorrent(index: number) {
  torrentFiles.value.splice(index, 1)
}

function toggleParsedFile(index: number) {
  const files = torrentFiles.value[0]?.parsedFiles
  if (!files) return
  files[index].selected = !files[index].selected
}

function selectAllParsedFiles() {
  torrentFiles.value[0]?.parsedFiles?.forEach((f) => (f.selected = true))
}

function deselectAllParsedFiles() {
  torrentFiles.value[0]?.parsedFiles?.forEach((f) => (f.selected = false))
}

async function submit() {
  if (torrentFiles.value.length > 0) {
    const c = api?.value?.client
    if (!c) return
    submitting.value = true
    const options = buildOptions()
    let success = 0
    const errors: string[] = []
    for (const f of torrentFiles.value) {
      try {
        const opts = { ...options }
        if (f.parsedFiles) {
          const selected = f.parsedFiles.map((file, i) => (file.selected ? i + 1 : -1)).filter((i) => i > 0)
          if (selected.length > 0) {
            opts['select-file'] = selected.join(',')
          }
        }
        await c.addTorrent(f.base64, [], opts)
        success++
      } catch (e) {
        errors.push(`${f.name}: ${String(e)}`)
      }
    }
    submitting.value = false
    if (errors.length > 0) {
      message.error(`${success} 成功，${errors.length} 失败：${errors.join('; ')}`)
    } else {
      message.success(`已添加 ${success} 个任务`)
    }
    if (success > 0) {
      emit('update:show', false)
      emit('submitted')
    }
    return
  }
  const list = urlList.value
  if (list.length === 0) {
    message.warning('请输入至少一个链接')
    return
  }
  const c = api?.value?.client
  if (!c) return
  submitting.value = true
  const options = buildOptions()
  let success = 0
  const errors: string[] = []
  for (const url of list) {
    try {
      await c.addUri([url], options)
      success++
    } catch (e) {
      errors.push(`${url}: ${String(e)}`)
    }
  }
  submitting.value = false
  if (errors.length > 0) {
    message.error(`${success} 成功，${errors.length} 失败：${errors.join('; ')}`)
  } else {
    message.success(`已添加 ${success} 个任务`)
  }
  if (success > 0) {
    emit('update:show', false)
    emit('submitted')
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="新建任务"
    style="width: 600px; max-width: 90vw"
    @update:show="emit('update:show', $event)"
  >
    <div style="display: flex; flex-direction: column; gap: 12px; padding: 8px 0">
      <NInput v-model:value="urls" type="textarea" :rows="4" placeholder="粘贴下载链接，每行一个" />

      <div style="display: flex; align-items: center; gap: 8px">
        <NTag v-if="detectedType" :type="typeTagType" size="small">{{ typeLabel }}</NTag>
        <span style="font-size: 12px; opacity: 0.6">{{ urlList.length }} 个链接</span>
      </div>

      <div style="display: flex; align-items: center; gap: 8px">
        <NButton size="small" quaternary data-test="pick-torrent" @click="pickTorrent">选择种子文件</NButton>
        <span v-if="torrentFiles.length > 0" style="font-size: 12px; opacity: 0.6">
          已选择 {{ torrentFiles.length }} 个种子文件（链接将被忽略）
        </span>
      </div>
      <div v-if="torrentFiles.length > 0" style="display: flex; flex-wrap: wrap; gap: 6px">
        <NTag v-for="(f, i) in torrentFiles" :key="i" size="small" closable @close="removeTorrent(i)">
          {{ f.name }}
        </NTag>
      </div>

      <div
        v-if="torrentFiles.length === 1 && torrentFiles[0].parsedFiles && torrentFiles[0].parsedFiles.length > 1"
        data-test="file-list"
        style="border: 1px solid var(--n-border-color, #eee); border-radius: 4px; padding: 8px"
      >
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
          <span style="font-size: 13px; font-weight: 500">文件列表</span>
          <div style="display: flex; gap: 4px">
            <NButton size="tiny" data-test="select-all-files" @click="selectAllParsedFiles">全选</NButton>
            <NButton size="tiny" data-test="deselect-all-files" @click="deselectAllParsedFiles">全不选</NButton>
          </div>
        </div>
        <div style="max-height: 240px; overflow-y: auto">
          <div
            v-for="(f, i) in torrentFiles[0].parsedFiles"
            :key="i"
            style="display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 2px 0"
          >
            <NCheckbox :checked="f.selected" data-test="file-checkbox" @update:checked="toggleParsedFile(i)" />
            <span style="flex: 1; word-break: break-all">{{ f.path }}</span>
            <span style="opacity: 0.6; flex-shrink: 0">{{ fmtBytes(f.length) }}</span>
          </div>
        </div>
      </div>

      <NCollapse v-model:expanded-names="expandedNames" :display-directive="'show'">
        <NCollapseItem title="高级设置" name="advanced">
          <div style="display: flex; flex-direction: column; gap: 8px">
            <div style="display: flex; align-items: center; gap: 8px">
              <span style="font-size: 13px; width: 56px; flex-shrink: 0">分类</span>
              <NSelect
                v-model:value="selectedCategory"
                :options="categoryOptions"
                placeholder="选择分类"
                clearable
                size="small"
                style="flex: 1"
              />
            </div>
            <div style="display: flex; align-items: center; gap: 8px">
              <span style="font-size: 13px; width: 56px; flex-shrink: 0">目录</span>
              <NInput v-model:value="dir" placeholder="保存目录" size="small" style="flex: 1" />
              <NButton size="small" quaternary @click="browse">浏览</NButton>
            </div>
            <div v-if="detectedType !== 'bt'" style="display: flex; align-items: center; gap: 8px">
              <span style="font-size: 13px; width: 56px; flex-shrink: 0">文件名</span>
              <NInput v-model:value="filename" placeholder="文件名（可选）" size="small" style="flex: 1" />
            </div>
            <div v-if="detectedType !== 'bt'" style="display: flex; align-items: center; gap: 16px">
              <div style="display: flex; align-items: center; gap: 4px">
                <span style="font-size: 13px">分块</span>
                <NInputNumber v-model:value="split" size="small" :min="1" :max="16" style="width: 80px" />
              </div>
              <div style="display: flex; align-items: center; gap: 4px">
                <span style="font-size: 13px">连接数</span>
                <NInputNumber v-model:value="maxConnPerServer" size="small" :min="1" :max="16" style="width: 80px" />
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px">
              <span style="font-size: 13px; width: 56px; flex-shrink: 0">代理</span>
              <NInput v-model:value="proxy" placeholder="如 http://127.0.0.1:7890" size="small" style="flex: 1" />
            </div>
          </div>
        </NCollapseItem>
      </NCollapse>
    </div>

    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="submitting" data-test="submit" @click="submit">开始下载</NButton>
      </div>
    </template>
  </NModal>
</template>
