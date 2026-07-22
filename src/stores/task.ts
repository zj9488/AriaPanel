import { defineStore } from 'pinia'
import { computed, ref, shallowReactive } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'

export const useTaskStore = defineStore('task', () => {
  const tasks = shallowReactive(new Map<string, Aria2Task>())
  const order = ref<string[]>([])

  const active = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && t.status === 'active'))
  const waiting = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'waiting' || t.status === 'paused')))
  const stopped = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'complete' || t.status === 'removed' || t.status === 'error')))

  function apply(a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) {
    tasks.clear()
    const all = [...a, ...w, ...s]
    for (const t of all) tasks.set(t.gid, t)
    order.value = all.map(t => t.gid)
  }

  function upsert(task: Aria2Task) {
    if (!tasks.has(task.gid)) order.value.push(task.gid)
    tasks.set(task.gid, task)
  }

  function clear() { tasks.clear(); order.value = [] }

  return { tasks, order, active, waiting, stopped, apply, upsert, clear }
})
