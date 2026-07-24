<script setup lang="ts">
import { NModal, NInput, NButton, useMessage } from 'naive-ui'
import { ref, watch } from 'vue'
import type { Category } from '@/stores/category'

const props = defineProps<{ show: boolean; category: Category | null }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; submit: [name: string, dir: string] }>()

const name = ref('')
const dir = ref('')
const isEdit = ref(false)
const message = useMessage()

watch(() => props.show, v => {
  if (!v) return
  if (props.category) {
    name.value = props.category.name
    dir.value = props.category.dir
    isEdit.value = true
  } else {
    name.value = ''
    dir.value = ''
    isEdit.value = false
  }
}, { immediate: true })

function submit() {
  if (!name.value.trim()) {
    message.warning('请输入分类名称')
    return
  }
  emit('submit', name.value.trim(), dir.value.trim())
  emit('update:show', false)
}
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="card" :title="isEdit ? '编辑分类' : '添加分类'" style="width:400px;max-width:90vw">
    <div style="display:flex;flex-direction:column;gap:16px;padding:8px 0">
      <NInput v-model:value="name" placeholder="分类名称" />
      <NInput v-model:value="dir" placeholder="保存目录（留空使用默认目录）" />
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton size="small" type="primary" data-test="submit" @click="submit">确定</NButton>
      </div>
    </div>
  </NModal>
</template>
