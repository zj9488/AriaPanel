import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCategoryStore } from './category'
import type { Aria2Task } from '@/lib/aria2/types'

function mkTask(gid: string, dir: string): Aria2Task {
  return {
    gid,
    status: 'active',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    dir,
    files: [{ path: `${dir}/f.bin`, length: '0', completedLength: '0', selected: 'true', uris: [] }],
  }
}

describe('useCategoryStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('initializes with 5 default categories', () => {
    const s = useCategoryStore()
    expect(s.categories).toHaveLength(5)
    expect(s.categories.map((c) => c.name)).toEqual(['下载', '音乐', '视频', '图片', '文档'])
  })

  it('addCategory appends and persists', () => {
    const s = useCategoryStore()
    s.addCategory('游戏', 'D:/Games')
    expect(s.categories).toHaveLength(6)
    expect(s.categories[5].name).toBe('游戏')
    expect(s.categories[5].dir).toBe('D:/Games')
    const raw = localStorage.getItem('ap:categories')
    expect(raw).toContain('游戏')
  })

  it('updateCategory modifies and persists', () => {
    const s = useCategoryStore()
    s.updateCategory('music', 'Music', 'D:/Music')
    const cat = s.getCategory('music')!
    expect(cat.name).toBe('Music')
    expect(cat.dir).toBe('D:/Music')
    expect(localStorage.getItem('ap:categories')!).toContain('D:/Music')
  })

  it('removeCategory deletes and persists', () => {
    const s = useCategoryStore()
    s.removeCategory('doc')
    expect(s.categories).toHaveLength(4)
    expect(s.getCategory('doc')).toBeUndefined()
  })

  it('removeCategory allows deleting all categories', () => {
    const s = useCategoryStore()
    s.removeCategory('music')
    s.removeCategory('video')
    s.removeCategory('image')
    s.removeCategory('doc')
    expect(s.removeCategory('downloads')).toBe(true)
    expect(s.categories).toHaveLength(0)
  })

  it('matchCategory: non-empty dir exact match', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.matchCategory(mkTask('g1', 'D:/Music'), 'music')).toBe(true)
    expect(s.matchCategory(mkTask('g2', 'D:/Other'), 'music')).toBe(false)
  })

  it('matchCategory: empty-dir category matches nothing without defaultDir', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.matchCategory(mkTask('g1', 'D:/dl'), 'downloads')).toBe(false)
  })

  it('matchCategory: empty-dir category resolves to defaultDir', () => {
    const s = useCategoryStore()
    s.setDefaultDir('D:/dl')
    expect(s.matchCategory(mkTask('g1', 'D:/dl'), 'downloads')).toBe(true)
    expect(s.matchCategory(mkTask('g2', 'D:/Other'), 'downloads')).toBe(false)
  })

  it('isUncategorized: tasks not matching any configured category', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.isUncategorized(mkTask('g1', 'D:/Music'))).toBe(false)
    expect(s.isUncategorized(mkTask('g2', 'D:/Other'))).toBe(true)
  })

  it('isUncategorized: empty-dir categories resolve to defaultDir', () => {
    const s = useCategoryStore()
    s.setDefaultDir('D:/dl')
    expect(s.isUncategorized(mkTask('g1', 'D:/dl'))).toBe(false)
    expect(s.isUncategorized(mkTask('g2', 'D:/Other'))).toBe(true)
  })

  it('restores from localStorage', () => {
    localStorage.setItem('ap:categories', JSON.stringify([{ id: 'custom', name: '自定义', dir: '/x' }]))
    const s = useCategoryStore()
    expect(s.categories).toHaveLength(1)
    expect(s.categories[0].name).toBe('自定义')
  })
})
