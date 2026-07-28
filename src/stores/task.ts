import { defineStore } from 'pinia'
import { computed, ref, shallowReactive, watch } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'
import { taskName } from '@/lib/format'
import { useCategoryStore, UNCATEGORIZED_ID } from './category'

export type TaskFilter = 'all' | 'active' | 'waiting' | 'stopped'

export const useTaskStore = defineStore('task', () => {
  const tasks = shallowReactive(new Map<string, Aria2Task>())
  const order = ref<string[]>([])
  const selection = ref<Set<string>>(new Set())
  const filter = ref<TaskFilter>((localStorage.getItem('ap:filter') as TaskFilter) ?? 'all')
  watch(filter, (v) => localStorage.setItem('ap:filter', v), { flush: 'sync' })
  const selectedGid = ref<string | null>(null)
  const searchQuery = ref('')
  const categoryFilter = ref<string | null>(null)

  const active = computed(() => order.value.map((g) => tasks.get(g)!).filter((t) => t && t.status === 'active'))
  const waiting = computed(() =>
    order.value.map((g) => tasks.get(g)!).filter((t) => t && (t.status === 'waiting' || t.status === 'paused')),
  )
  const stopped = computed(() =>
    order.value
      .map((g) => tasks.get(g)!)
      .filter((t) => t && (t.status === 'complete' || t.status === 'removed' || t.status === 'error')),
  )

  const visibleTasks = computed(() => {
    let list: Aria2Task[]
    switch (filter.value) {
      case 'active':
        list = active.value
        break
      case 'waiting':
        list = waiting.value
        break
      case 'stopped':
        list = stopped.value
        break
      default:
        list = [...active.value, ...waiting.value, ...stopped.value]
    }
    if (categoryFilter.value) {
      const catStore = useCategoryStore()
      const cid = categoryFilter.value
      if (cid === UNCATEGORIZED_ID) {
        list = list.filter((t) => catStore.isUncategorized(t))
      } else {
        list = list.filter((t) => catStore.matchCategory(t, cid))
      }
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter((t) => {
        const name = taskName(t)
        return name.toLowerCase().includes(q)
      })
    }
    return list
  })

  function apply(a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) {
    tasks.clear()
    const all = [...a, ...w, ...s]
    for (const t of all) tasks.set(t.gid, t)
    order.value = all.map((t) => t.gid)
    const ids = new Set(all.map((t) => t.gid))
    selection.value = new Set([...selection.value].filter((g) => ids.has(g)))
  }

  function upsert(task: Aria2Task) {
    if (!tasks.has(task.gid)) order.value.push(task.gid)
    tasks.set(task.gid, task)
  }

  function clear() {
    tasks.clear()
    order.value = []
  }

  function toggleSelect(gid: string) {
    const next = new Set(selection.value)
    if (next.has(gid)) next.delete(gid)
    else next.add(gid)
    selection.value = next
  }
  function selectMany(gids: string[]) {
    selection.value = new Set([...selection.value, ...gids])
  }
  function selectAllVisible() {
    selection.value = new Set(visibleTasks.value.map((t) => t.gid))
  }
  function clearSelection() {
    selection.value = new Set()
  }
  function setFilter(f: TaskFilter) {
    filter.value = f
  }

  return {
    tasks,
    order,
    selection,
    filter,
    selectedGid,
    searchQuery,
    categoryFilter,
    active,
    waiting,
    stopped,
    visibleTasks,
    apply,
    upsert,
    clear,
    toggleSelect,
    selectMany,
    selectAllVisible,
    clearSelection,
    setFilter,
  }
})
