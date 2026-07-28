# Torrent File Preview Selection — Design Spec

**Date:** 2026-07-28
**Status:** Approved (brainstorming complete)

## Goal

When adding a single .torrent file via NewTaskModal, parse the torrent to display its file list with checkboxes before starting the download. Users can deselect files they don't want. The `select-file` option is passed to `addTorrent` so aria2 only downloads chosen files.

## Scope

- **Applies to:** single .torrent file selection only
- **Does NOT apply to:** magnet links (metadata fetched from peers, not available pre-add), multiple torrent batch add (no per-file selection)

## Architecture

### Rust: `parse_torrent_files` command

New Tauri command in `src-tauri/src/commands.rs`. Takes the already-read base64 string, decodes it, parses bencode, and returns normalized file info.

**Crate:** `serde_bencode = "0.2"` added to `Cargo.toml`

**Bencode structs (deserialize from raw torrent):**

```rust
#[derive(serde::Deserialize)]
struct TorrentInfo {
    name: String,
    files: Option<Vec<RawTorrentFile>>,
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
```

**Return types (serialized to JS):**

```rust
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
```

**Command:**

```rust
#[tauri::command]
pub fn parse_torrent_files(b64: String) -> Result<ParsedTorrent, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| e.to_string())?;
    let torrent: Torrent = serde_bencode::from_bytes(&bytes)
        .map_err(|e| format!("bencode: {e}"))?;
    let files = if let Some(raw_files) = torrent.info.files {
        raw_files.into_iter().map(|f| ParsedTorrentFile {
            path: f.path.join("/"),
            length: f.length,
        }).collect()
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

Register in `src-tauri/src/lib.rs` `invoke_handler` alongside `read_torrent_base64`.

### Rust Tests

In `commands.rs` test module:

1. **`parse_torrent_files_single_file`** — bencode with `info.name` + `info.length`, assert returns one file with matching name and length
2. **`parse_torrent_files_multi_file`** — bencode with `info.name` + `info.files` (2 files), assert returns 2 files with joined paths
3. **`parse_torrent_files_invalid_b64`** — invalid base64 string, assert error
4. **`parse_torrent_files_invalid_bencode`** — valid base64 but invalid bencode, assert error

Test bencode payloads constructed as raw byte literals.

### Frontend: NewTaskModal changes

**Data flow:**

```
pickTorrent() picks single .torrent
  → read_torrent_base64(path)      → b64 string
  → parse_torrent_files(b64)       → ParsedTorrent { name, files }
  → store files with selected=true on torrentFiles[0]
  → file list renders inline
```

**Data structure:**

```typescript
interface ParsedFile {
  path: string
  length: number
  selected: boolean
}
```

Extend `torrentFiles` item type to include optional `parsedFiles?: ParsedFile[]`.

**pickTorrent changes:**

After reading base64, if only one torrent was selected (resulting `torrentFiles.length === 1`), call `parse_torrent_files`. On success with `files.length > 1`, store `parsedFiles` with `selected: true` on each. On failure, log warning and continue (no file selection shown).

**UI — file list section:**

Appears between torrent tags and advanced settings, only when `torrentFiles.length === 1` and `torrentFiles[0].parsedFiles` exists and has more than 1 file:

```
种子标签区域
┌──────────────────────────────────────┐
│ 文件列表           [全选] [全不选]     │
│ ☑ ubuntu-22.04.iso       2.4 GB     │
│ ☑ docs/readme.txt         12 KB     │
│ ☑ docs/guide.pdf          1.2 MB    │
│ ☐ source/src.zip          500 MB    │
└──────────────────────────────────────┘
高级设置 (collapse)
```

- Max height 240px, overflow-y auto
- Each row: `NCheckbox` + file name (left) + `fmtBytes(length)` (right)
- 全选/全不选 `NButton size="tiny"` in header row
- All files checked by default

**Submit changes:**

When `torrentFiles.length === 1` and `parsedFiles` exists:
- Build `select-file` from checked file indices (1-based, comma-separated)
- Include in `addTorrent` options: `{ 'select-file': '1,3', dir, ... }`

When multiple torrents or no parsedFiles: existing behavior (no `select-file`).

### Frontend Tests

`NewTaskModal.test.ts` additions:
1. Single multi-file torrent shows file list with checkboxes
2. Single single-file torrent does NOT show file list
3. 全选 button selects all files
4. 全不选 button deselects all files
5. Toggling individual checkbox updates selection
6. Submit includes `select-file` with correct indices

`rpc-client.test.ts` addition:
7. `addTorrent` with `select-file` option passes it correctly (already tested in M6a, verify if needed)

## Modified Files

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | +`serde_bencode = "0.2"` |
| `src-tauri/src/commands.rs` | +bencode structs, +`parse_torrent_files` command, +4 Rust tests |
| `src-tauri/src/lib.rs` | Register `parse_torrent_files` in `invoke_handler` |
| `src/components/NewTaskModal.vue` | +`ParsedFile` interface, +parse call in `pickTorrent`, +file list UI, +`select-file` in submit |
| `src/components/NewTaskModal.test.ts` | +6 tests for file preview/selection |

## Out of Scope

- Magnet link file preview (requires metadata from peers)
- Multiple torrent per-file selection
- File priority (high/normal/low)
- Search/filter within file list
- Torrent info display (announce list, creation date, etc.)
