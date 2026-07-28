import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskOperations } from './useTaskOperations'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'

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
})
