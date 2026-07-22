# AriaPanel M2 — 核心下载管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能完整管理 aria2 下载任务——单任务暂停/恢复/删除/强制/重试、批量操作、按状态分组过滤，且失败任务重试支持断点续传。

**Architecture:** Rust 零命令改动（仅 build_args 补续传参数），所有任务操作由前端直连 aria2 JSON-RPC。操作同步用「命令 + 即时刷新」：调 RPC 成功后触发 `Poller.refreshNow()` 拉一次权威状态，不乐观更新、不回滚。前端通过一个 `Aria2Api` service（`{client, refresh}`）注入组件。

**Tech Stack:** Rust/Tauri 2（aria2.rs）、Vue 3.5 + TS、Pinia、Naive UI、vitest。

## Global Constraints

- **平台/Shell**：Windows PowerShell。Rust/cargo 不在默认 PATH——每个 cargo 命令前加 `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`。
- **前端测试**：`pnpm test`（= `vitest run`）。指定文件 `pnpm test -- <path>`。
- **类型门禁**：`pnpm vue-tsc --noEmit` 必须 0 错误；`pnpm build`（= vue-tsc && vite build）必须成功。
- **路径别名**：`@` → `src/`（vite.config.ts + tsconfig.json 已配）。
- **naive-ui**：main.ts 已 `app.use(naive)` 全局注册组件；`useMessage`/`useDialog` 需 `NMessageProvider`/`NDialogProvider` 包裹（见 Task 6 改 AppShell）。
- **操作同步**：一律「命令 → 成功后 `refresh()` → 失败 `message.error()`」，**禁止**乐观更新 store。
- **删除**：单/批量删除都走 `NPopconfirm` 二次确认。
- **续传参数**：build_args 含 `--auto-file-renaming=false` + `--allow-overwrite=true`（Task 1）。
- **commit 风格**：`feat(scope): ...` / `fix(scope): ...`，参照已有 git log。
- **DRY/YAGNI/TDD**，无注释（除非计划代码块中有）。

---

## File Structure

**Rust**
- Modify `src-tauri/src/aria2.rs` — `build_args` 补续传参数（Task 1）

**前端类型/RPC（lib/aria2）**
- Modify `src/lib/aria2/types.ts` — `Aria2Task` 加 `dir` + `files[].uris`；新增 `TaskOp` 类型（Task 3，放 `src/lib/task-op.ts`）
- Modify `src/lib/aria2/rpc-client.ts` — 7 操作方法 + `addUri` options（Task 2/3）
- Test `src/lib/aria2/rpc-client.test.ts` — 操作方法 + addUri options（Task 2/3）
- Modify `src/lib/aria2/poller.ts` — `refreshNow()` + `inFlight` 防重入（Task 4）
- Test `src/lib/aria2/poller.test.ts` — refreshNow（Task 4）

**Store**
- Modify `src/stores/task.ts` — `selection` / `filter` / `visibleTasks` / 失效清理（Task 5）
- Test `src/stores/task.test.ts` — selection/filter/清理（Task 5）

**Service / 骨架**
- Modify `src/composables/useAria2.ts` — 导出 `Aria2Api`，`getApi()`（Task 6）
- Modify `src/App.vue` — provide `aria2-api`（Task 6）
- Modify `src/components/AppShell.vue` — 加 `NMessageProvider` + `NDialogProvider`（Task 6）

**UI 组件**
- Create `src/components/Sidebar.vue` — 左导航过滤 + 计数（Task 7）
- Create `src/components/TopBar.vue` — 全部暂停/继续 + 状态（Task 8）
- Modify `src/components/TaskTable.vue` — 复选框列 + 操作列 + 右键（Task 9）
- Test `src/components/TaskTable.test.ts` — 复选框/操作列（Task 9）
- Create `src/components/BulkToolbar.vue` — 批量删除确认 + 清空（Task 10）
- Create `src/components/TaskContextMenu.vue` — ⋮/右键菜单（Task 11）
- Create `src/components/RetryDialog.vue` — 更换链接重试（Task 11）
- Modify `src/views/TaskListView.vue` — 组装布局 + operate 处理（Task 12）
- Modify `src/i18n/locales/zh-CN.ts` — M2 文案（Task 12）

---

### Task 1: Rust — build_args 补断点续传参数

