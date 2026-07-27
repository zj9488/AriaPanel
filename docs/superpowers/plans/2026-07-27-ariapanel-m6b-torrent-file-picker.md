# M6b: Torrent File Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.torrent` file selection to NewTaskModal so users can pick one or more torrent files and submit them via the `addTorrent` RPC (built in M6a).

**Architecture:** Single-component change to `NewTaskModal.vue` — new `torrentFiles` state, a picker button calling the Tauri file dialog + `read_torrent_base64` command, a removable file tag list, `submit()` branching between `addTorrent` (files present) and the existing `addUri` loop. One type alignment in `rpc-client.ts` so `addTorrent` accepts the same options shape as `addUri`.

**Tech Stack:** Vue 3.5 `<script setup>`, TypeScript, Naive UI 2.44 (`NTag`), Vitest, `@tauri-apps/plugin-dialog`, `@tauri-apps/api/core`.

## Global Constraints

- **Windows + PowerShell**: No `&&` — use `;` or `if ($?) {}`
- **No comments** in code
- **No emojis** in code or commit messages
- **Semicolons**: false; **Quotes**: single; **Trailing comma**: all; **Width**: 120
- **pnpm** is the package manager. Test runner: `pnpm test -- --run`
- **Naive UI** components imported individually (no global registration)
- **Test providers**: wrap with `NConfigProvider > NMessageProvider > NDialogProvider`; NModal/NTag teleport to `document.body`
- `@` alias maps to `src/`

---

### Task 1: Torrent File Picker UI

**Files:**
- Modify: `src/components/NewTaskModal.vue`
- Modify: `src/components/NewTaskModal.test.ts`

**Interfaces:**
- Consumes: `open` from `@tauri-apps/plugin-dialog`; `invoke` from `@tauri-apps/api/core`; `read_torrent_base64` Tauri command (returns base64 string)
- Produces: `torrentFiles` ref (`{ name: string; base64: string }[]`), `pickTorrent()` / `removeTorrent(index)` functions; `detectedType` returns `'bt'` when files present; picker button `data-test="pick-torrent"`

- [ ] **Step 1: Add test mock infrastructure + first failing test**

In `src/components/NewTaskModal.test.ts`, add the `invoke` mock right after the existing dialog mock (line 10). Add imports for `open` and `invoke` after the existing `flushPromises` import (line 5):

```typescript
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
```

Add this mock after line 10 (`vi.mock('@tauri-apps/plugin-dialog', ...)`):

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
```

Add these 4 tests inside the `describe('NewTaskModal', ...)` block, before the closing `})`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pnpm test -- --run src/components/NewTaskModal.test.ts
```
Expected: FAIL — `button[data-test="pick-torrent"]` not found (4 new tests fail)

- [ ] **Step 3: Add imports to NewTaskModal.vue**

In `src/components/NewTaskModal.vue`, update the naive-ui import (line 2) to add `NTag`:

```typescript
import { NModal, NInput, NButton, NSelect, NInputNumber, NCollapse, NCollapseItem, NTag, useMessage } from 'naive-ui'
```

Add these imports after line 3 (`import { ref, computed, watch, inject, type Ref } from 'vue'`):

```typescript
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
```

- [ ] **Step 4: Add torrentFiles state**

After line 21 (`const submitting = ref(false)`), add:

```typescript
const torrentFiles = ref<{ name: string; base64: string }[]>([])
```

- [ ] **Step 5: Refine detectedType to check files first**

Replace the `detectedType` computed (lines 40-44) with:

```typescript
const detectedType = computed<'http' | 'bt' | 'mixed' | null>(() => {
  if (torrentFiles.value.length > 0) return 'bt'
  if (urlList.value.length === 0) return null
  const types = new Set(urlList.value.map((u) => (u.startsWith('magnet:') ? 'bt' : 'http')))
  return types.size === 1 ? ([...types][0] as 'http' | 'bt') : 'mixed'
})
```

- [ ] **Step 6: Add pickTorrent and removeTorrent functions**

After the `buildOptions` function (after line 104), add:

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

function removeTorrent(index: number) {
  torrentFiles.value.splice(index, 1)
}
```

- [ ] **Step 7: Add reset for torrentFiles on close**

In the `watch(() => props.show, ...)` reset block, after `proxy.value = ''` (line 86), add:

```typescript
      torrentFiles.value = []
```

(Place it inside the `if (!v) { ... }` block, alongside the other resets.)

- [ ] **Step 8: Add picker button and file list to template**

In the `<template>`, after the type-tag row closing `</div>` (line 153 — the div containing the NTag and link count), add before the `<NCollapse>`:

```html
      <div style="display: flex; align-items: center; gap: 8px">
        <NButton size="small" quaternary data-test="pick-torrent" @click="pickTorrent">选择种子文件</NButton>
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

