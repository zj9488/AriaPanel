# AriaPanel M5: Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire crash recovery, add diagnostics panel, and surface connection errors to the user — completing the v1 reliability story.

**Architecture:** Stderr reader thread detects aria2c crashes via EOF; Rust auto-restarts (up to 3x) and emits lifecycle events; frontend tracks poller failures, shows error banner, and provides a diagnostics modal with logs + manual restart.

**Tech Stack:** Rust (Tauri 2, std::process), TypeScript, Vue 3.5, Naive UI 2.44, Vitest

## Global Constraints

- **Windows + PowerShell**: No `&&` in commands — use `;` or `if ($?) {}`
- **Rust cargo** at `%USERPROFILE%\.cargo\bin` — prepend: `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`
- **Kill aria2c before cargo check**: `Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force`
- **pnpm** is the package manager (not npm/yarn)
- **No comments** in code unless explicitly requested
- **No emojis** in code or commit messages
- **Semicolons**: false; **Quotes**: single; **Trailing comma**: all; **Width**: 120
- **`@` alias** maps to `src/`
- **Naive UI** components imported individually (no global registration)
- **Test providers**: Components using `useMessage`/`useDialog` must be wrapped with `NConfigProvider > NMessageProvider > NDialogProvider` in tests
- **NModal/NDrawer** teleport to `document.body` — tests must use `document.body.textContent`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src-tauri/src/log_buffer.rs` | Ring buffer for aria2c stderr lines; `push`, `snapshot`, `new(max) -> Arc<Self>` |
| `src/components/DiagnosticsModal.vue` | Modal showing conn status, restart count, aria2c logs, restart button |
| `src/components/DiagnosticsModal.test.ts` | Tests for DiagnosticsModal |
| `src/components/TopBar.test.ts` | Tests for TopBar status pill + disabled controls |

### Modified files

| File | Changes |
|------|---------|
| `src-tauri/src/log_buffer.rs` | (new) LogBuffer struct + tests |
| `src-tauri/src/aria2.rs` | `start()`/`ensure_alive()`/`restart()` return `(bool, Option<ChildStderr>)`; add `spawn_stderr_reader` |
| `src-tauri/src/commands.rs` | Add `logs`/`intentional_stop` to AppState; add `get_aria2_logs`/`get_restarts_count`/`restart_aria2`; add `start_crash_recovery` |
| `src-tauri/src/lib.rs` | Register `log_buffer` mod; init AppState with logs/intentional_stop; spawn stderr reader on startup; set intentional_stop on exit; register new commands |
| `src/lib/aria2/poller.ts` | Add `failCount` + `onStatus` callback |
| `src/lib/aria2/poller.test.ts` | Test failure counting |
| `src/composables/useAria2.ts` | Own `apiRef`; consolidate event listeners; wire poller `onStatus` |
| `src/App.vue` | Use `aria.apiRef` from useAria2; remove `aria2://restarted` listener |
| `src/stores/connection.ts` | Add `showDiagnostics` ref + `setShowDiagnostics` |
| `src/stores/connection.test.ts` | Test `showDiagnostics` |
| `src/components/TopBar.vue` | Replace status text with clickable pill; disable buttons when disconnected |
| `src/views/TaskListView.vue` | Add error banner; render `<DiagnosticsModal />` |

---

## Task 1: Rust LogBuffer Module

**Files:**
- Create: `src-tauri/src/log_buffer.rs`
- Modify: `src-tauri/src/lib.rs:1` (add `pub mod log_buffer;`)

**Interfaces:**
- Produces: `LogBuffer::new(max_lines: usize) -> Arc<LogBuffer>`, `LogBuffer::push(line: String)`, `LogBuffer::snapshot() -> Vec<String>`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/log_buffer.rs`:

```rust
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub struct LogBuffer {
    lines: Mutex<VecDeque<String>>,
    max_lines: usize,
}

impl LogBuffer {
    pub fn new(max_lines: usize) -> Arc<Self> {
        Arc::new(Self {
            lines: Mutex::new(VecDeque::with_capacity(max_lines)),
            max_lines,
        })
    }

    pub fn push(&self, line: String) {
        let mut guard = self.lines.lock().unwrap();
        if guard.len() >= self.max_lines {
            guard.pop_front();
        }
        guard.push_back(line);
    }