**Files:**
- Modify: `src-tauri/src/aria2.rs`（`build_args` 函数 + 其测试 mod）
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: 无
- Produces: `build_args` 输出含 `--auto-file-renaming=false` 与 `--allow-overwrite=true`，保证重 addUri 同名文件时续传而非建副本。

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/aria2.rs` 的 `mod tests` 中，找到现有测试 `build_args_sets_secret_dir_session`，在其后追加一个新测试：

```rust
    #[test]
    fn build_args_enables_resume_safety() {
        let a = build_args(&cfg());
        assert!(a.contains(&"--auto-file-renaming=false".to_string()));
        assert!(a.contains(&"--allow-overwrite=true".to_string()));
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml build_args_enables_resume_safety
```
Expected: FAIL（断言失败，参数不存在）。

- [ ] **Step 3: 写实现**

在 `build_args` 的 `vec![...]` 中，`"--file-allocation=none".into(),` 之后、`format!("--input-file=...")` 之前，插入两行：

```rust
        "--auto-file-renaming=false".into(),
        "--allow-overwrite=true".into(),
```

完整 `build_args` 变为：
```rust
pub fn build_args(cfg: &Aria2Config) -> Vec<String> {
    vec![
        "--enable-rpc".into(),
        "--rpc-listen-all=false".into(),
        "--rpc-allow-origin-all=false".into(),
        format!("--rpc-listen-port={}", cfg.port),
        format!("--rpc-secret={}", cfg.secret),
        format!("--dir={}", cfg.dir.display()),
        "--continue=true".into(),
        "--file-allocation=none".into(),
        "--auto-file-renaming=false".into(),
        "--allow-overwrite=true".into(),
        format!("--input-file={}", cfg.session.display()),
        format!("--save-session={}", cfg.session.display()),
        "--quiet=true".into(),
    ]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: 全部通过（原有测试 + 新增 1 个），0 warning。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/aria2.rs
git commit -m "feat(core): aria2 resume-safety args (auto-file-renaming=false, allow-overwrite=true)"
```

---

### Task 2: RPC — 任务操作方法

**Files:**
- Modify: `src/lib/aria2/rpc-client.ts`（Aria2Client 加 7 方法）
- Test: `src/lib/aria2/rpc-client.test.ts`

**Interfaces:**
- Consumes: 现有 `call<T>(method, params)`
- Produces: `pause(gid)` / `unpause(gid)` / `remove(gid)` / `forcePause(gid)` / `forceRemove(gid)` / `pauseAll()` / `unpauseAll()`，均返回 `Promise<unknown>`（aria2 返回 "OK"）。

- [ ] **Step 1: 写失败测试**

在 `src/lib/aria2/rpc-client.test.ts` 的 `describe('Aria2Client', ...)` 内追加：

```ts
  it('pause sends gid as second param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.pause('g1')
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.pause')
    expect(body.params).toEqual(['token:S', 'g1'])
  })

  it('pauseAll sends no extra params', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'OK' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.pauseAll()
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.pauseAll')
    expect(body.params).toEqual(['token:S'])
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected: FAIL（`c.pause` / `c.pauseAll` 不是函数）。

- [ ] **Step 3: 写实现**

在 `src/lib/aria2/rpc-client.ts` 的 `Aria2Client` 中，`addUri` 方法**之前**插入 7 个方法：

```ts
  pause(gid: string) { return this.call('aria2.pause', [gid]) }
  unpause(gid: string) { return this.call('aria2.unpause', [gid]) }
  remove(gid: string) { return this.call('aria2.remove', [gid]) }
  forcePause(gid: string) { return this.call('aria2.forcePause', [gid]) }
  forceRemove(gid: string) { return this.call('aria2.forceRemove', [gid]) }
  pauseAll() { return this.call('aria2.pauseAll') }
  unpauseAll() { return this.call('aria2.unpauseAll') }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected: 5 passed（原 3 + 新 2）。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/aria2/rpc-client.ts src/lib/aria2/rpc-client.test.ts
git commit -m "feat(rpc): aria2 task control methods (pause/unpause/remove/force*/pauseAll)"
```

---

### Task 3: RPC — addUri options + 类型扩展

**Files:**
- Modify: `src/lib/aria2/rpc-client.ts`（`addUri` 加 options）
- Modify: `src/lib/aria2/types.ts`（`Aria2Task` 加 `dir` + `files[].uris`）
- Create: `src/lib/task-op.ts`（共享 `TaskOp` 类型）
- Test: `src/lib/aria2/rpc-client.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `addUri(uris, options?)` 把 options 作为 `params[2]`；`Aria2Task.dir`、`Aria2Task.files[].uris`；`TaskOp` 类型供 UI 共享。

- [ ] **Step 1: 写失败测试**

在 `src/lib/aria2/rpc-client.test.ts` 追加：

```ts
  it('addUri passes options as third param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'gid-new' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.addUri(['http://x/f.bin'], { dir: '/dl', out: 'f.bin' })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.addUri')
    expect(body.params).toEqual(['token:S', ['http://x/f.bin'], { dir: '/dl', out: 'f.bin' }])
  })

  it('addUri without options omits third param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: 'gid-new' })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.addUri(['http://x/f.bin'])
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.params).toEqual(['token:S', ['http://x/f.bin']])
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected: FAIL（addUri 当前不传 options，第一个新测试 params 不符）。

- [ ] **Step 3: 写实现**

3a. 改 `src/lib/aria2/rpc-client.ts` 的 `addUri`：

```ts
  addUri(uris: string[], options?: Record<string, unknown>) {
    const params = options ? [uris, options] : [uris]
    return this.call<string>('aria2.addUri', params)
  }
```

3b. 改 `src/lib/aria2/types.ts` 的 `Aria2Task`：

```ts
export interface Aria2Task {
  gid: string
  status: 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error'
  totalLength: string
  completedLength: string
  downloadSpeed: string
  uploadSpeed: string
  dir: string
  files: Array<{
    path: string
    length: string
    completedLength: string
    selected: string
    uris: Array<{ uri: string; status: string }>
  }>
  bittorrent?: { info: { name?: string } }
  errorCode?: string
  errorMessage?: string
}
```

3c. 创建 `src/lib/task-op.ts`：

```ts
export type TaskOp =
  | 'pause' | 'unpause' | 'remove' | 'forcePause' | 'forceRemove'
  | 'retry' | 'retryWithUrl' | 'copyLink'
```

- [ ] **Step 4: 运行测试 + 类型确认**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected: 7 passed（原 5 + 新 2）。

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误（注意：测试文件里 `t(...)` 工厂函数需补 `dir` 与 `uris`——见 Step 3b 后，`task.test.ts` 的 `t()` helper 也要补字段，否则类型错。打开 `src/stores/task.test.ts`，把 helper 改为：

```ts
function t(gid: string, status: Aria2Task['status']): Aria2Task {
  return { gid, status, totalLength: '100', completedLength: '0', downloadSpeed: '0', uploadSpeed: '0', dir: '/dl', files: [{ path: 'D:/dl/f', length: '100', completedLength: '0', selected: 'true', uris: [] }] }
}
```

同理 `src/components/TaskTable.test.ts` 的 tasks 数据补 `dir: 'D:/dl'` 与每个 file 加 `uris: []`。补完后再跑 vue-tsc 直到 0 错误。）

- [ ] **Step 5: 提交**

```powershell
git add src/lib/aria2/rpc-client.ts src/lib/aria2/rpc-client.test.ts src/lib/aria2/types.ts src/lib/task-op.ts src/stores/task.test.ts src/components/TaskTable.test.ts
git commit -m "feat(rpc): addUri options + Aria2Task dir/uris + TaskOp type"
```

---

### Task 4: Poller — refreshNow + inFlight 防重入

**Files:**
- Modify: `src/lib/aria2/poller.ts`
- Test: `src/lib/aria2/poller.test.ts`

**Interfaces:**
- Consumes: 现有 `tick()`
- Produces: `refreshNow()`（清 pending 定时器并立即触发一次 tick）；`tick` 加 `inFlight` 守卫防重入。

- [ ] **Step 1: 写失败测试**

在 `src/lib/aria2/poller.test.ts` 的 `describe('Poller', ...)` 内追加：

```ts
  it('refreshNow triggers an immediate tick', async () => {
    const onTick = vi.fn()
    const p = new Poller(makeClient(0), onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)   // bootstrap probe
    expect(onTick).toHaveBeenCalledTimes(1)
    onTick.mockClear()
    p.refreshNow()
    await vi.advanceTimersByTimeAsync(0)   // refreshNow 立即触发，不等 5s
    expect(onTick).toHaveBeenCalledTimes(1)
    p.stop()
  })

  it('does not re-enter tick while one is in flight', async () => {
    let resolveTell!: () => void
    const slowClient = {
      tellActive: vi.fn(() => new Promise<any[]>(r => { resolveTell = () => r([]) })),
      tellWaiting: vi.fn(async () => []),
      tellStopped: vi.fn(async () => []),
    } as unknown as Aria2Client
    const onTick = vi.fn()
    const p = new Poller(slowClient, onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)   // tick 进行中（tellActive 未 resolve）
    p.refreshNow()                          // 试图再触发
    await vi.advanceTimersByTimeAsync(0)
    expect(slowClient.tellActive).toHaveBeenCalledTimes(1)  // 没有叠加第二次
    resolveTell()                           // 放行第一次
    await vi.advanceTimersByTimeAsync(0)
    p.stop()
  })
```

注意：第二个测试需要在文件顶部 import 已有 `import type { Aria2Client } from './rpc-client'`（已存在）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/aria2/poller.test.ts`
Expected: FAIL（`p.refreshNow` 不是函数；inFlight 不存在）。

- [ ] **Step 3: 写实现**

把 `src/lib/aria2/poller.ts` 整体替换为：

```ts
import type { Aria2Client } from './rpc-client'
import type { Aria2Task } from './types'

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private inFlight = false
  constructor(
    private client: Aria2Client,
    private onTick: (a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) => void,
  ) {}

  start() { this.schedule(0) }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null }

  refreshNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.schedule(0)
  }

  private schedule(ms: number) {
    this.timer = setTimeout(() => { this.tick() }, ms)
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
    } catch {
      /* 网络瞬断忽略，下次重试 */
    } finally {
      this.inFlight = false
      this.schedule(this.active ? 1000 : 5000)
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/lib/aria2/poller.test.ts`
Expected: 4 passed（原 2 + 新 2）。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/aria2/poller.ts src/lib/aria2/poller.test.ts
git commit -m "feat(rpc): poller refreshNow + inFlight reentry guard"
```

---

### Task 5: Store — selection / filter / visibleTasks / 失效清理

**Files:**
- Modify: `src/stores/task.ts`
- Test: `src/stores/task.test.ts`

**Interfaces:**
- Consumes: 现有 `active/waiting/stopped` 派生、`apply`
- Produces: `selection: Set<string>`、`filter`、`visibleTasks`、`toggleSelect/selectMany/clearSelection/selectAllVisible/setFilter`；`apply` 后自动清理失效 selection。

- [ ] **Step 1: 写失败测试**

在 `src/stores/task.test.ts` 的 `describe('useTaskStore', ...)` 内追加：

```ts
  it('toggles and clears selection', () => {
    const s = useTaskStore()
    s.toggleSelect('1')
    expect(s.selection.has('1')).toBe(true)
    s.toggleSelect('1')
    expect(s.selection.has('1')).toBe(false)
    s.selectMany(['1', '2'])
    expect(s.selection.size).toBe(2)
    s.clearSelection()
    expect(s.selection.size).toBe(0)
  })

  it('visibleTasks respects filter', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [t('2', 'waiting')], [t('3', 'complete')])
    s.setFilter('active')
    expect(s.visibleTasks.map(x => x.gid)).toEqual(['1'])
    s.setFilter('stopped')
    expect(s.visibleTasks.map(x => x.gid)).toEqual(['3'])
    s.setFilter('all')
    expect(s.visibleTasks.map(x => x.gid)).toEqual(['1', '2', '3'])
  })

  it('apply prunes selection of removed gids', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [t('2', 'waiting')], [])
    s.selectMany(['1', '2'])
    s.apply([t('1', 'active')], [], [])   // gid 2 没了
    expect(s.selection.has('2')).toBe(false)
    expect(s.selection.has('1')).toBe(true)
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/stores/task.test.ts`
Expected: FAIL（`s.selection` / `s.setFilter` / `s.visibleTasks` 不存在）。

- [ ] **Step 3: 写实现**

把 `src/stores/task.ts` 整体替换为：

```ts
import { defineStore } from 'pinia'
import { computed, ref, shallowReactive } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'

export type TaskFilter = 'all' | 'active' | 'waiting' | 'stopped'

export const useTaskStore = defineStore('task', () => {
  const tasks = shallowReactive(new Map<string, Aria2Task>())
  const order = ref<string[]>([])
  const selection = ref<Set<string>>(new Set())
  const filter = ref<TaskFilter>('all')

  const active = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && t.status === 'active'))
  const waiting = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'waiting' || t.status === 'paused')))
  const stopped = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'complete' || t.status === 'removed' || t.status === 'error')))

  const visibleTasks = computed(() => {
    switch (filter.value) {
      case 'active': return active.value
      case 'waiting': return waiting.value
      case 'stopped': return stopped.value
      default: return [...active.value, ...waiting.value, ...stopped.value]
    }
  })

  function apply(a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) {
    tasks.clear()
    const all = [...a, ...w, ...s]
    for (const t of all) tasks.set(t.gid, t)
    order.value = all.map(t => t.gid)
    const ids = new Set(all.map(t => t.gid))
    selection.value = new Set([...selection.value].filter(g => ids.has(g)))
  }

  function upsert(task: Aria2Task) {
    if (!tasks.has(task.gid)) order.value.push(task.gid)
    tasks.set(task.gid, task)
  }

  function clear() { tasks.clear(); order.value = [] }

  function toggleSelect(gid: string) {
    const next = new Set(selection.value)
    next.has(gid) ? next.delete(gid) : next.add(gid)
    selection.value = next
  }
  function selectMany(gids: string[]) {
    selection.value = new Set([...selection.value, ...gids])
  }
  function selectAllVisible() {
    selection.value = new Set(visibleTasks.value.map(t => t.gid))
  }
  function clearSelection() { selection.value = new Set() }
  function setFilter(f: TaskFilter) { filter.value = f }

  return {
    tasks, order, selection, filter, active, waiting, stopped, visibleTasks,
    apply, upsert, clear, toggleSelect, selectMany, selectAllVisible, clearSelection, setFilter,
  }
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/stores/task.test.ts`
Expected: 5 passed（原 2 + 新 3）。

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 5: 提交**

```powershell
git add src/stores/task.ts src/stores/task.test.ts
git commit -m "feat(store): task selection, filter, visibleTasks, stale-selection pruning"
```

---

### Task 6: Aria2Api service + App.vue provide + AppShell providers

**Files:**
- Modify: `src/composables/useAria2.ts`
- Modify: `src/App.vue`
- Modify: `src/components/AppShell.vue`

**Interfaces:**
- Consumes: `Poller.refreshNow`（Task 4）、`Aria2Client`
- Produces: `Aria2Api = { client: Aria2Client; refresh: () => void }`；组件 `inject<Ref<Aria2Api|null>>('aria2-api')`；AppShell 提供 `useMessage`/`useDialog` 上下文。

- [ ] **Step 1: 改 useAria2.ts**

把 `getClient` 替换为 `getApi`，并导出 `Aria2Api` 类型。修改 `src/composables/useAria2.ts`：

顶部 import 之后、`export function useAria2()` 之前加：
```ts
export interface Aria2Api {
  client: Aria2Client
  refresh: () => void
}
```

把函数末尾的：
```ts
  function getClient() { return client }

  return { start, getClient }
```
替换为：
```ts
  function getApi(): Aria2Api | null {
    if (!client || !poller) return null
    return { client, refresh: () => poller!.refreshNow() }
  }

  return { start, getApi }
```

- [ ] **Step 2: 改 App.vue**

把 `src/App.vue` 整体替换为：

```vue
<script setup lang="ts">
import { onMounted, provide, shallowRef, type Ref } from 'vue'
import { useAria2, type Aria2Api } from '@/composables/useAria2'

const aria = useAria2()
const apiRef = shallowRef<Aria2Api | null>(null)
provide<Ref<Aria2Api | null>>('aria2-api', apiRef)
onMounted(async () => {
  await aria.start()
  apiRef.value = aria.getApi()
})
</script>

<template>
  <router-view />
</template>
```

- [ ] **Step 3: 改 AppShell.vue 加 providers**

把 `src/components/AppShell.vue` 整体替换为：

```vue
<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider, darkTheme } from 'naive-ui'
import { useTheme } from '@/composables/useTheme'
const { mode } = useTheme()
</script>

<template>
  <NConfigProvider :theme="mode === 'dark' ? darkTheme : null">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <slot />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
```

- [ ] **Step 4: 验证类型与回归**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。（`Aria2Client` 的 import 若变成未使用会报错——确认 useAria2.ts 仍 import Aria2Client 用于类型，保留。）

Run: `pnpm test`
Expected: 全部通过（无回归；本任务无新单测，是胶水层）。

- [ ] **Step 5: 提交**

```powershell
git add src/composables/useAria2.ts src/App.vue src/components/AppShell.vue
git commit -m "feat(app): Aria2Api service (client+refresh) and naive providers"
```

---

### Task 7: UI — Sidebar 左导航过滤

**Files:**
- Create: `src/components/Sidebar.vue`

**Interfaces:**
- Consumes: `useTaskStore`（filter/setFilter/active/waiting/stopped 派生）、i18n。
- Produces: 4 个状态过滤项 + 计数；点选切换 `filter`。

- [ ] **Step 1: 创建组件**

创建 `src/components/Sidebar.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useTaskStore, type TaskFilter } from '@/stores/task'

const tasks = useTaskStore()

const items = computed(() => [
  { key: 'all' as TaskFilter, label: '全部', count: tasks.active.length + tasks.waiting.length + tasks.stopped.length },
  { key: 'active' as TaskFilter, label: '下载中', count: tasks.active.length },
  { key: 'waiting' as TaskFilter, label: '等待中', count: tasks.waiting.length },
  { key: 'stopped' as TaskFilter, label: '已完成', count: tasks.stopped.length },
])
</script>

<template>
  <nav style="width:170px;flex-shrink:0;border-right:1px solid var(--n-border-color,#eee);padding:8px 0">
    <button
      v-for="it in items" :key="it.key"
      @click="tasks.setFilter(it.key)"
      :style="{
        display:'flex',justifyContent:'space-between',alignItems:'center',
        width:'100%',padding:'6px 14px',border:'none',background:'transparent',cursor:'pointer',
        fontWeight: tasks.filter === it.key ? 700 : 400,
        color: tasks.filter === it.key ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
    >
      <span>{{ it.label }}</span>
      <span style="opacity:.6;font-size:12px">{{ it.count }}</span>
    </button>
    <div style="margin-top:16px;padding:0 14px;opacity:.4;font-size:12px">分类（M3）</div>
    <div style="padding:0 14px;opacity:.4;font-size:12px">速度统计（M3）</div>
  </nav>
</template>
```

- [ ] **Step 2: 验证类型**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 3: 提交**

```powershell
git add src/components/Sidebar.vue
git commit -m "feat(ui): sidebar with status filter and counts"
```

---

### Task 8: UI — TopBar 全部暂停/继续 + 状态

**Files:**
- Create: `src/components/TopBar.vue`

**Interfaces:**
- Consumes: `inject('aria2-api')`、`useConnectionStore`、`useMessage`。
- Produces: 顶栏——应用名 + 全部暂停/全部继续按钮 + 连接状态。

- [ ] **Step 1: 创建组件**

创建 `src/components/TopBar.vue`：

```vue
<script setup lang="ts">
import { NButton, NSpace, useMessage } from 'naive-ui'
import { inject, type Ref } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import type { Aria2Api } from '@/composables/useAria2'

const conn = useConnectionStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()

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
</script>

<template>
  <div style="padding:8px 12px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--n-border-color,#eee)">
    <strong>AriaPanel</strong>
    <NSpace :size="8">
      <NButton size="small" @click="run('pauseAll','全部暂停')">全部暂停</NButton>
      <NButton size="small" @click="run('unpauseAll','全部继续')">全部继续</NButton>
    </NSpace>
    <span style="margin-left:auto;font-size:12px;opacity:.7">{{ conn.status }}</span>
  </div>
</template>
```

- [ ] **Step 2: 验证类型**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 3: 提交**

```powershell
git add src/components/TopBar.vue
git commit -m "feat(ui): topbar with pause-all/resume-all and connection status"
```

---

### Task 9: UI — TaskTable 改造（复选框 + 操作列 + 右键）

**Files:**
- Modify: `src/components/TaskTable.vue`
- Test: `src/components/TaskTable.test.ts`

**Interfaces:**
- Consumes: `useTaskStore`（selection/toggleSelect/selectAllVisible/clearSelection）、`TaskOp`。
- Produces: 复选框列（行 + 表头全选）、操作列（随 status 的主按钮 + `⋮`）、右键菜单 emit。Props: `tasks: Aria2Task[]`、`operate: (gid: string, op: TaskOp) => void`。

- [ ] **Step 1: 改测试**

把 `src/components/TaskTable.test.ts` 整体替换为：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskTable from './TaskTable.vue'
import type { Aria2Task } from '@/lib/aria2/types'

function mkTask(gid: string, status: Aria2Task['status']): Aria2Task {
  return {
    gid, status, totalLength: '1000', completedLength: '500', downloadSpeed: '100', uploadSpeed: '0',
    dir: 'D:/dl', files: [{ path: 'D:/dl/file.bin', length: '1000', completedLength: '500', selected: 'true', uris: [{ uri: 'http://x/file.bin', status: 'used' }] }],
  }
}

describe('TaskTable', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders task name, progress and speed', () => {
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate: () => {} } })
    expect(w.text()).toContain('file.bin')
    expect(w.text()).toContain('50%')
    expect(w.text()).toContain('100 B/s')
  })

  it('shows pause button for active task', () => {
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate: () => {} } })
    expect(w.text()).toContain('暂停')
  })

  it('shows retry button for error task', () => {
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'error')], operate: () => {} } })
    expect(w.text()).toContain('重试')
  })

  it('emits operate with gid and op', async () => {
    const operate = vi.fn()
    const w = mount(TaskTable, { props: { tasks: [mkTask('g1', 'active')], operate } })
    await w.get('[data-op="pause"]').trigger('click')
    expect(operate).toHaveBeenCalledWith('g1', 'pause')
  })
})
```

（`vi` 需在 import 中：把第一行改为 `import { describe, it, expect, beforeEach, vi } from 'vitest'`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/components/TaskTable.test.ts`
Expected: FAIL（operate prop 不存在、`[data-op]` 找不到）。

