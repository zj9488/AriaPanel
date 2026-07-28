import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { NConfigProvider, NMessageProvider, NDialogProvider, NSelect } from 'naive-ui'
import NewTaskModal from './NewTaskModal.vue'
import { useCategoryStore } from '@/stores/category'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const mockAddUri = vi.fn().mockResolvedValue('gid123')
const mockAddTorrent = vi.fn().mockResolvedValue('gid-torrent')
const mockApi = {
  client: { addUri: mockAddUri, addTorrent: mockAddTorrent },
  refresh: vi.fn(),
  dir: 'D:/downloads',
}

function mountModal(props: Record<string, unknown> = {}) {
  return mount(
    {
      components: { NConfigProvider, NMessageProvider, NDialogProvider, NewTaskModal },
      provide: { 'aria2-api': shallowRef(mockApi) },
      props: ['show', 'defaultDir'],
      template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <NewTaskModal :show="show" :default-dir="defaultDir" />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
    },
    { props: { show: true, defaultDir: 'D:/downloads', ...props } },
  )
}

function el(selector: string): HTMLElement {
  return document.body.querySelector(selector)!
}

async function expandAdvanced() {
  const header = document.body.querySelector('.n-collapse-item__header-main')
  if (header) await new DOMWrapper(header).trigger('click')
  await flushPromises()
}

