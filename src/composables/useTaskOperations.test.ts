import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskOperations } from './useTaskOperations'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'
import type { Aria2Task } from '@/lib/aria2/types'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }))

function mkTask(gid: string, dir: string, files: Array<{ path: string }> = [{ path: `${dir}/f.bin` }]): Aria2Task {
  return {
    gid,
    status: 'complete',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    dir,
    files: files.map((f) => ({
      path: f.path,
      length: '0',
      completedLength: '0',
      selected: 'true',
      uris: [],
    })),
  }
}

describe('useTaskOperations', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function makeOps(changeOption: ReturnType<typeof vi.fn>) {
    const api = shallowRef({
      client: { changeOption },
      refresh: vi.fn(),
      dir: '/dl',
    } as unknown as Aria2Api)
    const tasks = useTaskStore()
    const message = { error: vi.fn() }
    const ops = useTaskOperations(api, tasks, message as never)
    return { ops, message }
  }

  it('changeTaskOption calls changeOption with correct params', async () => {
    const changeOption = vi.fn(async () => 'OK')
    const { ops } = makeOps(changeOption)
    await ops.changeTaskOption('g1', { 'max-download-limit': '2M' })
    expect(changeOption).toHaveBeenCalledWith('g1', { 'max-download-limit': '2M' })
  })

  it('changeTaskOption shows error on failure', async () => {
    const changeOption = vi.fn().mockRejectedValue(new Error('rpc error'))
    const { ops, message } = makeOps(changeOption)
    await ops.changeTaskOption('g1', { 'max-download-limit': '2M' })
    expect(message.error).toHaveBeenCalledWith('操作失败：Error: rpc error')
  })

  it('removeWithFiles purges task then deletes files', async () => {
    const forcePurge = vi.fn(async () => 'OK')
    const refresh = vi.fn()
    const api = shallowRef({
      client: { forcePurge, changeOption: vi.fn() },
      refresh,
      dir: '/dl',
    } as unknown as Aria2Api)
    const tasks = useTaskStore()
    tasks.apply([mkTask('g1', 'D:/Downloads', [{ path: 'D:/Downloads/file.bin' }])], [], [])
    const message = { error: vi.fn() }
    const ops = useTaskOperations(api, tasks, message as never)

    invokeMock.mockResolvedValue(1)
    await ops.operate('g1', 'removeWithFiles')

    expect(forcePurge).toHaveBeenCalledWith('g1', 'complete')
    expect(invokeMock).toHaveBeenCalledWith('delete_task_files', {
      paths: ['D:/Downloads/file.bin', 'D:/Downloads/file.bin.aria2'],
    })
  })
})