- [ ] **Step 3: 写实现**

把 `src/components/TaskTable.vue` 整体替换为：

```vue
<script setup lang="ts">
import { NCheckbox, NProgress, NTable } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'
import type { TaskOp } from '@/lib/task-op'
import { useTaskStore } from '@/stores/task'

const props = defineProps<{
  tasks: Aria2Task[]
  operate: (gid: string, op: TaskOp) => void
}>()

const store = useTaskStore()

function name(t: Aria2Task): string {
  return t.bittorrent?.info?.name || t.files?.[0]?.path?.split(/[\\/]/).pop() || t.gid
}
function pct(t: Aria2Task): number {
  const total = Number(t.totalLength) || 0
  const done = Number(t.completedLength) || 0
  return total === 0 ? 0 : Math.round((done / total) * 100)
}
function fmtBytes(s: string): string {
  const n = Number(s)
  if (!n) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}
function primaryOp(t: Aria2Task): { op: TaskOp; label: string } | null {
  switch (t.status) {
    case 'active': return { op: 'pause', label: '暂停' }
    case 'paused': case 'waiting': return { op: 'unpause', label: '恢复' }
    case 'error': return { op: 'retry', label: '重试' }
    default: return null
  }
}

const rows = computed(() => props.tasks.map(t => ({ t, name: name(t), pct: pct(t), primary: primaryOp(t) })))
const allChecked = computed(() => props.tasks.length > 0 && props.tasks.every(t => store.selection.has(t.gid)))
function toggleAll(v: boolean) { v ? store.selectAllVisible() : store.clearSelection() }
</script>

<template>
  <NTable size="small" :bordered="false">
    <thead>
      <tr>
        <th style="width:32px"><NCheckbox :checked="allChecked" @update:checked="toggleAll" /></th>
        <th>名称</th><th>进度</th><th>速度</th><th>状态</th><th style="width:160px">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="r in rows" :key="r.t.gid" @contextmenu.prevent="operate(r.t.gid, 'copyLink')">
        <td><NCheckbox :checked="store.selection.has(r.t.gid)" @update:checked="store.toggleSelect(r.t.gid)" /></td>
        <td>{{ r.name }}</td>
        <td style="width:180px"><NProgress :percentage="r.pct" :height="10" /></td>
        <td>{{ fmtBytes(r.t.downloadSpeed) }}</td>
        <td>{{ r.t.status }}</td>
        <td>
          <template v-if="r.primary">
            <a data-op="pause" v-if="r.primary.op === 'pause'" style="margin-right:8px;cursor:pointer" @click="operate(r.t.gid, r.primary!.op)">{{ r.primary.label }}</a>
            <a data-op="unpause" v-else-if="r.primary.op === 'unpause'" style="margin-right:8px;cursor:pointer" @click="operate(r.t.gid, r.primary!.op)">{{ r.primary.label }}</a>
            <a data-op="retry" v-else style="margin-right:8px;cursor:pointer" @click="operate(r.t.gid, r.primary!.op)">{{ r.primary.label }}</a>
          </template>
          <a style="cursor:pointer" @click="operate(r.t.gid, 'remove')">删除</a>
          <a data-op="more" style="margin-left:8px;cursor:pointer" @click="operate(r.t.gid, 'forcePause')">⋮</a>
        </td>
      </tr>
    </tbody>
  </NTable>
</template>
```

