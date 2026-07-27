# AriaPanel M5: Reliability — Crash Recovery, Diagnostics, Error Handling

- **Status**: Approved, pending implementation
- **Date**: 2026-07-27
- **Milestone**: M5
- **Depends on**: M1-M4b (merged), tech debt remediation (merged)

## 1. Problem Statement

AriaPanel's v1 success criteria (design spec section 8) require that "crashes can recover unfinished tasks" and that errors are surfaced to the user. Currently:

1. **Crash recovery is dead code**: `Supervisor.ensure_alive()` exists in `aria2.rs:124` but is never called. If aria2c crashes mid-session, nothing restarts it and the frontend is never notified.
2. **No diagnostics**: On startup failure or crash, the frontend only sets `conn.setError('aria2 启动失败')`. There is no way to view aria2c logs or manually restart.
3. **Silent connection failures**: The Poller catches RPC errors silently (`catch { /* ignore */ }`). The WsNotifier reconnects with exponential backoff but never updates the connection store. The user has no feedback during disconnection.
4. **No error banner**: The only connection-status display is raw `{{ conn.status }}` text in TopBar. No banner, no disabled controls.

## 2. Scope

### In scope

- **Rust**: Wire crash recovery via stderr reader thread; capture stderr to in-memory ring buffer; add commands for logs, restart count, and manual restart.
- **Frontend**: Track poller RPC failures; listen for aria2 lifecycle events; show error banner; disable controls during disconnection; diagnostics modal with logs and restart.

### Out of scope

- `.torrent`/`.metalink` file support (M6)
- BT selective download / peers / seed control (M6)
- Self-update / Tauri updater (P2)
- Tray speed badge (P2)
- WS notifier updating conn store directly (poller failure tracking covers this)

## 3. Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Crash detection | Stderr reader EOF | Pipe already exists; EOF gives instant detection without polling; reader is mandatory anyway (unread pipe blocks aria2c) |
| Log capture | In-memory ring buffer (200 lines) | Fast, no disk I/O, sufficient for diagnostics |
| Diagnostics access | Auto-popup on fatal + manual from TopBar | User can proactively check logs; auto-popup ensures errors are noticed |
| RPC failure tracking | Consecutive failure threshold (3) | Covers transient network issues and aria2c crashes; avoids false positives from single dropped polls |
| WsNotifier conn updates | No — poller covers it | WS is notification-only (optimization); RPC failure tracking already detects aria2c crashes; avoids state conflicts between two independent signals |
| Process type | Keep `std::process::Child` | No tokio::process migration needed; stderr reader runs in a std thread (blocking I/O — ideal for threads) |

## 4. Architecture

### 4.1 Rust: Crash Recovery & Log Capture

#### LogBuffer

A shared ring buffer stored in `AppState`:

```rust
pub type LogBuffer = Arc<Mutex<VecDeque<String>>>;
```

- Capacity: 200 lines. When full, oldest line is evicted.
- Cloned for both `AppState` (read access via command) and the stderr reader thread (write access).

#### Stderr Reader Thread

After `Supervisor.start()` succeeds, `child.stderr` is taken from the `Child` and passed to a dedicated `std::thread`:

```rust
fn spawn_stderr_reader(
    stderr: ChildStderr,
    buffer: LogBuffer,
    intentional_stop: Arc<AtomicBool>,
    app: AppHandle,
)
```

The thread:
1. Reads stderr line-by-line via `BufReader::lines()`, pushing each line to the ring buffer.
2. On EOF (loop exits): checks `intentional_stop`.
   - If `true`: thread exits silently (expected shutdown).
   - If `false`: triggers crash recovery.

#### Crash Recovery Flow

When the stderr reader detects unexpected EOF:

1. Emit `aria2://crashed` (frontend shows "reconnecting" banner).
2. Spawn an async recovery task via `tauri::async_runtime::spawn`:
   a. Lock `Supervisor`, call `ensure_alive()` (increments `restarts`, spawns new aria2c, health check).
   b. If success: take new stderr, spawn new reader thread, emit `aria2://restarted` with endpoint.
   c. If failure (limit exceeded or health check failed): emit `aria2://failed`.

