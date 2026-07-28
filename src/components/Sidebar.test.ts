import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import Sidebar from './Sidebar.vue'
import { useTaskStore } from '@/stores/task'
import { useCategoryStore, UNCATEGORIZED_ID } from '@/stores/category'
import { useConnectionStore } from '@/stores/connection'
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
    files: [{ path: `${dir}/${gid}.bin`, length: '0', completedLength: '0', selected: 'true', uris: [] }],
  }
}

function mountSidebar() {
  return mount({
    components: { NConfigProvider, NMessageProvider, NDialogProvider, Sidebar },
    template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <Sidebar />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
  })
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders status filter items', () => {
    const w = mountSidebar()
    expect(w.text()).toContain('全部')
    expect(w.text()).toContain('下载中')
    expect(w.text()).toContain('等待中')
    expect(w.text()).toContain('已完成')
  })

  it('renders default categories', () => {
    const w = mountSidebar()
    expect(w.text()).toContain('音乐')
    expect(w.text()).toContain('视频')
    expect(w.text()).toContain('添加分类')
  })

  it('renders speed stats from connection store', () => {
    const conn = useConnectionStore()
    conn.setStat({ downloadSpeed: '2621440', uploadSpeed: '1024', active: '1', waiting: '0', stoppedTotal: '0' })
    const w = mountSidebar()
    expect(w.text()).toContain('2.5 MB/s')
  })

  it('clicking a category sets categoryFilter', async () => {
    const ts = useTaskStore()
    const w = mountSidebar()
    const catButtons = w.findAll('[data-cat]')
    expect(catButtons.length).toBeGreaterThan(0)
    await catButtons[0].trigger('click')
    expect(ts.categoryFilter).not.toBeNull()
  })

  it('shows category task counts', () => {
    const ts = useTaskStore()
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    ts.apply([mkTask('g1', 'D:/Music'), mkTask('g2', 'D:/dl')], [], [])
    const w = mountSidebar()
    expect(w.text()).toContain('1')
  })

  it('renders uncategorized item', () => {
    const w = mountSidebar()
    expect(w.text()).toContain('未分类')
  })

  it('clicking uncategorized sets categoryFilter', async () => {
    const ts = useTaskStore()
    const w = mountSidebar()
    await w.find('[data-uncategorized]').trigger('click')
    expect(ts.categoryFilter).toBe(UNCATEGORIZED_ID)
  })

  it('uncategorized count reflects unmatched tasks', () => {
    const ts = useTaskStore()
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    ts.apply([mkTask('g1', 'D:/Music'), mkTask('g2', 'D:/dl')], [], [])
    const w = mountSidebar()
    expect(w.find('[data-uncategorized]').text()).toContain('1')
  })
})
