# M6b: Torrent File Picker — Design Spec

**Date:** 2026-07-27
**Status:** Approved (brainstorming complete)
**Phase:** M6b of 4 (M6a Infrastructure → M6b Add Torrent → M6c Peer Observability → M6d Operation Control)

## Goal

Add `.torrent` file selection to `NewTaskModal`. Users pick one or more `.torrent` files via a native Tauri file dialog; the existing "开始下载" button submits them through the M6a infrastructure (`read_torrent_base64` command + `addTorrent` RPC). Only `NewTaskModal.vue` changes — no new composables or stores, consistent with M4b's "self-contained modal" philosophy.

## Architecture

Single-layer, single-file change:

| Layer | Changes |
|-------|---------|
| **Frontend** | `NewTaskModal.vue` gains a "选择种子文件" button + removable file list; `submit()` branches between `addTorrent` (files present) and the existing `addUri` loop (otherwise) |

Consumes (built in M6a, one minor alignment needed):
- `read_torrent_base64` Tauri command — reads a file path, returns base64 string
- `addTorrent(torrentBase64, uris, options)` RPC method on `Aria2Client`

**Type alignment:** M6a typed `addTorrent`'s `options` as `Record<string, string>`, but `buildOptions()` returns `Record<string, unknown>` (same type `addUri` accepts). Loosen `addTorrent`'s `options` param to `Record<string, unknown>` in `rpc-client.ts` so both methods share a consistent shape. This also resolves the "inconsistent shape" smell flagged in the M6a standards review.

## UX Flow

1. A new "选择种子文件" button appears below the URL textarea.
2. Click → Tauri `open({ multiple: true, filters: [{ name: 'Torrent', extensions: ['torrent'] }] })`.
3. Selected files render as a removable tag list below the button (filename + "×").
4. When files are present: the type tag shows **BT** and the textarea shows a hint "已选择 N 个种子文件（链接将被忽略）".
5. "开始下载" submit: **files take priority** → `addTorrent(base64, [], options)` per file; if no files, the existing `addUri` loop runs unchanged.
6. On close/reset: the file list clears (alongside the existing form reset).

## Component Changes (`src/components/NewTaskModal.vue`)

### State

```typescript
const torrentFiles = ref<{ name: string; base64: string }[]>([])
```

Holds the filename and pre-read base64 for each picked `.torrent` file.

### pickTorrent()

```typescript
async function pickTorrent() {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Torrent', extensions: ['torrent'] }],
  })
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  for (const path of paths) {
    try {
      const base64 = await invoke<string>('read_torrent_base64', { path })
      const name = path.split(/[\\/]/).pop() ?? path
      torrentFiles.value.push({ name, base64 })
    } catch (e) {
      message.error(`读取种子文件失败：${String(e)}`)
    }
  }
}
```

Eager-reads base64 at pick time so that (a) read errors surface immediately and (b) submit stays a clean loop with no async file reads. `open` is imported from `@tauri-apps/plugin-dialog`; `invoke` from `@tauri-apps/api/core`.

### removeTorrent(index)

```typescript
function removeTorrent(index: number) {
  torrentFiles.value.splice(index, 1)
}
```

### Type detection refinement

Update `detectedType` so that picked files force BT:

```typescript
const detectedType = computed<'http' | 'bt' | 'mixed' | null>(() => {
  if (torrentFiles.value.length > 0) return 'bt'
  if (urlList.value.length === 0) return null
  const types = new Set(urlList.value.map((u) => (u.startsWith('magnet:') ? 'bt' : 'http')))
  return types.size === 1 ? ([...types][0] as 'http' | 'bt') : 'mixed'
})
```

Because the existing advanced-settings visibility already keys off `detectedType !== 'bt'`, the HTTP-only fields (filename / split / maxConnPerServer) auto-hide when files are picked — no new conditionals needed.

### submit() branching

