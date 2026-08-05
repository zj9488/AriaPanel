<script setup lang="ts">
import {
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NCheckbox,
  NSwitch,
  NSelect,
  NText,
  NTabs,
  NTabPane,
  useMessage,
} from 'naive-ui'
import { ref, watch, inject, computed, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Aria2Api } from '@/composables/useAria2'
import { advancedOptions } from '@/lib/aria2/advanced-options'

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
  btMaxPeers: number
  seedRatio: number
  seedTime: number
  enableDht: boolean
  btListenPort: string
  dhtListenPort: string
  btTracker: string
  btSaveMetadata: boolean
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
  btMaxPeers: 55,
  seedRatio: 1.0,
  seedTime: 0,
  enableDht: true,
  btListenPort: '6881-6999',
  dhtListenPort: '6881-6999',
  btTracker: '',
  btSaveMetadata: false,
})
const loading = ref(false)
const advancedValues = ref<Record<string, string>>({})
const initialAdvanced = ref<Record<string, string>>({})
const advSearch = ref('')

const filteredOptions = computed(() => {
  const q = advSearch.value.trim().toLowerCase()
  if (!q) return advancedOptions
  return advancedOptions.filter((o) => o.key.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
})

watch(
  () => props.show,
  async (v) => {
    if (v) {
      try {
        const got = await invoke<AppSettings>('get_settings')
        s.value = { ...got, port: got.port, secret: got.secret }
        const c = api?.value?.client
        if (c) {
          const globalOpts = await c.getGlobalOption()
          initialAdvanced.value = globalOpts
          advancedValues.value = { ...globalOpts }
        }
      } catch (e) {
        message.error(`加载设置失败：${String(e)}`)
      }
    }
  },
  { flush: 'sync' },
)

function resetAdvanced(key: string) {
  advancedValues.value[key] = initialAdvanced.value[key] ?? ''
}

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
    <NTabs type="line">
      <NTabPane name="general" tab="常规" display-directive="show">
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
      </NTabPane>
      <NTabPane name="bt" tab="BitTorrent" display-directive="show">
        <div style="display: flex; flex-direction: column; gap: 16px; padding: 4px 0">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >最大 Peer 数<NInputNumber v-model:value="s.btMaxPeers" size="small" :min="0" style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >做种比例<NInputNumber
              v-model:value="s.seedRatio"
              size="small"
              :step="0.1"
              :min="0"
              placeholder="0=不限制"
              style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >做种时间 (分钟)<NInputNumber
              v-model:value="s.seedTime"
              size="small"
              :min="0"
              placeholder="0=不限制"
              style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >DHT<NSwitch v-model:value="s.enableDht" size="small"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >BT 监听端口<NInput
              v-model:value="s.btListenPort"
              size="small"
              placeholder="6881-6999"
              style="width: 160px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >DHT 监听端口<NInput
              v-model:value="s.dhtListenPort"
              size="small"
              placeholder="6881-6999"
              style="width: 160px"
          /></label>
          <div style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-size: 13px">额外 Tracker</span>
            <NInput v-model:value="s.btTracker" type="textarea" size="small" placeholder="逗号分隔" :rows="2" />
          </div>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >保存种子文件<NSwitch v-model:value="s.btSaveMetadata" size="small"
          /></label>
        </div>
      </NTabPane>
      <NTabPane name="advanced" tab="高级" display-directive="show">
        <div style="display: flex; flex-direction: column; gap: 10px; padding: 4px 0">
          <NInput v-model:value="advSearch" size="small" placeholder="按选项名或说明过滤" clearable />
          <div style="max-height: 360px; overflow-y: auto; display: flex; flex-direction: column">
            <div
              v-for="opt in filteredOptions"
              :key="opt.key"
              style="
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 0;
                border-bottom: 1px solid rgba(128, 128, 128, 0.15);
              "
            >
              <span style="flex: 1; font-size: 13px" :title="opt.key">{{ opt.label }}</span>
              <NSelect
                v-if="opt.type === 'enum'"
                v-model:value="advancedValues[opt.key]"
                size="small"
                :options="(opt.values || []).map((v) => ({ label: v, value: v }))"
                style="width: 120px"
              />
              <NSwitch
                v-else-if="opt.type === 'boolean'"
                :value="advancedValues[opt.key] === 'true'"
                size="small"
                @update:value="(v) => (advancedValues[opt.key] = String(v))"
              />
              <NInput v-else v-model:value="advancedValues[opt.key]" size="small" style="width: 120px" />
              <NButton size="tiny" quaternary @click="resetAdvanced(opt.key)">重置</NButton>
            </div>
            <NText v-if="filteredOptions.length === 0" depth="3" style="font-size: 13px; padding: 8px 0"
              >无匹配选项</NText
            >
          </div>
        </div>
      </NTabPane>
    </NTabs>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="loading" @click="save">保存</NButton>
      </div>
    </template>
  </NModal>
</template>
