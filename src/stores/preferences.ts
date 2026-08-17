import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type SortKey = 'name' | 'size' | 'progress' | 'speed' | 'eta' | 'status'
type SortOrder = 'asc' | 'desc'
export type ThemeMode = 'light' | 'dark' | 'system'

export const usePrefStore = defineStore('prefs', () => {
  const sortKey = ref<SortKey>((localStorage.getItem('ap:sortKey') as SortKey) ?? 'name')
  const sortOrder = ref<SortOrder>((localStorage.getItem('ap:sortOrder') as SortOrder) ?? 'asc')
  const themeMode = ref<ThemeMode>((localStorage.getItem('ap:theme') as ThemeMode) ?? 'system')

  watch(sortKey, (v) => localStorage.setItem('ap:sortKey', v), { flush: 'sync' })
  watch(sortOrder, (v) => localStorage.setItem('ap:sortOrder', v), { flush: 'sync' })
  watch(themeMode, (v) => localStorage.setItem('ap:theme', v), { flush: 'sync' })

  function setSort(key: SortKey, order: SortOrder) {
    sortKey.value = key
    sortOrder.value = order
  }
  function setTheme(mode: ThemeMode) {
    themeMode.value = mode
  }

  return { sortKey, sortOrder, themeMode, setSort, setTheme }
})
