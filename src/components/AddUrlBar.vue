<script setup lang="ts">
import { NButton, NInput, NInputNumber } from 'naive-ui'
import { ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'

const props = defineProps<{ onAdd: (url: string, dir: string, filename: string, proxy: string, split: number) => void; defaultDir: string }>()

const url = ref('')
const dir = ref(props.defaultDir)
const filename = ref('')
const proxy = ref('')
const split = ref(5)

watch(() => props.defaultDir, v => { dir.value = v })

function deriveFilename(u: string) {
  try { return new URL(u).pathname.split('/').pop() || '' }
  catch { return '' }
}

watch(url, u => { if (u && !filename.value) filename.value = deriveFilename(u) })

async function browse() {
  const selected = await open({ directory: true, defaultPath: dir.value })
  if (selected) dir.value = selected
}

function submit() {
  const v = url.value.trim()
  if (!v) return
  props.onAdd(v, dir.value.trim() || props.defaultDir, filename.value.trim(), proxy.value.trim(), split.value || 1)
  url.value = ''
  filename.value = ''
}
</script>

<template>
  <div style="display:flex;flex-direction:column;gap:4px;padding:8px">
    <div style="display:flex;gap:8px">
      <NInput v-model:value="url" placeholder="粘贴下载链接，回车开始" @keydown.enter="submit" />
      <NButton type="primary" @click="submit">添加</NButton>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <NInput v-model:value="dir" size="small" placeholder="保存路径" />
      <NButton size="small" quaternary @click="browse">浏览</NButton>
      <NInput v-model:value="filename" size="small" placeholder="文件名（可选）" style="width:180px" />
      <NInput v-model:value="proxy" size="small" placeholder="代理（可选，如 http://127.0.0.1:7890）" style="width:240px" />
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <span style="font-size:12px;opacity:.6;white-space:nowrap">线程</span>
        <NInputNumber v-model:value="split" size="small" :min="1" :max="16" style="width:70px" />
      </div>
    </div>
  </div>
</template>
