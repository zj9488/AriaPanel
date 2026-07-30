import { ref, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Aria2Api } from '@/composables/useAria2'
import type { Aria2Client } from '@/lib/aria2/rpc-client'
import type { useTaskStore } from '@/stores/task'
import type { TaskOp } from '@/lib/task-op'

type MessageApi = { error: (s: string) => void }

export function useTaskOperations(
  api: Ref<Aria2Api | null>,
  tasks: ReturnType<typeof useTaskStore>,
  message: MessageApi,
) {
  const retry = ref({ show: false, gid: '', url: '', dir: '', filename: '', proxy: '', split: 5 })

  function refresh() {
    api.value!.refresh()
  }

  async function operate(gid: string, op: TaskOp) {
    const c: Aria2Client | undefined = api.value?.client
    if (!c) return
    const t = tasks.tasks.get(gid)
    try {
      switch (op) {
        case 'pause':
          await c.pause(gid)
          break
        case 'unpause':
          await c.unpause(gid)
          break
        case 'remove':
          await c.purge(gid, t?.status ?? 'active')
          break
        case 'forcePause':
          await c.forcePause(gid)
          break
        case 'forceRemove':
          await c.forcePurge(gid, t?.status ?? 'active')
          break
        case 'removeWithFiles': {
          if (!t) return
          await c.forcePurge(gid, t.status)
          const paths: string[] = []
          for (const f of t.files) {
            if (f.path) {
              paths.push(f.path)
              paths.push(`${f.path}.aria2`)
            }
          }
          if (paths.length > 0) {
            await invoke('delete_task_files', { paths })
          }
          break
        }
        case 'copyLink':
          if (t) await navigator.clipboard?.writeText(t.files[0]?.uris[0]?.uri ?? '')
          return
        case 'openFolder': {
          if (!t) return
          const filePath = t.files[0]?.path
          const fp = filePath && filePath.includes(t.dir) ? filePath : t.dir
          await invoke('open_folder', { path: fp })
          return
        }
        case 'retry': {
          if (!t) return
          const url = t.files[0]?.uris[0]?.uri ?? ''
          const out = t.files[0]?.path?.split(/[\\/]/).pop() ?? ''
          await c.purge(gid, t.status)
          await c.addUri([url], { dir: t.dir, out })
          break
        }
        case 'retryWithUrl': {
          if (!t) return
          const opts = await c.getOption(gid)
          retry.value = {
            show: true,
            gid,
            url: t.files[0]?.uris[0]?.uri ?? '',
            dir: t.dir,
            filename: t.files[0]?.path?.split(/[\\/]/).pop() ?? '',
            proxy: opts['all-proxy'] ?? '',
            split: parseInt(opts['max-connection-per-server'] ?? '5', 10) || 5,
          }
          return
        }
      }
      refresh()
    } catch (e) {
      message.error(`操作失败：${String(e)}`)
      refresh()
    }
  }

  async function submitRetry(url: string, dir: string, filename: string, proxy: string, split: number) {
    const c = api.value?.client
    const t = tasks.tasks.get(retry.value.gid)
    if (!c || !t) return
    const options: Record<string, string> = {
      dir: dir || t.dir,
      split: String(split),
      'max-connection-per-server': String(split),
    }
    if (filename) options.out = filename
    if (proxy) options['all-proxy'] = proxy
    try {
      await c.purge(retry.value.gid, t.status)
      await c.addUri([url], options)
      refresh()
    } catch (e) {
      message.error(`重试失败：${String(e)}`)
      refresh()
    }
  }

  async function onAdd(url: string, dir: string, filename: string, proxy: string, split: number) {
    const a = api.value
    const c = a?.client
    if (!c) return
    const finalDir = dir || a.dir
    const options: Record<string, string> = {
      dir: finalDir,
      split: String(split),
      'max-connection-per-server': String(split),
    }
    if (filename) options.out = filename
    if (proxy) options['all-proxy'] = proxy
    try {
      await c.addUri([url], options)
      refresh()
    } catch (e) {
      message.error(`添加失败：${String(e)}`)
    }
  }

  async function changeTaskOption(gid: string, options: Record<string, string>) {
    const c = api.value?.client
    if (!c) return
    try {
      await c.changeOption(gid, options)
      refresh()
    } catch (e) {
      message.error(`操作失败：${String(e)}`)
      refresh()
    }
  }

  return { retry, operate, submitRetry, onAdd, changeTaskOption }
}
