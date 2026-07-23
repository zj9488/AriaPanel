import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePrefStore } from './preferences'

describe('usePrefStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to name/asc/system', () => {
    const p = usePrefStore()
    expect(p.sortKey).toBe('name')
    expect(p.sortOrder).toBe('asc')
    expect(p.themeMode).toBe('system')
  })

  it('persists sort to localStorage', () => {
    const p = usePrefStore()
    p.setSort('size', 'desc')
    expect(localStorage.getItem('ap:sortKey')).toBe('size')
    expect(localStorage.getItem('ap:sortOrder')).toBe('desc')
  })

  it('persists theme to localStorage', () => {
    const p = usePrefStore()
    p.setTheme('dark')
    expect(localStorage.getItem('ap:theme')).toBe('dark')
  })

  it('restores from localStorage', () => {
    localStorage.setItem('ap:sortKey', 'progress')
    localStorage.setItem('ap:theme', 'dark')
    const p = usePrefStore()
    expect(p.sortKey).toBe('progress')
    expect(p.themeMode).toBe('dark')
  })
})