describe('NewTaskModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    mockAddUri.mockClear()
    mockAddTorrent.mockClear()
  })

  it('renders textarea and submit button', () => {
    mountModal()
    expect(el('textarea')).toBeTruthy()
    expect(document.body.textContent).toContain('开始下载')
  })

  it('detects HTTP type from url', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    expect(document.body.textContent).toContain('HTTP')
  })

  it('detects BT type from magnet', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('magnet:?xt=urn:btih:abc123')
    expect(document.body.textContent).toContain('BT')
  })

  it('detects mixed type', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip\nmagnet:?xt=urn:btih:abc123')
    expect(document.body.textContent).toContain('混合')
  })

  it('hides BT-irrelevant fields when magnet', async () => {
    mountModal()
    await expandAdvanced()
    await new DOMWrapper(el('textarea')).setValue('magnet:?xt=urn:btih:abc123')
    expect(document.body.textContent).not.toContain('文件名')
    expect(document.body.textContent).not.toContain('分块')
  })

  it('shows all fields for HTTP', async () => {
    mountModal()
    await expandAdvanced()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    expect(document.body.textContent).toContain('文件名')
    expect(document.body.textContent).toContain('分块')
  })

  it('submits single HTTP url with correct options', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).toHaveBeenCalledTimes(1)
    expect(mockAddUri).toHaveBeenCalledWith(
      ['http://example.com/file.zip'],
      expect.objectContaining({
        dir: 'D:/downloads',
        split: '5',
        'max-connection-per-server': '5',
      }),
    )
  })

  it('submits magnet without HTTP-only options', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('magnet:?xt=urn:btih:abc123')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).toHaveBeenCalledTimes(1)
    expect(mockAddUri).toHaveBeenCalledWith(
      ['magnet:?xt=urn:btih:abc123'],
      expect.not.objectContaining({
        split: expect.anything(),
        'max-connection-per-server': expect.anything(),
        out: expect.anything(),
      }),
    )
  })

  it('submits multiple urls in batch', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://a.com/1.zip\nhttp://b.com/2.zip\nhttp://c.com/3.zip')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).toHaveBeenCalledTimes(3)
  })

  it('skips empty lines in textarea', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://a.com/1.zip\n\n  \nhttp://b.com/2.zip')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).toHaveBeenCalledTimes(2)
  })

  it('warns when textarea is empty', async () => {
    mountModal()
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).not.toHaveBeenCalled()
  })

  it('resets form on close', async () => {
    const w = mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    expect((el('textarea') as HTMLTextAreaElement).value).toBe('http://example.com/file.zip')
    await w.setProps({ show: false })
    await flushPromises()
    await w.setProps({ show: true })
    await flushPromises()
    expect((el('textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('category select fills dir', async () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const w = mountModal({ defaultDir: 'D:/downloads' })
    await expandAdvanced()
    const modal = w.findComponent(NewTaskModal)
    let selects = modal.findAllComponents(NSelect)
    if (selects.length === 0) {
      selects = modal.findAllComponents({ name: 'Select' })
    }
    expect(selects.length).toBeGreaterThanOrEqual(1)
    selects[0].vm.$emit('update:value', 'music')
    await flushPromises()
    const dirInput = document.body.querySelector('input[placeholder="保存目录"]') as HTMLInputElement
    expect(dirInput?.value).toBe('D:/Music')
  })

  it('pickTorrent populates file list', async () => {
    vi.mocked(open).mockResolvedValue(['D:/test.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('test.torrent')
  })

  it('type tag shows BT when files selected', async () => {
    vi.mocked(open).mockResolvedValue(['D:/test.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('BT')
  })

  it('remove file reduces list', async () => {
    vi.mocked(open).mockResolvedValue(['D:/test.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    const w = mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('test.torrent')
    const tags = w.findComponent(NewTaskModal).findAllComponents({ name: 'Tag' })
    const fileTag = tags.find((t) => t.text().includes('test.torrent'))
    fileTag?.vm.$emit('close')
    await flushPromises()
    expect(document.body.textContent).not.toContain('test.torrent')
  })

  it('reset on close clears torrent files', async () => {
    vi.mocked(open).mockResolvedValue(['D:/test.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    const w = mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('test.torrent')
    await w.setProps({ show: false })
    await flushPromises()
    await w.setProps({ show: true })
    await flushPromises()
    expect(document.body.textContent).not.toContain('test.torrent')
  })

  it('submit with torrent files calls addTorrent not addUri', async () => {
    vi.mocked(open).mockResolvedValue(['D:/test.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddTorrent).toHaveBeenCalledTimes(1)
    expect(mockAddTorrent).toHaveBeenCalledWith('base64data', [], expect.objectContaining({ dir: 'D:/downloads' }))
    expect(mockAddUri).not.toHaveBeenCalled()
  })

  it('submit multiple torrent files calls addTorrent per file', async () => {
    vi.mocked(open).mockResolvedValue(['D:/a.torrent', 'D:/b.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddTorrent).toHaveBeenCalledTimes(2)
    expect(mockAddUri).not.toHaveBeenCalled()
  })

  it('files take priority over URLs in textarea on submit', async () => {
    vi.mocked(open).mockResolvedValue(['D:/test.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddTorrent).toHaveBeenCalledTimes(1)
    expect(mockAddUri).not.toHaveBeenCalled()
  })

  it('shows file list for single multi-file torrent', async () => {
    vi.mocked(open).mockResolvedValue('D:/test.torrent')
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_torrent_base64') return Promise.resolve('base64data')
      if (cmd === 'parse_torrent_files')
        return Promise.resolve({
          name: 'test',
          files: [
            { path: 'file1.bin', length: 100 },
            { path: 'file2.bin', length: 200 },
          ],
        })
      return Promise.resolve(null)
    })
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('文件列表')
    expect(document.body.textContent).toContain('file1.bin')
    expect(document.body.textContent).toContain('file2.bin')
  })

  it('hides file list for single-file torrent', async () => {
    vi.mocked(open).mockResolvedValue('D:/test.torrent')
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_torrent_base64') return Promise.resolve('base64data')
      if (cmd === 'parse_torrent_files')
        return Promise.resolve({
          name: 'test',
          files: [{ path: 'only.bin', length: 100 }],
        })
      return Promise.resolve(null)
    })
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    expect(document.body.textContent).not.toContain('文件列表')
  })

  it('deselect all unchecks all file checkboxes', async () => {
    vi.mocked(open).mockResolvedValue('D:/test.torrent')
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_torrent_base64') return Promise.resolve('base64data')
      if (cmd === 'parse_torrent_files')
        return Promise.resolve({
          name: 'test',
          files: [
            { path: 'file1.bin', length: 100 },
            { path: 'file2.bin', length: 200 },
          ],
        })
      return Promise.resolve(null)
    })
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="deselect-all-files"]')).trigger('click')
    await flushPromises()
    const checkboxes = document.body.querySelectorAll('[data-test="file-checkbox"]')
    expect(checkboxes[0].className).not.toContain('checked')
    expect(checkboxes[1].className).not.toContain('n-checkbox--checked')
  })

  it('select all re-checks all file checkboxes', async () => {
    vi.mocked(open).mockResolvedValue('D:/test.torrent')
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_torrent_base64') return Promise.resolve('base64data')
      if (cmd === 'parse_torrent_files')
        return Promise.resolve({
          name: 'test',
          files: [
            { path: 'file1.bin', length: 100 },
            { path: 'file2.bin', length: 200 },
          ],
        })
      return Promise.resolve(null)
    })
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="deselect-all-files"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="select-all-files"]')).trigger('click')
    await flushPromises()
    const checkboxes = document.body.querySelectorAll('[data-test="file-checkbox"]')
    expect(checkboxes[0].className).toContain('n-checkbox--checked')
    expect(checkboxes[1].className).toContain('n-checkbox--checked')
  })

  it('toggling individual checkbox updates selection', async () => {
    vi.mocked(open).mockResolvedValue('D:/test.torrent')
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_torrent_base64') return Promise.resolve('base64data')
      if (cmd === 'parse_torrent_files')
        return Promise.resolve({
          name: 'test',
          files: [
            { path: 'file1.bin', length: 100 },
            { path: 'file2.bin', length: 200 },
          ],
        })
      return Promise.resolve(null)
    })
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    const checkboxes = document.body.querySelectorAll('[data-test="file-checkbox"]')
    await new DOMWrapper(checkboxes[0] as HTMLElement).trigger('click')
    await flushPromises()
    const updated = document.body.querySelectorAll('[data-test="file-checkbox"]')
    expect(updated[0].className).not.toContain('n-checkbox--checked')
    expect(updated[1].className).toContain('n-checkbox--checked')
  })

  it('submit includes select-file with checked indices', async () => {
    vi.mocked(open).mockResolvedValue('D:/test.torrent')
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'read_torrent_base64') return Promise.resolve('base64data')
      if (cmd === 'parse_torrent_files')
        return Promise.resolve({
          name: 'test',
          files: [
            { path: 'file1.bin', length: 100 },
            { path: 'file2.bin', length: 200 },
            { path: 'file3.bin', length: 300 },
          ],
        })
      return Promise.resolve(null)
    })
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="deselect-all-files"]')).trigger('click')
    await flushPromises()
    const checkboxes = document.body.querySelectorAll('[data-test="file-checkbox"]')
    await new DOMWrapper(checkboxes[2] as HTMLElement).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddTorrent).toHaveBeenCalledWith(
      'base64data',
      [],
      expect.objectContaining({ 'select-file': '3', dir: 'D:/downloads' }),
    )
  })
})
