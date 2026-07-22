import { defineStore } from 'pinia'
import { computed, ref, shallowReactive } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'

export type TaskFilter = 'all' | 'active' | 'waiting' | 'stopped'

export const useTaskStore = defineStore('task', () => {
  const tasks = shallowReactive(new Map<string, Aria2Task>())
  const order = ref<string[]>([])
  const selection = ref<Set<string>>(new Set())
  const filter = ref<TaskFilter>('all')

  const active = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && t.status === 'active'))
  const waiting = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'waiting' || t.status === 'paused')))
  const stopped = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'complete' || t.status === 'removed' || t.status === 'error')))

  const visibleTasks = computed(() => {
    switch (filter.value) {
      case 'active': return active.value
      case 'waiting': return waiting.value
      case 'stopped': return stopped.value
      default: return [...active.value, ...waiting.value, ...stopped.value]
    }
  })

  function apply(a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) {
    tasks.clear()
    const all = [...a, ...w, ...s]
    for (const t of all) tasks.set(t.gid, t)
    order.value = all.map(t => t.gid)
    const ids = new Set(all.map(t => t.gid))
    selection.value = new Set([...selection.value].filter(g => ids.has(g)))
  }

  function upsert(task: Aria2Task) {
    if (!tasks.has(task.gid)) order.value.push(task.gid)
    tasks.set(task.gid, task)
  }

  function clear() { tasks.clear(); order.value = [] }

  function toggleSelect(gid: string) {
    const next = new Set(selection.value)
    next.has(gid) ? next.delete(gid) : next.add(gid)
    selection.value = next
  }
  function selectMany(gids: string[]) {
    selection.value = new Set([...selection.value, ...gids])
  }
  function selectAllVisible() {
    selection.value = new Set(visibleTasks.value.map(t => t.gid))
  }
  function clearSelection() { selection.value = new Set() }
  function setFilter(f: TaskFilter) { filter.value = f }

  return {
    tasks, order, selection, filter, active, waiting, stopped, visibleTasks,
    apply, upsert, clear, toggleSelect, selectMany, selectAllVisible, clearSelection, setFilter,
  }
})
