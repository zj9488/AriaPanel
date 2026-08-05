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

  it('renders advanced tab options with search filter', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({})
    const api = shallowRef({
      client: {
        getGlobalOption: vi.fn().mockResolvedValue({
          'max-tries': '7',
          'http-accept-gzip': 'true',
          'console-log-level': 'debug',
          'disk-cache': '32M',
        }),
      },
    })
    mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider },
        provide: { 'aria2-api': api },
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
    const advTab = Array.from(tabs).find((t) => (t as HTMLElement).textContent?.includes('高级'))
    expect(advTab).toBeTruthy()
    ;(advTab as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
    const text = document.body.textContent ?? ''
    expect(text).toContain('最大重试次数')
    expect(text).toContain('接受 Gzip 压缩')
    expect(text).toContain('日志级别')
    expect(text).toContain('FTP 传输类型')
  })

  it('filters advanced options by key and label via search', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({})
    const api = shallowRef({
      client: { getGlobalOption: vi.fn().mockResolvedValue({}) },
    })
    mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider },
        provide: { 'aria2-api': api },
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
    const advTab = Array.from(tabs).find((t) => (t as HTMLElement).textContent?.includes('高级'))
    ;(advTab as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))

    const searchInput = Array.from(document.body.querySelectorAll('.n-input input')).find((i) =>
      (i as HTMLInputElement).placeholder?.includes('过滤'),
    )
    expect(searchInput).toBeTruthy()

    ;(searchInput as HTMLInputElement).value = 'gzip'
    await (searchInput as HTMLInputElement).dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    const text = document.body.textContent ?? ''
    expect(text).toContain('接受 Gzip 压缩')
    expect(text).not.toContain('最大重试次数')
  })

  it('shows empty state when search has no match', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({})
    const api = shallowRef({
      client: { getGlobalOption: vi.fn().mockResolvedValue({}) },
    })
    mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider },
        provide: { 'aria2-api': api },
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
    const advTab = Array.from(tabs).find((t) => (t as HTMLElement).textContent?.includes('高级'))
    ;(advTab as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))

    const searchInput = Array.from(document.body.querySelectorAll('.n-input input')).find((i) =>
      (i as HTMLInputElement).placeholder?.includes('过滤'),
    )
    ;(searchInput as HTMLInputElement).value = 'zzz-no-match'
    await (searchInput as HTMLInputElement).dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.textContent ?? '').toContain('无匹配选项')
  })

  it('saves advanced options via changeGlobalOption', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        port: 6800,
        secret: '',
        dir: '',
        maxConcurrentDownloads: 5,
        maxConnectionPerServer: 5,
        minSplitSize: '20M',
        split: 5,
        maxOverallDownloadLimit: '0',
        maxOverallUploadLimit: '0',
        allProxy: '',
        clipboardWatch: true,
        btMaxPeers: 55,
        seedRatio: 1.0,
        seedTime: 0,
        enableDht: true,
        btListenPort: '6881-6999',
        dhtListenPort: '6881-6999',
        btTracker: '',
        btSaveMetadata: false,
      })
      .mockResolvedValue({ restarted: false })
    const changeGlobalOption = vi.fn().mockResolvedValue(undefined)
    const api = shallowRef({
      client: {
        getGlobalOption: vi.fn().mockResolvedValue({
          'max-tries': '7',
          'http-accept-gzip': 'true',
          'max-concurrent-downloads': '99',
        }),
        changeGlobalOption,
      },
    })
    mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider },
        provide: { 'aria2-api': api },
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
    const advTab = Array.from(tabs).find((t) => (t as HTMLElement).textContent?.includes('高级'))
    ;(advTab as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))

    const inputs = document.body.querySelectorAll('.n-input input')
    const maxTries = Array.from(inputs).find((i) => (i as HTMLInputElement).value === '7')
    expect(maxTries).toBeTruthy()
    ;(maxTries as HTMLInputElement).value = '10'
    await (maxTries as HTMLInputElement).dispatchEvent(new Event('input'))

    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('保存'),
    )
    ;(saveBtn as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))

    expect(changeGlobalOption).toHaveBeenCalled()
    const args = (changeGlobalOption as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args['max-tries']).toBe('10')
    expect(args['max-concurrent-downloads']).toBe('5')
  })
})