说明：`⋮` 在 M2 临时挂到 forcePause（占位），真正的菜单组件在 Task 11 接入（Task 12 把 `⋮` 换成 TaskContextMenu 触发器）。右键当前先 emit `copyLink` 占位，Task 12 换成 TaskContextMenu。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/components/TaskTable.test.ts`
Expected: 4 passed。

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 5: 提交**

```powershell
git add src/components/TaskTable.vue src/components/TaskTable.test.ts
git commit -m "feat(ui): task table with checkbox column and status-aware actions"
```

---

### Task 10: UI — BulkToolbar 批量删除确认

**Files:**
- Create: `src/components/BulkToolbar.vue`

**Interfaces:**
- Consumes: `useTaskStore`（selection）、`inject('aria2-api')`、`useMessage`。
- Produces: 选中数显示 + 批量删除（NPopconfirm）+ 清空选择；选中数为 0 时隐藏。

- [ ] **Step 1: 创建组件**

创建 `src/components/BulkToolbar.vue`：

```vue
<script setup lang="ts">
import { NButton, NPopconfirm, useMessage } from 'naive-ui'
import { inject, type Ref } from 'vue'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'

const tasks = useTaskStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()

async function deleteSelected() {
  const c = api.value?.client
  if (!c) return
  const gids = [...tasks.selection]
  try {
    for (const gid of gids) await c.remove(gid)
    api.value!.refresh()
  } catch (e) {
    message.error(`删除失败：${String(e)}`)
    api.value!.refresh()
  }
}
</script>

