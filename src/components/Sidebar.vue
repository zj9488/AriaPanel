<script setup lang="ts">
import { computed, ref, inject, type Ref } from 'vue'
import { NDropdown, useDialog } from 'naive-ui'
import { useTaskStore, type TaskFilter } from '@/stores/task'
import { useCategoryStore, type Category, UNCATEGORIZED_ID } from '@/stores/category'
import { useConnectionStore } from '@/stores/connection'
import type { Aria2Api } from '@/composables/useAria2'
import { fmtSpeed } from '@/lib/format'
import CategoryModal from './CategoryModal.vue'

const tasks = useTaskStore()
const cats = useCategoryStore()
const conn = useConnectionStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')
const dialog = useDialog()
const version = __APP_VERSION__

const statusItems = computed(() => [
  { key: 'all' as TaskFilter, label: '全部', count: tasks.active.length + tasks.waiting.length + tasks.stopped.length },
  { key: 'active' as TaskFilter, label: '下载中', count: tasks.active.length },
  { key: 'waiting' as TaskFilter, label: '等待中', count: tasks.waiting.length },
  { key: 'stopped' as TaskFilter, label: '已完成', count: tasks.stopped.length },
])

const CATEGORY_ICONS: Record<string, string> = {
  downloads: '📁',
  music: '🎵',
  video: '🎬',
  image: '🖼',
  doc: '📄',
}

function iconFor(cat: Category): string {
  return CATEGORY_ICONS[cat.id] ?? '📂'
}

function catCount(catId: string): number {
  let count = 0
  for (const gid of tasks.order) {
    const t = tasks.tasks.get(gid)
    if (t && cats.matchCategory(t, catId)) count++
  }
  return count
}

function uncategorizedCount(): number {
  let count = 0
  for (const gid of tasks.order) {
    const t = tasks.tasks.get(gid)
    if (t && cats.isUncategorized(t)) count++
  }
  return count
}

function selectUncategorized() {
  tasks.categoryFilter = tasks.categoryFilter === UNCATEGORIZED_ID ? null : UNCATEGORIZED_ID
}

function selectCategory(id: string) {
  tasks.categoryFilter = tasks.categoryFilter === id ? null : id
}

const catCtx = ref({ show: false, x: 0, y: 0, id: '' })

function onCategoryContext(e: MouseEvent, id: string) {
  e.preventDefault()
  catCtx.value = { show: true, x: e.clientX, y: e.clientY, id }
}

function catMenuOptions() {
  return [
    { label: '编辑', key: 'edit' },
    { label: '删除', key: 'delete' },
  ]
}

function catMenuPick(key: string) {
  const id = catCtx.value.id
  catCtx.value.show = false
  if (key === 'edit') {
    editingCategory.value = cats.getCategory(id) ?? null
    catModalShow.value = true
  } else if (key === 'delete') {
    const count = catCount(id)
    const cat = cats.getCategory(id)
    const label = cat?.name ?? '该分类'
    dialog.warning({
      title: '删除分类',
      content:
        count > 0
          ? `「${label}」下有 ${count} 个任务，删除后这些任务将变为未分类。确定删除？`
          : `确定删除「${label}」？`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        cats.removeCategory(id)
        if (tasks.categoryFilter === id) tasks.categoryFilter = null
      },
    })
  }
}

const catModalShow = ref(false)
const editingCategory = ref<Category | null>(null)

function openAddCategory() {
  editingCategory.value = null
  catModalShow.value = true
}

function onCategorySubmit(name: string, dir: string) {
  if (editingCategory.value) {
    cats.updateCategory(editingCategory.value.id, name, dir)
  } else {
    cats.addCategory(name, dir)
  }
}
</script>

<template>
  <nav
    style="
      width: 170px;
      flex-shrink: 0;
      border-right: 1px solid var(--n-border-color, #eee);
      padding: 8px 0;
      display: flex;
      flex-direction: column;
    "
  >
    <button
      v-for="it in statusItems"
      :key="it.key"
      :style="{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        padding: '6px 14px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: tasks.filter === it.key ? 700 : 400,
        color: tasks.filter === it.key ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
      @click="tasks.setFilter(it.key)"
    >
      <span>{{ it.label }}</span>
      <span style="opacity: 0.6; font-size: 12px">{{ it.count }}</span>
    </button>

    <div style="margin-top: 12px; padding: 0 14px; font-size: 12px; opacity: 0.5">分类</div>
    <button
      v-for="cat in cats.categories"
      :key="cat.id"
      data-cat
      :style="{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        padding: '4px 14px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: tasks.categoryFilter === cat.id ? 700 : 400,
        color: tasks.categoryFilter === cat.id ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
      @click="selectCategory(cat.id)"
      @contextmenu="onCategoryContext($event, cat.id)"
    >
      <span>{{ iconFor(cat) }} {{ cat.name }}</span>
      <span style="opacity: 0.6; font-size: 12px">{{ catCount(cat.id) }}</span>
    </button>
    <button
      data-uncategorized
      :style="{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        padding: '4px 14px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: tasks.categoryFilter === UNCATEGORIZED_ID ? 700 : 400,
        color: tasks.categoryFilter === UNCATEGORIZED_ID ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
      @click="selectUncategorized()"
    >
      <span>📂 未分类</span>
      <span style="opacity: 0.6; font-size: 12px">{{ uncategorizedCount() }}</span>
    </button>
    <button
      style="
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        padding: 4px 14px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 13px;
        opacity: 0.6;
      "
      @click="openAddCategory"
    >
      + 添加分类
    </button>

    <div style="margin-top: 12px; padding: 0 14px; font-size: 12px; display: flex; flex-direction: column; gap: 2px">
      <span style="opacity: 0.6">↓ {{ fmtSpeed(conn.globalStat.downloadSpeed) }}</span>
      <span style="opacity: 0.6">↑ {{ fmtSpeed(conn.globalStat.uploadSpeed) }}</span>
    </div>

    <div style="margin-top: auto; padding: 8px 14px 0; font-size: 11px; opacity: 0.5; word-break: break-all">
      保存到：<br />{{ api?.dir ?? '…' }}
      <br />AriaPanel v{{ version }}
    </div>
  </nav>

  <NDropdown
    placement="bottom-start"
    trigger="manual"
    :show="catCtx.show"
    :x="catCtx.x"
    :y="catCtx.y"
    :options="catMenuOptions()"
    @select="catMenuPick"
    @clickoutside="catCtx.show = false"
  />
  <CategoryModal v-model:show="catModalShow" :category="editingCategory" @submit="onCategorySubmit" />
</template>
