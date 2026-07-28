# M6d: Task Options Control — Design Spec

**Date:** 2026-07-28
**Status:** Approved (brainstorming complete)
**Phase:** M6d of 4 (M6a Infrastructure -> M6b Add Torrent -> M6c Peer Observability -> M6d Operation Control)

## Goal

Add per-task runtime option control to AriaPanel: file selection within multi-file BT torrents, per-task download/upload speed limits, per-task seed ratio override, and context-aware seeding stop/start labels. All controls live in the TaskDetailDrawer with contextual placement and auto-apply on blur/change.

## Scope

Four features, all in TaskDetailDrawer:

| Feature | Location | RPC |
|---------|----------|-----|
| File selection (select-file) | File list section | `changeOption(gid, { 'select-file': '1,3,5' })` |
| Per-task speed limits | Basic info section | `changeOption(gid, { 'max-download-limit': '1M', 'max-upload-limit': '0' })` |
| Per-task seed ratio | BT info section | `changeOption(gid, { 'seed-ratio': '2.0' })` |
| Seeding stop/start (relabel) | Drawer footer buttons | Existing pause/unpause (label only) |

## Architecture: Approach A (Extend Existing Composables)

Follows existing patterns: poller loads data, `useTaskOperations` handles operations, drawer is presentational.

### Data Loading

`useDetailPoller` extends to load task options alongside task detail:

- When `selectedGid` changes, call both `tellStatus` (polled every 2s) and `getOption` (one-time load)
- Store `getOption` result in a new `taskOptions` ref (`Record<string, string>`)
- `taskOptions` is NOT polled — option values only change when the user changes them
- Return `{ detail, taskOptions }` instead of `{ detail }`

### Option Changes

`useTaskOperations` gains a new `changeTaskOption` function:

```typescript
async function changeTaskOption(gid: string, options: Record<string, string>) {
  const c = api.value?.client
  if (!c) return
  try {
    await c.changeOption(gid, options)
    refresh()
  } catch (e) {
    message.error(`操作失败：${String(e)}`)
    refresh()
  }
}
```

Returned alongside existing `{ retry, operate, submitRetry, onAdd }`.

### Props Wiring

`TaskListView` passes new props to `TaskDetailDrawer`:

```html
<TaskDetailDrawer
  :show="detailShow"
  :detail="detail"
  :task-options="taskOptions"
  :operate="operate"
  :change-option="changeTaskOption"
  @update:show="onDrawerClose"
/>
```

## Feature Details

### 1. File Selection

**Scope:** Only for BT multi-file tasks (`t.bittorrent && t.files.length > 1`). HTTP/FTP downloads and single-file torrents show the existing read-only file list.

**UI:**

- File list section header gains two `size="tiny"` buttons: 「全选」 and 「全不选」, shown only when file selection is active
- Each file row gains an `NCheckbox` on the left, bound to `files[i].selected === 'true'`
- Checkbox click stops propagation (does not trigger row click)

**Mechanics:**

- aria2 `select-file` takes 1-based comma-separated indices: `"1,3,5"`. JS `files` array is 0-based, so index `i` maps to aria2 index `i+1`
- When all files are selected (aria2 default), `files[i].selected` is `'true'` for all — no explicit `select-file` needed
- Toggling a checkbox rebuilds the full index list from current file states + the toggled file, then calls `changeOption(gid, { 'select-file': newIndices })`
- 「全选」: sets `select-file` to all indices (`"1,2,...,N"`)
- 「全不选」: sets `select-file` to empty string (`""`). **Implementation note:** verify aria2 treats empty `select-file` as "no files selected" vs "all files default". If aria2 defaults to all, fall back to setting a non-existent index or handle in UI only (defer apply until a file is re-checked)
- Next `tellStatus` poll (within 2s) reflects the change in `files[].selected`

**Edge cases:**

- File already fully downloaded: checkbox still toggles, aria2 handles gracefully (keeps existing data)
- `changeOption` fails: error message shown, checkbox reverts on next poll

### 2. Per-Task Speed Limits

**Scope:** All task types (BT and HTTP/FTP).

**UI:**

In the basic info section, below the existing speed line, add:

```
下载限速：[  1M  ] (placeholder: 0=不限)
上传限速：[  0    ] (placeholder: 0=不限)
```

