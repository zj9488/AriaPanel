import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useDetailPoller } from './useDetailPoller'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'
import type { Aria2TaskDetail } from '@/lib/aria2/types'

const mockDetail: Aria2TaskDetail = {
  gid: 'g1',
  status: 'active',
  totalLength: '100',
  completedLength: '50',
  downloadSpeed: '10',
  uploadSpeed: '0',
  dir: '/dl',
  pieceLength: '1',
  numPieces: '10',
  bitfield: 'ff',
  connections: '5',
  files: [],
}

function makeApi() {
  return {
    client: {
      tellStatus: vi.fn(async () => mockDetail),
      getOption: vi.fn(async () => ({
        'max-download-limit': '1M',
        'max-upload-limit': '0',
        'seed-ratio': '2.0',
      })),
    },
    refresh: vi.fn(),
    dir: '/dl',
  } as unknown as Aria2Api
}

function mountPoller(api: Aria2Api | null) {
  let result!: ReturnType<typeof useDetailPoller>
  const apiRef = shallowRef<Aria2Api | null>(api)
  const wrapper = mount(
    defineComponent({
      setup() {
        const tasks = useTaskStore()
        result = useDetailPoller(apiRef, tasks)
        return () => h('div')
      },
    }),
  )
  return { result, wrapper }
}

describe('useDetailPoller', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('loads taskOptions via getOption when gid is selected', async () => {
    const api = makeApi()
    const { result, wrapper } = mountPoller(api)
    const tasks = useTaskStore()
    tasks.selectedGid = 'g1'
    await nextTick()
    await flushPromises()
    expect(api.client.getOption).toHaveBeenCalledWith('g1')
    expect(result.taskOptions.value['max-download-limit']).toBe('1M')
    expect(result.taskOptions.value['seed-ratio']).toBe('2.0')
    wrapper.unmount()
  })

  it('clears taskOptions when gid is deselected', async () => {
    const api = makeApi()
    const { result, wrapper } = mountPoller(api)
    const tasks = useTaskStore()
    tasks.selectedGid = 'g1'
    await nextTick()
    await flushPromises()
    expect(result.taskOptions.value['max-download-limit']).toBe('1M')
    tasks.selectedGid = ''
    await nextTick()
    expect(result.taskOptions.value).toEqual({})
    wrapper.unmount()
  })
})