    pub fn snapshot(&self) -> Vec<String> {
        self.lines.lock().unwrap().iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_snapshot() {
        let buf = LogBuffer::new(200);
        buf.push("line1".into());
        buf.push("line2".into());
        assert_eq!(buf.snapshot(), vec!["line1", "line2"]);
    }

    #[test]
    fn evicts_oldest_when_full() {
        let buf = LogBuffer::new(3);
        buf.push("a".into());
        buf.push("b".into());
        buf.push("c".into());
        buf.push("d".into());
        assert_eq!(buf.snapshot(), vec!["b", "c", "d"]);
    }

    #[test]
    fn empty_buffer_returns_empty_snapshot() {
        let buf = LogBuffer::new(200);
        assert!(buf.snapshot().is_empty());
    }
}
```

- [ ] **Step 2: Register module in lib.rs**

Add `pub mod log_buffer;` to the top of `src-tauri/src/lib.rs`, after the existing module declarations:

```rust
pub mod aria2;
pub mod settings;
pub mod commands;
pub mod secret;
pub mod log_buffer;
```

- [ ] **Step 3: Run tests to verify they pass**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo test --manifest-path src-tauri\Cargo.toml log_buffer
```
Expected: 3 tests pass

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/log_buffer.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add LogBuffer ring buffer for aria2c stderr"
```

---

## Task 2: Rust AppState + start() Signature + Read Commands

**Files:**
- Modify: `src-tauri/src/aria2.rs:112-144` (start/ensure_alive/restart signatures)
- Modify: `src-tauri/src/commands.rs:21-27` (AppState), `src-tauri/src/commands.rs:29-32` (new commands)
- Modify: `src-tauri/src/lib.rs:40-46` (AppState init), `src-tauri/src/lib.rs:119-124` (start caller), `src-tauri/src/lib.rs:138-143` (invoke_handler)

**Interfaces:**
- Consumes: `LogBuffer::new` from Task 1
- Produces: `AppState.logs: Arc<LogBuffer>`, `AppState.intentional_stop: Arc<AtomicBool>`, commands `get_aria2_logs()`, `get_restarts_count()`. `Supervisor.start() -> (bool, Option<ChildStderr>)`, `ensure_alive() -> (bool, Option<ChildStderr>)`, `restart() -> (bool, Option<ChildStderr>)`

- [ ] **Step 1: Modify start() to return stderr**

In `src-tauri/src/aria2.rs`, change the `start` method signature and body:

```rust
pub async fn start(&mut self, binary: &Path, cfg: &Aria2Config, settings: &Settings) -> (bool, Option<std::process::ChildStderr>) {
    match spawn(binary, cfg, settings) {
        Ok(mut c) => {
            let stderr = c.stderr.take();
            self.child = Some(c);
            let ok = health_check(cfg.port, &cfg.secret).await;
            (ok, if ok { stderr } else { None })
        }
        Err(_) => (false, None),
    }
}
```

- [ ] **Step 2: Modify ensure_alive() to propagate stderr**

```rust
pub async fn ensure_alive(&mut self, binary: &Path, cfg: &Aria2Config, settings: &Settings) -> (bool, Option<std::process::ChildStderr>) {
    let dead = match self.child.as_mut() {
        None => true,
        Some(c) => match c.try_wait() {
            Ok(None) => false,
            _ => true,
        },
    };
    if dead {
        if !self.can_restart() { return (false, None); }
        self.restarts += 1;
        return self.start(binary, cfg, settings).await;
    }
    (true, None)
}
```

- [ ] **Step 3: Modify restart() to propagate stderr**

```rust
pub async fn restart(&mut self, binary: &Path, old_port: u16, old_secret: &str, cfg: &Aria2Config, settings: &Settings) -> (bool, Option<std::process::ChildStderr>) {
    self.shutdown(old_port, old_secret).await;
    self.restarts = 0;
    self.start(binary, cfg, settings).await
}
```

- [ ] **Step 4: Add fields to AppState and new commands in commands.rs**

Add these fields to the `AppState` struct:

```rust
pub struct AppState {
    pub endpoint: Mutex<Option<RpcEndpoint>>,
    pub port: Mutex<Option<u16>>,
    pub secret: Mutex<Option<String>>,
    pub supervisor: Mutex<crate::aria2::Supervisor>,
    pub allow_exit: std::sync::atomic::AtomicBool,
    pub logs: std::sync::Arc<crate::log_buffer::LogBuffer>,
    pub intentional_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
```

Add these commands after the existing `get_rpc_endpoint` command:

```rust
#[tauri::command]
pub fn get_aria2_logs(state: State<'_, AppState>) -> Vec<String> {
    state.logs.snapshot()
}

#[tauri::command]
pub fn get_restarts_count(state: State<'_, AppState>) -> u32 {
    state.supervisor.lock().unwrap().restarts_count()
}
```

- [ ] **Step 5: Update AppState init in lib.rs**

In the `.manage(AppState { ... })` call, add the new fields:

```rust
.manage(AppState {
    endpoint: Mutex::new(None),
    port: Mutex::new(None),
    secret: Mutex::new(None),
    supervisor: Mutex::new(aria2::Supervisor::new()),
    allow_exit: std::sync::atomic::AtomicBool::new(false),
    logs: log_buffer::LogBuffer::new(200),
    intentional_stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
})
```

- [ ] **Step 6: Update start() caller in lib.rs setup**

In the `tauri::async_runtime::spawn` block (around line 119), change from:

```rust
let ok = {
    let mut sup = std::mem::replace(&mut *st.supervisor.lock().unwrap(), aria2::Supervisor::new());
    let result = sup.start(&binary, &cfg, &settings).await;
    let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
    result
};
```

To:

```rust
let (ok, _stderr) = {
    let mut sup = std::mem::replace(&mut *st.supervisor.lock().unwrap(), aria2::Supervisor::new());
    let result = sup.start(&binary, &cfg, &settings).await;
    let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
    result
};
```

(Stderr is captured but not yet read — the reader is wired in Task 3. Using `_stderr` to avoid unused variable warnings.)

- [ ] **Step 7: Update save_settings caller in commands.rs**

In `save_settings` (around line 70), the restart path needs to destructure the tuple. Change:

```rust
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
```

To:

```rust
let (ok, _stderr) = {
    let mut sup = std::mem::replace(&mut *state.supervisor.lock().unwrap(), crate::aria2::Supervisor::new());
    let result = if let (Some(op), Some(os)) = (old_port, old_secret.as_ref()) {
        sup.restart(&binary, op, os, &cfg, &settings).await
    } else {
        sup.start(&binary, &cfg, &settings).await
    };
    let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
    result
};
```

- [ ] **Step 8: Register new commands in lib.rs**

In the `.invoke_handler` macro, add the new commands:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_rpc_endpoint,
    commands::get_settings,
    commands::save_settings,
    commands::open_folder,
    commands::get_aria2_logs,
    commands::get_restarts_count,
])
```

- [ ] **Step 9: Run cargo check**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: compiles with 0 errors

- [ ] **Step 10: Run cargo test**

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: all existing tests + 3 new LogBuffer tests pass

- [ ] **Step 11: Commit**

```powershell
git add src-tauri/src/aria2.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add AppState logs/intentional_stop, read-only commands, start() returns stderr"
```

---

## Task 3: Rust Stderr Reader + Crash Recovery Wiring

**Files:**
- Modify: `src-tauri/src/aria2.rs` (add `spawn_stderr_reader`)
- Modify: `src-tauri/src/commands.rs` (add `start_crash_recovery`, update `save_settings`)
- Modify: `src-tauri/src/lib.rs` (wire stderr reader on startup, set intentional_stop on exit)

**Interfaces:**
- Consumes: `LogBuffer` from Task 1, `AppState` fields from Task 2, `Supervisor.ensure_alive() -> (bool, Option<ChildStderr>)` from Task 2
- Produces: `spawn_stderr_reader()`, `start_crash_recovery()`, events `aria2://crashed`, `aria2://restarted`, `aria2://failed`

- [ ] **Step 1: Add spawn_stderr_reader to aria2.rs**

Add this function at the end of `aria2.rs` (before the `#[cfg(test)]` block):

```rust
pub fn spawn_stderr_reader(
    stderr: std::process::ChildStderr,
    buffer: std::sync::Arc<crate::log_buffer::LogBuffer>,
    intentional_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    on_eof: impl FnOnce() + Send + 'static,
) {
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) => buffer.push(l),
                Err(_) => break,
            }
        }
        if !intentional_stop.load(std::sync::atomic::Ordering::Relaxed) {
            on_eof();
        }
    });
}
```

- [ ] **Step 2: Add start_crash_recovery to commands.rs**

Add this function to `commands.rs` (after the `open_folder` command):

```rust
pub fn start_crash_recovery(handle: tauri::AppHandle) {
    let _ = handle.emit("aria2://crashed", ());
    tauri::async_runtime::spawn(async move {
        let st = match handle.try_state::<AppState>() {
            Some(s) => s,
            None => return,
        };
        let binary = match crate::aria2::binary_path(&handle) {
            Ok(p) => p,
            Err(_) => {
                let _ = handle.emit("aria2://failed", ());
                return;
            }
        };
        let data_dir = match handle.path().app_data_dir() {
            Ok(d) => d,
            Err(_) => {
                let _ = handle.emit("aria2://failed", ());
                return;
            }
        };
        let session = data_dir.join("aria2.session.gz");
        let settings_path = crate::settings::settings_path(&data_dir);
        let settings = crate::settings::load_settings(&settings_path);
        let dir = if settings.dir.is_empty() {
            data_dir.join("downloads")
        } else {
            std::path::PathBuf::from(&settings.dir)
        };
        let cfg = crate::aria2::new_config(dir, session, &settings);

        let (ok, stderr) = {
            let mut sup = std::mem::replace(
                &mut *st.supervisor.lock().unwrap(),
                crate::aria2::Supervisor::new(),
            );
            let result = sup.ensure_alive(&binary, &cfg, &settings).await;
            let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
            result
        };

        if ok {
            if let Some(stderr) = stderr {
                let logs = st.logs.clone();
                let is = st.intentional_stop.clone();
                let h = handle.clone();
                crate::aria2::spawn_stderr_reader(stderr, logs, is, move || {
                    start_crash_recovery(h);
                });
            }
            let _ = handle.emit("aria2://restarted", ());
        } else {
            let _ = handle.emit("aria2://failed", ());
        }
    });
}
```

- [ ] **Step 3: Wire stderr reader in lib.rs startup**

In the `tauri::async_runtime::spawn` block in `setup()`, replace `let (ok, _stderr) = {` with code that spawns the reader:

```rust
let (ok, stderr) = {
    let mut sup = std::mem::replace(&mut *st.supervisor.lock().unwrap(), aria2::Supervisor::new());
    let result = sup.start(&binary, &cfg, &settings).await;
    let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
    result
};
if ok {
    if let Some(stderr) = stderr {
        let logs = st.logs.clone();
        let is = st.intentional_stop.clone();
        let h = handle.clone();
        aria2::spawn_stderr_reader(stderr, logs, is, move || {
            commands::start_crash_recovery(h);
        });
    }
    if let Ok(mut g) = st.endpoint.lock() {
        *g = Some(RpcEndpoint { url: rpc_http_url(port), secret: secret.clone(), dir: cfg.dir.display().to_string() });
    }
    if let Ok(mut p) = st.port.lock() { *p = Some(port); }
    if let Ok(mut s) = st.secret.lock() { *s = Some(secret); }
    let _ = handle.emit("aria2://started", ());
} else {
    let _ = handle.emit("aria2://failed", ());
}
```

- [ ] **Step 4: Set intentional_stop on exit in lib.rs**

In the `app.run()` closure for `ExitRequested`, add `intentional_stop.store(true, ...)` before `shutdown`:

```rust
app.run(|app_handle, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
        if let Some(st) = app_handle.try_state::<AppState>() {
            st.intentional_stop.store(true, std::sync::atomic::Ordering::Relaxed);
            let port = st.port.lock().ok().and_then(|g| *g);
            let secret = st.secret.lock().ok().and_then(|g| g.clone());
            if let (Some(port), Some(secret)) = (port, secret) {
                let mut sup = st.supervisor.lock().unwrap();
                tauri::async_runtime::block_on(sup.shutdown(port, &secret));
            }
        }
    }
});
```

- [ ] **Step 5: Update save_settings to spawn reader and set intentional_stop**

In `commands.rs` `save_settings`, before the restart block, set `intentional_stop = true`. After restart succeeds, set `intentional_stop = false` and spawn reader. Change the restart block to:

```rust
state.intentional_stop.store(true, std::sync::atomic::Ordering::Relaxed);

let (ok, stderr) = {
    let mut sup = std::mem::replace(&mut *state.supervisor.lock().unwrap(), crate::aria2::Supervisor::new());
    let result = if let (Some(op), Some(os)) = (old_port, old_secret.as_ref()) {
        sup.restart(&binary, op, os, &cfg, &settings).await
    } else {
        sup.start(&binary, &cfg, &settings).await
    };
    let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
    result
};

state.intentional_stop.store(false, std::sync::atomic::Ordering::Relaxed);

if ok {
    if let Some(stderr) = stderr {
        let logs = state.logs.clone();
        let is = state.intentional_stop.clone();
        let h = app.clone();
        crate::aria2::spawn_stderr_reader(stderr, logs, is, move || {
            start_crash_recovery(h);
        });
    }
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
```

- [ ] **Step 6: Run cargo check**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: compiles with 0 errors

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/aria2.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): wire stderr reader, crash recovery, intentional_stop"
```

---

## Task 4: Rust restart_aria2 Command

**Files:**
- Modify: `src-tauri/src/commands.rs` (add command)
- Modify: `src-tauri/src/lib.rs:138-143` (register command)

**Interfaces:**
- Consumes: `spawn_stderr_reader` from Task 3, `start_crash_recovery` from Task 3
- Produces: `restart_aria2` command callable from frontend via `invoke('restart_aria2')`

- [ ] **Step 1: Add restart_aria2 command to commands.rs**

Add after `start_crash_recovery`:

```rust
#[tauri::command]
pub async fn restart_aria2(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    state.intentional_stop.store(true, std::sync::atomic::Ordering::Relaxed);

    let (old_port, old_secret) = {
        let p = state.port.lock().unwrap().clone();
        let s = state.secret.lock().unwrap().clone();
        (p, s)
    };

    {
        let mut sup = std::mem::replace(
            &mut *state.supervisor.lock().unwrap(),
            crate::aria2::Supervisor::new(),
        );
        if let (Some(p), Some(s)) = (old_port, old_secret.as_ref()) {
            sup.shutdown(p, s).await;
        }
        sup.restarts = 0;
        let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
    }

    let binary = crate::aria2::binary_path(&app).map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let session = data_dir.join("aria2.session.gz");
    let settings_path = crate::settings::settings_path(&data_dir);
    let settings = crate::settings::load_settings(&settings_path);
    let dir = if settings.dir.is_empty() {
        data_dir.join("downloads")
    } else {
        std::path::PathBuf::from(&settings.dir)
    };
    let cfg = crate::aria2::new_config(dir, session, &settings);

    let (ok, stderr) = {
        let mut sup = std::mem::replace(
            &mut *state.supervisor.lock().unwrap(),
            crate::aria2::Supervisor::new(),
        );
        let result = sup.start(&binary, &cfg, &settings).await;
        let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
        result
    };

    state.intentional_stop.store(false, std::sync::atomic::Ordering::Relaxed);

    if ok {
        if let Some(stderr) = stderr {
            let logs = state.logs.clone();
            let is = state.intentional_stop.clone();
            let h = app.clone();
            crate::aria2::spawn_stderr_reader(stderr, logs, is, move || {
                start_crash_recovery(h);
            });
        }
        let _ = app.emit("aria2://restarted", ());
        Ok(())
    } else {
        let _ = app.emit("aria2://failed", ());
        Err("aria2 restart failed".into())
    }
}
```

- [ ] **Step 2: Register command in lib.rs**

Update the `.invoke_handler` to include `restart_aria2`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_rpc_endpoint,
    commands::get_settings,
    commands::save_settings,
    commands::open_folder,
    commands::get_aria2_logs,
    commands::get_restarts_count,
    commands::restart_aria2,
])
```

- [ ] **Step 3: Run cargo check**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: compiles with 0 errors

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add restart_aria2 command for manual restart from diagnostics"
```

---

## Task 5: Frontend Poller Failure Tracking

**Files:**
- Modify: `src/lib/aria2/poller.ts`
- Modify: `src/lib/aria2/poller.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `Poller` constructor accepts optional third parameter `onStatus?: (connected: boolean) => void`. Called with `false` after 3 consecutive failures, `true` on first success after failures.

- [ ] **Step 1: Write failing tests for failure tracking**

Add these tests to `src/lib/aria2/poller.test.ts` (inside the existing `describe` block, before the closing `})`):

```typescript
  it('calls onStatus(false) after 3 consecutive failures', async () => {
    const failClient = {
      tellActive: vi.fn().mockRejectedValue(new Error('rpc')),
      tellWaiting: vi.fn().mockRejectedValue(new Error('rpc')),
      tellStopped: vi.fn().mockRejectedValue(new Error('rpc')),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const onStatus = vi.fn()
    const p = new Poller(failClient, onTick, onStatus)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).toHaveBeenCalledWith(false)
    p.stop()
  })

  it('calls onStatus(true) on recovery after failures', async () => {
    let failCount = 0
    const flakyClient = {
      tellActive: vi.fn(async () => {
        failCount++
        if (failCount <= 3) throw new Error('rpc')
        return []
      }),
      tellWaiting: vi.fn(async () => []),
      tellStopped: vi.fn(async () => []),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const onStatus = vi.fn()
    const p = new Poller(flakyClient, onTick, onStatus)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(onStatus).toHaveBeenCalledWith(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).toHaveBeenCalledWith(true)
    p.stop()
  })

  it('does not call onStatus for 1-2 transient failures', async () => {
    let failCount = 0
    const blipClient = {
      tellActive: vi.fn(async () => {
        failCount++
        if (failCount === 1) throw new Error('blip')
        return []
      }),
      tellWaiting: vi.fn(async () => []),
      tellStopped: vi.fn(async () => []),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const onStatus = vi.fn()
    const p = new Poller(blipClient, onTick, onStatus)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onStatus).not.toHaveBeenCalled()
    p.stop()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pnpm test -- --run src/lib/aria2/poller.test.ts
```
Expected: 3 new tests FAIL (onStatus not called / Poller constructor doesn't accept 3rd arg behavior)

- [ ] **Step 3: Implement failure tracking in poller.ts**

Replace the entire `src/lib/aria2/poller.ts`:

```typescript
import type { Aria2Client } from './rpc-client'
import type { Aria2Task } from './types'

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private inFlight = false
  private failCount = 0
  constructor(
    private client: Aria2Client,
    private onTick: (a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) => void,
    private onStatus?: (connected: boolean) => void,
  ) {}

  start() {
    this.schedule(0)
  }
  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  refreshNow() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.schedule(0)
  }

  private schedule(ms: number) {
    this.timer = setTimeout(() => {
      this.tick()
    }, ms)
  }

  private async tick() {
    if (this.inFlight) return
    this.inFlight = true
    try {
      const [a, w, s] = await Promise.all([
        this.client.tellActive(),
        this.client.tellWaiting(0, 100),
        this.client.tellStopped(0, 100),
      ])
      this.active = a.length > 0
      this.onTick(a, w, s)
      if (this.failCount >= 3) this.onStatus?.(true)
      this.failCount = 0
    } catch {
      this.failCount++
      if (this.failCount === 3) this.onStatus?.(false)
    } finally {
      this.inFlight = false
      this.schedule(this.active ? 1000 : 5000)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
pnpm test -- --run src/lib/aria2/poller.test.ts
```
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```powershell
git add src/lib/aria2/poller.ts src/lib/aria2/poller.test.ts
git commit -m "feat(poller): add consecutive failure tracking with onStatus callback"
```

---

## Task 6: Frontend Connection Store + useAria2 Event Consolidation

**Files:**
- Modify: `src/stores/connection.ts`
- Modify: `src/stores/connection.test.ts`
- Modify: `src/composables/useAria2.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `Poller` with `onStatus` from Task 5
- Produces: `conn.showDiagnostics` ref, `conn.setShowDiagnostics(v)`. `useAria2` returns `apiRef` and handles all aria2 lifecycle events internally. `useAria2.start()` registers listeners for `aria2://crashed`, `aria2://restarted`, `aria2://failed`.

- [ ] **Step 1: Write failing test for showDiagnostics**

Add to `src/stores/connection.test.ts` (inside the `describe` block):

```typescript
  it('tracks diagnostics visibility', () => {
    const s = useConnectionStore()
    expect(s.showDiagnostics).toBe(false)
    s.setShowDiagnostics(true)
    expect(s.showDiagnostics).toBe(true)
    s.setShowDiagnostics(false)
    expect(s.showDiagnostics).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- --run src/stores/connection.test.ts
```
Expected: FAIL — `showDiagnostics` not defined

- [ ] **Step 3: Add showDiagnostics to connection store**

In `src/stores/connection.ts`, add `showDiagnostics` ref and `setShowDiagnostics` action. Add after the `error` ref:

```typescript
const showDiagnostics = ref(false)
```

Add the setter after `setError`:

```typescript
const setShowDiagnostics = (v: boolean) => {
  showDiagnostics.value = v
}
```

Return them in the store:

```typescript
return { status, error, globalStat, showDiagnostics, setConnecting, setConnected, setReconnecting, setError, setStat, setShowDiagnostics }
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
pnpm test -- --run src/stores/connection.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: Refactor useAria2 to own apiRef and consolidate event listeners**

Replace the entire `src/composables/useAria2.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { shallowRef } from 'vue'
import { Aria2Client } from '@/lib/aria2/rpc-client'
import { Poller } from '@/lib/aria2/poller'
import { WsNotifier } from '@/lib/aria2/ws-notify'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'

export interface Aria2Api {
  client: Aria2Client
  refresh: () => void
  dir: string
}

export function useAria2() {
  const conn = useConnectionStore()
  const tasks = useTaskStore()
  const apiRef = shallowRef<Aria2Api | null>(null)
  let client: Aria2Client | null = null
  let poller: Poller | null = null
  let ws: WsNotifier | null = null
  let downloadDir = ''

  async function start() {
    conn.setConnecting()

    await listen('aria2://failed', () => {
      conn.setError('aria2 连接失败')
      conn.setShowDiagnostics(true)
    })
    await listen('aria2://crashed', () => {
      conn.setReconnecting()
    })
    await listen('aria2://restarted', (e) => {
      const ep = e.payload as { url: string; secret: string; dir: string }
      reconnect(ep)
    })

    const ep = await waitForEndpoint()
    if (!ep) return
    connectToEndpoint(ep)
  }

  async function waitForEndpoint(): Promise<{ url: string; secret: string; dir: string } | null> {
    for (let i = 0; i < 100; i++) {
      const ep = await invoke<{ url: string; secret: string; dir: string } | null>('get_rpc_endpoint')
      if (ep) return ep
      await new Promise((r) => setTimeout(r, 100))
    }
    conn.setError('获取 aria2 端点超时')
    conn.setShowDiagnostics(true)
    return null
  }

  function connectToEndpoint(ep: { url: string; secret: string; dir: string }) {
    const wsUrl = ep.url.replace(/^http/, 'ws')
    client = new Aria2Client(ep.url, ep.secret)
    downloadDir = ep.dir
    conn.setConnected()
    poller = new Poller(
      client,
      (a, w, s) => {
        tasks.apply(a, w, s)
        refreshStat()
      },
      (connected) => {
        if (connected) conn.setConnected()
        else conn.setReconnecting()
      },
    )
    poller.start()
    ws = new WsNotifier(wsUrl, ep.secret, () => {})
    ws.start()
    apiRef.value = getApi()
  }

  async function refreshStat() {
    if (!client) return
    try {
      conn.setStat(await client.getGlobalStat())
    } catch {
      /* ignore */
    }
  }

  function getApi(): Aria2Api | null {
    if (!client || !poller) return null
    return { client, refresh: () => poller!.refreshNow(), dir: downloadDir }
  }

  function reconnect(endpoint: { url: string; secret: string; dir: string }) {
    poller?.stop()
    ws?.stop()
    connectToEndpoint(endpoint)
  }

  return { start, getApi, reconnect, apiRef }
}
```

- [ ] **Step 6: Update App.vue to use aria.apiRef**

Replace the entire `src/App.vue`:

```vue
<script setup lang="ts">
import { onMounted, provide, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useAria2, type Aria2Api } from '@/composables/useAria2'
import AppShell from '@/components/AppShell.vue'
import TaskListView from '@/views/TaskListView.vue'

const aria = useAria2()
provide<Ref<Aria2Api | null>>('aria2-api', aria.apiRef)

onMounted(async () => {
  await aria.start()

  await listen('tray://pause-all', async () => {
    await aria.getApi()?.client.pauseAll()
    aria.getApi()?.refresh()
  })
  await listen('tray://resume-all', async () => {
    await aria.getApi()?.client.unpauseAll()
    aria.getApi()?.refresh()
  })
})
</script>

<template>
  <AppShell>
    <TaskListView />
  </AppShell>
</template>
```

- [ ] **Step 7: Run lint + type check**

```powershell
pnpm lint; if ($?) { pnpm vue-tsc --noEmit }
```
Expected: 0 errors

- [ ] **Step 8: Run all tests**

```powershell
pnpm test -- --run
```
Expected: all tests pass (connection.test.ts has 2 tests now)

- [ ] **Step 9: Commit**

```powershell
git add src/stores/connection.ts src/stores/connection.test.ts src/composables/useAria2.ts src/App.vue
git commit -m "feat(frontend): consolidate aria2 events in useAria2, add showDiagnostics to conn store"
```

---

## Task 7: DiagnosticsModal Component

**Files:**
- Create: `src/components/DiagnosticsModal.vue`
- Create: `src/components/DiagnosticsModal.test.ts`

**Interfaces:**
- Consumes: `conn.showDiagnostics`, `conn.status` from Task 6. `invoke('get_aria2_logs')`, `invoke('get_restarts_count')`, `invoke('restart_aria2')` from Tasks 2+4.
- Produces: `<DiagnosticsModal />` component that reads from connection store directly (no props).

- [ ] **Step 1: Write failing test**

Create `src/components/DiagnosticsModal.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useConnectionStore } from '@/stores/connection'
import DiagnosticsModal from './DiagnosticsModal.vue'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'get_aria2_logs') return Promise.resolve(['[WARN] test line 1', '[ERROR] test line 2'])
    if (cmd === 'get_restarts_count') return Promise.resolve(2)
    if (cmd === 'restart_aria2') return Promise.resolve()
    return Promise.resolve({})
  }),
}))