- `NInput` text inputs (aria2 format: `1M`, `500K`, `0`)
- Read initial values from `taskOptions['max-download-limit']` / `taskOptions['max-upload-limit']`
- `@blur` triggers `changeOption` only if value changed from loaded value
- Input values managed as local refs in TaskDetailDrawer, initialized via `watch` on `taskOptions` prop (drawer does NOT mutate `taskOptions` ref directly)

### 3. Per-Task Seed Ratio

**Scope:** BT tasks only (`t.bittorrent`).

**UI:**

In TaskDetailDrawer as a conditional section (separate from `BtPeerSection` component, which stays presentational), placed right before `<BtPeerSection>`, add:

```
做种比例：[ 2.0 ] (placeholder: 0=跟随全局)
```

- `NInput` text input
- Read initial value from `taskOptions['seed-ratio']`
- `@blur` triggers `changeOption` only if value changed
- `0` means follow global setting (aria2 default)

### 4. Seeding Stop/Start (Label Relabel)

**Scope:** BT tasks in seeding state.

**Detection:** A task is "seeding" when:
- `t.bittorrent` exists (BT task)
- `Number(t.completedLength) >= Number(t.totalLength)` (download complete)
- `totalLength > 0` (avoid edge case of 0-size torrent)

**Footer button labels:**

| Condition | Current label | New label |
|-----------|--------------|-----------|
| active + not seeding | 暂停 | 暂停 (unchanged) |
| active + seeding | 暂停 | 停止做种 |
| paused/waiting + not seeding | 恢复 | 恢复 (unchanged) |
| paused/waiting + seeding | 恢复 | 开始做种 |

Behavior unchanged — still calls `operate(gid, 'pause')` / `operate(gid, 'unpause')`.

## Data Flow

```
selectedGid changes
  -> useDetailPoller.fetch()        // tellStatus (2s polling)
  -> useDetailPoller.fetchOptions() // getOption (one-time)
  -> taskOptions ref updated

User edits speed limit / seed ratio (blur)
  -> changeTaskOption(gid, { 'max-download-limit': '1M' })
  -> rpc changeOption
  -> local ref updated (input stays at new value)
  -> refresh()

User toggles file checkbox
  -> changeTaskOption(gid, { 'select-file': '1,3' })
  -> rpc changeOption
  -> next tellStatus poll reflects files[].selected change
```

## Modified Files

| File | Changes |
|------|---------|
| `src/composables/useDetailPoller.ts` | +`taskOptions` ref, +`fetchOptions()` on gid change, return `{ detail, taskOptions }` |
| `src/composables/useTaskOperations.ts` | +`changeTaskOption(gid, options)` function, add to return |
| `src/views/TaskListView.vue` | Destructure `taskOptions` from poller, `changeTaskOption` from ops, pass as props to drawer |
| `src/components/TaskDetailDrawer.vue` | +`taskOptions`/`changeOption` props, +speed limit inputs in basic info, +seed ratio input near BT, +file checkboxes + select all/deselect all, +seeding label logic |
| `src/composables/useDetailPoller.test.ts` | +getOption loading test |
| `src/composables/useTaskOperations.test.ts` | +changeTaskOption test |
| `src/components/TaskDetailDrawer.test.ts` | +file checkbox, select all/deselect all, speed limit, seed ratio, seeding label tests |

## Out of Scope

- Per-task max-connection-per-server / split changes (can be added later)
- Per-task proxy changes
- File priority (high/normal/low) — aria2 doesn't support this via changeOption
- Batch option changes across multiple tasks
- File selection in NewTaskModal (M6b already handles pre-add selection)

## Testing Strategy

- **useDetailPoller:** Verify `getOption` called once on `selectedGid` change, result stored in `taskOptions`
- **useTaskOperations:** Verify `changeTaskOption` calls `changeOption` with correct params, handles errors
- **TaskDetailDrawer:**
  - File checkboxes render for BT multi-file tasks, not for single-file or HTTP
  - Select all / deselect all buttons call `changeOption` with correct indices
  - Individual checkbox toggle rebuilds index list correctly
  - Speed limit inputs read from `taskOptions`, blur triggers `changeOption`
  - Seed ratio input visible for BT tasks only
  - Seeding label shows 「停止做种」/「开始做种」 for completed BT tasks
