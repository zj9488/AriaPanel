import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useConnectionStore } from '@/stores/connection'
import TopBar from './TopBar.vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function mountTopBar() {
  return mount({
    components: { NConfigProvider, NMessageProvider, NDialogProvider, TopBar },
    provide: { 'aria2-api': shallowRef(null) },
    template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <TopBar />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
  })
}

describe('TopBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows correct status label when connected', () => {
    const conn = useConnectionStore()
    conn.setConnected()
    const wrapper = mountTopBar()
    expect(wrapper.text()).toContain('已连接')
  })

  it('shows error label when in error state', () => {
    const conn = useConnectionStore()
    conn.setError('boom')
    const wrapper = mountTopBar()
    expect(wrapper.text()).toContain('连接失败')
  })

  it('disables action buttons when disconnected', () => {
    const conn = useConnectionStore()
    conn.setError('boom')
    const wrapper = mountTopBar()
    const buttons = wrapper.findAll('button')
    const newText = buttons.find((b) => b.text().includes('新建'))
    expect(newText?.attributes('disabled')).toBeDefined()
  })

  it('opens diagnostics when status pill clicked', async () => {
    const conn = useConnectionStore()
    conn.setConnected()
    const wrapper = mountTopBar()
    const pill = wrapper.findAll('button').find((b) => b.text().includes('已连接'))
    expect(pill).toBeTruthy()
    await pill!.trigger('click')
    expect(conn.showDiagnostics).toBe(true)
  })
})
