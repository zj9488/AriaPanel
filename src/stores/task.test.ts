import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskStore } from './task'
import type { Aria2Task } from '@/lib/aria2/types'

function t(gid: string, status: Aria2Task['status']): Aria2Task {
  return { gid, status, totalLength: '100', completedLength: '0', downloadSpeed: '0', uploadSpeed: '0', dir: '/dl', files: [{ path: 'D:/dl/f', length: '100', completedLength: '0', selected: 'true', uris: [] }] }
}

describe('useTaskStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('applies and partitions tasks', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [t('2', 'waiting')], [t('3', 'complete')])
    expect(s.active.map(x => x.gid)).toEqual(['1'])
    expect(s.waiting.map(x => x.gid)).toEqual(['2'])
    expect(s.stopped.map(x => x.gid)).toEqual(['3'])
    expect(s.order).toEqual(['1', '2', '3'])
  })

  it('upsert merges existing task', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [], [])
    s.upsert({ ...t('1', 'active'), completedLength: '50' })
    expect(s.tasks.get('1')?.completedLength).toBe('50')
  })

  it('toggles and clears selection', () => {
    const s = useTaskStore()
    s.toggleSelect('1')
    expect(s.selection.has('1')).toBe(true)
    s.toggleSelect('1')
    expect(s.selection.has('1')).toBe(false)
    s.selectMany(['1', '2'])
    expect(s.selection.size).toBe(2)
    s.clearSelection()
    expect(s.selection.size).toBe(0)
  })

  it('visibleTasks respects filter', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [t('2', 'waiting')], [t('3', 'complete')])
    s.setFilter('active')
    expect(s.visibleTasks.map(x => x.gid)).toEqual(['1'])
    s.setFilter('stopped')
    expect(s.visibleTasks.map(x => x.gid)).toEqual(['3'])
    s.setFilter('all')
    expect(s.visibleTasks.map(x => x.gid)).toEqual(['1', '2', '3'])
  })

  it('apply prunes selection of removed gids', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [t('2', 'waiting')], [])
    s.selectMany(['1', '2'])
    s.apply([t('1', 'active')], [], [])
    expect(s.selection.has('2')).toBe(false)
    expect(s.selection.has('1')).toBe(true)
  })
})
