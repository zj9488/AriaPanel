<script setup lang="ts">
import { NButton, NInput, NInputNumber, NModal } from 'naive-ui'
import { ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'

const props = defineProps<{
  show: boolean
  originalUrl: string
  originalDir: string
  originalFilename: string
  originalProxy: string
  originalSplit: number
}>()
const emit = defineEmits<{ 'update:show': [v: boolean]; submit: [url: string, dir: string, filename: string, proxy: string, split: number] }>()

const url = ref('')
const dir = ref('')
const filename = ref('')
const proxy = ref('')
const split = ref(5)

watch(() => props.show, v => {
  if (v) {
    url.value = props.originalUrl
    dir.value = props.originalDir
    filename.value = props.originalFilename
    proxy.value = props.originalProxy
    split.value = props.originalSplit
  }
})

async function browse() {
  const selected = await open({ directory: true, defaultPath: dir.value })
  if (selected) dir.value = selected
}

function ok() {
  const v = url.value.trim()
  if (v) emit('submit', v, dir.value.trim(), filename.value.trim(), proxy.value.trim(), split.value || 1)
  emit('update:show', false)
}
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="dialog" title="更换链接重试">
    <div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">
      <NInput v-model:value="url" placeholder="下载链接" @keydown.enter="ok" />
      <div style="display:flex;gap:8px;align-items:center">
        <NInput v-model:value="dir" size="small" placeholder="保存路径" />
        <NButton size="small" quaternary @click="browse">浏览</NButton>
        <NInput v-model:value="filename" size="small" placeholder="文件名（可选）" style="width:160px" />
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <NInput v-model:value="proxy" size="small" placeholder="代理（可选）" style="width:240px" />
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span style="font-size:12px;opacity:.6;white-space:nowrap">线程</span>
          <NInputNumber v-model:value="split" size="small" :min="1" :max="16" style="width:70px" />
        </div>
      </div>
    </div>
    <template #action>
      <NButton @click="emit('update:show', false)">取消</NButton>
      <NButton type="primary" @click="ok">重试</NButton>
    </template>
  </NModal>
</template>
