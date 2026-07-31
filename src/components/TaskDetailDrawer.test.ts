import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'

const detail: Aria2TaskDetail = {
  gid: 'g1',
  status: 'active',
  totalLength: '104857600',
  completedLength: '71303168',
  downloadSpeed: '2621440',
  uploadSpeed: '0',
  dir: 'D:/Downloads',
  pieceLength: '1048576',
  numPieces: '100',
  bitfield: 'ffff',
  connections: '8',
  files: [
    {
      path: 'D:/Downloads/file.bin',
      length: '104857600',
      completedLength: '71303168',
      selected: 'true',
      uris: [{ uri: 'https://x/file.bin', status: 'used' }],
    },
  ],
}

const btDetail: Aria2TaskDetail = {
  ...detail,
  bittorrent: { info: { name: 'ubuntu.iso' } },
  infoHash: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4',
  peers: [
    {
      peerId: 'p1',
      ip: '192.168.1.1',
      port: '6881',
      bitfield: 'ffff',
      amChoking: 'false',
      peerChoking: 'false',
      downloadSpeed: '1250000',
      uploadSpeed: '30000',
      seeder: 'true',
    },
  ],
}

const taskOpts: Record<string, string> = {
  'max-download-limit': '1M',
  'max-upload-limit': '0',
  'seed-ratio': '2.0',
}

const multiFileBtDetail: Aria2TaskDetail = {
  ...btDetail,
  bittorrent: { info: { name: 'multi torrent' }, mode: 'multi' },
  files: [
    {
      path: 'D:/Downloads/torrent/file1.bin',
      length: '52428800',
      completedLength: '26214400',
      selected: 'true',
      uris: [],
    },
    {
      path: 'D:/Downloads/torrent/file2.bin',
      length: '52428800',
      completedLength: '0',
      selected: 'false',
      uris: [],
    },
    {
      path: 'D:/Downloads/torrent/file3.bin',
      length: '52428800',
      completedLength: '52428800',
      selected: 'true',
      uris: [],
    },
  ],
}

const seedingBtDetail: Aria2TaskDetail = {
  ...btDetail,
  status: 'active',
  totalLength: '104857600',
  completedLength: '104857600',
}

describe('TaskDetailDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders task name and basic info', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('file.bin')
    expect(document.body.textContent).toContain('D:/Downloads')
  })

  it('renders piece progress', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('100')
    expect(document.body.textContent).toContain('8')
  })

  it('renders link list', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('https://x/file.bin')
  })

  it('shows BT section for bittorrent tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail: btDetail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('BT 信息')
  })

  it('hides BT section for non-bittorrent tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).not.toContain('BT 信息')
  })

  it('renders speed limit inputs from taskOptions', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: taskOpts, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('下载限速')
    expect(document.body.textContent).toContain('上传限速')
  })

  it('blur on download limit calls changeOption', async () => {
    const changeOption = vi.fn()
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: taskOpts, operate: () => {}, changeOption },
      attachTo: document.body,
    })
    const input = new DOMWrapper(document.body.querySelector('[data-test="dl-limit"] input')!)
    await input.setValue('2M')
    await input.trigger('blur')
    expect(changeOption).toHaveBeenCalledWith('g1', { 'max-download-limit': '2M' })
  })

  it('renders seed ratio input for BT tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail: btDetail, taskOptions: taskOpts, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('做种比例')
  })

  it('hides seed ratio input for non-BT tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: taskOpts, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).not.toContain('做种比例')
  })

  it('renders file checkboxes for multi-file BT tasks', () => {
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption: () => {},
      },
      attachTo: document.body,
    })
    expect(document.body.querySelectorAll('[data-test="file-checkbox"]')).toHaveLength(3)
    expect(document.body.textContent).toContain('编辑选择')
  })

  it('hides file checkboxes for single-file tasks', () => {
    const w = mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(w.findAll('[data-test="file-checkbox"]')).toHaveLength(0)
  })

  it('entering edit mode shows batch buttons', async () => {
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption: () => {},
      },
      attachTo: document.body,
    })
    await new DOMWrapper(document.body.querySelector('[data-test="edit-files"]')!).trigger('click')
    expect(document.body.textContent).toContain('全选')
    expect(document.body.textContent).toContain('全不选')
    expect(document.body.textContent).toContain('应用')
    expect(document.body.textContent).toContain('取消')
  })

  it('edit mode: select all then apply sends all indices', async () => {
    const changeOption = vi.fn()
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption,
      },
      attachTo: document.body,
    })
    await new DOMWrapper(document.body.querySelector('[data-test="edit-files"]')!).trigger('click')
    await new DOMWrapper(document.body.querySelector('[data-test="select-all-files"]')!).trigger('click')
    await new DOMWrapper(document.body.querySelector('[data-test="apply-files"]')!).trigger('click')
    expect(changeOption).toHaveBeenCalledWith('g1', { 'select-file': '1,2,3' })
  })

  it('edit mode: deselect all disables apply and shows hint', async () => {
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption: () => {},
      },
      attachTo: document.body,
    })
    await new DOMWrapper(document.body.querySelector('[data-test="edit-files"]')!).trigger('click')
    await new DOMWrapper(document.body.querySelector('[data-test="deselect-all-files"]')!).trigger('click')
    expect(document.body.textContent).toContain('至少保留一个文件')
    const applyBtn = document.body.querySelector('[data-test="apply-files"]')! as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)
  })

  it('edit mode: toggle files then apply sends correct indices', async () => {
    const changeOption = vi.fn()
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption,
      },
      attachTo: document.body,
    })
    await new DOMWrapper(document.body.querySelector('[data-test="edit-files"]')!).trigger('click')
    const checkboxes = document.body.querySelectorAll('[data-test="file-checkbox"]')
    await new DOMWrapper(checkboxes[0]!).trigger('click')
    await new DOMWrapper(checkboxes[1]!).trigger('click')
    await new DOMWrapper(document.body.querySelector('[data-test="apply-files"]')!).trigger('click')
    expect(changeOption).toHaveBeenCalledWith('g1', { 'select-file': '2,3' })
  })

  it('edit mode: cancel exits without calling changeOption', async () => {
    const changeOption = vi.fn()
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption,
      },
      attachTo: document.body,
    })
    await new DOMWrapper(document.body.querySelector('[data-test="edit-files"]')!).trigger('click')
    await new DOMWrapper(document.body.querySelector('[data-test="select-all-files"]')!).trigger('click')
    await new DOMWrapper(document.body.querySelector('[data-test="cancel-edit-files"]')!).trigger('click')
    expect(changeOption).not.toHaveBeenCalled()
  })

  it('shows stop seeding label for completed BT tasks', () => {
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: seedingBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption: () => {},
      },
    })
    expect(document.body.textContent).toContain('停止做种')
  })

  it('shows pause label for incomplete tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('暂停')
    expect(document.body.textContent).not.toContain('停止做种')
  })
})
