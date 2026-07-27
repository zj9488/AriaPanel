# M6a: BT Infrastructure — Design Spec

**Date:** 2026-07-27
**Status:** Approved (brainstorming complete)
**Phase:** M6a of 4 (M6a Infrastructure → M6b Add Torrent → M6c Peer Observability → M6d Operation Control)

## Goal

Establish the foundation for BitTorrent support in AriaPanel: expand type definitions to carry full BT metadata, add the `aria2.addTorrent` RPC method, wire 8 BT global settings into the Rust settings model and aria2 startup flags, and expose them in a new SettingsModal tab. M6a produces no user-visible BT UI beyond the settings tab — the file picker, peer list, and seeding controls arrive in M6b-d.

## Architecture

Three layers:

| Layer | Changes |
|-------|---------|
| **Rust** | `Settings` struct +8 BT fields; `Aria2Config` +`dht_file_path`; `build_global_args` +BT flags; `build_args` +`--dht-file-path`; new `read_torrent_base64` command; `Cargo.toml` +`base64` crate |
| **Frontend types** | `types.ts` expand `bittorrent` object + add `infoHash` / `numSeeders` / `seeder` |
| **Frontend RPC** | `rpc-client.ts` add `addTorrent` method |
| **Frontend settings** | `SettingsModal.vue` gains `NTabs`; new "BitTorrent" tab with 8 form fields; `AppSettings` interface expanded |

## Rust Changes

### 1. Settings Struct (`src-tauri/src/settings.rs`)

Add 8 fields to `Settings`, following the existing `#[serde(default)]` pattern:

```rust
#[serde(default = "default_bt_max_peers")]
pub bt_max_peers: u32,       // aria2: --bt-max-peers, default 55
#[serde(default = "default_seed_ratio")]
pub seed_ratio: f64,         // aria2: --seed-ratio, default 1.0 (0 = unlimited)
#[serde(default)]
pub seed_time: u64,          // aria2: --seed-time, default 0 = don't set flag (>0 = minutes)
#[serde(default = "default_true")]
pub enable_dht: bool,        // aria2: --enable-dht, default true
#[serde(default = "default_bt_listen_port")]
pub bt_listen_port: String,  // aria2: --listen-port, default "6881-6999"
#[serde(default = "default_bt_listen_port")]
pub dht_listen_port: String, // aria2: --dht-listen-port, default "6881-6999"
#[serde(default)]
pub bt_tracker: String,      // aria2: --bt-tracker, default "" (comma-separated URLs)
#[serde(default)]
pub bt_save_metadata: bool,  // aria2: --bt-save-metadata, default false
```

Default functions:

```rust
fn default_bt_max_peers() -> u32 { 55 }
fn default_seed_ratio() -> f64 { 1.0 }
fn default_bt_listen_port() -> String { "6881-6999".into() }
```

Update `Default for Settings` impl to include the 8 new fields with their defaults.

Update existing tests (`default_settings`, `serialize_deserialize_roundtrip`, `save_and_load_roundtrip`) to account for the new fields. The `..Settings::default()` spread in tests handles this automatically — only `default_settings` needs new assertions.

### 2. Aria2Config + new_config (`src-tauri/src/aria2.rs`)

Add `dht_file_path` to `Aria2Config`:

```rust
pub struct Aria2Config {
    pub port: u16,
    pub secret: String,
    pub dir: PathBuf,
    pub session: PathBuf,
    pub dht_file_path: PathBuf,
}
```

Update `new_config` signature:

```rust
pub fn new_config(dir: PathBuf, session: PathBuf, dht_file_path: PathBuf, settings: &Settings) -> Aria2Config
```

Update `build_args` — add `--dht-file-path`:

```rust
format!("--dht-file-path={}", cfg.dht_file_path.display()),
```

Place it after `--save-session` and before `--quiet`.

Update `build_global_args` — append BT flags after the proxy block:

