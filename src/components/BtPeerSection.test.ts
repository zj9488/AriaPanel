import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, DOMWrapper, flushPromises } from '@vue/test-utils'
import BtPeerSection from './BtPeerSection.vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'

const mockWriteText = vi.fn().mockResolvedValue(undefined)

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
  files: [],
  bittorrent: { info: { name: 'test.iso' } },
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
    {
      peerId: 'p2',
      ip: '10.0.0.5',
      port: '51413',
      bitfield: 'ff00',
      amChoking: 'false',
      peerChoking: 'false',
      downloadSpeed: '450000',
      uploadSpeed: '0',
      seeder: 'false',
    },
    {
      peerId: 'p3',
      ip: '172.16.0.1',
      port: '6881',
      bitfield: 'f0ff',
      amChoking: 'true',
      peerChoking: 'false',
      downloadSpeed: '800000',
      uploadSpeed: '10000',
      seeder: 'true',
    },
    {
      peerId: 'p4',
      ip: '192.168.0.10',
      port: '12345',
      bitfield: '0fff',
      amChoking: 'false',
      peerChoking: 'true',
      downloadSpeed: '100000',
      uploadSpeed: '0',
      seeder: 'false',
    },
  ],
}

function mountSection(override: Partial<Aria2TaskDetail> = {}) {
  return mount(BtPeerSection, {
    props: { detail: { ...detail, ...override } },
    attachTo: document.body,
  })
}

async function expandPeerList() {
  const header = document.body.querySelector('.n-collapse-item__header-main')
  if (header) await new DOMWrapper(header).trigger('click')
  await flushPromises()
}

describe('BtPeerSection', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    mockWriteText.mockClear()
    Object.assign(navigator, { clipboard: { writeText: mockWriteText } })
  })

  it('renders seeder leecher and connected counts', () => {
    const wrapper = mountSection()
    expect(wrapper.text()).toContain('做种 2')
    expect(wrapper.text()).toContain('下载 2')
    expect(wrapper.text()).toContain('连接 4')
  })

  it('renders truncated infoHash', () => {
    const wrapper = mountSection()
    expect(wrapper.text()).toContain('a1b2c3d4...')
    expect(wrapper.text()).not.toContain('a1b2c3d4e5f67890')
  })

  it('copy button writes full infoHash to clipboard', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-test="copy-infohash"]').trigger('click')
    expect(mockWriteText).toHaveBeenCalledWith('a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4')
  })

  it('peer list collapsed by default hides peer IPs', () => {
    const wrapper = mountSection()
    expect(wrapper.text()).not.toContain('192.168.1.1')
  })

  it('expanding peer list shows peer rows', async () => {
    const wrapper = mountSection()
    await expandPeerList()
    expect(wrapper.text()).toContain('192.168.1.1')
    expect(wrapper.text()).toContain('10.0.0.5')
  })

  it('peers sorted by download speed descending', async () => {
    const wrapper = mountSection()
    await expandPeerList()
    const rows = wrapper.findAll('.peer-row')
    expect(rows[0].text()).toContain('192.168.1.1')
    expect(rows[1].text()).toContain('172.16.0.1')
    expect(rows[2].text()).toContain('10.0.0.5')
    expect(rows[3].text()).toContain('192.168.0.10')
  })

  it('shows empty state when no peers', async () => {
    const wrapper = mountSection({ peers: [] })
    await expandPeerList()
    expect(wrapper.text()).toContain('暂无连接的节点')
  })
})
