import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskStore } from './task'
import type { Aria2Task } from '@/lib/aria2/types'

function t(gid: string, status: Aria2Task['status']): Aria2Task {
  return { gid, status, totalLength: '100', completedLength: '0', downloadSpeed: '0', uploadSpeed: '0', files: [] }
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
})