<template>
  <div v-if="tasks.selection.size > 0" style="padding:6px 12px;display:flex;align-items:center;gap:8px;background:var(--n-color-target,#f5f5f5)">
    <span style="font-size:13px">已选 {{ tasks.selection.size }} 项</span>
    <NPopconfirm @positive-click="deleteSelected">
      <template #trigger><NButton size="tiny" type="error">删除选中</NButton></template>
      确认删除选中的 {{ tasks.selection.size }} 个任务？（已下载部分保留，可重试续传）
    </NPopconfirm>
    <NButton size="tiny" @click="tasks.clearSelection()">清空选择</NButton>
  </div>
</template>
```

- [ ] **Step 2: 验证类型**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 3: 提交**

```powershell
git add src/components/BulkToolbar.vue
git commit -m "feat(ui): bulk toolbar with confirm-delete and clear selection"
```

---

### Task 11: UI — TaskContextMenu + RetryDialog

**Files:**
- Create: `src/components/TaskContextMenu.vue`
- Create: `src/components/RetryDialog.vue`

**Interfaces:**
- Consumes: `TaskOp`、`Aria2Task`（取原 URL）。
- Produces: `TaskContextMenu`（NDropdown，emit `select(op)`）；`RetryDialog`（v-model:show + 预填原 URL，emit `submit(url)`）。

- [ ] **Step 1: 创建 TaskContextMenu**

创建 `src/components/TaskContextMenu.vue`：

```vue
<script setup lang="ts">
import { NDropdown } from 'naive-ui'
import type { TaskOp } from '@/lib/task-op'

