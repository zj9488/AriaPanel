# M6c: Peer Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BT peer observability section to TaskDetailDrawer — infoHash (truncated + copy), seeder/leecher/connected counts, collapsible per-peer list.

**Architecture:** New `BtPeerSection.vue` receives `Aria2TaskDetail` prop, renders summary + NCollapse peer list. Placed conditionally in TaskDetailDrawer for BT tasks only. Type extension adds `Peer` interface + `peers?: Peer[]` on `Aria2TaskDetail`. No RPC, poller, or Rust changes — peer data already arrives via existing 2s `tellStatus` poll.

**Tech Stack:** Vue 3.5 (Composition API, `<script setup>`), TypeScript, Naive UI 2.44, Vitest + jsdom + @vue/test-utils

## Global Constraints

- **No comments** in code unless explicitly requested
- **No emojis** in code or commit messages
- **Semicolons:** false (Prettier)
- **Quotes:** single (Prettier)
- **Trailing comma:** all
- **`@` alias** maps to `src/`
- **Windows + PowerShell:** No `&&` — use `;` or `if ($?) {}`
- **pnpm** is the package manager
- **Naive UI components** imported individually (no global registration)
- **NCollapse** lazily mounts body — tests must click `.n-collapse-item__header-main` to expand before asserting body content
- **Clipboard:** use `navigator.clipboard?.writeText(...)` (same pattern as `useTaskOperations.ts:43`)

---

### Task 1: Peer types + BtPeerSection component

**Files:**
- Modify: `src/lib/aria2/types.ts` (add `Peer` interface + `peers?: Peer[]` on `Aria2TaskDetail`)
- Create: `src/components/BtPeerSection.vue`
- Test: `src/components/BtPeerSection.test.ts`

**Interfaces:**
- Produces: `Peer` interface (exported from `src/lib/aria2/types.ts`), `BtPeerSection.vue` default export with prop `{ detail: Aria2TaskDetail }`

- [ ] **Step 1: Add Peer type and peers field**

Modify `src/lib/aria2/types.ts`. Add `Peer` interface after the `Aria2Task` interface (after line 39, before `GlobalStat`), and add `peers?: Peer[]` to `Aria2TaskDetail`.

Add this interface:

```typescript
export interface Peer {
  peerId: string
  ip: string
  port: string
  bitfield: string
  amChoking: string
  peerChoking: string
  downloadSpeed: string
  uploadSpeed: string
  seeder: string
}
```

Change `Aria2TaskDetail` to:

```typescript
export interface Aria2TaskDetail extends Aria2Task {
  pieceLength: string
  numPieces: string
  bitfield: string
  connections: string
  peers?: Peer[]
}
```

- [ ] **Step 2: Write BtPeerSection tests (failing)**

Create `src/components/BtPeerSection.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- --run src/components/BtPeerSection.test.ts`
Expected: FAIL — `BtPeerSection.vue` does not exist (import error)

- [ ] **Step 4: Implement BtPeerSection.vue**

Create `src/components/BtPeerSection.vue`:

```vue
<script setup lang="ts">
import { NButton, NCollapse, NCollapseItem, NTag } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'
import { fmtSpeed } from '@/lib/format'

const props = defineProps<{ detail: Aria2TaskDetail }>()

const peers = computed(() =>
  [...(props.detail.peers ?? [])].sort(
    (a, b) => Number(b.downloadSpeed) - Number(a.downloadSpeed),
  ),
)
const seederCount = computed(() => peers.value.filter((p) => p.seeder === 'true').length)
const leecherCount = computed(() => peers.value.length - seederCount.value)
const infoHashShort = computed(() =>
  props.detail.infoHash ? props.detail.infoHash.slice(0, 8) + '...' : '',
)

async function copyInfoHash() {
  if (props.detail.infoHash) await navigator.clipboard?.writeText(props.detail.infoHash)
}
</script>

<template>
  <section>
    <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">BT 信息</h4>
    <div style="font-size: 13px; line-height: 1.8">
      infoHash：{{ infoHashShort }}
      <NButton size="tiny" quaternary data-test="copy-infohash" @click="copyInfoHash">复制</NButton>
      <br />
      做种 {{ seederCount }} · 下载 {{ leecherCount }} · 连接 {{ peers.length }}
    </div>
    <NCollapse :default-expanded-names="[]">
      <NCollapseItem title="Peer 列表" name="peers">
        <div v-if="peers.length === 0" style="font-size: 13px">暂无连接的节点</div>
        <div
          v-for="peer in peers"
          :key="peer.peerId"
          class="peer-row"
          style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 2px"
        >
          <span>{{ peer.ip }}:{{ peer.port }}</span>
          <NTag v-if="peer.seeder === 'true'" size="small" type="success" :bordered="false"
            >做种</NTag
          >
          <span>↓{{ fmtSpeed(peer.downloadSpeed) }}</span>
          <span>↑{{ fmtSpeed(peer.uploadSpeed) }}</span>
        </div>
      </NCollapseItem>
    </NCollapse>
  </section>
</template>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/BtPeerSection.test.ts`
Expected: PASS — all 7 tests

