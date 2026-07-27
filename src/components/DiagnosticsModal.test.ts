import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useConnectionStore } from '@/stores/connection'
import DiagnosticsModal from './DiagnosticsModal.vue'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'get_aria2_logs') return Promise.resolve(['[WARN] test line 1', '[ERROR] test line 2'])
    if (cmd === 'get_restarts_count') return Promise.resolve(2)
    if (cmd === 'restart_aria2') return Promise.resolve()
    return Promise.resolve({})
  }),
}))

function mountModal() {
  return mount({
    components: { NConfigProvider, NMessageProvider, NDialogProvider, DiagnosticsModal },
    template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <DiagnosticsModal />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
  })
}

describe('DiagnosticsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders status and restart count when open', async () => {
    const conn = useConnectionStore()
    conn.setShowDiagnostics(true)
    mountModal()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.textContent).toContain('aria2')
    expect(document.body.textContent).toContain('2')
    expect(document.body.textContent).toContain('/3')
  })

  it('renders log lines', async () => {
    const conn = useConnectionStore()
    conn.setShowDiagnostics(true)
    mountModal()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.textContent).toContain('[WARN] test line 1')
    expect(document.body.textContent).toContain('[ERROR] test line 2')
  })

  it('close button hides modal', async () => {
    const conn = useConnectionStore()
    conn.setShowDiagnostics(true)
    mountModal()
    await new Promise((r) => setTimeout(r, 0))
    const closeBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('关闭'),
    )
    expect(closeBtn).toBeTruthy()
    await new DOMWrapper(closeBtn!).trigger('click')
    expect(conn.showDiagnostics).toBe(false)
  })
})
