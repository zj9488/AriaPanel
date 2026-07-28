# M6c: Peer Observability

**Phase:** M6c (3 of 4) — follows M6a (BT Infrastructure) + M6b (Torrent File Picker)
**Branch:** `m6c-peer-observability` (from master `24bd662`)

## Overview

Add a BT peer observability section to `TaskDetailDrawer`. For BT tasks only, display infoHash (truncated + copyable), seeder/leecher/connected summary counts, and a collapsible per-peer list showing IP:port, seeder badge, and download/upload speeds.

aria2 already delivers the `peers` array via `tellStatus` (polled every 2s by `useDetailPoller` with no `keys` filter — all fields returned). M6c only needs to extend the type and render the data. No RPC, poller, or Rust changes.

## Scope

### In Scope

- `Peer` interface + `peers?: Peer[]` on `Aria2TaskDetail`
- `BtPeerSection.vue` component: infoHash truncated + copy button, summary counts, collapsible peer list
- Integration into `TaskDetailDrawer.vue` (conditional on `detail.bittorrent`)
- Unit tests for `BtPeerSection` + integration smoke test in `TaskDetailDrawer.test.ts`

### Out of Scope

- `amChoking` / `peerChoking` state display (can add as tooltips in a future pass)
- Per-peer `bitfield` progress bar
- DHT routing table info
- `getPeers` JSON-RPC method (data already arrives via `tellStatus`)
- Sorting controls / column customization (peers sorted by download speed desc, fixed)
- M6d operation control (pause/remove individual peers)

## Data Model

### Peer interface (`src/lib/aria2/types.ts`)

All fields typed as `string` following the project convention (aria2 JSON-RPC returns all values as strings):

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
  seeder: string // 'true' | 'false'
}
```

### Aria2TaskDetail extension

```typescript
export interface Aria2TaskDetail extends Aria2Task {
  pieceLength: string
  numPieces: string
  bitfield: string
  connections: string
  peers?: Peer[]
}
```

`Aria2Task` already has `infoHash?`, `numSeeders?`, `seeder?` (added in M6a). No changes needed there.

## Component Design

### BtPeerSection.vue

**Location:** `src/components/BtPeerSection.vue`

**Props:**

```typescript
defineProps<{ detail: Aria2TaskDetail }>()
```

**Computed values:**

| Name | Derivation |
|------|------------|
| `peers` | `detail.peers ?? []`, sorted by `downloadSpeed` descending (parse string → number) |
| `seederCount` | `peers.filter(p => p.seeder === 'true').length` |
| `leecherCount` | `peers.length - seederCount` |
| `infoHashShort` | `detail.infoHash?.slice(0, 8) + '...'` (or empty string if no infoHash) |

**Clipboard copy:** `writeText` from `@tauri-apps/plugin-clipboard-manager` (already a registered Tauri 2 plugin; same pattern as TaskDetailDrawer footer copy-link button). Full `detail.infoHash` passed to `writeText`.

**Naive UI components:** `NButton`, `NCollapse`, `NCollapseItem`, `NTag`.

**Template structure:**

```
section
  heading: "BT 信息"
  summary row:
    infoHashShort + NButton(copy icon, quaternary, size=small) → writeText(infoHash)
    counts: "做种 {seederCount} · 下载 {leecherCount} · 连接 {peers.length}"
  NCollapse (default-expanded-names=[]):
    NCollapseItem (title="Peer 列表", name="peers"):
      v-for peer in peers:
        div.peer-row:
          span: {peer.ip}:{peer.port}
          NTag(size=small, type=success, bordered=false) v-if peer.seeder === 'true': "做种"
          span: ↓{fmtSpeed(peer.downloadSpeed)}
          span: ↑{fmtSpeed(peer.uploadSpeed)}
```

**Empty state:** When `peers.length === 0`, NCollapseItem body shows "暂无连接的节点".

### Integration into TaskDetailDrawer.vue

- Import `BtPeerSection`
- Insert after the 分块进度 section, before 文件列表 section
- Conditional: `<BtPeerSection v-if="detail?.bittorrent" :detail="detail" />`

Non-BT tasks (no `bittorrent` field) never render the section.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Per-peer detail level | Compact (IP:port + seeder badge + speeds) | Fits 420px drawer width; most useful info at a glance |
| infoHash display | Truncated 8 chars + copy button | Saves space; full hash available via clipboard |
| Peer list height | Summary always visible + NCollapse default collapsed | Keeps drawer concise when many peers connected |
| Choking states | Omitted from UI | Low user value at this stage; YAGNI |
| Peer sort | By download speed desc | Most useful peers first; fixed ordering |
| Component architecture | Separate BtPeerSection.vue | Single responsibility; independently testable; drawer stays lean |

## Testing Strategy

### BtPeerSection.test.ts (new file)

Test fixture: a minimal `Aria2TaskDetail` with `bittorrent`, `infoHash`, and a `peers` array of 3-4 peers (mix of seeders and leechers with varying speeds).

| Test | Assertion |
|------|-----------|
| Renders summary counts | "做种 2", "下载 2", "连接 4" appear in document.body.textContent |
| Truncated infoHash | "a1b2c3d4..." appears (not full 40 chars) |
| Copy button calls clipboard | `writeText` called with full 40-char infoHash |
| Peer list collapsed by default | Peer IPs not in DOM before expand |
| Expanding shows peer rows | Click NCollapseItem header → peer IP + speeds appear |
| Peers sorted by download speed | Highest-speed peer IP appears first in expanded list |
| Empty peers state | "暂无连接的节点" when peers array empty |

Test mount: `NConfigProvider > NMessageProvider > NDialogProvider` wrapper (NTag + NCollapse may need providers). Mock `@tauri-apps/plugin-clipboard-manager` `writeText`.

### TaskDetailDrawer.test.ts (extend existing)

Extend the existing fixture with `bittorrent` and `peers` fields. Add one test asserting "BT 信息" heading appears when detail has `bittorrent`, and does NOT appear for non-BT tasks.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/aria2/types.ts` | Add `Peer` interface + `peers?: Peer[]` on `Aria2TaskDetail` |
| `src/components/BtPeerSection.vue` | New component |
| `src/components/BtPeerSection.test.ts` | New test file |
| `src/components/TaskDetailDrawer.vue` | Import + conditional placement of BtPeerSection |
| `src/components/TaskDetailDrawer.test.ts` | Extend fixture + integration test |

No changes to: `rpc-client.ts`, `useDetailPoller.ts`, `format.ts`, any Rust code, or stores.