function mountModal() {
  return mount(
    {
      components: { NConfigProvider, NMessageProvider, NDialogProvider, DiagnosticsModal },
      template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <DiagnosticsModal />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
    },
  )
}

describe('DiagnosticsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('renders status and restart count when open', async () => {
    const conn = useConnectionStore()
    conn.setShowDiagnostics(true)
    const wrapper = mountModal()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.textContent).toContain('aria2')
    expect(document.body.textContent).toContain('2')
    expect(document.body.textContent).toContain('/3')
  })

  it('renders log lines', async () => {
    const conn = useConnectionStore()
    conn.setShowDiagnostics(true)
    const wrapper = mountModal()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.textContent).toContain('[WARN] test line 1')
    expect(document.body.textContent).toContain('[ERROR] test line 2')
  })

  it('close button hides modal', async () => {
    const conn = useConnectionStore()
    conn.setShowDiagnostics(true)
    const wrapper = mountModal()
    await new Promise((r) => setTimeout(r, 0))
    const closeBtn = Array.from(wrapper.findAll('button')).find((b) => b.text().includes('关闭'))
    expect(closeBtn).toBeTruthy()
    await closeBtn!.trigger('click')
    expect(conn.showDiagnostics).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- --run src/components/DiagnosticsModal.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement DiagnosticsModal.vue**

Create `src/components/DiagnosticsModal.vue`:

```vue
<script setup lang="ts">
import { NModal, NButton, NTag, NSpace, useMessage } from 'naive-ui'
import { ref, watch, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useConnectionStore } from '@/stores/connection'

const conn = useConnectionStore()
const message = useMessage()

const logs = ref<string[]>([])
const restarts = ref(0)
const restarting = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const statusConfig: Record<string, { type: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  connected: { type: 'success', label: '已连接' },
  connecting: { type: 'info', label: '连接中' },
  reconnecting: { type: 'warning', label: '重连中' },
  error: { type: 'error', label: '连接失败' },
  idle: { type: 'default', label: '未连接' },
}

async function fetchLogs() {
  try {
    logs.value = await invoke<string[]>('get_aria2_logs')
    restarts.value = await invoke<number>('get_restarts_count')
  } catch {
    /* ignore */
  }
}

async function doRestart() {
  restarting.value = true
  try {
    await invoke('restart_aria2')
    conn.setShowDiagnostics(false)
  } catch (e) {
    message.error(`重启失败：${String(e)}`)
  } finally {
    restarting.value = false
  }
}

watch(
  () => conn.showDiagnostics,
  (show) => {
    if (show) {
      fetchLogs()
      timer = setInterval(fetchLogs, 2000)
    } else {
      if (timer) clearInterval(timer)
      timer = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <NModal :show="conn.showDiagnostics" @update:show="conn.setShowDiagnostics">
    <div style="width: 600px; max-width: 90vw; background: var(--n-color, #fff); border-radius: 8px">
      <div style="padding: 24px">
        <h3 style="margin: 0 0 16px">aria2 诊断</h3>
        <NSpace vertical :size="12">
          <div>
            状态：
            <NTag :type="statusConfig[conn.status]?.type ?? 'default'" size="small">
              {{ statusConfig[conn.status]?.label ?? conn.status }}
            </NTag>
          </div>
          <div>重启次数：{{ restarts }}/3</div>
          <div style="font-size: 13px; opacity: 0.7; margin-bottom: 4px">aria2c 日志</div>
          <div
            style="
              max-height: 300px;
              overflow: auto;
              background: var(--n-color-target, #f5f5f5);
              border-radius: 4px;
              padding: 8px;
              font-family: monospace;
              font-size: 12px;
              white-space: pre-wrap;
              word-break: break-all;
            "
          >
            <div v-if="logs.length === 0" style="opacity: 0.5">暂无日志</div>
            <div v-for="(line, i) in logs" :key="i">{{ line }}</div>
          </div>
          <NSpace justify="end">
            <NButton :loading="restarting" type="primary" @click="doRestart">重启 aria2</NButton>
            <NButton @click="conn.setShowDiagnostics(false)">关闭</NButton>
          </NSpace>
        </NSpace>
      </div>
    </div>
  </NModal>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
pnpm test -- --run src/components/DiagnosticsModal.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```powershell
git add src/components/DiagnosticsModal.vue src/components/DiagnosticsModal.test.ts
git commit -m "feat(ui): DiagnosticsModal with status, logs, restart button"
```

---

## Task 8: Error Banner + TopBar Status Pill + TaskListView Wiring

**Files:**
- Modify: `src/components/TopBar.vue`
- Create: `src/components/TopBar.test.ts`
- Modify: `src/views/TaskListView.vue`

**Interfaces:**
- Consumes: `conn.showDiagnostics`/`setShowDiagnostics` from Task 6, `<DiagnosticsModal />` from Task 7
- Produces: TopBar with clickable status pill and disabled controls; TaskListView with error banner and DiagnosticsModal

- [ ] **Step 1: Write failing test for TopBar**

Create `src/components/TopBar.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useConnectionStore } from '@/stores/connection'
import TopBar from './TopBar.vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function mountTopBar() {
  return mount(
    {
      components: { NConfigProvider, NMessageProvider, NDialogProvider, TopBar },
      provide: { 'aria2-api': shallowRef(null) },
      template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <TopBar />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
    },
  )
}