```typescript
async function submit() {
  if (torrentFiles.value.length > 0) {
    const c = api?.value?.client
    if (!c) return
    submitting.value = true
    const options = buildOptions()
    let success = 0
    const errors: string[] = []
    for (const f of torrentFiles.value) {
      try {
        await c.addTorrent(f.base64, [], options)
        success++
      } catch (e) {
        errors.push(`${f.name}: ${String(e)}`)
      }
    }
    submitting.value = false
    if (errors.length > 0) {
      message.error(`${success} 成功，${errors.length} 失败：${errors.join('; ')}`)
    } else {
      message.success(`已添加 ${success} 个任务`)
    }
    if (success > 0) {
      emit('update:show', false)
      emit('submitted')
    }
    return
  }
  // ... existing addUri loop unchanged
}
```

`buildOptions()` is reused as-is — `dir`, `category`, and `proxy` apply to torrents. The HTTP-only keys (`out`, `split`, `max-connection-per-server`) are already omitted when `detectedType === 'bt'`.

### Reset on close

In the existing `watch(() => props.show, ...)` reset block, add:

```typescript
torrentFiles.value = []
```

### Template additions

Below the type-tag row, add the picker button and file list:

```html
<div style="display: flex; align-items: center; gap: 8px">
  <NButton size="small" quaternary @click="pickTorrent">选择种子文件</NButton>
  <span v-if="torrentFiles.length > 0" style="font-size: 12px; opacity: 0.6">
    已选择 {{ torrentFiles.length }} 个种子文件（链接将被忽略）
  </span>
</div>
<div v-if="torrentFiles.length > 0" style="display: flex; flex-wrap: wrap; gap: 6px">
  <NTag
    v-for="(f, i) in torrentFiles"
    :key="i"
    size="small"
    closable
    @close="removeTorrent(i)"
  >
    {{ f.name }}
  </NTag>
</div>
```

`NTag` is added to the naive-ui import. The `@close` event on `NTag` fires on clicking the close (×) button.

## Testing (`src/components/NewTaskModal.test.ts`)

The test file already mocks `@tauri-apps/plugin-dialog`. Add a mock for `@tauri-apps/api/core` so the `read_torrent_base64` command call is intercepted:

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
```

In each picker test, configure the `invoke` mock to return base64 for `read_torrent_base64`. Extend with:

| # | Test | Asserts |
|---|------|---------|
| 1 | pickTorrent populates files | mock `open` → return `['D:/a.torrent']`; mock `invoke('read_torrent_base64')` → `'base64data'`; click button; assert `torrentFiles` populated (via rendered tag showing filename) |
| 2 | submit with files calls addTorrent | mock api client `addTorrent`; pick a file; click "开始下载"; assert `addTorrent` called once with `('base64data', [], options)`; assert `addUri` not called |
| 3 | submit multiple files calls addTorrent per file | pick 2 files; submit; assert `addTorrent` called twice |
| 4 | type tag shows BT when files selected | pick a file; assert BT tag visible |
| 5 | remove file reduces list | pick a file; trigger tag close; assert file list empty |
| 6 | reset on close clears files | pick a file; close modal (`show=false`); reopen; assert no file tags |

The existing mock api object gains `addTorrent: vi.fn().mockResolvedValue('gid-torrent')` alongside the existing `addUri` mock.

## Out of Scope (Deferred to M6c / M6d)

- **Webseed URIs:** `addTorrent` is always called with an empty `uris` array. A future enhancement could let users paste webseed URLs alongside the torrent file.
- **Drag-and-drop:** Files are picked only via the native dialog button.
- **`.metalink` files:** Separate concern (`aria2.addMetalink`), future milestone.
- **Per-task BT options** (seed-ratio override, file selection): M6d.

## File Summary

### Modified files

| File | Changes |
|------|---------|
| `src/components/NewTaskModal.vue` | +`torrentFiles` state, +`pickTorrent`/`removeTorrent` functions, `detectedType` checks files first, `submit()` branches addTorrent vs addUri, reset clears files, +picker button + file tag list in template, `NTag` import |
| `src/lib/aria2/rpc-client.ts` | `addTorrent` options param `Record<string, string>` → `Record<string, unknown>` (align with `addUri`) |
| `src/components/NewTaskModal.test.ts` | +`@tauri-apps/api/core` invoke mock, +`addTorrent` on mock api, +6 tests for picker/submit/detection/remove/reset |
