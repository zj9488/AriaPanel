import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskTable from './TaskTable.vue'
import type { Aria2Task } from '@/lib/aria2/types'

function mkTask(gid: string, status: Aria2Task['status']): Aria2Task {
  return {
    gid,
    status,
    totalLength: '1000',
    completedLength: '500',
    downloadSpeed: '100',
    uploadSpeed: '0',
    dir: 'D:/dl',
    files: [
      {
        path: 'D:/dl/file.bin',
        length: '1000',
        completedLength: '500',
        selected: 'true',
        uris: [{ uri: 'http://x/file.bin', status: 'used' }],
      },
    ],
  }
}

describe('TaskTable', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders task name, progress and speed', () => {
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate: () => {} } })
    expect(w.text()).toContain('file.bin')
    expect(w.text()).toContain('50%')
    expect(w.text()).toContain('100 B/s')
  })

  it('shows pause button for active task', () => {
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate: () => {} } })
    expect(w.text()).toContain('暂停')
  })

  it('shows retry button for error task', () => {
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'error')], operate: () => {} } })
    expect(w.text()).toContain('重试')
  })

  it('emits operate with gid and op', async () => {
    const operate = vi.fn()
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate } })
    await w.get('[data-op="pause"]').trigger('click')
    expect(operate).toHaveBeenCalledWith('g1', 'pause')
  })

  it('renders sort indicator on active column', () => {
    localStorage.setItem('ap:sortKey', 'size')
    localStorage.setItem('ap:sortOrder', 'desc')
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate: () => {} } })
    expect(w.text()).toContain('↓')
  })

  it('shows expected size when aria2 reports unknown length', () => {
    localStorage.setItem('ap:size-meta', JSON.stringify({ g1: { expected: 137946130 } }))
    const t = mkTask('g1', 'active')
    t.totalLength = '0'
    const w = mount(TaskTable, { props: { tasks: [t], operate: () => {} } })
    expect(w.text()).toContain('131.6 MB')
    expect(w.text()).toContain('预计')
  })

  it('shows size mismatch badge when verified actual differs from expected', () => {
    localStorage.setItem('ap:size-meta', JSON.stringify({ g1: { expected: 1000, actual: 640 } }))
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'complete')], operate: () => {} } })
    expect(w.text()).toContain('大小异常')
  })

  it('shows no badge when verified size matches expected', () => {
    localStorage.setItem('ap:size-meta', JSON.stringify({ g1: { expected: 1000, actual: 1000 } }))
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'complete')], operate: () => {} } })
    expect(w.text()).not.toContain('大小异常')
  })
})
