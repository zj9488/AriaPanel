# AriaPanel M6a: BT Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire BT infrastructure into AriaPanel — expand Rust settings with 8 BT fields, inject aria2 startup flags, add `read_torrent_base64` command, expand frontend types, add `addTorrent` RPC, and create a BT settings tab in SettingsModal.

**Architecture:** Settings struct gains BT fields with serde defaults → `build_global_args` emits `--bt-*`/`--dht-*`/`--listen-port` flags → `Aria2Config` gains `dht_file_path` for DHT routing table persistence → frontend types carry full BT metadata → rpc-client gains `addTorrent` → SettingsModal uses NTabs with a BT tab.

**Tech Stack:** Rust (Tauri 2, serde, base64 crate), TypeScript, Vue 3.5, Naive UI 2.44, Vitest

## Global Constraints

- **Windows + PowerShell**: No `&&` in commands — use `;` or `if ($?) {}`
- **Rust cargo** at `%USERPROFILE%\.cargo\bin` — prepend: `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`
- **Kill aria2c before cargo check**: `Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force`
- **pnpm** is the package manager (not npm/yarn)
- **No comments** in code unless explicitly requested
- **No emojis** in code or commit messages
- **Semicolons**: false; **Quotes**: single; **Trailing comma**: all; **Width**: 120
- **`@` alias** maps to `src/` in imports
- **Naive UI** components imported individually (no global registration)
- **Test providers**: Components using `useMessage`/`useDialog` must be wrapped with `NConfigProvider > NMessageProvider > NDialogProvider` in tests
- **NModal/NDrawer** teleport to `document.body` — tests must use `document.body.textContent`

---

## File Structure

### Modified files

| File | Responsibility |
|------|---------------|
| `src-tauri/Cargo.toml` | +`base64 = "0.22"` dependency |
| `src-tauri/src/settings.rs` | +8 BT fields, +3 default functions, Default impl, test assertions |
| `src-tauri/src/aria2.rs` | `Aria2Config` +`dht_file_path`, `new_config` +param, `build_args` +`--dht-file-path`, `build_global_args` +BT flags, tests |
| `src-tauri/src/commands.rs` | +`read_torrent_base64` command, update 3 `new_config` call sites |
| `src-tauri/src/lib.rs` | Update `new_config` call site, register `read_torrent_base64` |
| `src/lib/aria2/types.ts` | Expand `bittorrent` object, +`infoHash`/`numSeeders`/`seeder` |
| `src/lib/aria2/rpc-client.ts` | +`addTorrent` method |
| `src/lib/aria2/rpc-client.test.ts` | +`addTorrent` test |
| `src/components/SettingsModal.vue` | +`NTabs`/`NTabPane`, +BT tab with 8 fields, +`AppSettings` fields |
| `src/components/SettingsModal.test.ts` | +BT tab rendering test |

---

## Task 1: Rust Settings BT Fields

**Files:**
- Modify: `src-tauri/src/settings.rs`

**Interfaces:**
- Produces: `Settings` struct with 8 new fields: `bt_max_peers: u32`, `seed_ratio: f64`, `seed_time: u64`, `enable_dht: bool`, `bt_listen_port: String`, `dht_listen_port: String`, `bt_tracker: String`, `bt_save_metadata: bool`

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/settings.rs`, update the `default_settings` test (inside `#[cfg(test)] mod tests`) to add BT assertions after the existing assertions:

```rust
    #[test]
    fn default_settings() {
        let s = Settings::default();
        assert_eq!(s.max_concurrent_downloads, 5);
        assert_eq!(s.split, 5);
        assert_eq!(s.min_split_size, "20M");
        assert!(s.clipboard_watch);
        assert_eq!(s.all_proxy, "");
        assert_eq!(s.bt_max_peers, 55);
        assert_eq!(s.seed_ratio, 1.0);
        assert_eq!(s.seed_time, 0);
        assert!(s.enable_dht);
        assert_eq!(s.bt_listen_port, "6881-6999");
        assert_eq!(s.dht_listen_port, "6881-6999");
        assert_eq!(s.bt_tracker, "");
        assert!(!s.bt_save_metadata);
    }
```