#### Intentional Stop Flag

```rust
// In AppState
pub intentional_stop: Arc<AtomicBool>,
```

- Callers (lib.rs exit handler, commands.rs `save_settings`/`restart_aria2`) set `intentional_stop = true` on `AppState` before calling `Supervisor.shutdown()` or `Supervisor.restart()`.
- After the new process starts: set `intentional_stop = false`.
- The stderr reader thread holds a clone of the `Arc<AtomicBool>` and checks it on EOF to distinguish crash from expected shutdown.
- `Supervisor` itself does not own or know about this flag — it is purely an `AppState` concern.

#### Event Flow

```
aria2c crash
  -> stderr reader EOF
  -> emit "aria2://crashed"
  -> ensure_alive()
     -> success -> emit "aria2://restarted" (frontend: reconnect WS/RPC)
     -> failure -> emit "aria2://failed"    (frontend: show diagnostics)
```

### 4.2 Rust: New Commands

#### `get_aria2_logs`

```rust
#[tauri::command]
pub fn get_aria2_logs(state: State<'_, AppState>) -> Vec<String>
```

Returns a snapshot of the ring buffer (oldest first). Called by the diagnostics modal on open and every 2s while open.

#### `get_restarts_count`

```rust
#[tauri::command]
pub fn get_restarts_count(state: State<'_, AppState>) -> u32
```

Returns `Supervisor.restarts_count()`. Displayed in diagnostics as "X/3".

#### `restart_aria2`

```rust
#[tauri::command]
pub async fn restart_aria2(state: State<'_, AppState>, app: AppHandle) -> Result<(), String>
```