```rust
args.push(format!("--bt-max-peers={}", s.bt_max_peers));
if s.seed_ratio > 0.0 {
    args.push(format!("--seed-ratio={}", s.seed_ratio));
}
if s.seed_time > 0 {
    args.push(format!("--seed-time={}", s.seed_time));
}
args.push(format!("--enable-dht={}", s.enable_dht));
args.push(format!("--listen-port={}", s.bt_listen_port));
args.push(format!("--dht-listen-port={}", s.dht_listen_port));
if !s.bt_tracker.is_empty() {
    args.push(format!("--bt-tracker={}", s.bt_tracker));
}
args.push(format!("--bt-save-metadata={}", s.bt_save_metadata));
```

**All BT settings trigger aria2 restart** (via `save_settings`), consistent with RPC settings. The `changeGlobalOption` path in SettingsModal's `save()` does not include BT options — they only take effect on restart. This is necessary because `--listen-port` and `--dht-listen-port` are startup-only flags.

### 3. new_config Call Sites

All 4 call sites must pass the additional `dht_file_path` argument:

| File | Context | Code |
|------|---------|------|
| `lib.rs` | startup `async_runtime::spawn` | `let dht = data_dir.join("dht.dat");` then `new_config(dir, session, dht, &settings)` |
| `commands.rs` | `save_settings` | `let dht = data_dir.join("dht.dat");` then `new_config(new_dir, session, dht, &settings)` |
| `commands.rs` | `start_crash_recovery` | `let dht = data_dir.join("dht.dat");` then `new_config(dir, session, dht, &settings)` |
| `commands.rs` | `restart_aria2` | `let dht = data_dir.join("dht.dat");` then `new_config(dir, session, dht, &settings)` |

In each case, `data_dir` is already available in scope (same variable used for `session`).

### 4. read_torrent_base64 Command (`src-tauri/src/commands.rs`)

```rust
#[tauri::command]
pub fn read_torrent_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
```

Register in `lib.rs` `invoke_handler`.

### 5. Cargo.toml

Add `base64` dependency:

```toml
base64 = "0.22"
```

### 6. Rust Tests

**`settings.rs` tests:**
- `default_settings`: assert `bt_max_peers == 55`, `seed_ratio == 1.0`, `enable_dht == true`, `bt_listen_port == "6881-6999"`, `bt_save_metadata == false`
- `serialize_deserialize_roundtrip`: already works via `..Settings::default()` spread
- `save_and_load_roundtrip`: already works via `..Settings::default()` spread

**`aria2.rs` tests:**
- `build_global_args_includes_bt_settings`: construct Settings with BT values, assert flags present
- `build_global_args_omits_zero_seed_time_and_ratio`: seed_time=0 and seed_ratio=0.0 should not produce `--seed-time` / `--seed-ratio` flags
- `build_global_args_omits_empty_bt_tracker`: empty bt_tracker should not produce `--bt-tracker` flag
- Update `cfg()` helper to include `dht_file_path: PathBuf::from("/s/dht.dat")`
- Update `build_args` tests to assert `--dht-file-path` present

**`commands.rs` tests:**
- `read_torrent_base64_reads_file`: write temp file, call function, assert base64 output matches
- `read_torrent_base64_missing_file_returns_err`: assert Err for nonexistent path

## Frontend Changes

### 7. Types Expansion (`src/lib/aria2/types.ts`)

Replace line 27:

```typescript
bittorrent?: {
  info: { name?: string }
  mode?: 'single' | 'multi'
  announceList?: string[][]
  comment?: string
  creationDate?: number
}
```

Add after `bittorrent` (before `errorCode`):

```typescript
infoHash?: string
numSeeders?: string
seeder?: string
```

**Note:** `numSeeders` and `seeder` are typed as `string` (not `number`/`boolean`) because aria2 returns all values as strings in its JSON-RPC response. This matches the existing pattern where `totalLength`, `completedLength`, etc. are all strings.

These fields are typed but not consumed in M6a UI. They exist so M6c (peer observability) can use them without modifying types again.

### 8. addTorrent RPC Method (`src/lib/aria2/rpc-client.ts`)

Add after `addUri` (line 92):

```typescript
addTorrent(torrentBase64: string, uris: string[] = [], options: Record<string, string> = {}) {
  return this.call<string>('aria2.addTorrent', [torrentBase64, uris, options])
}
```

Returns: GID string of the created download.

### 9. SettingsModal BT Tab (`src/components/SettingsModal.vue`)

#### AppSettings interface expansion

