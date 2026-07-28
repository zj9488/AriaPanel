import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { Aria2Api } from '@/composables/useAria2'
import type { useTaskStore } from '@/stores/task'
import type { Aria2TaskDetail } from '@/lib/aria2/types'

export function useDetailPoller(api: Ref<Aria2Api | null>, tasks: ReturnType<typeof useTaskStore>) {
  const detail = ref<Aria2TaskDetail | null>(null)
  const taskOptions = ref<Record<string, string>>({})
  let timer: ReturnType<typeof setInterval> | null = null

  function clearTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  async function fetch() {
    if (!tasks.selectedGid) return
    const c = api?.value?.client
    if (!c) return
    try {
      detail.value = await c.tellStatus(tasks.selectedGid)
    } catch {
      /* ignore */
    }
  }

  async function fetchOptions() {
    if (!tasks.selectedGid) return
    const c = api?.value?.client
    if (!c) return
    try {
      taskOptions.value = await c.getOption(tasks.selectedGid)
    } catch {
      /* ignore */
    }
  }

  watch(
    () => tasks.selectedGid,
    (gid) => {
      clearTimer()
      if (gid) {
        fetch()
        fetchOptions()
        timer = setInterval(fetch, 2000)
      } else {
        detail.value = null
        taskOptions.value = {}
      }
    },
  )

  onUnmounted(clearTimer)

  return { detail, taskOptions }
}
