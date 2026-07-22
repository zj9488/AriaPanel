<script setup lang="ts">
import { NButton, NInput, NModal } from 'naive-ui'
import { ref, watch } from 'vue'

const props = defineProps<{ show: boolean; originalUrl: string }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; submit: [url: string] }>()

const url = ref(props.originalUrl)
watch(() => props.show, v => { if (v) url.value = props.originalUrl })

function ok() {
  const v = url.value.trim()
  if (v) emit('submit', v)
  emit('update:show', false)
}
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="dialog" title="更换链接重试">
    <div style="padding:8px 0">
      <NInput v-model:value="url" type="text" placeholder="下载链接" @keydown.enter="ok" />
    </div>
    <template #action>
      <NButton @click="emit('update:show', false)">取消</NButton>
      <NButton type="primary" @click="ok">重试</NButton>
    </template>
  </NModal>
</template>
