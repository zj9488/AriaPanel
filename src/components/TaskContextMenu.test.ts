import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NDropdown } from 'naive-ui'
import TaskContextMenu from './TaskContextMenu.vue'

const baseProps = {
  show: true,
  x: 0,
  y: 0,
  status: 'active' as const,
  isBittorrent: false,
  categories: [] as { id: string; name: string; dir: string }[],
}

function mountMenu(extra: Partial<typeof baseProps> = {}) {
  return mount(TaskContextMenu, { props: { ...baseProps, ...extra } })
}

describe('TaskContextMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders reclassify submenu with all categories regardless of dir', () => {
    const w = mountMenu({
      categories: [
        { id: 'downloads', name: '下载', dir: '' },
        { id: 'music', name: '音乐', dir: 'D:/Music' },
      ],
    })
    const opts = w.findComponent(NDropdown).props('options') as Array<{
      key: string
      label: string
      children?: Array<{ key: string; label: string }>
    }>
    const reclassify = opts.find((o) => o.key === 'reclassify')
    expect(reclassify).toBeDefined()
    expect(reclassify!.children).toHaveLength(2)
    expect(reclassify!.children![0].label).toBe('下载')
    expect(reclassify!.children![0].key).toBe('reclassify:downloads')
    expect(reclassify!.children![1].label).toBe('音乐')
    expect(reclassify!.children![1].key).toBe('reclassify:music')
  })

  it('hides reclassify when categories list is empty', () => {
    const w = mountMenu({ categories: [] })
    const opts = w.findComponent(NDropdown).props('options') as Array<{
      key: string
    }>
    expect(opts.find((o) => o.key === 'reclassify')).toBeUndefined()
  })

  it('selecting a category emits reclassify with categoryId', async () => {
    const w = mountMenu({
      categories: [{ id: 'music', name: '音乐', dir: 'D:/Music' }],
    })
    const dropdown = w.findComponent(NDropdown)
    dropdown.vm.$emit('select', 'reclassify:music')
    await flushPromises()
    expect(w.emitted('reclassify')).toBeTruthy()
    expect(w.emitted('reclassify')![0]).toEqual(['music'])
  })
})