Add 8 fields to `AppSettings`:

```typescript
btMaxPeers: number
seedRatio: number
seedTime: number
enableDht: boolean
btListenPort: string
dhtListenPort: string
btTracker: string
btSaveMetadata: boolean
```

Add defaults to the `s` ref initialization:

```typescript
btMaxPeers: 55,
seedRatio: 1.0,
seedTime: 0,
enableDht: true,
btListenPort: '6881-6999',
dhtListenPort: '6881-6999',
btTracker: '',
btSaveMetadata: false,
```

#### Template restructure

Wrap existing sections in `NTabs`:

```html
<NTabs type="line">
  <NTabPane name="general" tab="常规">
    <!-- all existing sections moved here unchanged -->
  </NTabPane>
  <NTabPane name="bt" tab="BitTorrent">
    <!-- 8 BT form fields -->
  </NTabPane>
</NTabs>
```

#### BT tab form fields

| Label | Component | Binding | Notes |
|-------|-----------|---------|-------|
| 最大 Peer 数 | `NInputNumber` | `s.btMaxPeers` | min=0 |
| 做种比例 | `NInputNumber` | `s.seedRatio` | step=0.1, min=0, placeholder "0=不限制" |
| 做种时间 (分钟) | `NInputNumber` | `s.seedTime` | min=0, placeholder "0=不限制" |
| DHT | `NSwitch` | `s.enableDht` | — |
| BT 监听端口 | `NInput` | `s.btListenPort` | placeholder "6881-6999" |
| DHT 监听端口 | `NInput` | `s.dhtListenPort` | placeholder "6881-6999" |
| 额外 Tracker | `NInput type=textarea` | `s.btTracker` | placeholder "逗号分隔" |
| 保存种子文件 | `NSwitch` | `s.btSaveMetadata` | — |

Add `NSwitch`, `NTabs`, `NTabPane` to the naive-ui import.

#### Save behavior

BT settings go through `save_settings` (same as RPC settings). The existing restart logic in `save_settings` handles this automatically — all settings are written to disk and aria2 is restarted with new flags. The `changeGlobalOption` fallback path does NOT include BT options (they need restart due to listen-port flags).

### 10. Frontend Tests

**rpc-client test:** Add test for `addTorrent` — mock fetch, call `client.addTorrent(base64, [], { dir: '/dl' })`, assert JSON-RPC payload contains `aria2.addTorrent` with correct params.

**SettingsModal test:** Add test for BT tab — mount modal, switch to BT tab, assert all 8 field labels render, verify values appear from mocked `get_settings`.

## Out of Scope (Deferred to M6b-d)

- **M6b:** `.torrent` file picker UI in NewTaskModal (uses `read_torrent_base64` command + `addTorrent` RPC)
- **M6c:** Peer list, seeder/leecher counts, infoHash display in TaskDetailDrawer (uses expanded types)
- **M6d:** File selection (`select-file`), seeding start/stop, seed-ratio per-task override

## File Summary

### Modified files

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | +`base64 = "0.22"` |
| `src-tauri/src/settings.rs` | +8 BT fields, +3 default functions, Default impl update, test assertions |
| `src-tauri/src/aria2.rs` | `Aria2Config` +`dht_file_path`, `new_config` +param, `build_args` +`--dht-file-path`, `build_global_args` +BT flags, test cfg() update, +3 BT arg tests |
| `src-tauri/src/commands.rs` | +`read_torrent_base64` command, update 3 `new_config` call sites in save_settings/start_crash_recovery/restart_aria2 |
| `src-tauri/src/lib.rs` | Update `new_config` call site, register `read_torrent_base64` in invoke_handler |
| `src/lib/aria2/types.ts` | Expand `bittorrent` object, +`infoHash`/`numSeeders`/`seeder` |
| `src/lib/aria2/rpc-client.ts` | +`addTorrent` method |
| `src/components/SettingsModal.vue` | +`NTabs`/`NTabPane` wrap, +BT tab with 8 fields, +`AppSettings` fields |
| `src/components/SettingsModal.test.ts` | +BT tab rendering test |
| `src/lib/aria2/rpc-client.test.ts` | +`addTorrent` test (follows existing `fakeFetch` pattern) |
