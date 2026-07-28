import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskStore } from './task'
import { useCategoryStore, UNCATEGORIZED_ID } from './category'
import type { Aria2Task } from '@/lib/aria2/types'

function mkTask(gid: string, status: Aria2Task['status'], dir: string): Aria2Task {
  return {
    gid,
    status,
    totalLength: '1000',
    completedLength: '500',
    downloadSpeed: '100',
    uploadSpeed: '0',
    dir,
    files: [
      {
        path: `${dir}/${gid}.bin`,
        length: '1000',
        completedLength: '500',
        selected: 'true',
        uris: [{ uri: `http://x/${gid}.bin`, status: 'used' }],
      },
    ],
  }
}

function t(gid: string, status: Aria2Task['status']): Aria2Task {
  return {
    gid,
    status,
    totalLength: '100',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    dir: '/dl',
    files: [{ path: 'D:/dl/f', length: '100', completedLength: '0', selected: 'true', uris: [] }],
  }
}

describe('useTaskStore filter pipeline', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('status filter only', () => {
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/dl')], [mkTask('g2', 'waiting', 'D:/dl')], [])
    ts.setFilter('active')
    expect(ts.visibleTasks.map((t) => t.gid)).toEqual(['g1'])
  })

  it('category filter', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/Music'), mkTask('g2', 'active', 'D:/dl')], [], [])
    ts.categoryFilter = 'music'
    expect(ts.visibleTasks.map((t) => t.gid)).toEqual(['g1'])
  })

  it('search filter by filename', () => {
    const ts = useTaskStore()
    ts.apply([mkTask('alpha', 'active', 'D:/dl'), mkTask('beta', 'active', 'D:/dl')], [], [])
    ts.searchQuery = 'alp'
    expect(ts.visibleTasks.map((t) => t.gid)).toEqual(['alpha'])
  })

  it('three-stage pipeline: status + category + search', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply(
      [mkTask('g1', 'active', 'D:/Music'), mkTask('g2', 'active', 'D:/Music'), mkTask('g3', 'active', 'D:/dl')],
      [],
      [mkTask('g4', 'complete', 'D:/Music')],
    )
    ts.setFilter('active')
    ts.categoryFilter = 'music'
    ts.searchQuery = 'g2'
    expect(ts.visibleTasks.map((t) => t.gid)).toEqual(['g2'])
  })

  it('clearing categoryFilter shows all', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/Music'), mkTask('g2', 'active', 'D:/dl')], [], [])
    ts.categoryFilter = 'music'
    expect(ts.visibleTasks).toHaveLength(1)
    ts.categoryFilter = null
    expect(ts.visibleTasks).toHaveLength(2)
  })

  it('uncategorized filter', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/Music'), mkTask('g2', 'active', 'D:/dl')], [], [])
    ts.categoryFilter = UNCATEGORIZED_ID
    expect(ts.visibleTasks.map((t) => t.gid)).toEqual(['g2'])
  })
})

describe('useTaskStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('applies and partitions tasks', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [t('2', 'waiting')], [t('3', 'complete')])
    expect(s.active.map((x) => x.gid)).toEqual(['1'])
    expect(s.waiting.map((x) => x.gid)).toEqual(['2'])
    expect(s.stopped.map((x) => x.gid)).toEqual(['3'])
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
    expect(s.visibleTasks.map((x) => x.gid)).toEqual(['1'])
    s.setFilter('stopped')
    expect(s.visibleTasks.map((x) => x.gid)).toEqual(['3'])
    s.setFilter('all')
    expect(s.visibleTasks.map((x) => x.gid)).toEqual(['1', '2', '3'])
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
