# AriaPanel M3 — 详情、设置与桌面集成 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M2 基础上补齐下载管理器核心体验：任务详情抽屉、全局参数配置（持久化 + 自动重启）、系统托盘、剪贴板监听、打开文件夹、UI 偏好持久化。

**Architecture:** Rust 侧新增 settings.json 持久化层 + aria2 重启能力 + 托盘 + 3 个 Tauri command。前端新增 4 个 RPC 方法、preferences store、3 个新组件、2 个新 composable，改造 TaskTable 排序和 TopBar 设置入口。所有配置统一在 Rust settings.json，UI 偏好在 localStorage。

**Tech Stack:** Rust/Tauri 2（TrayIcon API + clipboard-manager plugin）、Vue 3.5 + TS、Pinia、Naive UI、vitest。

## Global Constraints

- **平台/Shell**：Windows PowerShell。Rust/cargo 不在默认 PATH——每个 cargo 命令前加 `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`。
- **前端测试**：`pnpm test`（= `vitest run`）。指定文件 `pnpm test -- <path>`。
- **类型门禁**：`pnpm vue-tsc --noEmit` 必须 0 错误；`pnpm build` 必须成功。
- **Rust 测试**：`cargo test --manifest-path src-tauri\Cargo.toml`。
- **路径别名**：`@` → `src/`（vite.config.ts + vitest.config.ts + tsconfig.json）。
- **naive-ui**：main.ts 已全局注册；`useMessage`/`useDialog`/`useNotification` 需在 AppShell providers 内。
- **操作同步**：一律「命令 → 成功后 `refresh()` → 失败 `message.error()`」，禁止乐观更新。
- **commit 风格**：`feat(scope): ...` / `fix(scope): ...`。
- **DRY/YAGNI/TDD**，无注释（除非计划代码块中有）。
- **分支**：`feat/m3-detail-settings-desktop`，从 master 创建。

---

## File Structure

**Rust**
- Create `src-tauri/src/settings.rs` — Settings struct + load/save
- Modify `src-tauri/src/aria2.rs` — build_args/spawn/Supervisor accept Settings; restart method
- Modify `src-tauri/src/commands.rs` — get_settings, save_settings, open_folder commands; SaveResult; allow_exit
- Modify `src-tauri/src/lib.rs` — settings startup flow, tray, close-to-tray, command registration, plugin registration

**前端类型/RPC**
- Modify `src/lib/aria2/rpc-client.ts` — tellStatus, changeOption, getGlobalOption, changeGlobalOption
- Modify `src/lib/aria2/types.ts` — Aria2TaskDetail
- Modify `src/lib/task-op.ts` — add 'openFolder'
- Test `src/lib/aria2/rpc-client.test.ts`

**Store**
- Create `src/stores/preferences.ts` — sortKey, sortOrder, themeMode + localStorage
- Modify `src/stores/task.ts` — filter localStorage sync, selectedGid, displayTasks (sorted)
- Modify `src/composables/useTheme.ts` — read from preferences store
- Modify `src/composables/useAria2.ts` — reconnect method

**UI 组件**
- Modify `src/components/TaskTable.vue` — clickable sort headers
- Modify `src/components/TaskContextMenu.vue` — openFolder item
- Modify `src/components/TopBar.vue` — settings button, theme toggle
- Create `src/components/TaskDetailDrawer.vue` — 6-section detail drawer
- Create `src/components/SettingsModal.vue` — global settings
- Create `src/composables/useClipboardWatcher.ts`
- Create `src/composables/useWindowGeometry.ts`
- Modify `src/views/TaskListView.vue` — drawer + sort + openFolder wiring
- Modify `src/App.vue` — clipboard watcher, window geometry, tray listeners, reconnect

---

### Task 1: Rust — Settings struct + load/save

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs`（declare module）

**Interfaces:**
- Consumes: `serde`, `serde_json`
- Produces: `Settings` struct, `settings_path()`, `load_settings()`, `save_to_disk()`

- [ ] **Step 1: 创建 settings.rs**

创建 `src-tauri/src/settings.rs`：

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Settings {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub secret: Option<String>,
    #[serde(default)]
    pub dir: String,
    #[serde(default = "default_u32_5")]
    pub max_concurrent_downloads: u32,
    #[serde(default = "default_u32_5")]
    pub max_connection_per_server: u32,
    #[serde(default = "default_min_split")]
    pub min_split_size: String,
    #[serde(default = "default_u32_5")]
    pub split: u32,
    #[serde(default = "default_zero")]
    pub max_overall_download_limit: String,
    #[serde(default = "default_zero")]
    pub max_overall_upload_limit: String,
    #[serde(default)]
    pub all_proxy: String,
    #[serde(default = "default_true")]
    pub clipboard_watch: bool,
}

fn default_u32_5() -> u32 { 5 }
fn default_min_split() -> String { "20M".into() }
fn default_zero() -> String { "0".into() }
fn default_true() -> bool { true }

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
        }
    }
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

pub fn load_settings(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save_to_disk(path: &Path, settings: &Settings) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings() {
        let s = Settings::default();
        assert_eq!(s.max_concurrent_downloads, 5);
        assert_eq!(s.split, 5);
        assert_eq!(s.min_split_size, "20M");
        assert!(s.clipboard_watch);
        assert_eq!(s.all_proxy, "");
    }

    #[test]
    fn serialize_deserialize_roundtrip() {
        let s = Settings { port: Some(6800), secret: Some("abc".into()), dir: "/dl".into(), ..Settings::default() };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let s = load_settings(Path::new("/nonexistent/path/settings.json"));
        assert_eq!(s.max_concurrent_downloads, 5);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = std::env::temp_dir();
        let path = dir.join("ap_test_settings.json");
        let s = Settings { port: Some(6801), dir: "/x".into(), ..Settings::default() };
        save_to_disk(&path, &s);
        let loaded = load_settings(&path);
        assert_eq!(s, loaded);
        let _ = std::fs::remove_file(&path);
    }
}
```

- [ ] **Step 2: 在 lib.rs 声明模块**

在 `src-tauri/src/lib.rs` 的 `pub mod aria2;` 后加：

```rust
pub mod settings;
```

- [ ] **Step 3: 运行测试确认通过**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml settings
```
Expected: 4 passed。

- [ ] **Step 4: 提交**

```powershell
git add src-tauri/src/settings.rs src-tauri/src/lib.rs
git commit -m "feat(core): Settings struct with JSON persistence"
```

---

### Task 2: Rust — build_args/spawn/Supervisor accept Settings + startup wiring

**Files:**
- Modify: `src-tauri/src/aria2.rs`（build_args, spawn, Supervisor::start/ensure_alive accept Settings; add build_global_args）
- Modify: `src-tauri/src/lib.rs`（startup: load settings, new_config from settings, persist generated port/secret）
- Test: `src-tauri/src/aria2.rs` mod tests

**Interfaces:**
- Consumes: `Settings` from Task 1
- Produces: `build_global_args(&Settings) -> Vec<String>`; `new_config(dir, session, &Settings) -> Aria2Config`; `spawn(binary, cfg, &Settings)`; `Supervisor::start(binary, cfg, &Settings)`

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/aria2.rs` 的 `mod tests` 末尾追加：

```rust
    #[test]
    fn build_global_args_includes_concurrent_and_split() {
        use crate::settings::Settings;
        let s = Settings { max_concurrent_downloads: 3, split: 8, max_connection_per_server: 4, min_split_size: "10M".into(), max_overall_download_limit: "1M".into(), max_overall_upload_limit: "0".into(), all_proxy: "http://p:1".into(), ..Settings::default() };
        let a = build_global_args(&s);
        assert!(a.contains(&"--max-concurrent-downloads=3".to_string()));
        assert!(a.contains(&"--split=8".to_string()));
        assert!(a.contains(&"--max-connection-per-server=4".to_string()));
        assert!(a.contains(&"--min-split-size=10M".to_string()));
        assert!(a.contains(&"--max-overall-download-limit=1M".to_string()));
        assert!(a.contains(&"--all-proxy=http://p:1".to_string()));
    }

    #[test]
    fn build_global_args_omits_empty_proxy() {
        use crate::settings::Settings;
        let s = Settings::default();
        let a = build_global_args(&s);
        assert!(!a.iter().any(|x| x.starts_with("--all-proxy")));
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml build_global_args
```
Expected: FAIL（`build_global_args` 不存在）。

