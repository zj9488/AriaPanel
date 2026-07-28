import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
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

describe('TaskDetailDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders task name and basic info', () => {
    mount(TaskDetailDrawer, { props: { show: true, detail, operate: () => {} } })
    expect(document.body.textContent).toContain('file.bin')
    expect(document.body.textContent).toContain('D:/Downloads')
  })

  it('renders piece progress', () => {
    mount(TaskDetailDrawer, { props: { show: true, detail, operate: () => {} } })
    expect(document.body.textContent).toContain('100')
    expect(document.body.textContent).toContain('8')
  })

  it('renders link list', () => {
    mount(TaskDetailDrawer, { props: { show: true, detail, operate: () => {} } })
    expect(document.body.textContent).toContain('https://x/file.bin')
  })

  it('shows BT section for bittorrent tasks', () => {
    mount(TaskDetailDrawer, { props: { show: true, detail: btDetail, operate: () => {} } })
    expect(document.body.textContent).toContain('BT 信息')
  })

  it('hides BT section for non-bittorrent tasks', () => {
    mount(TaskDetailDrawer, { props: { show: true, detail, operate: () => {} } })
    expect(document.body.textContent).not.toContain('BT 信息')
  })
})
