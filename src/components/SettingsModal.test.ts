import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import SettingsModal from './SettingsModal.vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({}) }))

describe('SettingsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders config sections', () => {
    mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider },
        provide: { 'aria2-api': shallowRef(null) },
        template: `
          <NConfigProvider>
            <NMessageProvider>
              <NDialogProvider>
                <SettingsModal :show="true" />
              </NDialogProvider>
            </NMessageProvider>
          </NConfigProvider>
        `,
      },
      { global: { components: { SettingsModal } } },
    )
    expect(document.body.textContent).toContain('最大并发下载数')
    expect(document.body.textContent).toContain('速度限制')
    expect(document.body.textContent).toContain('代理')
    expect(document.body.textContent).toContain('RPC')
  })

  it('renders BT settings tab with all fields', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      btMaxPeers: 100,
      seedRatio: 1.5,
      seedTime: 60,
      enableDht: false,
      btListenPort: '6881-6999',
      dhtListenPort: '7000-7999',
      btTracker: 'http://t.example.com',
      btSaveMetadata: true,
    })
    mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider },
        provide: { 'aria2-api': shallowRef(null) },
        template: `
          <NConfigProvider>
            <NMessageProvider>
              <NDialogProvider>
                <SettingsModal :show="true" />
              </NDialogProvider>
            </NMessageProvider>
          </NConfigProvider>
        `,
      },
      { global: { components: { SettingsModal } } },
    )
    await new Promise((r) => setTimeout(r, 0))
    const tabs = document.body.querySelectorAll('.n-tabs-tab')
    const btTab = Array.from(tabs).find((t) => (t as HTMLElement).textContent?.includes('BitTorrent'))
    expect(btTab).toBeTruthy()
    ;(btTab as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
    const text = document.body.textContent ?? ''
    expect(text).toContain('最大 Peer')
    expect(text).toContain('做种比例')
    expect(text).toContain('做种时间')
    expect(text).toContain('DHT')
    expect(text).toContain('BT 监听端口')
    expect(text).toContain('DHT 监听端口')
    expect(text).toContain('Tracker')
    expect(text).toContain('保存种子')
  })
})