- [ ] **Step 3: 写实现**

3a. 在 `src-tauri/src/aria2.rs` 顶部加 import：

```rust
use crate::settings::Settings;
```

3b. 在 `build_args` 函数之后加：

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
    args
}
```

3c. 改 `new_config` 签名：

把：
```rust
pub fn new_config(dir: PathBuf, session: PathBuf) -> Aria2Config {
    Aria2Config {
        port: pick_free_port(),
        secret: generate_secret(),
        dir,
        session,
    }
}
```

改为：
```rust
pub fn new_config(dir: PathBuf, session: PathBuf, settings: &Settings) -> Aria2Config {
    Aria2Config {
        port: settings.port.unwrap_or_else(pick_free_port),
        secret: settings.secret.clone().unwrap_or_else(generate_secret),
        dir,
        session,
    }
}
```

3d. 改 `spawn` 签名：

把：
```rust
pub fn spawn(binary: &Path, cfg: &Aria2Config) -> std::io::Result<Child> {
    Command::new(binary)
        .args(build_args(cfg))
```

改为：
```rust
pub fn spawn(binary: &Path, cfg: &Aria2Config, settings: &Settings) -> std::io::Result<Child> {
    Command::new(binary)
        .args(build_args(cfg))
        .args(build_global_args(settings))
```

3e. 改 `Supervisor::start`：

把：
```rust
    pub async fn start(&mut self, binary: &Path, cfg: &Aria2Config) -> bool {
        match spawn(binary, cfg) {
```

改为：
```rust
    pub async fn start(&mut self, binary: &Path, cfg: &Aria2Config, settings: &Settings) -> bool {
        match spawn(binary, cfg, settings) {
```

3f. 改 `Supervisor::ensure_alive`：

把：
```rust
    pub async fn ensure_alive(&mut self, binary: &Path, cfg: &Aria2Config) -> bool {
```

改为：
```rust
    pub async fn ensure_alive(&mut self, binary: &Path, cfg: &Aria2Config, settings: &Settings) -> bool {
```

以及其中调用：
```rust
            return self.start(binary, cfg).await;
```

改为：
```rust
            return self.start(binary, cfg, settings).await;
```

- [ ] **Step 4: 改 lib.rs startup**

把 `src-tauri/src/lib.rs` setup 块中的：

```rust
            let dir = handle.path().app_data_dir().unwrap_or_default();
            let session = dir.join("aria2.session.gz");
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&session, b"");
            let cfg = new_config(dir, session);
            let port = cfg.port;
            let secret = cfg.secret.clone();
```

替换为：

```rust
            let data_dir = handle.path().app_data_dir().unwrap_or_default();
            let _ = std::fs::create_dir_all(&data_dir);
            let session = data_dir.join("aria2.session.gz");
            let _ = std::fs::write(&session, b"");
            let settings_path = settings::settings_path(&data_dir);
            let mut settings = settings::load_settings(&settings_path);
            let dir = if settings.dir.is_empty() { data_dir.join("downloads") } else { std::path::PathBuf::from(&settings.dir) };
            let _ = std::fs::create_dir_all(&dir);
            let cfg = new_config(dir, session, &settings);
            if settings.port.is_none() || settings.secret.is_none() {
                settings.port = Some(cfg.port);
                settings.secret = Some(cfg.secret.clone());
                settings::save_to_disk(&settings_path, &settings);
            }
            let port = cfg.port;
            let secret = cfg.secret.clone();
```

并在同块中把 `sup.start(&binary, &cfg)` 改为 `sup.start(&binary, &cfg, &settings)`，找到：

```rust
                    let result = sup.start(&binary, &cfg).await;
```

改为：

```rust
                    let result = sup.start(&binary, &cfg, &settings).await;
```

- [ ] **Step 5: 运行全部 Rust 测试**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: 全部通过（含原有 + 新增 2 个），0 warning。

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/aria2.rs src-tauri/src/lib.rs
git commit -m "feat(core): aria2 build_args with user global options from Settings"
```

---

### Task 3: Rust — Tauri commands (get_settings, save_settings, open_folder) + Supervisor restart

**Files:**
- Modify: `src-tauri/src/aria2.rs`（Supervisor.restart）
- Modify: `src-tauri/src/commands.rs`（SaveResult, get_settings, save_settings, open_folder, allow_exit in AppState）
- Modify: `src-tauri/src/lib.rs`（register commands, init allow_exit）

**Interfaces:**
- Consumes: `Settings`, `settings_path`, `load_settings`, `save_to_disk` from Task 1; `new_config`, `binary_path`, `rpc_http_url` from existing
- Produces: Tauri commands `get_settings()`, `save_settings(s)`, `open_folder(path)`; `SaveResult { restarted: bool }`

- [ ] **Step 1: 添加 Supervisor::restart 方法**

在 `src-tauri/src/aria2.rs` 的 `Supervisor` impl 中，`shutdown` 方法之前加：

```rust
    pub async fn restart(&mut self, binary: &Path, old_port: u16, old_secret: &str, cfg: &Aria2Config, settings: &Settings) -> bool {
        self.shutdown(old_port, old_secret).await;
        self.restarts = 0;
        self.start(binary, cfg, settings).await
    }
```

- [ ] **Step 2: 改 commands.rs**

把 `src-tauri/src/commands.rs` 整体替换为：

```rust
use serde::Serialize;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::State;

use crate::settings::Settings;

#[derive(Serialize, Clone)]
pub struct RpcEndpoint {
    pub url: String,
    pub secret: String,
    pub dir: String,
}

#[derive(Serialize)]
pub struct SaveResult {
    pub restarted: bool,
    pub endpoint: Option<RpcEndpoint>,
}

pub struct AppState {
    pub endpoint: Mutex<Option<RpcEndpoint>>,
    pub port: Mutex<Option<u16>>,
    pub secret: Mutex<Option<String>>,
    pub supervisor: Mutex<crate::aria2::Supervisor>,
    pub allow_exit: AtomicBool,
}

#[tauri::command]
pub fn get_rpc_endpoint(state: State<'_, AppState>) -> Option<RpcEndpoint> {
    state.endpoint.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    let dir = app.path().app_data_dir().unwrap_or_default();
    crate::settings::load_settings(&crate::settings::settings_path(&dir))
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    settings: Settings,
) -> Result<SaveResult, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = crate::settings::settings_path(&data_dir);
    let old = crate::settings::load_settings(&path);
    let needs_restart = settings.port != old.port || settings.secret != old.secret;
    crate::settings::save_to_disk(&path, &settings);

    if !needs_restart {
        return Ok(SaveResult { restarted: false, endpoint: None });
    }

    let binary = crate::aria2::binary_path(&app).map_err(|e| e.to_string())?;
    let session = data_dir.join("aria2.session.gz");
    let dir = if settings.dir.is_empty() { data_dir.join("downloads") } else { std::path::PathBuf::from(&settings.dir) };
    let cfg = crate::aria2::new_config(dir, session, &settings);
    let new_port = cfg.port;
    let new_secret = cfg.secret.clone();
    let new_dir = cfg.dir.display().to_string();

    let (old_port, old_secret) = {
        let p = state.port.lock().unwrap().clone();
        let s = state.secret.lock().unwrap().clone();
        (p, s)
    };

    let ok = {
        let mut sup = std::mem::replace(&mut *state.supervisor.lock().unwrap(), crate::aria2::Supervisor::new());
        let result = if let (Some(op), Some(os)) = (old_port, old_secret.as_ref()) {
            sup.restart(&binary, op, os, &cfg, &settings).await
        } else {
            sup.start(&binary, &cfg, &settings).await
        };
        let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
        result
    };

    if ok {
        *state.port.lock().unwrap() = Some(new_port);
        *state.secret.lock().unwrap() = Some(new_secret.clone());
        let ep = RpcEndpoint {
            url: crate::aria2::rpc_http_url(new_port),
            secret: new_secret.clone(),
            dir: new_dir.clone(),
        };
        *state.endpoint.lock().unwrap() = Some(ep.clone());
        let _ = app.emit("aria2://restarted", ep.clone());
        Ok(SaveResult { restarted: true, endpoint: Some(ep) })
    } else {
        Err("aria2 restart failed".into())
    }
}

#[tauri::command]
pub fn open_folder(path: String) {
    let p = std::path::Path::new(&path);
    #[cfg(target_os = "windows")]
    {
        let arg = if p.is_file() {
            format!("/select,{}", p.display())
        } else {
            p.display().to_string()
        };
        let _ = std::process::Command::new("explorer.exe").arg(arg).spawn();
    }
}
```

- [ ] **Step 3: 改 lib.rs**

3a. 在 imports 中加 `use std::sync::atomic::AtomicBool;` 并改 manage：

把：
```rust
        .manage(AppState {
            endpoint: Mutex::new(None),
            port: Mutex::new(None),
            secret: Mutex::new(None),
            supervisor: Mutex::new(aria2::Supervisor::new()),
        })
```

改为：
```rust
        .manage(AppState {
            endpoint: Mutex::new(None),
            port: Mutex::new(None),
            secret: Mutex::new(None),
            supervisor: Mutex::new(aria2::Supervisor::new()),
            allow_exit: AtomicBool::new(false),
        })
```

3b. 改 invoke_handler：

把：
```rust
        .invoke_handler(tauri::generate_handler![commands::get_rpc_endpoint])
```

改为：
```rust
        .invoke_handler(tauri::generate_handler![
            commands::get_rpc_endpoint,
            commands::get_settings,
            commands::save_settings,
            commands::open_folder,
        ])
```

- [ ] **Step 4: 运行 Rust 测试 + 编译确认**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: 全部通过。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/aria2.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(core): get_settings, save_settings (with restart), open_folder commands"
```

---

### Task 4: Rust — System tray + close-to-tray

**Files:**
- Modify: `src-tauri/src/lib.rs`（TrayIcon, Menu, on_window_event, tray handlers）

**Interfaces:**
- Consumes: `AppState.allow_exit` from Task 3
- Produces: tray menu events `tray://pause-all`, `tray://resume-all`; close-to-tray behavior

- [ ] **Step 1: 加 tray 和 on_window_event**

在 `src-tauri/src/lib.rs` 的 imports 中，把 `use tauri::{Emitter, Manager};` 改为：

```rust
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
```

在 `.plugin(tauri_plugin_dialog::init())` 之后、`.manage(AppState {` 之前加：

```rust
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let allow = window.app_handle().try_state::<AppState>()
                    .map(|s| s.allow_exit.load(std::sync::atomic::Ordering::Relaxed))
                    .unwrap_or(false);
                if !allow {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
```

在 `.setup(|app| {` 闭体最开头（`let handle = app.handle().clone();` 之前）加：

```rust
            let show_i = MenuItem::with_id(app, "tray_show", "显示主窗口", true, None::<&str>)?;
            let pause_i = MenuItem::with_id(app, "tray_pause", "全部暂停", true, None::<&str>)?;
            let resume_i = MenuItem::with_id(app, "tray_resume", "全部继续", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &pause_i, &resume_i, &sep, &quit_i])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or("no icon")?)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_show" => {
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                    "tray_pause" => { let _ = app.emit("tray://pause-all", ()); }
                    "tray_resume" => { let _ = app.emit("tray://resume-all", ()); }
                    "tray_quit" => {
                        if let Some(s) = app.try_state::<AppState>() {
                            s.allow_exit.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                        if let Some(w) = app.get_webview_window("main") { let _ = w.close(); }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                })
                .build(app)?;
```

- [ ] **Step 2: 编译确认**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo build --manifest-path src-tauri\Cargo.toml 2>&1 | Select-Object -Last 5
```
Expected: 编译成功（可能有 warning 但无 error）。

- [ ] **Step 3: 提交**

```powershell
git add src-tauri/src/lib.rs
git commit -m "feat(core): system tray with close-to-tray behavior"
```

---

### Task 5: Dependencies — Clipboard plugin (Rust + npm)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`（register plugin）
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json`（pnpm add）

**Interfaces:**
- Produces: `tauri-plugin-clipboard-manager` registered; `@tauri-apps/plugin-clipboard-manager` installed

- [ ] **Step 1: 添加 Rust 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 末尾加：

```toml
tauri-plugin-clipboard-manager = "2"
```

- [ ] **Step 2: 注册 plugin**

在 `src-tauri/src/lib.rs` 的 `.plugin(tauri_plugin_dialog::init())` 后加：

```rust
        .plugin(tauri_plugin_clipboard_manager::init())
```

- [ ] **Step 3: 添加 capability**

在 `src-tauri/capabilities/default.json` 的 `permissions` 数组加 `"clipboard-manager:allow-read-text"`：

```json
  "permissions": [
    "core:default",
    "dialog:default",
    "clipboard-manager:allow-read-text"
  ]
```

- [ ] **Step 4: 安装 npm 包**

Run:
```powershell
pnpm add @tauri-apps/plugin-clipboard-manager
```

- [ ] **Step 5: 编译确认**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo build --manifest-path src-tauri\Cargo.toml 2>&1 | Select-Object -Last 5
```
Expected: 编译成功。

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json pnpm-lock.yaml
git commit -m "chore: add clipboard-manager plugin (Rust + npm)"
```

---

### Task 6: Frontend RPC — tellStatus, changeOption, getGlobalOption, changeGlobalOption + types

**Files:**
- Modify: `src/lib/aria2/rpc-client.ts`（4 methods）
- Modify: `src/lib/aria2/types.ts`（Aria2TaskDetail）
- Test: `src/lib/aria2/rpc-client.test.ts`

**Interfaces:**
- Consumes: existing `call<T>`
- Produces: `tellStatus(gid)`, `changeOption(gid, options)`, `getGlobalOption()`, `changeGlobalOption(options)`; type `Aria2TaskDetail`

- [ ] **Step 1: 写失败测试**

在 `src/lib/aria2/rpc-client.test.ts` 追加：

```ts
  it('tellStatus sends gid', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: { gid: 'g1' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.tellStatus('g1')
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.tellStatus')
    expect(body.params).toEqual(['token:S', 'g1'])
  })

  it('changeOption sends gid and options', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.changeOption('g1', { 'select-file': '1,2' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.changeOption')
    expect(body.params).toEqual(['token:S', 'g1', { 'select-file': '1,2' }])
  })

  it('changeGlobalOption sends options', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.changeGlobalOption({ 'max-concurrent-downloads': '3' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.changeGlobalOption')
    expect(body.params).toEqual(['token:S', { 'max-concurrent-downloads': '3' }])
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 写实现**

3a. 在 `src/lib/aria2/types.ts` 末尾加：

```ts
export interface Aria2TaskDetail extends Aria2Task {
  pieceLength: string
  numPieces: string
  bitfield: string
  connections: string
}
```

3b. 在 `src/lib/aria2/rpc-client.ts` 的 `getOption` 之后、`addUri` 之前加：

```ts
  tellStatus(gid: string) { return this.call<Aria2TaskDetail>('aria2.tellStatus', [gid]) }
  changeOption(gid: string, options: Record<string, string>) { return this.call('aria2.changeOption', [gid, options]) }
  getGlobalOption() { return this.call<Record<string, string>>('aria2.getGlobalOption') }
  changeGlobalOption(options: Record<string, string>) { return this.call('aria2.changeGlobalOption', [options]) }
```

并在顶部 import 加 `Aria2TaskDetail`：

把 `import type { Aria2Task, GlobalStat, RpcResponse } from './types'` 改为 `import type { Aria2Task, Aria2TaskDetail, GlobalStat, RpcResponse } from './types'`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected: 10 passed（原 7 + 新 3）。

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/aria2/rpc-client.ts src/lib/aria2/rpc-client.test.ts src/lib/aria2/types.ts
git commit -m "feat(rpc): tellStatus, changeOption, getGlobalOption, changeGlobalOption"
```

---

### Task 7: Frontend Store — preferences store + task store changes + theme refactor + useAria2 reconnect

**Files:**
- Create: `src/stores/preferences.ts`
- Modify: `src/stores/task.ts`（filter localStorage sync, selectedGid）
- Modify: `src/composables/useTheme.ts`（read from preferences store）
- Modify: `src/composables/useAria2.ts`（reconnect method）
- Test: `src/stores/preferences.test.ts`

**Interfaces:**
- Consumes: none new
- Produces: `usePrefStore()` with `sortKey`, `sortOrder`, `themeMode`; task store `selectedGid`; `useAria2().reconnect()`

- [ ] **Step 1: 创建 preferences store + 测试**

创建 `src/stores/preferences.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePrefStore } from './preferences'

describe('usePrefStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to name/asc/system', () => {
    const p = usePrefStore()
    expect(p.sortKey).toBe('name')
    expect(p.sortOrder).toBe('asc')
    expect(p.themeMode).toBe('system')
  })

  it('persists sort to localStorage', () => {
    const p = usePrefStore()
    p.setSort('size', 'desc')
    expect(localStorage.getItem('ap:sortKey')).toBe('size')
    expect(localStorage.getItem('ap:sortOrder')).toBe('desc')
  })

  it('persists theme to localStorage', () => {
    const p = usePrefStore()
    p.setTheme('dark')
    expect(localStorage.getItem('ap:theme')).toBe('dark')
  })

  it('restores from localStorage', () => {
    localStorage.setItem('ap:sortKey', 'progress')
    localStorage.setItem('ap:theme', 'dark')
    const p = usePrefStore()
    expect(p.sortKey).toBe('progress')
    expect(p.themeMode).toBe('dark')
  })
})
```

创建 `src/stores/preferences.ts`：

```ts
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type SortKey = 'name' | 'size' | 'progress' | 'speed' | 'status'
export type SortOrder = 'asc' | 'desc'
export type ThemeMode = 'light' | 'dark' | 'system'

export const usePrefStore = defineStore('prefs', () => {
  const sortKey = ref<SortKey>(localStorage.getItem('ap:sortKey') as SortKey ?? 'name')
  const sortOrder = ref<SortOrder>(localStorage.getItem('ap:sortOrder') as SortOrder ?? 'asc')
  const themeMode = ref<ThemeMode>(localStorage.getItem('ap:theme') as ThemeMode ?? 'system')

  watch(sortKey, v => localStorage.setItem('ap:sortKey', v))
  watch(sortOrder, v => localStorage.setItem('ap:sortOrder', v))
  watch(themeMode, v => localStorage.setItem('ap:theme', v))

  function setSort(key: SortKey, order: SortOrder) { sortKey.value = key; sortOrder.value = order }
  function setTheme(mode: ThemeMode) { themeMode.value = mode }

  return { sortKey, sortOrder, themeMode, setSort, setTheme }
})
```

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm test -- src/stores/preferences.test.ts`
Expected: 4 passed。

- [ ] **Step 3: 改 task store — filter localStorage + selectedGid**

在 `src/stores/task.ts`：

3a. 顶部 import 加 `watch`：

```ts
import { computed, ref, shallowReactive, watch } from 'vue'
```

3b. 初始化 filter 从 localStorage：

把 `const filter = ref<TaskFilter>('all')` 改为：

```ts
  const filter = ref<TaskFilter>(localStorage.getItem('ap:filter') as TaskFilter ?? 'all')
  watch(filter, v => localStorage.setItem('ap:filter', v))
```

3c. 加 selectedGid（在 filter 之后）：

```ts
  const selectedGid = ref<string | null>(null)
```

3d. 在 return 中加 `selectedGid`。

- [ ] **Step 4: 改 useTheme.ts**

把 `src/composables/useTheme.ts` 整体替换为：

```ts
import { computed, watch } from 'vue'
import { usePrefStore, type ThemeMode } from '@/stores/preferences'

export type { ThemeMode }

export function useTheme() {
  const prefs = usePrefStore()
  const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const isDark = computed(() => prefs.themeMode === 'dark' || (prefs.themeMode === 'system' && prefersDark()))
  const mode = computed(() => isDark.value ? 'dark' : 'light')

  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  mq?.addEventListener?.('change', () => { if (prefs.themeMode === 'system') { /* trigger reactivity */ prefs.setTheme('system') } })

  function setTheme(m: ThemeMode) { prefs.setTheme(m) }

  return { mode, themeMode: computed(() => prefs.themeMode), setTheme }
}
```

- [ ] **Step 5: 改 useAria2.ts — reconnect**

在 `src/composables/useAria2.ts` 的 `getApi` 之后、`return` 之前加：

```ts
  function reconnect(endpoint: { url: string; secret: string; dir: string }) {
    poller?.stop()
    ws?.stop()
    client = new Aria2Client(endpoint.url, endpoint.secret)
    downloadDir = endpoint.dir
    const wsUrl = endpoint.url.replace(/^http/, 'ws')
    poller = new Poller(client, (a, w, s) => { tasks.apply(a, w, s); refreshStat() })
    poller.start()
    ws = new WsNotifier(wsUrl, endpoint.secret, () => {})
    ws.start()
  }
```

把 `return { start, getApi }` 改为 `return { start, getApi, reconnect }`。

- [ ] **Step 6: 类型 + 全部测试确认**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 7: 提交**

```powershell
git add src/stores/preferences.ts src/stores/preferences.test.ts src/stores/task.ts src/composables/useTheme.ts src/composables/useAria2.ts
git commit -m "feat(store): preferences store, filter persistence, selectedGid, theme refactor, reconnect"
```

---

### Task 8: Frontend UI — TaskTable sortable headers

**Files:**
- Modify: `src/components/TaskTable.vue`
- Modify: `src/views/TaskListView.vue`（displayTasks computed）
- Test: `src/components/TaskTable.test.ts`

**Interfaces:**
- Consumes: `usePrefStore` from Task 7
- Produces: TaskTable with clickable sort headers; `sortKey`/`sortOrder` props

- [ ] **Step 1: 写失败测试**

在 `src/components/TaskTable.test.ts` 追加：

```ts
  it('renders sort indicator on active column', () => {
    localStorage.setItem('ap:sortKey', 'size')
    localStorage.setItem('ap:sortOrder', 'desc')
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate: () => {} } })
    expect(w.text()).toContain('↓')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/components/TaskTable.test.ts`
Expected: FAIL（无 ↓ 渲染）。

- [ ] **Step 3: 改 TaskTable.vue**

把 `<script setup>` 部分改为（保留现有 helper 函数 `name`, `pct`, `fmtBytes`, `primaryOp`）：

在 `const store = useTaskStore()` 后加：

```ts
import { usePrefStore, type SortKey } from '@/stores/preferences'
const prefs = usePrefStore()

const sortableColumns: { key: SortKey; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'progress', label: '进度' },
  { key: 'speed', label: '速度' },
  { key: 'status', label: '状态' },
]
function toggleSort(key: SortKey) {
  if (prefs.sortKey === key) {
    prefs.setSort(key, prefs.sortOrder === 'asc' ? 'desc' : 'asc')
  } else {
    prefs.setSort(key, 'asc')
  }
}
function sortArrow(key: SortKey): string {
  if (prefs.sortKey !== key) return ''
  return prefs.sortOrder === 'asc' ? '↑' : '↓'
}
```

把 template 的 `<thead>` 改为：

```html
    <thead>
      <tr>
        <th style="width:32px"><NCheckbox :checked="allChecked" @update:checked="toggleAll" /></th>
        <th v-for="col in sortableColumns" :key="col.key"
          @click="toggleSort(col.key)"
          style="cursor:pointer;user-select:none">
          {{ col.label }} <span style="opacity:.6">{{ sortArrow(col.key) }}</span>
        </th>
        <th style="width:160px">操作</th>
      </tr>
    </thead>
```

- [ ] **Step 4: 改 TaskListView — displayTasks**

在 `src/views/TaskListView.vue` 的 `<script setup>` 中：

顶部 import 加：
```ts
import { computed } from 'vue'
import { usePrefStore } from '@/stores/preferences'
```

在 `const tasks = useTaskStore()` 后加：
```ts
const prefs = usePrefStore()

const displayTasks = computed(() => {
  const list = [...tasks.visibleTasks]
  const key = prefs.sortKey
  const dir = prefs.sortOrder === 'asc' ? 1 : -1
  return list.sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'name': cmp = (a.bittorrent?.info?.name || a.files?.[0]?.path || a.gid).localeCompare(b.bittorrent?.info?.name || b.files?.[0]?.path || b.gid); break
      case 'size': cmp = Number(a.totalLength) - Number(b.totalLength); break
      case 'progress': cmp = pct(a) - pct(b); break
      case 'speed': cmp = Number(a.downloadSpeed) - Number(b.downloadSpeed); break
      case 'status': cmp = a.status.localeCompare(b.status); break
    }
    return cmp * dir
  })
})

function pct(t: { totalLength: string; completedLength: string }): number {
  const total = Number(t.totalLength) || 0
  const done = Number(t.completedLength) || 0
  return total === 0 ? 0 : Math.round((done / total) * 100)
}
```

模板中把 `<TaskTable :tasks="tasks.visibleTasks"` 改为 `<TaskTable :tasks="displayTasks"`。

- [ ] **Step 5: 运行测试 + 类型确认**

Run: `pnpm test -- src/components/TaskTable.test.ts`
Expected: 5 passed。

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```powershell
git add src/components/TaskTable.vue src/components/TaskTable.test.ts src/views/TaskListView.vue
git commit -m "feat(ui): sortable task table headers with persistence"
```

---

### Task 9: Frontend UI — TaskDetailDrawer

**Files:**
- Create: `src/components/TaskDetailDrawer.vue`
- Modify: `src/lib/task-op.ts`（add 'openFolder'）
- Test: `src/components/TaskDetailDrawer.test.ts`

**Interfaces:**
- Consumes: `Aria2Api` (`client`, `refresh`), `useTaskStore` (`selectedGid`), `TaskOp`
- Produces: `TaskDetailDrawer` with 6 sections; `TaskOp` now includes `'openFolder'`

- [ ] **Step 1: 扩展 TaskOp**

把 `src/lib/task-op.ts` 改为：

```ts
export type TaskOp =
  | 'pause' | 'unpause' | 'remove' | 'forcePause' | 'forceRemove'
  | 'retry' | 'retryWithUrl' | 'copyLink' | 'openFolder'
```

- [ ] **Step 2: 写失败测试**

创建 `src/components/TaskDetailDrawer.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'

const detail: Aria2TaskDetail = {
  gid: 'g1', status: 'active', totalLength: '104857600', completedLength: '71303168',
  downloadSpeed: '2621440', uploadSpeed: '0', dir: 'D:/Downloads',
  pieceLength: '1048576', numPieces: '100', bitfield: 'ffff', connections: '8',
  files: [{ path: 'D:/Downloads/file.bin', length: '104857600', completedLength: '71303168', selected: 'true', uris: [{ uri: 'https://x/file.bin', status: 'used' }] }],
}

describe('TaskDetailDrawer', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders task name and basic info', () => {
    const w = mount(TaskDetailDrawer, { props: { detail, operate: () => {} } })
    expect(w.text()).toContain('file.bin')
    expect(w.text()).toContain('104.9')
    expect(w.text()).toContain('D:/Downloads')
  })

  it('renders piece progress', () => {
    const w = mount(TaskDetailDrawer, { props: { detail, operate: () => {} } })
    expect(w.text()).toContain('100')
    expect(w.text()).toContain('8')
  })

  it('renders link list', () => {
    const w = mount(TaskDetailDrawer, { props: { detail, operate: () => {} } })
    expect(w.text()).toContain('https://x/file.bin')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test -- src/components/TaskDetailDrawer.test.ts`
Expected: FAIL（组件不存在）。

- [ ] **Step 4: 创建组件**

创建 `src/components/TaskDetailDrawer.vue`：

```vue
<script setup lang="ts">
import { NButton, NDrawer, NDrawerContent, NProgress, NTag } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'
import type { TaskOp } from '@/lib/task-op'

const props = defineProps<{ show: boolean; detail: Aria2TaskDetail | null; operate: (gid: string, op: TaskOp) => void }>()
const emit = defineEmits<{ 'update:show': [v: boolean] }>()

const t = computed(() => props.detail)

function name(d: Aria2TaskDetail): string {
  return d.bittorrent?.info?.name || d.files?.[0]?.path?.split(/[\\/]/).pop() || d.gid
}
function fmtBytes(s: string): string {
  const n = Number(s)
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}
function fmtSpeed(s: string): string {
  const n = Number(s)
  if (!n) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}
function pct(d: Aria2TaskDetail): number {
  const total = Number(d.totalLength) || 0
  const done = Number(d.completedLength) || 0
  return total === 0 ? 0 : Math.round((done / total) * 100)
}
function completedPieces(d: Aria2TaskDetail): number {
  if (!d.bitfield) return 0
  let count = 0
  for (const ch of d.bitfield) {
    const nibble = parseInt(ch, 16)
    if (isNaN(nibble)) continue
    count += (nibble & 8 ? 1 : 0) + (nibble & 4 ? 1 : 0) + (nibble & 2 ? 1 : 0) + (nibble & 1 ? 1 : 0)
  }
  return count
}
function uriStatusColor(s: string): 'success' | 'warning' | 'error' | 'default' {
  switch (s) {
    case 'used': return 'success'
    case 'waiting': return 'warning'
    case 'error': return 'error'
    default: return 'default'
  }
}
</script>

<template>
  <NDrawer :show="show" @update:show="emit('update:show', $event)" :width="420" placement="right">
    <NDrawerContent v-if="t" :title="name(t)" closable>
      <div style="display:flex;flex-direction:column;gap:16px">
        <NProgress :percentage="pct(t)" />

        <section>
          <h4 style="margin:0 0 4px;font-size:13px;opacity:.7">基本信息</h4>
          <div style="font-size:13px;line-height:1.8">
            状态：{{ t.status }}<br>
            大小：{{ fmtBytes(t.totalLength) }}<br>
            已下载：{{ fmtBytes(t.completedLength) }}<br>
            速度：↓ {{ fmtSpeed(t.downloadSpeed) }} ↑ {{ fmtSpeed(t.uploadSpeed) }}<br>
            保存路径：{{ t.dir }}
          </div>
        </section>

        <section>
          <h4 style="margin:0 0 4px;font-size:13px;opacity:.7">分块进度</h4>
          <div style="font-size:13px;line-height:1.8">
            {{ completedPieces(t) }}/{{ t.numPieces }} 块已完成，{{ t.connections }} 个活跃连接<br>
            分块大小：{{ fmtBytes(t.pieceLength) }}
          </div>
        </section>

        <section>
          <h4 style="margin:0 0 4px;font-size:13px;opacity:.7">文件列表</h4>
          <div v-for="(f, i) in t.files" :key="i" style="font-size:13px;line-height:1.6">
            {{ f.path.split(/[\\/]/).pop() }} — {{ fmtBytes(f.length) }}
            <NProgress :percentage="Number(f.length) ? Math.round(Number(f.completedLength) / Number(f.length) * 100) : 0" :height="6" />
          </div>
        </section>

        <section>
          <h4 style="margin:0 0 4px;font-size:13px;opacity:.7">链接列表</h4>
          <div v-for="(f, i) in t.files" :key="'u'+i">
            <div v-for="(u, j) in f.uris" :key="j" style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:2px">
              <NTag :type="uriStatusColor(u.status)" size="small" round>{{ u.status }}</NTag>
              <span style="word-break:break-all">{{ u.uri }}</span>
            </div>
          </div>
        </section>

        <section v-if="t.errorCode">
          <h4 style="margin:0 0 4px;font-size:13px;opacity:.7;color:#e88080">错误详情</h4>
          <div style="font-size:13px;line-height:1.6">
            错误码：{{ t.errorCode }}<br>
            {{ t.errorMessage }}
          </div>
        </section>
      </div>

      <template #footer>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <NButton v-if="t.status === 'active'" size="small" @click="operate(t.gid, 'pause')">暂停</NButton>
          <NButton v-if="t.status === 'paused' || t.status === 'waiting'" size="small" @click="operate(t.gid, 'unpause')">恢复</NButton>
          <NButton size="small" @click="operate(t.gid, 'copyLink')">复制链接</NButton>
          <NButton size="small" @click="operate(t.gid, 'openFolder')">打开目录</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test -- src/components/TaskDetailDrawer.test.ts`
Expected: 3 passed。

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```powershell
git add src/components/TaskDetailDrawer.vue src/components/TaskDetailDrawer.test.ts src/lib/task-op.ts
git commit -m "feat(ui): task detail drawer with 6 sections"
```

---

### Task 10: Frontend UI — SettingsModal

**Files:**
- Create: `src/components/SettingsModal.vue`
- Test: `src/components/SettingsModal.test.ts`

**Interfaces:**
- Consumes: Tauri commands `get_settings`, `save_settings`; `Aria2Api.client.changeGlobalOption`
- Produces: `SettingsModal` with 6 config sections; emits `saved` on success

- [ ] **Step 1: 写失败测试**

创建 `src/components/SettingsModal.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsModal from './SettingsModal.vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('SettingsModal', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders config sections', () => {
    const w = mount(SettingsModal, { props: { show: true } })
    expect(w.text()).toContain('最大并发下载数')
    expect(w.text()).toContain('速度限制')
    expect(w.text()).toContain('代理')
    expect(w.text()).toContain('RPC')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/components/SettingsModal.test.ts`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 创建组件**

创建 `src/components/SettingsModal.vue`：

```vue
<script setup lang="ts">
import { NButton, NInput, NInputNumber, NModal, NCheckbox, useMessage } from 'naive-ui'
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { inject, type Ref } from 'vue'
import type { Aria2Api } from '@/composables/useAria2'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; saved: [] }>()
const api = inject<Ref<Aria2Api | null>>('aria2-api')
const message = useMessage()

interface AppSettings {
  port: number | null
  secret: string | null
  dir: string
  maxConcurrentDownloads: number
  maxConnectionPerServer: number
  minSplitSize: string
  split: number
  maxOverallDownloadLimit: string
  maxOverallUploadLimit: string
  allProxy: string
  clipboardWatch: boolean
}

const s = ref<AppSettings>({ port: null, secret: null, dir: '', maxConcurrentDownloads: 5, maxConnectionPerServer: 5, minSplitSize: '20M', split: 5, maxOverallDownloadLimit: '0', maxOverallUploadLimit: '0', allProxy: '', clipboardWatch: true })
const loading = ref(false)

watch(() => props.show, async v => {
  if (v) {
    try {
      const got = await invoke<AppSettings>('get_settings')
      s.value = { ...got, port: got.port, secret: got.secret }
    } catch { /* first launch defaults */ }
  }
})

async function save() {
  loading.value = true
  try {
    const result = await invoke<{ restarted: boolean; endpoint: { url: string; secret: string; dir: string } | null }>('save_settings', { settings: s.value })
    if (!result.restarted) {
      const c = api.value?.client
      if (c) {
        await c.changeGlobalOption({
          'max-concurrent-downloads': String(s.value.maxConcurrentDownloads),
          'max-connection-per-server': String(s.value.maxConnectionPerServer),
          'min-split-size': s.value.minSplitSize,
          'split': String(s.value.split),
          'max-overall-download-limit': s.value.maxOverallDownloadLimit,
          'max-overall-upload-limit': s.value.maxOverallUploadLimit,
          ...(s.value.allProxy ? { 'all-proxy': s.value.allProxy } : {}),
        })
      }
    }
    message.success(result.restarted ? '设置已保存，aria2 已重启' : '设置已保存')
    emit('saved')
    emit('update:show', false)
  } catch (e) {
    message.error(`保存失败：${String(e)}`)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="card" title="设置" style="width:500px;max-width:90vw">
    <div style="display:flex;flex-direction:column;gap:20px;padding:4px 0">
      <section>
        <h4 style="margin:0 0 8px;font-size:14px">下载设置</h4>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">最大并发下载数<NInputNumber v-model:value="s.maxConcurrentDownloads" size="small" :min="1" style="width:100px" /></label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">单任务最大连接数<NInputNumber v-model:value="s.maxConnectionPerServer" size="small" :min="1" style="width:100px" /></label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">最小分块大小<NInput v-model:value="s.minSplitSize" size="small" style="width:100px" /></label>
        </div>
      </section>
      <section>
        <h4 style="margin:0 0 8px;font-size:14px">速度限制</h4>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">全局下载限速<NInput v-model:value="s.maxOverallDownloadLimit" size="small" placeholder="0=不限" style="width:120px" /></label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">全局上传限速<NInput v-model:value="s.maxOverallUploadLimit" size="small" placeholder="0=不限" style="width:120px" /></label>
        </div>
      </section>
      <section>
        <h4 style="margin:0 0 8px;font-size:14px">下载目录</h4>
        <NInput v-model:value="s.dir" size="small" placeholder="默认下载路径" />
      </section>
      <section>
        <h4 style="margin:0 0 8px;font-size:14px">代理</h4>
        <NInput v-model:value="s.allProxy" size="small" placeholder="如 http://127.0.0.1:7890" />
      </section>
      <section>
        <h4 style="margin:0 0 8px;font-size:14px;color:#f0a020">RPC 设置 ⚠ 修改后自动重启 aria2</h4>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">RPC 端口<NInputNumber v-model:value="s.port" size="small" :min="1" :max="65535" style="width:120px" /></label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">RPC 密钥<NInput v-model:value="s.secret" size="small" placeholder="留空=自动生成" style="width:200px" /></label>
        </div>
      </section>
      <section>
        <h4 style="margin:0 0 8px;font-size:14px">行为</h4>
        <NCheckbox v-model:checked="s.clipboardWatch">剪贴板监听</NCheckbox>
      </section>
    </div>
    <template #footer>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="loading" @click="save">保存</NButton>
      </div>
    </template>
  </NModal>
</template>
```

- [ ] **Step 4: 运行测试 + 类型确认**

Run: `pnpm test -- src/components/SettingsModal.test.ts`
Expected: 1 passed。

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 5: 提交**

```powershell
git add src/components/SettingsModal.vue src/components/SettingsModal.test.ts
git commit -m "feat(ui): settings modal with 6 config sections"
```

---

### Task 11: Frontend — Clipboard watcher + window geometry composables

**Files:**
- Create: `src/composables/useClipboardWatcher.ts`
- Create: `src/composables/useWindowGeometry.ts`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-clipboard-manager` (readText), `@tauri-apps/api/window`
- Produces: `useClipboardWatcher(notification, onUrl)`, `useWindowGeometry()`

- [ ] **Step 1: 创建 useClipboardWatcher**

创建 `src/composables/useClipboardWatcher.ts`：

```ts
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { NotificationApiInjection } from 'naive-ui/es/notification/src/NotificationProvider'

const URL_RE = /^https?:\/\/[^\s]+$/

export function useClipboardWatcher(
  notification: NotificationApiInjection,
  onUrl: (url: string) => void,
) {
  let lastText = ''
  let lastNotified = ''
  let timer: ReturnType<typeof setInterval> | null = null
  let unlistenFocus: (() => void) | null = null

  async function check() {
    try {
      const text = await readText()
      if (!text || text === lastText) return
      lastText = text
      const match = text.trim().match(URL_RE)
      if (match && match[0] !== lastNotified) {
        const url = match[0]
        lastNotified = url
        notification.info({
          title: '检测到下载链接',
          content: url,
          duration: 10000,
          onClick: () => onUrl(url),
        })
      }
    } catch { /* ignore */ }
  }

  function start() {
    timer = setInterval(check, 2000)
    const win = getCurrentWindow()
    win.onFocusChanged(({ payload: focused }) => { if (focused) check() }).then(fn => { unlistenFocus = fn })
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    if (unlistenFocus) { unlistenFocus(); unlistenFocus = null }
  }

  return { start, stop }
}
```

- [ ] **Step 2: 创建 useWindowGeometry**

创建 `src/composables/useWindowGeometry.ts`：

```ts
import { getCurrentWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window'

export function useWindowGeometry() {
  const win = getCurrentWindow()
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function save() {
    try {
      const size = await win.outerSize()
      const pos = await win.outerPosition()
      const scale = await win.scaleFactor()
      localStorage.setItem('ap:winW', String(Math.round(size.width / scale)))
      localStorage.setItem('ap:winH', String(Math.round(size.height / scale)))
      localStorage.setItem('ap:winX', String(Math.round(pos.x / scale)))
      localStorage.setItem('ap:winY', String(Math.round(pos.y / scale)))
    } catch { /* ignore */ }
  }

  function debounceSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 500)
  }

  async function restore() {
    const w = localStorage.getItem('ap:winW')
    const h = localStorage.getItem('ap:winH')
    const x = localStorage.getItem('ap:winX')
    const y = localStorage.getItem('ap:winY')
    if (w && h) {
      try { await win.setSize(new LogicalSize(Number(w), Number(h))) } catch { /* ignore */ }
    }
    if (x && y) {
      try { await win.setPosition(new LogicalPosition(Number(x), Number(y))) } catch { /* ignore */ }
    }
  }

  function start() {
    restore()
    const unlistenResized = win.onResized(debounceSave)
    const unlistenMoved = win.onMoved(debounceSave)
    return async () => { (await unlistenResized)(); (await unlistenMoved)() }
  }

  return { start, save }
}
```

- [ ] **Step 3: 类型确认**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 4: 提交**

```powershell
git add src/composables/useClipboardWatcher.ts src/composables/useWindowGeometry.ts
git commit -m "feat(composable): clipboard watcher and window geometry persistence"
```

---

### Task 12: Assembly — wire everything + TaskContextMenu + TopBar + App.vue + smoke test

**Files:**
- Modify: `src/components/TaskContextMenu.vue`（openFolder item）
- Modify: `src/components/TopBar.vue`（settings button, theme toggle）
- Modify: `src/views/TaskListView.vue`（detail drawer + openFolder wiring）
- Modify: `src/App.vue`（clipboard, window geometry, tray listeners, reconnect, notification provider）
- Modify: `src/components/AppShell.vue`（add NNotificationProvider if missing — already present from M2）
- Modify: `src/i18n/locales/zh-CN.ts`

**Interfaces:**
- Consumes: all M3 components/composables
- Produces: fully wired M3 application

- [ ] **Step 1: TaskContextMenu — add openFolder**

在 `src/components/TaskContextMenu.vue` 的 `options()` 中，`base.push({ label: '强制暂停'` 之前加：

```ts
  base.push({ label: '打开文件夹', key: 'openFolder' })
```

- [ ] **Step 2: TopBar — settings + theme**

把 `src/components/TopBar.vue` 整体替换为：

```vue
<script setup lang="ts">
import { NButton, NSpace, useMessage } from 'naive-ui'
import { inject, ref, type Ref } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import type { Aria2Api } from '@/composables/useAria2'

const conn = useConnectionStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()
const { mode, themeMode, setTheme } = useTheme()

const emit = defineEmits<{ settings: [] }>()

async function run(fn: 'pauseAll' | 'unpauseAll', ok: string) {
  const c = api.value?.client
  if (!c) return
  try {
    await c[fn]()
    api.value!.refresh()
  } catch (e) {
    message.error(`${ok} 失败：${String(e)}`)
  }
}

const themeIcons: Record<ThemeMode, string> = { light: '☀', dark: '🌙', system: '💻' }
function cycleTheme() {
  const order: ThemeMode[] = ['system', 'light', 'dark']
  const next = order[(order.indexOf(themeMode.value) + 1) % order.length]
  setTheme(next)
}
</script>

<template>
  <div style="padding:8px 12px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--n-border-color,#eee)">
    <strong>AriaPanel</strong>
    <NSpace :size="8">
      <NButton size="small" @click="run('pauseAll','全部暂停')">全部暂停</NButton>
      <NButton size="small" @click="run('unpauseAll','全部继续')">全部继续</NButton>
    </NSpace>
    <span style="margin-left:auto;font-size:12px;opacity:.7">{{ conn.status }}</span>
    <NButton size="small" quaternary @click="cycleTheme" :title="`主题: ${themeMode}`">{{ themeIcons[themeMode] }}</NButton>
    <NButton size="small" quaternary @click="emit('settings')">⚙</NButton>
  </div>
</template>
```

- [ ] **Step 3: TaskListView — detail drawer + openFolder + settings modal**

在 `src/views/TaskListView.vue`：

3a. imports 加：
```ts
import TaskDetailDrawer from '@/components/TaskDetailDrawer.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import { invoke } from '@tauri-apps/api/core'
import type { Aria2TaskDetail } from '@/lib/aria2/types'
```

3b. 在 retry ref 后加：
```ts
const detail = ref<Aria2TaskDetail | null>(null)
const detailShow = ref(false)
const settingsShow = ref(false)
```

3c. 加一个 watch + interval 在抽屉打开时拉 tellStatus：
```ts
import { watch, onUnmountation } from 'vue'

let detailTimer: ReturnType<typeof setInterval> | null = null
async function fetchDetail() {
  if (!tasks.selectedGid) return
  const c = api.value?.client
  if (!c) return
  try { detail.value = await c.tellStatus(tasks.selectedGid) } catch { /* ignore */ }
}
watch(() => tasks.selectedGid, gid => {
  if (gid) {
    detailShow.value = true
    fetchDetail()
    detailTimer = setInterval(fetchDetail, 2000)
  } else {
    detailShow.value = false
    detail.value = null
    if (detailTimer) { clearInterval(detailTimer); detailTimer = null }
  }
})
onUnmountation(() => { if (detailTimer) clearInterval(detailTimer) })
```

3d. operate 中加 openFolder case。在 `case 'copyLink':` 之后加：
```ts
      case 'openFolder': {
        if (!t) return
        const fp = t.files[0]?.path || t.dir
        await invoke('open_folder', { path: fp })
        return
      }
```

3e. 模板中 TaskTable 加 `@row-click` 触发选中：
在 `<TaskTable` 标签加 `@contextmenu="openContextMenu" @more="openContextMenu"` 后面不变，但加一个 click handler。

在 `<TaskTable` 组件上加 emit `rowClick`：
在 TaskTable.vue 的 defineEmits 加 `'rowClick': [gid: string]`，并在 `<tr>` 加 `@click="$emit('rowClick', r.t.gid)"`。

在 TaskListView 模板中 TaskTable 加：
```html
          <TaskTable :tasks="displayTasks" :operate="operate" @contextmenu="openContextMenu" @more="openContextMenu" @row-click="(gid: string) => tasks.selectedGid = gid" />
```

3f. 模板末尾（RetryDialog 之后）加：
```html
    <TaskDetailDrawer v-model:show="detailShow" :detail="detail" :operate="operate" />
    <SettingsModal v-model:show="settingsShow" @saved="api?.refresh()" />
```

3g. TopBar 加 settings emit：
```html
    <TopBar @settings="settingsShow = true" />
```

- [ ] **Step 4: TaskTable — row click emit**

在 `src/components/TaskTable.vue` 的 `defineEmits` 加 `'rowClick': [gid: string]`。

在 `<tr v-for="r in rows"` 加 `@click="$emit('rowClick', r.t.gid)"`（注意排除操作列的点击冒泡：给 `<td>` 操作列加 `@click.stop`）。

- [ ] **Step 5: App.vue — clipboard, window geometry, tray listeners, reconnect**

把 `src/App.vue` 整体替换为：

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, provide, shallowRef, ref, type Ref } from 'vue'
import { useNotification } from 'naive-ui'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useAria2, type Aria2Api } from '@/composables/useAria2'
import { useClipboardWatcher } from '@/composables/useClipboardWatcher'
import { useWindowGeometry } from '@/composables/useWindowGeometry'
import AppShell from '@/components/AppShell.vue'
import { useTaskStore } from '@/stores/task'

const aria = useAria2()
const tasks = useTaskStore()
const notification = useNotification()
const apiRef = shallowRef<Aria2Api | null>(null)
provide<Ref<Aria2Api | null>>('aria2-api', apiRef)

const clipboardUrl = ref('')
const { start: startClipboard, stop: stopClipboard } = useClipboardWatcher(notification, (url) => { clipboardUrl.value = url })
const { start: startGeo } = useWindowGeometry()

let unlisteners: (() => void)[] = []

onMounted(async () => {
  await aria.start()
  apiRef.value = aria.getApi()
  startGeo()

  const watchSettings = await invoke<{ clipboardWatch: boolean }>('get_settings')
  if (watchSettings.clipboardWatch) startClipboard()

  unlisteners.push(await listen('aria2://restarted', async (e) => {
    const ep = e.payload as { url: string; secret: string; dir: string }
    aria.reconnect(ep)
    apiRef.value = aria.getApi()
  }))
  unlisteners.push(await listen('tray://pause-all', async () => {
    await apiRef.value?.client.pauseAll()
    apiRef.value?.refresh()
  }))
  unlisteners.push(await listen('tray://resume-all', async () => {
    await apiRef.value?.client.unpauseAll()
    apiRef.value?.refresh()
  }))
})

onUnmounted(() => { stopClipboard(); unlisteners.forEach(fn => fn()) })
</script>

<template>
  <AppShell>
    <router-view />
  </AppShell>
</template>
```

注意：`useNotification()` 需要在 `NNotificationProvider` 内调用。`App.vue` 的 `<router-view>` 渲染的组件在 AppShell 内（AppShell 包含 NNotificationProvider），但 `useNotification()` 在 App.vue setup 中调用时，App.vue 自身不在 provider 内。

解决方案：将 clipboard watcher 的启动移到 TaskListView（provider 内），或在 AppShell 外层再加一个 notification provider。最简单方案：在 `App.vue` 的 template 中直接嵌套 AppShell 包裹的内容，让 App.vue setup 在 provider 作用域外不调 `useNotification`。

改为：将 clipboard watcher 初始化移到 `TaskListView.vue`，因为 TaskListView 在 provider 内。

- [ ] **Step 5b: 修正 — clipboard 移到 TaskListView**

在 `src/views/TaskListView.vue` 加：

```ts
import { useNotification } from 'naive-ui'
import { useClipboardWatcher } from '@/composables/useClipboardWatcher'
import { useWindowGeometry } from '@/composables/useWindowGeometry'

const notification = useNotification()
const { start: startClipboard } = useClipboardWatcher(notification, (url) => { /* 填入 AddUrlBar */ })
startClipboard()
const { start: startGeo } = useWindowGeometry()
startGeo()
```

App.vue 只保留 aria2 start + reconnect + tray listeners（不调 useNotification）。

把 App.vue 改回不使用 notification：

```vue
<script setup lang="ts">
import { onMounted, provide, shallowRef, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useAria2, type Aria2Api } from '@/composables/useAria2'
import AppShell from '@/components/AppShell.vue'

const aria = useAria2()
const apiRef = shallowRef<Aria2Api | null>(null)
provide<Ref<Aria2Api | null>>('aria2-api', apiRef)

let unlisteners: (() => void) = () => {}

onMounted(async () => {
  await aria.start()
  apiRef.value = aria.getApi()

  const ul1 = await listen('aria2://restarted', (e) => {
    const ep = e.payload as { url: string; secret: string; dir: string }
    aria.reconnect(ep)
    apiRef.value = aria.getApi()
  })
  const ul2 = await listen('tray://pause-all', async () => {
    await apiRef.value?.client.pauseAll()
    apiRef.value?.refresh()
  })
  const ul3 = await listen('tray://resume-all', async () => {
    await apiRef.value?.client.unpauseAll()
    apiRef.value?.refresh()
  })
  unlisteners = () => { ul1(); ul2(); ul3() }
})
</script>

<template>
  <AppShell>
    <router-view />
  </AppShell>
</template>
```

- [ ] **Step 6: 类型 + 全套测试 + 构建**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

Run: `pnpm test`
Expected: 全部通过。

Run: `pnpm build`
Expected: 成功。

- [ ] **Step 7: 手工冒烟（tauri dev）**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
pnpm tauri dev
```

逐项验证：
1. 点任务行 → 详情抽屉打开，6 个分区正确渲染，关闭抽屉正常。
2. TopBar ⚙ → 设置 modal 打开，改并发数保存 → 新任务生效；改 RPC 端口保存 → aria2 重启、任务恢复。
3. TopBar 主题按钮 → 三态切换生效。
4. 表头点击 → 排序生效，↑↓ 显示，重启后恢复。
5. 点 ✕ → 窗口隐藏，托盘可见 → 点托盘 → 窗口恢复 → 托盘「退出」→ 正常退出。
6. 浏览器复制下载链接 → 切回 AriaPanel → 通知弹出 → 点击 → URL 填入。
7. 右键「打开文件夹」→ 资源管理器打开并选中文件。
8. 窗口缩放/移动 → 重启 → 几何恢复。

- [ ] **Step 8: 提交**

```powershell
git add src/components/TaskContextMenu.vue src/components/TopBar.vue src/components/TaskTable.vue src/views/TaskListView.vue src/App.vue src/i18n/locales/zh-CN.ts
git commit -m "feat(ui): M3 assembly — detail drawer, settings, tray, clipboard, sort, openFolder wiring"
```

---

## 自审（Self-Review）

**Spec 覆盖**：
- §3 配置持久化 → Task 1（Settings struct）+ Task 2（build_args）+ Task 3（commands）+ Task 10（SettingsModal）。
- §4 详情抽屉 → Task 6（tellStatus RPC）+ Task 9（Drawer 组件）+ Task 12（wiring）。
- §5 系统托盘 → Task 4（Rust tray）+ Task 12（frontend listeners）。
- §6 剪贴板 → Task 5（plugin）+ Task 11（composable）+ Task 12（wiring）。
- §7 打开文件夹 → Task 3（open_folder command）+ Task 9（TaskOp）+ Task 12（context menu）。
- §8 UI 偏好 → Task 7（preferences store + theme）+ Task 8（sort）+ Task 11（window geometry）。

**占位扫描**：Step 5b 已修正 notification provider 作用域问题（clipboard 移到 TaskListView）。无 TBD/TODO。

**类型一致**：
- `Aria2TaskDetail`（Task 6 定义）→ Task 9 import 使用。✓
- `TaskOp` + `'openFolder'`（Task 9 定义）→ Task 12 context menu + operate 使用。✓
- `usePrefStore`（Task 7 定义）→ Task 8 sort 使用。✓
- `useAria2().reconnect`（Task 7 定义）→ Task 12 App.vue 使用。✓
- `SaveResult`（Task 3 定义）→ Task 10 SettingsModal invoke 使用。✓
- `Settings` struct（Task 1 定义）→ Task 2 build_args + Task 3 commands 使用。✓

**已知执行注意**：
- Task 4 的 tray 代码使用了 `?` 操作符返回 `Result`，setup 闭包需返回 `Result<(), Box<dyn Error>>`（Tauri 2 setup 签名已支持）。
- Task 11 useWindowGeometry 的 `onResized`/`onMoved` 返回 Promise<UnlistenFn>，debounceSave 需同步——已用 then 处理。
- Task 12 Step 5b：clipboard watcher 必须在 NNotificationProvider 内调用 `useNotification()`，所以放在 TaskListView 而非 App.vue。