Also update the `serialize_deserialize_roundtrip` test to set non-default BT values:

```rust
    #[test]
    fn serialize_deserialize_roundtrip() {
        let s = Settings {
            port: Some(6800),
            secret: Some("abc".into()),
            dir: "/dl".into(),
            bt_max_peers: 100,
            seed_ratio: 1.5,
            bt_tracker: "http://t.example.com".into(),
            bt_save_metadata: true,
            ..Settings::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }
```

- [ ] **Step 2: Run tests to verify they fail (compilation error)**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo test --manifest-path src-tauri\Cargo.toml -- settings
```
Expected: COMPILATION ERROR — `no field `bt_max_peers` on type `Settings``

- [ ] **Step 3: Add BT fields to Settings struct**

In the `Settings` struct definition, add these 8 fields after `clipboard_watch`:

```rust
    #[serde(default = "default_bt_max_peers")]
    pub bt_max_peers: u32,
    #[serde(default = "default_seed_ratio")]
    pub seed_ratio: f64,
    #[serde(default)]
    pub seed_time: u64,
    #[serde(default = "default_true")]
    pub enable_dht: bool,
    #[serde(default = "default_bt_listen_port")]
    pub bt_listen_port: String,
    #[serde(default = "default_bt_listen_port")]
    pub dht_listen_port: String,
    #[serde(default)]
    pub bt_tracker: String,
    #[serde(default)]
    pub bt_save_metadata: bool,