Manual restart from diagnostics panel. Flow:
1. Set `intentional_stop = true`.
2. Shutdown current aria2c (graceful RPC shutdown + wait + kill).
3. Reset `restarts = 0` (manual restart doesn't count toward crash limit).
4. Start new aria2c with same config.
5. Take new stderr, spawn new reader thread.
6. Set `intentional_stop = false`.
7. Emit `aria2://restarted` with current endpoint.
8. Return `Ok(())` on success, `Err(message)` on failure.

### 4.3 Frontend: Connection State

#### Poller Failure Tracking

Add a `failCount` counter and optional `onStatus` callback to `Poller`:

```ts
constructor(
    private client: Aria2Client,
    private onTick: (a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) => void,
    private onStatus?: (connected: boolean) => void,
)
```

- On tick success: if `failCount >= 3`, call `onStatus(true)` (recovered). Reset `failCount = 0`.
- On tick failure: increment `failCount`. If `failCount === 3`, call `onStatus(false)` (disconnected).
- Single failures (1-2) do not trigger state change — avoids flicker on transient network blips.

#### Event Listeners in useAria2

Consolidate all aria2 lifecycle event listeners into `useAria2.start()`:

| Event | Action |
|-------|--------|
| `aria2://crashed` | `conn.setReconnecting('aria2 进程异常，正在重启…')` |
| `aria2://restarted` | `reconnect(endpoint)` + `conn.setConnected()` + update `apiRef` |
| `aria2://failed` | `conn.setError('aria2 启动失败')` + `conn.showDiagnostics = true` |

The `aria2://restarted` listener currently lives in `App.vue`. It moves to `useAria2` for consolidation. The `reconnect` method already exists and creates new `Aria2Client` + `Poller` + `WsNotifier`. After reconnect, `getApi()` returns the updated API object.

#### Connection Store: Diagnostics Visibility

Add to `useConnectionStore`:

```ts
const showDiagnostics = ref(false)
const setShowDiagnostics = (v: boolean) => { showDiagnostics.value = v }
```

- Set to `true` on `aria2://failed` (auto-popup).
- Set to `true` on TopBar status pill click (manual access).
- Set to `false` on diagnostics modal close.

### 4.4 Frontend: Diagnostics Modal

#### Component: `DiagnosticsModal.vue`

An `NModal` controlled by `conn.showDiagnostics`.

**Layout:**

```
+----------------------------------+
|  aria2 诊断                      |
+----------------------------------+
|  状态: [NTag colored by status]  |
|  重启次数: X/3                    |
|                                  |
|  -- aria2c 日志 --               |
|  +------------------------------+|
|  | [WARN] ...                   ||
|  | [ERROR] ...                  ||
|  | (monospace, auto-scroll)     ||
|  +------------------------------+|
|                                  |
|         [重启 aria2]  [关闭]     |
+----------------------------------+
```

**Behavior:**
- On open: fetch `get_aria2_logs` + `get_restarts_count`.
- While open: poll both every 2s (interval cleared on close, same pattern as `useDetailPoller`).
- Status tag: NTag with `type="success"` (connected), `type="warning"` (reconnecting), `type="error"` (error).
- Log display: scrollable container with monospace font, auto-scroll to bottom on new logs.
- Restart button: `loading` state while `invoke('restart_aria2')` is in flight. On success, modal closes (the `aria2://restarted` event handles reconnection). On failure, error message shown via `useMessage`.
- Close button: sets `conn.showDiagnostics = false`.

**Props/emits:** None — reads directly from connection store.

#### Rendering

In `TaskListView.vue`, alongside existing components:

```vue
<TaskTable ... />
<DiagnosticsModal />
```

The modal teleports to `document.body` via NModal, so placement in the template is flexible.

### 4.5 Frontend: Error Banner & Disabled Controls

#### Error Banner

In `TaskListView.vue`, an `NBanner` rendered between TopBar and TaskTable when `conn.status` is `'reconnecting'` or `'error'`:

| Status | Banner type | Message | Action |
|--------|-------------|---------|--------|
| `reconnecting` | `warning` | "aria2 连接中…" | None |
| `error` | `error` | `conn.error` | "查看诊断" button -> `conn.setShowDiagnostics(true)` |

Banner is hidden when `conn.status === 'connected'` or `'connecting'` or `'idle'`.

#### TopBar: Status Pill

Replace the raw `{{ conn.status }}` text (TopBar.vue:53) with a clickable status pill:

| Status | Color | Label |
|--------|-------|-------|
| `connected` | green | 已连接 |
| `connecting` | blue | 连接中 |
| `reconnecting` | yellow (pulsing) | 重连中 |
| `error` | red | 连接失败 |
| `idle` | gray | 未连接 |

Clicking the pill opens diagnostics (`conn.setShowDiagnostics(true)`).

#### Disabled Controls

When `conn.status !== 'connected'`:
- TopBar: `+ 新建`, `全部暂停`, `全部继续` buttons get `:disabled="conn.status !== 'connected'"`.
- Task operations (context menu, bulk toolbar): operations will naturally fail with an error message via existing try/catch. No additional guarding needed.

## 5. File Changes

### Rust

| File | Changes |
|------|---------|
| `src-tauri/src/aria2.rs` | Modify `start()` to take `child.stderr` out of the `Child` and return `(bool, Option<ChildStderr>)` instead of `bool`; no changes to `Supervisor` struct itself |
| `src-tauri/src/commands.rs` | Add `logs: LogBuffer` and `intentional_stop: Arc<AtomicBool>` to `AppState` struct; add `get_aria2_logs`, `get_restarts_count`, `restart_aria2` commands |
| `src-tauri/src/lib.rs` | Spawn stderr reader thread after initial `start()`; register new commands in `invoke_handler`; refactor initial startup to extract stderr and pass to reader |

### Frontend

| File | Changes |
|------|---------|
| `src/lib/aria2/poller.ts` | Add `failCount` counter + `onStatus` callback parameter |
| `src/lib/aria2/poller.test.ts` | Test failure counting, threshold trigger, recovery reset |
| `src/composables/useAria2.ts` | Consolidate event listeners (crashed/restarted/failed); wire poller `onStatus` to conn store; pass `onStatus` when constructing Poller |
| `src/stores/connection.ts` | Add `showDiagnostics` ref + `setShowDiagnostics` action |
| `src/stores/connection.test.ts` | Test `showDiagnostics` state transitions |
| `src/components/TopBar.vue` | Replace raw status text with clickable status pill; disable buttons when disconnected |
| `src/components/TopBar.test.ts` | Test pill rendering, click opens diagnostics, button disabled states |
| `src/views/TaskListView.vue` | Add NBanner for reconnecting/error; render `<DiagnosticsModal />` |
| `src/views/TaskListView.test.ts` | Test banner visibility by conn status |

### New files

| File | Purpose |
|------|---------|
| `src/components/DiagnosticsModal.vue` | Diagnostics modal: status, restart count, logs, restart button |
| `src/components/DiagnosticsModal.test.ts` | Modal rendering, log fetching, restart flow, interval cleanup |

## 6. Edge Cases

- **stderr pipe full**: If the reader thread is slow, the pipe buffer fills and aria2c blocks on stderr write. The reader thread processes lines as fast as possible; 200-line ring buffer eviction is O(1). This is not expected to be a problem in practice.
- **Restart during active downloads**: aria2c session file (`--save-session`) persists task state. On restart, aria2c reads the session file and resumes incomplete tasks. Brief gap during restart is expected.
- **Multiple rapid crashes**: If aria2c crashes 3 times in quick succession, `ensure_alive()` refuses the 4th restart and emits `aria2://failed`. User must manually restart from diagnostics.
- **Diagnostics open during reconnect**: Modal stays open showing "reconnecting" status. When `aria2://restarted` fires, conn status updates to connected. Modal can be manually closed.
- **App exit during crash recovery**: `ExitRequested` handler calls `supervisor.shutdown()`. If crash recovery is mid-flight, the `intentional_stop` flag and `allow_exit` flag ensure clean termination.
- **Manual restart resets counter**: `restart_aria2` resets `restarts = 0`, giving users a fresh crash budget after manual intervention.

## 7. Testing Strategy

### Rust tests

- `Supervisor.intentional_stop` flag set/clear during shutdown/restart
- `LogBuffer` ring buffer push/evict/snapshot
- `restart_aria2` command resets restart count (mock or integration)

### Frontend tests

- **Poller**: consecutive failure counting; `onStatus(false)` at threshold 3; `onStatus(true)` on recovery; no trigger for 1-2 failures
- **Connection store**: `showDiagnostics` set/unset
- **DiagnosticsModal**: renders status tag by conn status; fetches logs on mount; restart button calls `invoke`; interval cleaned up on unmount; close button sets `showDiagnostics = false`
- **TopBar**: status pill renders correct color/label by conn status; clicking pill opens diagnostics; buttons disabled when disconnected
- **TaskListView**: error banner visible for reconnecting/error; hidden for connected

## 8. Sequence Diagrams

### Normal startup

```
App.vue onMounted
  -> useAria2.start()
  -> Rust: spawn aria2c, health check
  -> Rust: spawn stderr reader thread
  -> Rust: emit "aria2://started"
  -> Frontend: conn.setConnected()
  -> Poller starts, WsNotifier starts
```

### Crash recovery

```
aria2c crashes
  -> stderr reader: EOF, intentional_stop == false
  -> emit "aria2://crashed"
  -> Frontend: conn.setReconnecting()
  -> Frontend: error banner shows "连接中..."
  -> Frontend: TopBar buttons disabled
  -> Rust: ensure_alive() -> start() -> health_check
  -> success: take new stderr, spawn new reader
  -> emit "aria2://restarted"
  -> Frontend: reconnect(endpoint), conn.setConnected()
  -> Frontend: banner clears, buttons enabled
```

### Crash limit exceeded

```
aria2c crashes (4th time)
  -> stderr reader: EOF
  -> emit "aria2://crashed"
  -> Rust: ensure_alive() -> can_restart() == false
  -> emit "aria2://failed"
  -> Frontend: conn.setError(), conn.showDiagnostics = true
  -> Frontend: diagnostics modal auto-opens with logs
  -> User clicks "重启 aria2"
  -> Rust: restart_aria2() -> reset count, start, emit "aria2://restarted"
  -> Frontend: reconnect, conn.setConnected()
```

### Manual diagnostics access

```
User clicks TopBar status pill
  -> conn.setShowDiagnostics(true)
  -> DiagnosticsModal opens
  -> Fetches get_aria2_logs + get_restarts_count
  -> Polls every 2s while open
  -> User clicks close
  -> conn.setShowDiagnostics(false)
```
