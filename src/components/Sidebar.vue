<script setup lang="ts">
import { computed } from 'vue'
import { useTaskStore, type TaskFilter } from '@/stores/task'

const tasks = useTaskStore()

const items = computed(() => [
  { key: 'all' as TaskFilter, label: '全部', count: tasks.active.length + tasks.waiting.length + tasks.stopped.length },
  { key: 'active' as TaskFilter, label: '下载中', count: tasks.active.length },
  { key: 'waiting' as TaskFilter, label: '等待中', count: tasks.waiting.length },
  { key: 'stopped' as TaskFilter, label: '已完成', count: tasks.stopped.length },
])
</script>

<template>
  <nav style="width:170px;flex-shrink:0;border-right:1px solid var(--n-border-color,#eee);padding:8px 0">
    <button
      v-for="it in items" :key="it.key"
      @click="tasks.setFilter(it.key)"
      :style="{
        display:'flex',justifyContent:'space-between',alignItems:'center',
        width:'100%',padding:'6px 14px',border:'none',background:'transparent',cursor:'pointer',
        fontWeight: tasks.filter === it.key ? 700 : 400,
        color: tasks.filter === it.key ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
    >
      <span>{{ it.label }}</span>
      <span style="opacity:.6;font-size:12px">{{ it.count }}</span>
    </button>
    <div style="margin-top:16px;padding:0 14px;opacity:.4;font-size:12px">分类（M3）</div>
    <div style="padding:0 14px;opacity:.4;font-size:12px">速度统计（M3）</div>
  </nav>
</template>