const props = defineProps<{ show: boolean; x: number; y: number; status: Aria2TaskLike['status'] }>()
const emit = defineEmits<{ select: [op: TaskOp]; close: [] }>()

type Aria2TaskLike = { status: 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error' }

function options() {
  const base: { label: string; key: TaskOp }[] = [{ label: '复制链接', key: 'copyLink' }]
  if (props.status === 'active') base.push({ label: '暂停', key: 'pause' })
  if (props.status === 'paused' || props.status === 'waiting') base.push({ label: '恢复', key: 'unpause' })
  base.push({ label: '强制暂停', key: 'forcePause' })
  base.push({ label: '更换链接重试', key: 'retryWithUrl' })
  base.push({ label: '删除', key: 'remove' })
  base.push({ label: '强制删除', key: 'forceRemove' })
  return base
}
function pick(key: string) {
  emit('select', key as TaskOp)
  emit('close')
}
</script>

<template>
  <NDropdown
    placement="bottom-start"
    trigger="manual"
    :show="show"
    :x="x" :y="y"
    :options="options()"
    @select="pick"
    @clickoutside="emit('close')"
  />
</template>
```

- [ ] **Step 2: 创建 RetryDialog**

创建 `src/components/RetryDialog.vue`：

```vue
<script setup lang="ts">
import { NButton, NInput, NModal } from 'naive-ui'
import { ref, watch } from 'vue'

const props = defineProps<{ show: boolean; originalUrl: string }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; submit: [url: string] }>()

