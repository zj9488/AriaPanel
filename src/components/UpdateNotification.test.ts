import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import UpdateNotification from './UpdateNotification.vue'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

import { check as mockCheck } from '@tauri-apps/plugin-updater'

function mountReal() {
  document.body.innerHTML = ''
  return mount({
    components: { NConfigProvider, NMessageProvider, NDialogProvider, UpdateNotification },
    template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <UpdateNotification />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
  })
}

describe('UpdateNotification', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('does not show modal when no update', async () => {
    vi.mocked(mockCheck).mockResolvedValue(null)
    mountReal()
    await flushPromises()
    expect(document.body.textContent).not.toContain('发现新版本')
  })

  it('shows modal with version when update available', async () => {
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '修复了若干问题',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    } as never)
    mountReal()
    await flushPromises()
    expect(document.body.textContent).toContain('发现新版本')
    expect(document.body.textContent).toContain('0.2.0')
    expect(document.body.textContent).toContain('修复了若干问题')
  })

  it('later button closes modal', async () => {
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    } as never)
    mountReal()
    await flushPromises()
    const laterBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('稍后'),
    )
    expect(laterBtn).toBeTruthy()
    await new DOMWrapper(laterBtn!).trigger('click')
    expect(document.body.textContent).not.toContain('发现新版本')
  })

  it('update button triggers downloadAndInstall', async () => {
    const dni = vi.fn().mockResolvedValue(undefined)
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    const { relaunch: mockRelaunch } = await import('@tauri-apps/plugin-process')
    vi.mocked(mockRelaunch).mockResolvedValue(undefined)
    mountReal()
    await flushPromises()
    const updateBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('立即更新'),
    )
    expect(updateBtn).toBeTruthy()
    await new DOMWrapper(updateBtn!).trigger('click')
    await flushPromises()
    expect(dni).toHaveBeenCalledOnce()
  })
})
