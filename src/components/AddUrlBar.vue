<script setup lang="ts">
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui'
import { ref, watch } from 'vue'
import { useDirBrowser } from '@/composables/useDirBrowser'
import { useCategoryDir } from '@/composables/useCategoryDir'

const props = defineProps<{
  onAdd: (url: string, dir: string, filename: string, proxy: string, split: number) => void
  defaultDir: string
}>()

const url = ref('')
const dir = ref(props.defaultDir)
const filename = ref('')
const proxy = ref('')
const split = ref(5)

const { browse } = useDirBrowser(dir)
const { selectedCategory, categoryOptions } = useCategoryDir(dir)

let prevDefaultDir = props.defaultDir
watch(
  () => props.defaultDir,
  (v) => {
    if (dir.value === prevDefaultDir) dir.value = v
    prevDefaultDir = v
  },
)

function deriveFilename(u: string): string {
  try {
    const url = new URL(u)
    const rcd = url.searchParams.get('response-content-disposition')
    if (rcd) {
      const decoded = decodeURIComponent(rcd)
      let m = decoded.match(/filename="([^"]+)"/i)
      if (!m) m = decoded.match(/filename\*=[^']*''([^;]+)/i)
      if (m?.[1]) return m[1]
    }
    const seg = url.pathname.split('/').pop() || ''
    if (seg && /\.[a-z0-9]{2,5}$/i.test(seg)) return seg
    return ''
  } catch {
    return ''
  }
}

watch(url, (u) => {
  if (u && !filename.value) filename.value = deriveFilename(u)
})

function submit() {
  const v = url.value.trim()
  if (!v) return
  props.onAdd(v, dir.value.trim() || props.defaultDir, filename.value.trim(), proxy.value.trim(), split.value || 1)
  url.value = ''
  filename.value = ''
}

function setUrl(u: string) {
  url.value = u
  filename.value = ''
}
defineExpose({ setUrl })
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px">
    <div style="display: flex; gap: 8px">
      <NInput v-model:value="url" placeholder="粘贴下载链接，回车开始" @keydown.enter="submit" />
      <NButton type="primary" @click="submit">添加</NButton>
    </div>
    <div style="display: flex; gap: 8px; align-items: center">
      <NSelect
        v-model:value="selectedCategory"
        :options="categoryOptions"
        size="small"
        placeholder="分类"
        clearable
        style="width: 120px; flex-shrink: 0"
      />
      <NInput v-model:value="dir" size="small" placeholder="保存路径" />
      <NButton size="small" quaternary @click="browse">浏览</NButton>
      <NInput v-model:value="filename" size="small" placeholder="文件名（可选）" style="width: 180px" />
      <NInput
        v-model:value="proxy"
        size="small"
        placeholder="代理（可选，如 http://127.0.0.1:7890）"
        style="width: 240px"
      />
      <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0">
        <span style="font-size: 12px; opacity: 0.6; white-space: nowrap">线程</span>
        <NInputNumber v-model:value="split" size="small" :min="1" :max="16" style="width: 88px" />
      </div>
    </div>
  </div>
</template>
