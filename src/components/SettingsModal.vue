<script setup lang="ts">
import { NButton, NInput, NInputNumber, NModal, NCheckbox, useMessage } from 'naive-ui'
import { ref, watch, inject, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Aria2Api } from '@/composables/useAria2'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; saved: [] }>()
const api = inject<Ref<Aria2Api | null>>('aria2-api')
const message = useMessage()

interface AppSettings {
  port: number | null
  secret: string | null
  dir: string
  maxConcurrentDownloads: number
  maxConnectionPerServer: number
  minSplitSize: string
  split: number
  maxOverallDownloadLimit: string
  maxOverallUploadLimit: string
  allProxy: string
  clipboardWatch: boolean
}

const s = ref<AppSettings>({
  port: null,
  secret: null,
  dir: '',
  maxConcurrentDownloads: 5,
  maxConnectionPerServer: 5,
  minSplitSize: '20M',
  split: 5,
  maxOverallDownloadLimit: '0',
  maxOverallUploadLimit: '0',
  allProxy: '',
  clipboardWatch: true,
})
const loading = ref(false)

watch(
  () => props.show,
  async (v) => {
    if (v) {
      try {
        const got = await invoke<AppSettings>('get_settings')
        s.value = { ...got, port: got.port, secret: got.secret }
      } catch (e) {
        message.error(`加载设置失败：${String(e)}`)
      }
    }
  },
  { flush: 'sync' },
)

async function save() {
  loading.value = true
  try {
    const result = await invoke<{ restarted: boolean; endpoint: { url: string; secret: string; dir: string } | null }>(
      'save_settings',
      { settings: s.value },
    )
    if (!result.restarted) {
      const c = api?.value?.client
      if (c) {
        await c.changeGlobalOption({
          'max-concurrent-downloads': String(s.value.maxConcurrentDownloads),
          'max-connection-per-server': String(s.value.maxConnectionPerServer),
          'min-split-size': s.value.minSplitSize,
          split: String(s.value.split),
          'max-overall-download-limit': s.value.maxOverallDownloadLimit,
          'max-overall-upload-limit': s.value.maxOverallUploadLimit,
          ...(s.value.allProxy ? { 'all-proxy': s.value.allProxy } : {}),
        })
      }
    }
    message.success(result.restarted ? '设置已保存，aria2 已重启' : '设置已保存')
    emit('saved')
    emit('update:show', false)
  } catch (e) {
    message.error(`保存失败：${String(e)}`)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="设置"
    style="width: 500px; max-width: 90vw"
    @update:show="emit('update:show', $event)"
  >
    <div style="display: flex; flex-direction: column; gap: 20px; padding: 4px 0">
      <section>
        <h4 style="margin: 0 0 8px; font-size: 14px">下载设置</h4>
        <div style="display: flex; flex-direction: column; gap: 6px">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >最大并发下载数<NInputNumber
              v-model:value="s.maxConcurrentDownloads"
              size="small"
              :min="1"
              style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >单任务最大连接数<NInputNumber
              v-model:value="s.maxConnectionPerServer"
              size="small"
              :min="1"
              style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >最小分块大小<NInput v-model:value="s.minSplitSize" size="small" style="width: 100px"
          /></label>
        </div>
      </section>
      <section>
        <h4 style="margin: 0 0 8px; font-size: 14px">速度限制</h4>
        <div style="display: flex; flex-direction: column; gap: 6px">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >全局下载限速<NInput
              v-model:value="s.maxOverallDownloadLimit"
              size="small"
              placeholder="0=不限"
              style="width: 120px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >全局上传限速<NInput
              v-model:value="s.maxOverallUploadLimit"
              size="small"
              placeholder="0=不限"
              style="width: 120px"
          /></label>
        </div>
      </section>
      <section>
        <h4 style="margin: 0 0 8px; font-size: 14px">下载目录</h4>
        <NInput v-model:value="s.dir" size="small" placeholder="默认下载路径" />
      </section>
      <section>
        <h4 style="margin: 0 0 8px; font-size: 14px">代理</h4>
        <NInput v-model:value="s.allProxy" size="small" placeholder="如 http://127.0.0.1:7890" />
      </section>
      <section>
        <h4 style="margin: 0 0 8px; font-size: 14px; color: #f0a020">RPC 设置 ⚠ 修改后自动重启 aria2</h4>
        <div style="display: flex; flex-direction: column; gap: 6px">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >RPC 端口<NInputNumber v-model:value="s.port" size="small" :min="1" :max="65535" style="width: 120px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >RPC 密钥<NInput v-model:value="s.secret" size="small" placeholder="留空=自动生成" style="width: 200px"
          /></label>
        </div>
      </section>
      <section>
        <h4 style="margin: 0 0 8px; font-size: 14px">行为</h4>
        <NCheckbox v-model:checked="s.clipboardWatch">剪贴板监听</NCheckbox>
      </section>
    </div>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="loading" @click="save">保存</NButton>
      </div>
    </template>
  </NModal>
</template>