```

Add default functions after the existing `default_true` function:

```rust
fn default_bt_max_peers() -> u32 { 55 }
fn default_seed_ratio() -> f64 { 1.0 }
fn default_bt_listen_port() -> String { "6881-6999".into() }
```

Update the `Default for Settings` impl to include the 8 new fields:

```rust
impl Default for Settings {
    fn default() -> Self {
        Self {
            port: None,
            secret: None,
            dir: String::new(),
            max_concurrent_downloads: 5,
            max_connection_per_server: 5,
            min_split_size: "20M".into(),
            split: 5,
            max_overall_download_limit: "0".into(),
            max_overall_upload_limit: "0".into(),
            all_proxy: String::new(),
            clipboard_watch: true,
            bt_max_peers: 55,
            seed_ratio: 1.0,
            seed_time: 0,
            enable_dht: true,
            bt_listen_port: "6881-6999".into(),
            dht_listen_port: "6881-6999".into(),
            bt_tracker: String::new(),
            bt_save_metadata: false,
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cargo test --manifest-path src-tauri\Cargo.toml -- settings
```
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/settings.rs
git commit -m "feat(rust): add 8 BT fields to Settings struct"
```

---

## Task 2: Aria2Config + BT Startup Flags + Call Sites

**Files:**
- Modify: `src-tauri/src/aria2.rs`
- Modify: `src-tauri/src/commands.rs` (3 `new_config` call sites)
- Modify: `src-tauri/src/lib.rs` (1 `new_config` call site)

**Interfaces:**
- Consumes: `Settings.bt_*` fields from Task 1
- Produces: `Aria2Config` with `dht_file_path: PathBuf` field. `new_config` signature: `(dir, session, dht_file_path, settings) -> Aria2Config`. `build_args` emits `--dht-file-path`. `build_global_args` emits `--bt-max-peers`, `--seed-ratio`, `--seed-time`, `--enable-dht`, `--listen-port`, `--dht-listen-port`, `--bt-tracker`, `--bt-save-metadata`.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/aria2.rs`, inside `#[cfg(test)] mod tests`, add 3 new tests after the existing `build_global_args_omits_empty_proxy` test:

```rust
    #[test]
    fn build_global_args_includes_bt_settings() {
        use crate::settings::Settings;
        let s = Settings {
            bt_max_peers: 100,
            seed_ratio: 1.5,
            seed_time: 60,
            enable_dht: true,
            bt_listen_port: "6881-6999".into(),
            dht_listen_port: "7000-7999".into(),
            bt_tracker: "http://t.example.com".into(),
            bt_save_metadata: true,
            ..Settings::default()
        };
        let a = build_global_args(&s);
        assert!(a.contains(&"--bt-max-peers=100".to_string()));
        assert!(a.contains(&"--seed-ratio=1.5".to_string()));
        assert!(a.contains(&"--seed-time=60".to_string()));
        assert!(a.contains(&"--enable-dht=true".to_string()));
        assert!(a.contains(&"--listen-port=6881-6999".to_string()));
        assert!(a.contains(&"--dht-listen-port=7000-7999".to_string()));
        assert!(a.contains(&"--bt-tracker=http://t.example.com".to_string()));
        assert!(a.contains(&"--bt-save-metadata=true".to_string()));
    }

    #[test]
    fn build_global_args_omits_zero_seed_time_and_ratio() {
        use crate::settings::Settings;
        let s = Settings {
            seed_ratio: 0.0,
            seed_time: 0,
            ..Settings::default()
        };
        let a = build_global_args(&s);
        assert!(!a.iter().any(|x| x.starts_with("--seed-ratio")));
        assert!(!a.iter().any(|x| x.starts_with("--seed-time")));
    }

    #[test]
    fn build_global_args_omits_empty_bt_tracker() {
        use crate::settings::Settings;
        let s = Settings::default();
        let a = build_global_args(&s);
        assert!(!a.iter().any(|x| x.starts_with("--bt-tracker")));
    }
```

Also update the test `cfg()` helper to include `dht_file_path`:

```rust
    fn cfg() -> Aria2Config {
        Aria2Config {
            port: 50000,
            secret: "abc".into(),
            dir: PathBuf::from("/dl"),
            session: PathBuf::from("/s/session.gz"),
            dht_file_path: PathBuf::from("/s/dht.dat"),
        }
    }
```

- [ ] **Step 2: Run tests to verify they fail (compilation error)**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo test --manifest-path src-tauri\Cargo.toml -- build_global_args
```
Expected: COMPILATION ERROR — `no field `dht_file_path` on type `Aria2Config``

- [ ] **Step 3: Add `dht_file_path` to Aria2Config and update `new_config`**

In `src-tauri/src/aria2.rs`, add `dht_file_path` to the struct:

```rust
pub struct Aria2Config {
    pub port: u16,
    pub secret: String,
    pub dir: PathBuf,
    pub session: PathBuf,
    pub dht_file_path: PathBuf,
}
```

Update `new_config` to accept and set `dht_file_path`:

```rust
pub fn new_config(
    dir: PathBuf,
    session: PathBuf,
    dht_file_path: PathBuf,
    settings: &Settings,
) -> Aria2Config {
    Aria2Config {
        port: settings.port.unwrap_or_else(pick_free_port),
        secret: settings.secret.clone().unwrap_or_else(generate_secret),
        dir,
        session,
        dht_file_path,
    }
}
```

- [ ] **Step 4: Add `--dht-file-path` to `build_args`**

In `build_args`, add the `--dht-file-path` flag after the `--save-session` line and before `--quiet`:

```rust
pub fn build_args(cfg: &Aria2Config) -> Vec<String> {
    vec![
        "--enable-rpc".into(),
        "--rpc-listen-all=false".into(),
        "--rpc-allow-origin-all=true".into(),
        format!("--rpc-listen-port={}", cfg.port),
        format!("--rpc-secret={}", cfg.secret),
        format!("--dir={}", cfg.dir.display()),
        "--continue=true".into(),
        "--file-allocation=none".into(),
        "--auto-file-renaming=false".into(),
        "--allow-overwrite=true".into(),
        format!("--input-file={}", cfg.session.display()),
        format!("--save-session={}", cfg.session.display()),
        format!("--dht-file-path={}", cfg.dht_file_path.display()),
        "--quiet=true".into(),
    ]
}
```

- [ ] **Step 5: Add BT flags to `build_global_args`**

In `build_global_args`, append BT flags after the proxy block (after the closing `}` of `if !s.all_proxy.is_empty()`):

```rust
pub fn build_global_args(s: &Settings) -> Vec<String> {
    let mut args = vec![
        format!("--max-concurrent-downloads={}", s.max_concurrent_downloads),
        format!("--max-connection-per-server={}", s.max_connection_per_server),
        format!("--min-split-size={}", s.min_split_size),
        format!("--split={}", s.split),
        format!("--max-overall-download-limit={}", s.max_overall_download_limit),
        format!("--max-overall-upload-limit={}", s.max_overall_upload_limit),
    ];
    if !s.all_proxy.is_empty() {
        args.push(format!("--all-proxy={}", s.all_proxy));
    }
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
    args
}
```

- [ ] **Step 6: Update all 4 `new_config` call sites**

In `src-tauri/src/lib.rs`, find the call at approximately line 113:

```rust
                let cfg = new_config(dir, session, &settings);
```

Replace with:

```rust
                let dht_file_path = data_dir.join("dht.dat");
                let cfg = new_config(dir, session, dht_file_path, &settings);
```

In `src-tauri/src/commands.rs`, find 3 call sites.

Call site 1 — in `save_settings` (approximately line 71):

```rust
    let cfg = crate::aria2::new_config(dir, session, &settings);
```

Replace with:

```rust
    let dht_file_path = data_dir.join("dht.dat");
    let cfg = crate::aria2::new_config(dir, session, dht_file_path, &settings);
```

Call site 2 — in `start_crash_recovery` (approximately line 179):

```rust
        let cfg = crate::aria2::new_config(dir, session, &settings);
```

Replace with:

```rust
        let dht_file_path = data_dir.join("dht.dat");
        let cfg = crate::aria2::new_config(dir, session, dht_file_path, &settings);
```

Call site 3 — in `restart_aria2` (approximately line 239):

```rust
    let cfg = crate::aria2::new_config(dir, session, &settings);
```

Replace with:

```rust
    let dht_file_path = data_dir.join("dht.dat");
    let cfg = crate::aria2::new_config(dir, session, dht_file_path, &settings);
```

- [ ] **Step 7: Run cargo check**

```powershell
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: 0 errors

- [ ] **Step 8: Run cargo test**

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: all tests pass (including 3 new BT args tests + updated cfg() helper)

- [ ] **Step 9: Commit**

```powershell
git add src-tauri/src/aria2.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add dht_file_path to Aria2Config, wire BT startup flags"
```

---

## Task 3: read_torrent_base64 Command

**Files:**
- Modify: `src-tauri/Cargo.toml` (add base64 dependency)
- Modify: `src-tauri/src/commands.rs` (add command)
- Modify: `src-tauri/src/lib.rs` (register command)

**Interfaces:**
- Produces: `read_torrent_base64(path: String) -> Result<String, String>` Tauri command. Returns base64-encoded file contents. Registered in invoke_handler.

- [ ] **Step 1: Add base64 dependency to Cargo.toml**

In `src-tauri/Cargo.toml`, add after the `tauri-plugin-clipboard-manager` line in `[dependencies]`:

```toml
base64 = "0.22"
```

- [ ] **Step 2: Write the failing test**

In `src-tauri/src/commands.rs`, add a test module at the end of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_file_base64_reads_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("ap_test.torrent");
        std::fs::write(&path, b"d6:lengthi100e4:name8:testfile12:piece lengthi16384e6:pieces20:").unwrap();
        let result = encode_file_base64(path.to_str().unwrap());
        assert!(result.is_ok());
        let b64 = result.unwrap();
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD.decode(&b64).unwrap();
        assert_eq!(decoded, b"d6:lengthi100e4:name8:testfile12:piece lengthi16384e6:pieces20:");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn encode_file_base64_missing_file_returns_err() {
        let result = encode_file_base64("/nonexistent/path/file.torrent");
        assert!(result.is_err());
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo test --manifest-path src-tauri\Cargo.toml -- commands::tests
```
Expected: COMPILATION ERROR — `cannot find function `encode_file_base64``

- [ ] **Step 4: Implement `encode_file_base64` helper and `read_torrent_base64` command**

In `src-tauri/src/commands.rs`, add these two functions before the `start_crash_recovery` function:

```rust
pub fn encode_file_base64(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn read_torrent_base64(path: String) -> Result<String, String> {
    encode_file_base64(&path)
}
```

The `encode_file_base64` helper is testable directly. The `#[tauri::command]` wrapper delegates to it.

- [ ] **Step 5: Register command in lib.rs**

In `src-tauri/src/lib.rs`, add `commands::read_torrent_base64,` to the `invoke_handler` macro:

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
        ])
```

- [ ] **Step 6: Run tests to verify they pass**

```powershell
cargo test --manifest-path src-tauri\Cargo.toml -- commands::tests
```
Expected: 2 tests pass

- [ ] **Step 7: Run full cargo check**

```powershell
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: 0 errors

- [ ] **Step 8: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add read_torrent_base64 command"
```

---

## Task 4: Frontend Types + addTorrent RPC

**Files:**
- Modify: `src/lib/aria2/types.ts`
- Modify: `src/lib/aria2/rpc-client.ts`
- Modify: `src/lib/aria2/rpc-client.test.ts`

**Interfaces:**
- Produces: Expanded `Aria2Task.bittorrent` type with `mode`, `announceList`, `comment`, `creationDate`. New fields `infoHash`, `numSeeders`, `seeder` on `Aria2Task`. New `addTorrent(torrentBase64, uris?, options?)` method on `Aria2Client`.

- [ ] **Step 1: Write the failing test for addTorrent**

In `src/lib/aria2/rpc-client.test.ts`, add this test before the closing `})` of the `describe` block:

```typescript
  it('addTorrent sends base64 and options', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'gid-new' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.addTorrent('dGVzdA==', [], { dir: '/dl' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.addTorrent')
    expect(body.params).toEqual(['token:S', 'dGVzdA==', [], { dir: '/dl' }])
  })
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- --run src/lib/aria2/rpc-client.test.ts
```
Expected: FAIL — `c.addTorrent is not a function`

- [ ] **Step 3: Expand BT types in types.ts**

In `src/lib/aria2/types.ts`, replace the `bittorrent` field on line 27:

```typescript
  bittorrent?: {
    info: { name?: string }
    mode?: 'single' | 'multi'
    announceList?: string[][]
    comment?: string
    creationDate?: number
  }
```

Add after the `bittorrent` field (before `errorCode`):

```typescript
  infoHash?: string
  numSeeders?: string
  seeder?: string
```

- [ ] **Step 4: Add addTorrent method to rpc-client.ts**

In `src/lib/aria2/rpc-client.ts`, add after the `addUri` method (after line 92):

```typescript
  addTorrent(torrentBase64: string, uris: string[] = [], options: Record<string, string> = {}) {
    return this.call<string>('aria2.addTorrent', [torrentBase64, uris, options])
  }
```

- [ ] **Step 5: Run test to verify it passes**

```powershell
pnpm test -- --run src/lib/aria2/rpc-client.test.ts
```
Expected: all tests pass (10 tests)

- [ ] **Step 6: Run type check**

```powershell
pnpm vue-tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```powershell
git add src/lib/aria2/types.ts src/lib/aria2/rpc-client.ts src/lib/aria2/rpc-client.test.ts
git commit -m "feat(types): expand BT types, add addTorrent RPC method"
```

---

## Task 5: SettingsModal BT Tab

**Files:**
- Modify: `src/components/SettingsModal.vue`
- Modify: `src/components/SettingsModal.test.ts`

**Interfaces:**
- Consumes: `Settings` BT fields from Task 1 (via `get_settings` / `save_settings`)
- Produces: SettingsModal with NTabs — "常规" tab (existing sections) + "BitTorrent" tab (8 form fields)

- [ ] **Step 1: Write the failing test**

In `src/components/SettingsModal.test.ts`, add this test inside the `describe` block before the closing `})`:

```typescript
  it('renders BT settings tab with all fields', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      btMaxPeers: 100,
      seedRatio: 1.5,
      seedTime: 60,
      enableDht: false,
      btListenPort: '6881-6999',
      dhtListenPort: '7000-7999',
      btTracker: 'http://t.example.com',
      btSaveMetadata: true,
    })
    mount(
      {
        components: { NConfigProvider, NMessageProvider, NDialogProvider },
        provide: { 'aria2-api': shallowRef(null) },
        template: `
          <NConfigProvider>
            <NMessageProvider>
              <NDialogProvider>
                <SettingsModal :show="true" />
              </NDialogProvider>
            </NMessageProvider>
          </NConfigProvider>
        `,
      },
      { global: { components: { SettingsModal } } },
    )
    await new Promise((r) => setTimeout(r, 0))
    const tabs = document.body.querySelectorAll('.n-tab-nav__tab')
    const btTab = Array.from(tabs).find((t) => (t as HTMLElement).textContent?.includes('BitTorrent'))
    expect(btTab).toBeTruthy()
    ;(btTab as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
    const text = document.body.textContent ?? ''
    expect(text).toContain('最大 Peer')
    expect(text).toContain('做种比例')
    expect(text).toContain('做种时间')
    expect(text).toContain('DHT')
    expect(text).toContain('BT 监听端口')
    expect(text).toContain('DHT 监听端口')
    expect(text).toContain('Tracker')
    expect(text).toContain('保存种子')
  })
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- --run src/components/SettingsModal.test.ts
```
Expected: FAIL — no "BitTorrent" tab found

- [ ] **Step 3: Expand AppSettings interface and defaults in SettingsModal.vue**

In `src/components/SettingsModal.vue`, add `NSwitch`, `NTabs`, `NTabPane` to the naive-ui import:

```typescript
import { NButton, NInput, NInputNumber, NModal, NCheckbox, NSwitch, NTabs, NTabPane, useMessage } from 'naive-ui'
```

Add 8 fields to the `AppSettings` interface (before the closing `}`):

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

Add 8 defaults to the `s` ref initialization (after `clipboardWatch: true,`):

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

- [ ] **Step 4: Restructure template with NTabs**

Replace the entire `<template>` section with:

```html
<template>
  <NModal
    :show="show"
    preset="card"
    title="设置"
    style="width: 500px; max-width: 90vw"
    @update:show="emit('update:show', $event)"
  >
    <NTabs type="line">
      <NTabPane name="general" tab="常规" display-directive="show">
        <div style="display: flex; flex-direction: column; gap: 20px; padding: 4px 0">
          <section>
            <h4 style="margin: 0 0 8px; font-size: 14px">下载设置</h4>
            <div style="display: flex; flex-direction: column; gap: 6px">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
                >最大并发下载数<NInputNumber
                  v-model:value="s.maxConcurrentDownloads"
                  size="small"
                  :min="1"
                  style="width: 100px"
              /></label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
                >单任务最大连接数<NInputNumber
                  v-model:value="s.maxConnectionPerServer"
                  size="small"
                  :min="1"
                  style="width: 100px"
              /></label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
                >最小分块大小<NInput v-model:value="s.minSplitSize" size="small" style="width: 100px"
              /></label>
            </div>
          </section>
          <section>
            <h4 style="margin: 0 0 8px; font-size: 14px">速度限制</h4>
            <div style="display: flex; flex-direction: column; gap: 6px">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
                >全局下载限速<NInput
                  v-model:value="s.maxOverallDownloadLimit"
                  size="small"
                  placeholder="0=不限"
                  style="width: 120px"
              /></label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
                >全局上传限速<NInput
                  v-model:value="s.maxOverallUploadLimit"
                  size="small"
                  placeholder="0=不限"
                  style="width: 120px"
              /></label>
            </div>
          </section>
          <section>
            <h4 style="margin: 0 0 8px; font-size: 14px">下载目录</h4>
            <NInput v-model:value="s.dir" size="small" placeholder="默认下载路径" />
          </section>
          <section>
            <h4 style="margin: 0 0 8px; font-size: 14px">代理</h4>
            <NInput v-model:value="s.allProxy" size="small" placeholder="如 http://127.0.0.1:7890" />
          </section>
          <section>
            <h4 style="margin: 0 0 8px; font-size: 14px; color: #f0a020">RPC 设置 ⚠ 修改后自动重启 aria2</h4>
            <div style="display: flex; flex-direction: column; gap: 6px">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
                >RPC 端口<NInputNumber v-model:value="s.port" size="small" :min="1" :max="65535" style="width: 120px"
              /></label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
                >RPC 密钥<NInput v-model:value="s.secret" size="small" placeholder="留空=自动生成" style="width: 200px"
              /></label>
            </div>
          </section>
          <section>
            <h4 style="margin: 0 0 8px; font-size: 14px">行为</h4>
            <NCheckbox v-model:checked="s.clipboardWatch">剪贴板监听</NCheckbox>
          </section>
        </div>
      </NTabPane>
      <NTabPane name="bt" tab="BitTorrent" display-directive="show">
        <div style="display: flex; flex-direction: column; gap: 16px; padding: 4px 0">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >最大 Peer 数<NInputNumber v-model:value="s.btMaxPeers" size="small" :min="0" style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >做种比例<NInputNumber
              v-model:value="s.seedRatio"
              size="small"
              :step="0.1"
              :min="0"
              placeholder="0=不限制"
              style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >做种时间 (分钟)<NInputNumber
              v-model:value="s.seedTime"
              size="small"
              :min="0"
              placeholder="0=不限制"
              style="width: 100px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >DHT<NSwitch v-model:value="s.enableDht" size="small"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >BT 监听端口<NInput
              v-model:value="s.btListenPort"
              size="small"
              placeholder="6881-6999"
              style="width: 160px"
          /></label>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >DHT 监听端口<NInput
              v-model:value="s.dhtListenPort"
              size="small"
              placeholder="6881-6999"
              style="width: 160px"
          /></label>
          <div style="display: flex; flex-direction: column; gap: 4px">
            <span style="font-size: 13px">额外 Tracker</span>
            <NInput
              v-model:value="s.btTracker"
              type="textarea"
              size="small"
              placeholder="逗号分隔"
              :rows="2"
            />
          </div>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px"
            >保存种子文件<NSwitch v-model:value="s.btSaveMetadata" size="small"
          /></label>
        </div>
      </NTabPane>
    </NTabs>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="loading" @click="save">保存</NButton>
      </div>
    </template>
  </NModal>
</template>
```

- [ ] **Step 5: Run test to verify it passes**

```powershell
pnpm test -- --run src/components/SettingsModal.test.ts
```
Expected: 2 tests pass (existing renders test + new BT tab test)

- [ ] **Step 6: Run lint + type check**

```powershell
pnpm lint; if ($?) { pnpm vue-tsc --noEmit }
```
Expected: 0 errors

- [ ] **Step 7: Run full test suite**

```powershell
pnpm test -- --run
```
Expected: all tests pass

- [ ] **Step 8: Run full build**

```powershell
pnpm build
```
Expected: builds successfully

- [ ] **Step 9: Commit**

```powershell
git add src/components/SettingsModal.vue src/components/SettingsModal.test.ts
git commit -m "feat(ui): SettingsModal BT tab with 8 BitTorrent settings"
```

---

## Post-Implementation Verification

After all 5 tasks are complete:

- [ ] **Final cargo check**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: 0 errors

- [ ] **Final cargo test**

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: all tests pass

- [ ] **Final frontend check**

```powershell
pnpm lint; if ($?) { pnpm vue-tsc --noEmit }; if ($?) { pnpm test -- --run }
```
Expected: all pass