const url = ref(props.originalUrl)
watch(() => props.show, v => { if (v) url.value = props.originalUrl })

function ok() {
  const v = url.value.trim()
  if (v) emit('submit', v)
  emit('update:show', false)
}
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="dialog" title="更换链接重试">
    <div style="padding:8px 0">
      <NInput v-model:value="url" type="text" placeholder="下载链接" @keydown.enter="ok" />
    </div>
    <template #action>
      <NButton @click="emit('update:show', false)">取消</NButton>
      <NButton type="primary" @click="ok">重试</NButton>
    </template>
  </NModal>
</template>
```

- [ ] **Step 3: 验证类型**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 4: 提交**

```powershell
git add src/components/TaskContextMenu.vue src/components/RetryDialog.vue
git commit -m "feat(ui): task context menu and retry-with-new-url dialog"
```

---

### Task 12: UI — TaskListView 组装 + operate 处理 + i18n + 冒烟

**Files:**
- Modify: `src/views/TaskListView.vue`
- Modify: `src/i18n/locales/zh-CN.ts`

**Interfaces:**
- Consumes: 所有 M2 组件 + `Aria2Api` + `useMessage` + `useDialog`。
- Produces: 完整 M2 布局；`operate(gid, op)` 执行命令→refresh→失败 toast；右键菜单 + 重试弹窗串联。

- [ ] **Step 1: 补 i18n 文案**

把 `src/i18n/locales/zh-CN.ts` 整体替换为：

```ts
export default {
  app: { title: 'AriaPanel' },
  nav: { all: '全部', active: '下载中', waiting: '等待中', completed: '已完成' },
  table: { name: '名称', size: '大小', progress: '进度', speed: '速度', status: '状态', action: '操作' },
  status: { connecting: '连接中…', reconnecting: '重连中…', error: '连接错误', connected: '已连接' },
  add: { placeholder: '粘贴下载链接，回车开始', button: '添加' },
  action: { pause: '暂停', unpause: '恢复', remove: '删除', forcePause: '强制暂停', forceRemove: '强制删除', retry: '重试', retryWithUrl: '更换链接重试', copyLink: '复制链接', pauseAll: '全部暂停', unpauseAll: '全部继续' },
}
```

- [ ] **Step 2: 改 TaskListView**

把 `src/views/TaskListView.vue` 整体替换为：

```vue
<script setup lang="ts">
import { ref, inject, type Ref } from 'vue'
import { useMessage } from 'naive-ui'
import AppShell from '@/components/AppShell.vue'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
import BulkToolbar from '@/components/BulkToolbar.vue'
import TaskTable from '@/components/TaskTable.vue'
import TaskContextMenu from '@/components/TaskContextMenu.vue'
import RetryDialog from '@/components/RetryDialog.vue'
import AddUrlBar from '@/components/AddUrlBar.vue'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'
import type { TaskOp } from '@/lib/task-op'

const tasks = useTaskStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')!
const message = useMessage()

