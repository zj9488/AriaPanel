import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUpdater } from './useUpdater'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

import { check as mockCheck } from '@tauri-apps/plugin-updater'
import { relaunch as mockRelaunch } from '@tauri-apps/plugin-process'

function mountComposable() {
  let result!: ReturnType<typeof useUpdater>
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useUpdater()
        return () => h('div')
      },
    }),
  )
  return { result, wrapper }
}

describe('useUpdater', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('no update available sets updateAvailable false', async () => {
    vi.mocked(mockCheck).mockResolvedValue(null)
    const { result } = mountComposable()
    await result.check()
    expect(result.updateAvailable.value).toBe(false)
    expect(result.updateInfo.value).toBeNull()
  })

  it('update available sets updateAvailable true and stores info', async () => {
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: 'Bug fixes',
      downloadAndInstall: vi.fn(),
    } as never)
    const { result } = mountComposable()
    await result.check()
    expect(result.updateAvailable.value).toBe(true)
    expect(result.updateInfo.value).toEqual({
      version: '0.2.0',
      date: '2026-07-30',
      body: 'Bug fixes',
    })
  })

  it('network error sets error and keeps updateAvailable false', async () => {
    vi.mocked(mockCheck).mockRejectedValue(new Error('network'))
    const { result } = mountComposable()
    await result.check()
    expect(result.updateAvailable.value).toBe(false)
    expect(result.error.value).toBe('network')
  })

  it('downloadAndInstall calls plugin then relaunch', async () => {
    const dni = vi.fn().mockResolvedValue(undefined)
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    vi.mocked(mockRelaunch).mockResolvedValue(undefined)
    const { result } = mountComposable()
    await result.check()
    await result.downloadAndInstall()
    expect(dni).toHaveBeenCalledOnce()
    expect(mockRelaunch).toHaveBeenCalledOnce()
  })

  it('downloadAndInstall sets downloading true during operation', async () => {
    const dni = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    vi.mocked(mockRelaunch).mockResolvedValue(undefined)
    const { result } = mountComposable()
    await result.check()
    const promise = result.downloadAndInstall()
    expect(result.downloading.value).toBe(true)
    await promise
    expect(result.downloading.value).toBe(false)
  })

  it('downloadAndInstall sets error on failure', async () => {
    const dni = vi.fn().mockRejectedValue(new Error('install failed'))
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    const { result } = mountComposable()
    await result.check()
    await result.downloadAndInstall()
    expect(result.error.value).toBe('install failed')
    expect(result.downloading.value).toBe(false)
  })
})
