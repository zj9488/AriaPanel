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
})