const ctx = ref({ show: false, x: 0, y: 0, gid: '', status: 'active' as 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error' })
const retry = ref({ show: false, gid: '', url: '' })

function basename(p: string) { return p.split(/[\\/]/).pop() || p }

async function operate(gid: string, op: TaskOp) {
  const c = api.value?.client
  if (!c) return
  const t = tasks.tasks.get(gid)
  try {
    switch (op) {
      case 'pause': await c.pause(gid); break
      case 'unpause': await c.unpause(gid); break
      case 'remove': await c.remove(gid); break
      case 'forcePause': await c.forcePause(gid); break
      case 'forceRemove': await c.forceRemove(gid); break
      case 'copyLink':
        if (t) await navigator.clipboard?.writeText(t.files[0]?.uris[0]?.uri ?? '')
        return
      case 'retry': {
        if (!t) return
        const url = t.files[0]?.uris[0]?.uri ?? ''
        const out = basename(t.files[0]?.path ?? '')
        await c.remove(gid)
        await c.addUri([url], { dir: t.dir, out })
        break
      }
      case 'retryWithUrl': {
        if (!t) return
        retry.value = { show: true, gid, url: t.files[0]?.uris[0]?.uri ?? '' }
        return
      }
    }
    api.value!.refresh()
  } catch (e) {
    message.error(`操作失败：${String(e)}`)
    api.value!.refresh()
  }
}

async function submitRetry(url: string) {
  const c = api.value?.client
  const t = tasks.tasks.get(retry.value.gid)
  if (!c || !t) return
  const out = basename(t.files[0]?.path ?? '')
  try {
    await c.remove(retry.value.gid)
    await c.addUri([url], { dir: t.dir, out })
    api.value!.refresh()
  } catch (e) {
    message.error(`重试失败：${String(e)}`)
    api.value!.refresh()
  }
}

function onContextmenu(gid: string, e: MouseEvent) {
  const t = tasks.tasks.get(gid)
  if (!t) return
  ctx.value = { show: true, x: e.clientX, y: e.clientY, gid, status: t.status }
}
</script>

<template>
  <AppShell>
    <TopBar />
    <div style="display:flex;flex:1;min-height:0">
      <Sidebar />
      <div style="flex:1;display:flex;flex-direction:column;min-width:0">
        <BulkToolbar />
        <AddUrlBar :on-add="(u:string) => api?.client?.addUri([u]).then(()=>api?.refresh()).catch((e)=>message.error(String(e)))" />
        <div style="flex:1;overflow:auto" @contextmenu.prevent>
          <TaskTable :tasks="tasks.visibleTasks" :operate="operate" />
        </div>
      </div>
    </div>
    <TaskContextMenu
      :show="ctx.show" :x="ctx.x" :y="ctx.y" :status="ctx.status"
      @select="(op) => operate(ctx.gid, op)" @close="ctx.show = false"
    />
    <RetryDialog v-model:show="retry.show" :original-url="retry.url" @submit="submitRetry" />
  </AppShell>
</template>
```

注意：TaskTable 的右键菜单——Task 9 里 TaskTable 自身 emit operate（行内按钮）；右键菜单的触发需要 TaskTable 把 contextmenu 事件透传。在 Task 9 的实现中，TaskTable 的 `<tr @contextmenu.prevent>` 已 prevent 默认；为让 TaskListView 的 `onContextmenu` 拿到 gid，把 Task 9 TaskTable 的 `<tr>` 行改为：

```vue
      <tr v-for="r in rows" :key="r.t.gid" @contextmenu.prevent="$emit('contextmenu', r.t.gid, $event)">
```
并在 TaskTable 的 defineProps 后加：
```ts
defineEmits<{ contextmenu: [gid: string, e: MouseEvent] }>()
```
然后 TaskListView 的 `<TaskTable ... @contextmenu="onContextmenu" />`。**回到 Task 9 的文件补上这两处**（emit 声明 + tr 的 @contextmenu），再继续。

- [ ] **Step 3: 验证类型 + 全套测试 + 构建**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

Run: `pnpm test`
Expected: 全部通过（rpc 9 + poller 4 + store 5 + TaskTable 4 = 22）。

Run: `pnpm build`
Expected: 成功（chunk 大小警告可忽略）。

- [ ] **Step 4: 手工冒烟（tauri dev）**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
pnpm tauri dev
```
逐项核对 spec §8 验证清单：
1. 暂停/恢复状态即时变化。
2. 单任务删除（确认）消失；强制删除可用。
3. 批量选中→计数→删除（确认）；清空选择。
4. 全部暂停/全部继续。
5. 左导航过滤 + 计数准确。
6. **断点续传**：下 `https://speed.hetzner.de/100MB.bin` 至部分 → remove → 默认重试，确认续传不重建副本；再测更换链接重试。
7. error 任务行内重试 + 更换链接重试弹窗。
8. 右键菜单各项。
9. 操作失败 toast。

- [ ] **Step 5: 提交**

```powershell
git add src/views/TaskListView.vue src/i18n/locales/zh-CN.ts src/components/TaskTable.vue
git commit -m "feat(ui): assemble M2 task management layout with operate wiring"
```

---

## 自审（Self-Review）

**Spec 覆盖**：
- §1 范围/成功标准 → Task 1-12 全覆盖（操作 Task 2、批量 Task 10、过滤 Task 5/7、续传 Task 1/3/12）。
- §2 架构/数据流（命令+即时刷新）→ Task 6（Aria2Api.refresh）+ Task 8/10/12（操作后 refresh）。
- §3 数据层（client 方法/refreshNow/store）→ Task 2/3/4/5。
- §4 断点续传（参数/dir/out/重试路径）→ Task 1（参数）+ Task 3（dir/uris/addUri options）+ Task 12（重试用 {dir,out}）。
- §5 UI（6 组件 + 操作列 + 右键 + 重试弹窗）→ Task 7-12。
- §6 测试 → 每个数据层任务含单测；§8 验证清单 → Task 12 Step 4。

**占位扫描**：无 TBD/TODO；Task 9 的 `⋮→forcePause` 占位已在 Task 12 自审段说明回填 contextmenu emit，非遗留占位。

**类型一致**：`TaskOp`（Task 3 定义）在 Task 9/11/12 引用一致；`Aria2Api`（Task 6）在 Task 8/10/12 引用一致；`TaskFilter`（Task 5）在 Task 7 引用一致；`Aria2Task.dir/uris`（Task 3）在 Task 12 重试引用一致；`refreshNow`（Task 4）→ `Aria2Api.refresh`（Task 6）链路一致。

**已知执行注意**：
- Task 3 改类型后，`task.test.ts` 与 `TaskTable.test.ts` 的测试数据需同步补 `dir`/`uris`（已在 Task 3 Step 4 说明）。
- Task 9→12 有一次回填（contextmenu emit），Task 12 Step 2 已显式提示。