- [ ] **Step 6: Run full suite + type check**

Run: `pnpm test -- --run`
Expected: All tests pass (87 existing + 7 new = 94)

Run: `pnpm vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/aria2/types.ts src/components/BtPeerSection.vue src/components/BtPeerSection.test.ts
git commit -m "feat(ui): BtPeerSection component with peer list and infoHash"
```

---

### Task 2: Integrate BtPeerSection into TaskDetailDrawer

**Files:**
- Modify: `src/components/TaskDetailDrawer.vue` (import + conditional placement)
- Modify: `src/components/TaskDetailDrawer.test.ts` (extend fixture + integration tests)

**Interfaces:**
- Consumes: `BtPeerSection.vue` from Task 1 (default export, prop `{ detail: Aria2TaskDetail }`)
- Produces: TaskDetailDrawer renders BtPeerSection when `detail.bittorrent` is present

- [ ] **Step 1: Extend TaskDetailDrawer test fixture and add integration tests**

Modify `src/components/TaskDetailDrawer.test.ts`. Add a `btDetail` fixture after the existing `detail` const (after line 28), and add two new tests inside the `describe` block.

Add this fixture after the `detail` const:

```typescript
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
```

Add these tests inside the `describe('TaskDetailDrawer', ...)` block (before the closing `})`):

```typescript
  it('shows BT section for bittorrent tasks', () => {
    mount(TaskDetailDrawer, { props: { show: true, detail: btDetail, operate: () => {} } })
    expect(document.body.textContent).toContain('BT 信息')
  })

  it('hides BT section for non-bittorrent tasks', () => {
    mount(TaskDetailDrawer, { props: { show: true, detail, operate: () => {} } })
    expect(document.body.textContent).not.toContain('BT 信息')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/components/TaskDetailDrawer.test.ts`
Expected: FAIL — "shows BT section" test fails because BtPeerSection is not yet imported/rendered. ("hides BT section" may pass since the section doesn't exist yet.)

- [ ] **Step 3: Integrate BtPeerSection into TaskDetailDrawer.vue**

Modify `src/components/TaskDetailDrawer.vue`:

1. Add import after line 5 (after `import type { TaskOp }`):

```typescript
import BtPeerSection from './BtPeerSection.vue'
```

2. Insert the component after the 分块进度 section (after line 64 — the closing `</section>` of 分块进度), before the 文件列表 section (line 66). Add:

```html
        <BtPeerSection v-if="t?.bittorrent" :detail="t" />
```

The resulting section order will be: Progress → 基本信息 → 分块进度 → **BT 信息** → 文件列表 → 链接列表 → 错误详情.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/TaskDetailDrawer.test.ts`
Expected: PASS — all 5 tests (3 existing + 2 new)

- [ ] **Step 5: Run full suite + type check + lint**

Run: `pnpm test -- --run`
Expected: All tests pass (94 from Task 1 + 2 new = 96)

Run: `pnpm vue-tsc --noEmit`
Expected: No errors

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/components/TaskDetailDrawer.vue src/components/TaskDetailDrawer.test.ts
git commit -m "feat(ui): integrate BtPeerSection into TaskDetailDrawer"
```
