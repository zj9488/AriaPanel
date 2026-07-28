# Torrent File Preview Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When adding a single .torrent file via NewTaskModal, parse the torrent to display its file list with checkboxes before starting the download. Users can deselect files they don't want. The `select-file` option is passed to `addTorrent` so aria2 only downloads chosen files.

**Architecture:** New Rust command `parse_torrent_files(b64)` uses `serde_bencode` to decode the torrent's info dict, returning a normalized `{ name, files: [{ path, length }] }` struct. NewTaskModal calls this after picking a single torrent, stores parsed files with `selected: boolean`, renders a checkbox list between torrent tags and advanced settings, and builds `select-file: "1,3,5"` from checked indices on submit.

**Tech Stack:** Rust + serde_bencode 0.2, Vue 3.5 Composition API, TypeScript, Naive UI 2.44, Vitest + jsdom

**Design Spec:** `docs/superpowers/specs/2026-07-28-ariapanel-torrent-file-preview-design.md`

## Global Constraints

- No comments in code unless explicitly requested
- No emojis in code or commit messages
- Semicolons: false (Prettier)
- Quotes: single (Prettier)
- Trailing comma: all
- `@` alias maps to `src/`
- Naive UI components imported individually (no global registration)
- NModal teleports to `document.body` — tests use `document.body.textContent` or `document.body.querySelector`
- No `&&` in PowerShell — use `;` or `if ($?) {}`
- Tauri 2 parameter names: JS-side name must match Rust-side name exactly (no camelCase conversion)
- Rust cargo at `%USERPROFILE%\.cargo\bin` — prepend to PATH before cargo commands
- Kill aria2c before cargo check if locked: `Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force`
- Test gate: `pnpm test` + `pnpm vue-tsc --noEmit` + `pnpm lint` + `cargo test --manifest-path src-tauri\Cargo.toml`

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/Cargo.toml` | Modify | Add `serde_bencode = "0.2"` dependency |
| `src-tauri/src/commands.rs` | Modify | Add bencode structs + `parse_torrent_files` command + 4 Rust tests |
| `src-tauri/src/lib.rs` | Modify | Register `parse_torrent_files` in `invoke_handler` |
| `src/lib/format.ts` | Modify | Widen `fmtBytes` param to `string \| number` |
| `src/components/NewTaskModal.vue` | Modify | Add `ParsedFile` interface, parse call in `pickTorrent`, file list UI, `select-file` in submit |
| `src/components/NewTaskModal.test.ts` | Modify | Add 6 tests for file preview/selection |

---

## Task 1: Rust `parse_torrent_files` Command

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `parse_torrent_files(b64: String) -> Result<ParsedTorrent, String>`
- `ParsedTorrent` = `{ name: String, files: Vec<ParsedTorrentFile> }`
- `ParsedTorrentFile` = `{ path: String, length: u64 }`

- [ ] **Step 1: Add `serde_bencode` dependency**

In `src-tauri/Cargo.toml`, add after the `base64 = "0.22"` line (line 29):

```toml
serde_bencode = "0.2"
```

- [ ] **Step 2: Write failing Rust tests**

In `src-tauri/src/commands.rs`, add these tests inside the existing `#[cfg(test)] mod tests` block, after the last test (`encode_file_base64_missing_file_returns_err`, before the closing `}` of the `mod tests` block at line 290):

```rust
    #[test]
    fn parse_torrent_files_single_file() {
        let bencode = b"d4:infod6:lengthi100e4:name8:testfile12:piece lengthi16384e6:pieces20:AAAAAAAAAAAAAAAAAAAAee";
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bencode);
        let result = parse_torrent_files(b64);
        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.name, "testfile");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "testfile");
        assert_eq!(parsed.files[0].length, 100);
    }

    #[test]
    fn parse_torrent_files_multi_file() {
        let bencode = b"d4:infod5:filesld6:lengthi100e4:pathl5:file1eed6:lengthi200e4:pathl3:sub5:file2eee4:name4:test12:piece lengthi16384e6:pieces20:AAAAAAAAAAAAAAAAAAAAee";
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bencode);
        let result = parse_torrent_files(b64);
        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.name, "test");
        assert_eq!(parsed.files.len(), 2);
        assert_eq!(parsed.files[0].path, "file1");
        assert_eq!(parsed.files[0].length, 100);
        assert_eq!(parsed.files[1].path, "sub/file2");
        assert_eq!(parsed.files[1].length, 200);
    }

    #[test]
    fn parse_torrent_files_invalid_b64() {
        let result = parse_torrent_files("!!!not-base64!!!".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn parse_torrent_files_invalid_bencode() {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"not valid bencode");
        let result = parse_torrent_files(b64);
        assert!(result.is_err());
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run (PowerShell):
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml parse_torrent_files
```

