<script setup lang="ts">
import { NModal, NButton, NSpin } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useUpdater } from '@/composables/useUpdater'

const { updateAvailable, updateInfo, downloading, progress, error, check, downloadAndInstall } = useUpdater()

const dismissed = ref(false)

onMounted(() => {
  check()
})

const showModal = computed(() => updateAvailable.value && !dismissed.value)

function later() {
  dismissed.value = true
}

async function doUpdate() {
  await downloadAndInstall()
}
</script>

<template>
  <NModal v-if="showModal" :show="showModal" :mask-closable="false" :close-on-esc="false">
    <div style="width: 420px; max-width: 90vw; background: var(--n-color, #fff); border-radius: 8px; padding: 24px">
      <h3 style="margin: 0 0 12px">发现新版本 v{{ updateInfo?.version }}</h3>
      <div v-if="updateInfo?.body" style="font-size: 14px; line-height: 1.6; margin-bottom: 16px">
        {{ updateInfo.body }}
      </div>
      <div v-if="downloading" style="margin-bottom: 16px">
        <NSpin size="small" />
        <span style="margin-left: 8px; font-size: 13px">下载中… {{ progress }}%</span>
      </div>
      <div v-if="error" style="color: #e88080; font-size: 13px; margin-bottom: 16px">更新失败：{{ error }}</div>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <NButton v-if="!downloading" size="small" @click="later">稍后</NButton>
        <NButton size="small" type="primary" :loading="downloading" :disabled="downloading" @click="doUpdate">
          立即更新
        </NButton>
      </div>
    </div>
  </NModal>
</template>