describe('TopBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows correct status label when connected', () => {
    const conn = useConnectionStore()
    conn.setConnected()
    const wrapper = mountTopBar()
    expect(wrapper.text()).toContain('已连接')
  })

  it('shows error label when in error state', () => {
    const conn = useConnectionStore()
    conn.setError('boom')
    const wrapper = mountTopBar()
    expect(wrapper.text()).toContain('连接失败')
  })

  it('disables action buttons when disconnected', () => {
    const conn = useConnectionStore()
    conn.setError('boom')
    const wrapper = mountTopBar()
    const buttons = wrapper.findAll('button')
    const newText = buttons.find((b) => b.text().includes('新建'))
    expect(newText?.attributes('disabled')).toBeDefined()
  })

  it('opens diagnostics when status pill clicked', async () => {
    const conn = useConnectionStore()
    conn.setConnected()
    const wrapper = mountTopBar()
    const pill = wrapper.findAll('button').find((b) => b.text().includes('已连接'))
    expect(pill).toBeTruthy()
    await pill!.trigger('click')
    expect(conn.showDiagnostics).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- --run src/components/TopBar.test.ts
```
Expected: FAIL — TopBar doesn't show "已连接" label

- [ ] **Step 3: Update TopBar.vue**

Replace the entire `src/components/TopBar.vue`:

```vue
<script setup lang="ts">
import { NButton, NSpace, NInput, useMessage } from 'naive-ui'
import { inject, computed, type Ref } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import type { Aria2Api } from '@/composables/useAria2'

const conn = useConnectionStore()
const tasks = useTaskStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')
const message = useMessage()
const { themeMode, setTheme } = useTheme()

const emit = defineEmits<{ settings: []; 'new-task': [] }>()

async function run(fn: 'pauseAll' | 'unpauseAll', ok: string) {
  const c = api?.value?.client
  if (!c) return
  try {
    await c[fn]()
    api?.value?.refresh()
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

const statusColor = computed(() => {
  switch (conn.status) {
    case 'connected':
      return '#52c41a'
    case 'connecting':
      return '#1890ff'
    case 'reconnecting':
      return '#faad14'
    case 'error':
      return '#ff4d4f'
    default:
      return '#d9d9d9'
  }
})

const statusLabel = computed(() => {
  switch (conn.status) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'reconnecting':
      return '重连中'
    case 'error':
      return '连接失败'
    default:
      return '未连接'
  }
})

const disconnected = computed(() => conn.status !== 'connected')
</script>

<template>
  <div
    style="
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--n-border-color, #eee);
    "
  >
    <strong>AriaPanel</strong>
    <NButton size="small" type="primary" :disabled="disconnected" @click="emit('new-task')">+ 新建</NButton>
    <NSpace :size="8">
      <NButton size="small" :disabled="disconnected" @click="run('pauseAll', '全部暂停')">全部暂停</NButton>
      <NButton size="small" :disabled="disconnected" @click="run('unpauseAll', '全部继续')">全部继续</NButton>
    </NSpace>
    <NInput
      v-model:value="tasks.searchQuery"
      placeholder="搜索任务…"
      clearable
      size="small"
      style="width: 200px"
    />
    <NButton
      size="small"
      quaternary
      title="点击查看诊断"
      @click="conn.setShowDiagnostics(true)"
    >
      <template #icon>
        <span
          :style="{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: statusColor,
          }"
        />
      </template>
      {{ statusLabel }}
    </NButton>
    <NButton
      size="small"
      quaternary
      :title="`主题: ${themeMode}`"
      @click="cycleTheme"
      >{{ themeIcons[themeMode] }}</NButton
    >
    <NButton size="small" quaternary @click="emit('settings')">⚙</NButton>
  </div>
</template>
```

- [ ] **Step 4: Run TopBar test to verify it passes**

```powershell
pnpm test -- --run src/components/TopBar.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: Add error banner and DiagnosticsModal to TaskListView**

In `src/views/TaskListView.vue`, add imports:

Add to the `<script setup>` imports:

```typescript
import { useConnectionStore } from '@/stores/connection'
import { NAlert } from 'naive-ui'
import DiagnosticsModal from '@/components/DiagnosticsModal.vue'
```

Add after `const notification = useNotification()`:

```typescript
const conn = useConnectionStore()
```

In the `<template>`, add the error banner after the `<TopBar />` line and before the sidebar div. Also add `<DiagnosticsModal />` at the end. The template section becomes:

```html
<template>
  <div style="height: 100vh; display: flex; flex-direction: column">
    <TopBar @settings="settingsShow = true" @new-task="newTaskShow = true" />
    <NAlert
      v-if="conn.status === 'reconnecting'"
      type="warning"
      :bordered="false"
      style="border-radius: 0"
    >
      aria2 连接中…
    </NAlert>
    <NAlert
      v-if="conn.status === 'error' && conn.error"
      type="error"
      :bordered="false"
      style="border-radius: 0"
    >
      <div style="display: flex; align-items: center; justify-content: space-between">
        <span>{{ conn.error }}</span>
        <NButton size="small" type="error" @click="conn.setShowDiagnostics(true)">查看诊断</NButton>
      </div>
    </NAlert>
    <div style="display: flex; flex: 1; min-height: 0">
      <Sidebar />
      <div style="flex: 1; display: flex; flex-direction: column; min-width: 0">
        <BulkToolbar />
        <AddUrlBar ref="addUrlRef" :default-dir="api?.dir ?? ''" :on-add="onAdd" />
        <div style="flex: 1; overflow: auto" @contextmenu.prevent>
          <TaskTable
            :tasks="displayTasks"
            :operate="operate"
            @contextmenu="openContextMenu"
            @more="openContextMenu"
            @row-click="onRowClick"
          />
        </div>
      </div>
    </div>
    <TaskContextMenu
      :show="ctx.show"
      :x="ctx.x"
      :y="ctx.y"
      :status="ctx.status"
      :is-bittorrent="ctx.isBittorrent"
      @select="(op) => operate(ctx.gid, op)"
      @close="ctx.show = false"
    />
    <RetryDialog
      v-model:show="retry.show"
      :original-url="retry.url"
      :original-dir="retry.dir"
      :original-filename="retry.filename"
      :original-proxy="retry.proxy"
      :original-split="retry.split"
      @submit="submitRetry"
    />
    <TaskDetailDrawer :show="detailShow" :detail="detail" :operate="operate" @update:show="onDrawerClose" />
    <SettingsModal v-model:show="settingsShow" @saved="api?.refresh()" />
    <NewTaskModal v-model:show="newTaskShow" :default-dir="api?.dir ?? ''" @submitted="api?.refresh()" />
    <DiagnosticsModal />
  </div>
</template>
```

- [ ] **Step 6: Run lint + type check**

```powershell
pnpm lint; if ($?) { pnpm vue-tsc --noEmit }
```
Expected: 0 errors

- [ ] **Step 7: Run all tests**

```powershell
pnpm test -- --run
```
Expected: all tests pass

- [ ] **Step 8: Run full build**

```powershell
pnpm build
```
Expected: builds successfully

- [ ] **Step 9: Run cargo check (final)**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: 0 errors

- [ ] **Step 10: Commit**

```powershell
git add src/components/TopBar.vue src/components/TopBar.test.ts src/views/TaskListView.vue
git commit -m "feat(ui): error banner, TopBar status pill, diagnostics wiring"
```