Expected: FAIL — `parse_torrent_files` function does not exist.

- [ ] **Step 4: Implement structs and command**

In `src-tauri/src/commands.rs`, add the following after the `read_torrent_base64` function (after line 157, before `start_crash_recovery`):

```rust
#[derive(serde::Deserialize)]
struct TorrentInfo {
    name: String,
    #[serde(default)]
    files: Option<Vec<RawTorrentFile>>,
    #[serde(default)]
    length: Option<u64>,
}

#[derive(serde::Deserialize)]
struct RawTorrentFile {
    path: Vec<String>,
    length: u64,
}

#[derive(serde::Deserialize)]
struct Torrent {
    info: TorrentInfo,
}

#[derive(serde::Serialize)]
pub struct ParsedTorrentFile {
    pub path: String,
    pub length: u64,
}

#[derive(serde::Serialize)]
pub struct ParsedTorrent {
    pub name: String,
    pub files: Vec<ParsedTorrentFile>,
}

#[tauri::command]
pub fn parse_torrent_files(b64: String) -> Result<ParsedTorrent, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| e.to_string())?;
    let torrent: Torrent = serde_bencode::from_bytes(&bytes)
        .map_err(|e| format!("bencode: {e}"))?;
    let files = if let Some(raw_files) = torrent.info.files {
        raw_files
            .into_iter()
            .map(|f| ParsedTorrentFile {
                path: f.path.join("/"),
                length: f.length,
            })
            .collect()
    } else if let Some(length) = torrent.info.length {
        vec![ParsedTorrentFile {
            path: torrent.info.name.clone(),
            length,
        }]
    } else {
        return Err("missing file info".into());
    };
    Ok(ParsedTorrent {
        name: torrent.info.name,
        files,
    })
}
```

- [ ] **Step 5: Register command in lib.rs**

In `src-tauri/src/lib.rs`, add `commands::parse_torrent_files,` to the `invoke_handler` macro, after `commands::read_torrent_base64,` (line 155). The block becomes:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_rpc_endpoint,
            commands::get_settings,
            commands::save_settings,
            commands::open_folder,
            commands::get_aria2_logs,
            commands::get_restarts_count,
            commands::restart_aria2,
            commands::read_torrent_base64,
            commands::parse_torrent_files,
        ])
