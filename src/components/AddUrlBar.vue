<script setup lang="ts">
import { NButton, NInput } from 'naive-ui'
import { ref } from 'vue'
const props = defineProps<{ onAdd: (url: string) => void }>()
const url = ref('')
function submit() {
  const v = url.value.trim()
  if (!v) return
  props.onAdd(v)
  url.value = ''
}
</script>

<template>
  <div style="display:flex;gap:8px;padding:8px">
    <NInput v-model:value="url" placeholder="粘贴下载链接，回车开始" @keydown.enter="submit" />
    <NButton type="primary" @click="submit">添加</NButton>
  </div>
</template>