- [ ] **Step 9: Run tests to verify they pass**

```powershell
pnpm test -- --run src/components/NewTaskModal.test.ts
```
Expected: 17 tests pass (13 existing + 4 new)

- [ ] **Step 10: Run type check and lint**

```powershell
pnpm vue-tsc --noEmit; if ($?) { pnpm lint }
```
Expected: 0 errors

- [ ] **Step 11: Commit**

```powershell
git add src/components/NewTaskModal.vue src/components/NewTaskModal.test.ts
git commit -m "feat(ui): torrent file picker in NewTaskModal"
```

---

### Task 2: Submit via addTorrent + Type Alignment

**Files:**
- Modify: `src/lib/aria2/rpc-client.ts`
- Modify: `src/components/NewTaskModal.vue`
- Modify: `src/components/NewTaskModal.test.ts`

**Interfaces:**
- Consumes: `torrentFiles` state + `buildOptions()` from Task 1; `addTorrent` on `Aria2Client`
- Produces: `submit()` branches to `addTorrent` loop when `torrentFiles` non-empty; `addTorrent` options param loosened to `Record<string, unknown>`

- [ ] **Step 1: Add mockAddTorrent to mock api and write failing submit tests**

In `src/components/NewTaskModal.test.ts`, add `mockAddTorrent` after line 12 (`const mockAddUri = ...`):

```typescript
const mockAddTorrent = vi.fn().mockResolvedValue('gid-torrent')
```

Update the `mockApi` object (lines 13-17) to include `addTorrent`:

```typescript
const mockApi = {
  client: { addUri: mockAddUri, addTorrent: mockAddTorrent },
  refresh: vi.fn(),
  dir: 'D:/downloads',
}
```

Add `mockAddTorrent.mockClear()` to `beforeEach` (after line 53 `mockAddUri.mockClear()`):

```typescript
    mockAddTorrent.mockClear()
```

Add these 2 tests inside the `describe` block, before the closing `})`:

```typescript
  it('submit with torrent files calls addTorrent not addUri', async () => {
    vi.mocked(open).mockResolvedValue(['D:/test.torrent'])
    vi.mocked(invoke).mockResolvedValue('base64data')
    mountModal()
    await new DOMWrapper(el('button[data-test="pick-torrent"]')).trigger('click')
    await flushPromises()
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddTorrent).toHaveBeenCalledTimes(1)
    expect(mockAddTorrent).toHaveBeenCalledWith(
      'base64data',
      [],
      expect.objectContaining({ dir: 'D:/downloads' }),
    )
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
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pnpm test -- --run src/components/NewTaskModal.test.ts
```
Expected: FAIL — `mockAddTorrent` not called (submit still uses addUri); 2 new tests fail

- [ ] **Step 3: Loosen addTorrent options type in rpc-client.ts**

In `src/lib/aria2/rpc-client.ts`, change the `addTorrent` method (line 94) options param type from `Record<string, string>` to `Record<string, unknown>`:

```typescript
  addTorrent(torrentBase64: string, uris: string[] = [], options: Record<string, unknown> = {}) {
    return this.call<string>('aria2.addTorrent', [torrentBase64, uris, options])
  }
```

- [ ] **Step 4: Add files-first branch to submit() in NewTaskModal.vue**

Replace the start of the `submit` function (lines 106-111). The current code starts:

```typescript
async function submit() {
  const list = urlList.value
  if (list.length === 0) {
    message.warning('请输入至少一个链接')
    return
  }
```

Replace with:

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
  const list = urlList.value
  if (list.length === 0) {
    message.warning('请输入至少一个链接')
    return
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```powershell
pnpm test -- --run src/components/NewTaskModal.test.ts
```
Expected: 19 tests pass (17 from Task 1 + 2 new)

- [ ] **Step 6: Run full test suite + type check + lint**

```powershell
pnpm test -- --run; if ($?) { pnpm vue-tsc --noEmit }; if ($?) { pnpm lint }
```
Expected: all tests pass, 0 type/lint errors

- [ ] **Step 7: Run full build**

```powershell
pnpm build
```
Expected: builds successfully

- [ ] **Step 8: Commit**

```powershell
git add src/lib/aria2/rpc-client.ts src/components/NewTaskModal.vue src/components/NewTaskModal.test.ts
git commit -m "feat(ui): submit torrent files via addTorrent RPC"
```

---

## Post-Implementation Verification

After both tasks are complete:

- [ ] **Final full check**

```powershell
pnpm lint; if ($?) { pnpm vue-tsc --noEmit }; if ($?) { pnpm test -- --run }; if ($?) { pnpm build }
```
Expected: all pass

- [ ] **Rust check (no Rust changes, but verify nothing broke)**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: 0 errors