```

- [ ] **Step 6: Run Rust tests to verify they pass**

Run (PowerShell):
```powershell
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: PASS — all tests pass (22 existing + 4 new = 26 tests).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): parse_torrent_files command with serde_bencode"
```

---

## Task 2: NewTaskModal File Preview UI

**Files:**
- Modify: `src/lib/format.ts`
- Modify: `src/components/NewTaskModal.vue`
- Modify: `src/components/NewTaskModal.test.ts`

**Interfaces:**
- Consumes: `parse_torrent_files` command from Task 1
- Produces: file list UI with checkboxes in NewTaskModal when single multi-file torrent is picked

- [ ] **Step 1: Write failing tests**

Add these tests to `src/components/NewTaskModal.test.ts`, inside the `describe` block, after the last existing test (before the closing `})` at line 267):

```typescript
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
    const checkboxes = document.body.querySelectorAll(
      '[data-test="file-checkbox"] input[type="checkbox"]',
    )
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false)
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
    const checkboxes = document.body.querySelectorAll(
      '[data-test="file-checkbox"] input[type="checkbox"]',
    )
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true)
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
    const inputs = document.body.querySelectorAll(
      '[data-test="file-checkbox"] input[type="checkbox"]',
    )
    expect((inputs[0] as HTMLInputElement).checked).toBe(false)
    expect((inputs[1] as HTMLInputElement).checked).toBe(true)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/components/NewTaskModal.test.ts`

Expected: FAIL — new tests fail because `parse_torrent_files` is not called in `pickTorrent`, no file list UI rendered, no `select-file` in submit.

- [ ] **Step 3: Widen `fmtBytes` param type**

In `src/lib/format.ts`, change line 14 from:

```typescript
export function fmtBytes(s: string): string {
```

to:

```typescript
export function fmtBytes(s: string | number): string {
```

- [ ] **Step 4: Implement NewTaskModal script changes**

In `src/components/NewTaskModal.vue`, make these changes:

**4a. Add imports (line 2):** Add `NCheckbox` to the naive-ui import and add `fmtBytes` import:

Change line 2 from:

```typescript
import { NModal, NInput, NButton, NSelect, NInputNumber, NCollapse, NCollapseItem, NTag, useMessage } from 'naive-ui'
```

to:

```typescript
import { NModal, NInput, NButton, NSelect, NInputNumber, NCheckbox, NCollapse, NCollapseItem, NTag, useMessage } from 'naive-ui'
```

After line 8 (`import type { Aria2Api } from '@/composables/useAria2'`), add:

```typescript
import { fmtBytes } from '@/lib/format'
```

**4b. Add interfaces (after line 8, before `const props`):**

```typescript
interface ParsedFile {
  path: string
  length: number
  selected: boolean
}

interface TorrentEntry {
  name: string
  base64: string
  parsedFiles?: ParsedFile[]
}
```

**4c. Update torrentFiles ref type (line 24):** Change from:

```typescript
const torrentFiles = ref<{ name: string; base64: string }[]>([])
```

to:

```typescript
const torrentFiles = ref<TorrentEntry[]>([])
```

**4d. Update pickTorrent (lines 111-126):** Replace the entire `pickTorrent` function with:

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
  if (torrentFiles.value.length === 1) {
    try {
      const parsed = await invoke<{ name: string; files: { path: string; length: number }[] }>(
        'parse_torrent_files',
        { b64: torrentFiles.value[0].base64 },
      )
      if (parsed.files.length > 1) {
        torrentFiles.value[0].parsedFiles = parsed.files.map((f) => ({
          path: f.path,
          length: f.length,
          selected: true,
        }))
      }
    } catch {
      // parsing failed, skip file selection
    }
  }
}
```

**4e. Add file selection helper functions (after `removeTorrent`, before `submit`):**

```typescript
function toggleParsedFile(index: number) {
  const files = torrentFiles.value[0]?.parsedFiles
  if (!files) return
  files[index].selected = !files[index].selected
}

function selectAllParsedFiles() {
  torrentFiles.value[0]?.parsedFiles?.forEach((f) => (f.selected = true))
}

function deselectAllParsedFiles() {
  torrentFiles.value[0]?.parsedFiles?.forEach((f) => (f.selected = false))
}
```

**4f. Update submit torrent loop (lines 140-142):** Replace the `for (const f of torrentFiles.value)` body. Change from:

```typescript
    for (const f of torrentFiles.value) {
      try {
        await c.addTorrent(f.base64, [], options)
        success++
```

to:

```typescript
    for (const f of torrentFiles.value) {
      try {
        const opts = { ...options }
        if (f.parsedFiles) {
          const selected = f.parsedFiles
            .map((file, i) => (file.selected ? i + 1 : -1))
            .filter((i) => i > 0)
          if (selected.length > 0) {
            opts['select-file'] = selected.join(',')
          }
        }
        await c.addTorrent(f.base64, [], opts)
        success++
```

- [ ] **Step 5: Implement NewTaskModal template changes**

In the `<template>` section, add the file list block between the torrent tags div (line 218) and the NCollapse (line 220). After the closing `</div>` of the torrent tags block, insert:

```html
      <div
        v-if="torrentFiles.length === 1 && torrentFiles[0].parsedFiles && torrentFiles[0].parsedFiles.length > 1"
        data-test="file-list"
        style="border: 1px solid var(--n-border-color, #eee); border-radius: 4px; padding: 8px"
      >
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
          <span style="font-size: 13px; font-weight: 500">文件列表</span>
          <div style="display: flex; gap: 4px">
            <NButton size="tiny" data-test="select-all-files" @click="selectAllParsedFiles">全选</NButton>
            <NButton size="tiny" data-test="deselect-all-files" @click="deselectAllParsedFiles">全不选</NButton>
          </div>
        </div>
        <div style="max-height: 240px; overflow-y: auto">
          <div
            v-for="(f, i) in torrentFiles[0].parsedFiles"
            :key="i"
            style="display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 2px 0"
          >
            <NCheckbox
              :checked="f.selected"
              data-test="file-checkbox"
              @update:checked="toggleParsedFile(i)"
            />
            <span style="flex: 1; word-break: break-all">{{ f.path }}</span>
            <span style="opacity: 0.6; flex-shrink: 0">{{ fmtBytes(f.length) }}</span>
          </div>
        </div>
      </div>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/NewTaskModal.test.ts`

Expected: PASS — all tests pass (20 existing + 6 new = 26 tests in this file).

- [ ] **Step 7: Run full test suite + type check + lint**

Run: `pnpm test -- --run`

Expected: All tests pass (111 existing + 6 new = 117 tests).

Run: `pnpm vue-tsc --noEmit`

Expected: No errors.

Run: `pnpm lint`

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/format.ts src/components/NewTaskModal.vue src/components/NewTaskModal.test.ts
git commit -m "feat(ui): torrent file preview selection in NewTaskModal"
```
