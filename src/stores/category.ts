import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface Category {
  id: string
  name: string
  dir: string
}

const STORAGE_KEY = 'ap:categories'

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

export const useCategoryStore = defineStore('category', () => {
  const categories = ref<Category[]>(load())
  const defaultDir = ref('')

  watch(categories, (v) => localStorage.setItem(STORAGE_KEY, JSON.stringify(v)), { deep: true, flush: 'sync' })

  function setDefaultDir(dir: string) {
    defaultDir.value = dir
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
    return true
  }

  function getCategory(id: string): Category | undefined {
    return categories.value.find((c) => c.id === id)
  }

  function matchCategory(task: { dir: string }, categoryId: string): boolean {
    const cat = categories.value.find((c) => c.id === categoryId)
    if (!cat) return false
    const effectiveDir = cat.dir || defaultDir.value
    if (!effectiveDir) return false
    return task.dir === effectiveDir
  }

  function isUncategorized(task: { dir: string }): boolean {
    return !categories.value.some((c) => {
      const effectiveDir = c.dir || defaultDir.value
      return effectiveDir && effectiveDir === task.dir
    })
  }

  return {
    categories,
    defaultDir,
    setDefaultDir,
    addCategory,
    updateCategory,
    removeCategory,
    getCategory,
    matchCategory,
    isUncategorized,
  }
})
