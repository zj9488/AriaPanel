import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDownloadMetaStore } from './download-meta'

describe('useDownloadMetaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('records expected size and persists to localStorage', () => {
    const s = useDownloadMetaStore()
    s.setExpected('g1', 137946130)
    expect(s.meta['g1'].expected).toBe(137946130)
    expect(JSON.parse(localStorage.getItem('ap:size-meta')!)['g1'].expected).toBe(137946130)
  })

  it('verify stores actual size only once', () => {
    const s = useDownloadMetaStore()
    s.setExpected('g1', 100)
    s.verify('g1', 99)
    expect(s.meta['g1'].actual).toBe(99)
    s.verify('g1', 100)
    expect(s.meta['g1'].actual).toBe(99)
    s.verify('unknown-gid', 1)
    expect(s.meta['unknown-gid']).toBeUndefined()
  })

  it('prunes stale entries beyond the cap', () => {
    const s = useDownloadMetaStore()
    for (let i = 0; i < 600; i++) s.setExpected(`g${i}`, i)
    expect(Object.keys(s.meta).length).toBeLessThanOrEqual(500)
    expect(s.meta['g599']).toBeDefined()
  })

  it('loads persisted state', () => {
    localStorage.setItem('ap:size-meta', JSON.stringify({ gx: { expected: 5 } }))
    setActivePinia(createPinia())
    const s = useDownloadMetaStore()
    expect(s.meta['gx'].expected).toBe(5)
  })
})
