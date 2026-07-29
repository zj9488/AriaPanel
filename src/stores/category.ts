import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface Category {
  id: string
  name: string
  dir: string
}

const STORAGE_KEY = 'ap:categories'
const TASK_CAT_KEY = 'ap:task-categories'

export const UNCATEGORIZED_ID = '__uncategorized__'

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'downloads', name: '下载', dir: '' },
  { id: 'music', name: '音乐', dir: '' },
  { id: 'video', name: '视频', dir: '' },
  { id: 'image', name: '图片', dir: '' },
  { id: 'doc', name: '文档', dir: '' },
]

function load(): Category[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return [...DEFAULT_CATEGORIES]
  try {
    const parsed = JSON.parse(raw) as Category[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_CATEGORIES]
    return parsed
  } catch {
    return [...DEFAULT_CATEGORIES]
  }
}

function loadTaskCats(): Record<string, string> {
  const raw = localStorage.getItem(TASK_CAT_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

export const useCategoryStore = defineStore('category', () => {
  const categories = ref<Category[]>(load())
  const taskCategories = ref<Record<string, string>>(loadTaskCats())

  watch(categories, (v) => localStorage.setItem(STORAGE_KEY, JSON.stringify(v)), { deep: true, flush: 'sync' })
  watch(taskCategories, (v) => localStorage.setItem(TASK_CAT_KEY, JSON.stringify(v)), { deep: true, flush: 'sync' })

  function setTaskCategory(gid: string, categoryId: string) {
    taskCategories.value[gid] = categoryId
  }

  function syncTaskCategories(activeGids: Set<string>) {
    let changed = false
    for (const gid of Object.keys(taskCategories.value)) {
      if (!activeGids.has(gid)) {
        delete taskCategories.value[gid]
        changed = true
      }
    }
    if (changed) taskCategories.value = { ...taskCategories.value }
  }

  function addCategory(name: string, dir: string) {
    const id = name.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now().toString(36)
    categories.value.push({ id, name, dir })
  }

  function updateCategory(id: string, name: string, dir: string) {
    const cat = categories.value.find((c) => c.id === id)
    if (cat) {
      cat.name = name
      cat.dir = dir
    }
  }

  function removeCategory(id: string): boolean {
    const cat = categories.value.find((c) => c.id === id)
    if (!cat) return false
    categories.value = categories.value.filter((c) => c.id !== id)
    for (const gid of Object.keys(taskCategories.value)) {
      if (taskCategories.value[gid] === id) delete taskCategories.value[gid]
    }
    taskCategories.value = { ...taskCategories.value }
    return true
  }

  function getCategory(id: string): Category | undefined {
    return categories.value.find((c) => c.id === id)
  }

  function matchCategory(task: { gid: string; dir: string }, categoryId: string): boolean {
    const explicit = taskCategories.value[task.gid]
    if (explicit) return explicit === categoryId
    const cat = categories.value.find((c) => c.id === categoryId)
    if (!cat || !cat.dir) return false
    return task.dir === cat.dir
  }

  function isUncategorized(task: { gid: string; dir: string }): boolean {
    if (taskCategories.value[task.gid]) return false
    return !categories.value.some((c) => c.dir && c.dir === task.dir)
  }

  return {
    categories,
    taskCategories,
    setTaskCategory,
    syncTaskCategories,
    addCategory,
    updateCategory,
    removeCategory,
    getCategory,
    matchCategory,
    isUncategorized,
  }
})
