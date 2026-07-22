# AriaPanel M2 — 核心下载管理 设计

- **日期**：2026-07-22
- **里程碑**：M2（核心下载管理）
- **前置**：M1 地基已完成并合入 master（aria2 进程生命周期 + RPC 端点 + 只读任务列表）
- **状态**：已确认，待出实现计划

## 1. 目标与范围

### 1.1 目标
让用户能完整管理下载任务：对单个任务做暂停/恢复/删除/重试、按状态分组过滤、批量操作，且操作后 UI 在几十毫秒内反映 aria2 的真实状态。失败的任务不丢已下载部分，重试支持断点续传。

### 1.2 成功标准
- 单任务：暂停/恢复/删除/强制暂停/强制删除/重试（原 URL）/更换链接重试，均可用且操作后 UI 即时一致。
- 批量：多选删除（带确认）、顶栏全部暂停/全部继续。
- 分组：左导航按 全部/下载中/等待中/已完成 过滤任务列表，带计数。
- 断点续传：大文件下载中途 remove 后重试（原 URL 或换链接），从已下载部分继续、不重建副本。

### 1.3 不做（推 M3+）
详情抽屉、分类、设置 modal、新建下载 modal（M2 保留 M1 的简陋 AddUrlBar）、系统托盘、剪贴板监听、BT 细节、UI 偏好持久化、右键「打开文件夹」（需 shell 权限）。

## 2. 架构与数据流

### 2.1 分层（M1 不变）
- **Rust**：职责单一——管理 aria2c 进程生命周期 + 暴露 RPC 端点（`get_rpc_endpoint`）。M2 **不新增任何 Tauri 命令**；所有任务操作由前端直连 aria2 JSON-RPC 完成。
- **前端三层**：`lib/aria2`（RPC/Poller）→ `stores`（状态）→ `components`（UI）。

唯一对 Rust 的改动：`aria2.rs` 的 `build_args` 补断点续传参数（见 §4.2）。

### 2.2 操作同步策略：命令 + 即时刷新（C 方案）
用户操作的统一数据流：
```
点击操作
  → Aria2Client.<op>(gid)          // 直连 aria2 RPC；失败 → useMessage.error() 并 return
  → 成功 → Poller.refreshNow()      // 不等下个 tick，立即拉一次 tellActive/Waiting/Stopped
  → useTaskStore.apply(a,w,s)        // 状态始终来自 aria2 权威源，无需乐观更新/回滚
WS 通知（onDownloadPause 等）          // 兜底：非用户触发的状态变更也会唤醒一次刷新
```
理由：响应在 RTT 内（几十 ms），状态严格来自权威源，避免乐观更新与 WS 通知的竞态。

## 3. 数据层改动

### 3.1 Aria2Client 操作方法
在 `src/lib/aria2/rpc-client.ts` 新增（均走现有 `call()`，token 自动注入为 `params[0]`，gid 作为 `params[1]`）：

| 方法 | RPC | 参数 |
|---|---|---|
| `pause(gid)` / `unpause(gid)` | `aria2.pause` / `aria2.unpause` | `[gid]` |
| `remove(gid)` | `aria2.remove` | `[gid]` |
| `forcePause(gid)` / `forceRemove(gid)` | `aria2.forcePause` / `aria2.forceRemove` | `[gid]` |
| `pauseAll()` / `unpauseAll()` | `aria2.pauseAll` / `aria2.unpauseAll` | 无 |

`addUri` 签名扩展为支持 aria2 选项字典：
```
addUri(uris: string[], options?: { dir?: string; out?: string; header?: string[]; ... }): Promise<string>
```
调用形式 `call('aria2.addUri', [uris, options])` → `params = [token, uris, options]`。重试时用 `options` 传 `{dir, out}` 保证文件名一致以续传（见 §4.3）。

### 3.2 Poller.refreshNow
在 `src/lib/aria2/poller.ts` 新增：
- `refreshNow()`：清掉当前 pending 定时器 → 立即触发一次 `tick()`。
- `tick()` 加 `inFlight` 守卫防重入：若上一次 tick 尚在进行中，本次跳过（tick 末尾总会重新 schedule，不会漏掉后续刷新）。

### 3.3 useTaskStore 扩展
在 `src/stores/task.ts` 新增：
- **选中态**：`selection: Set<string>`（gid 集）+ actions `toggleSelect(gid)` / `selectMany(gids)` / `clearSelection()` / `selectAllVisible()`。
- **过滤态**：`filter: 'all' | 'active' | 'waiting' | 'stopped'` + `setFilter(f)`。
- **派生**：`visibleTasks` —— 按 `filter` 过滤（复用现有 active/waiting/stopped 派生）。
- **失效清理**：`apply(a,w,s)` 重置 tasks 后，将 `selection` 与当前全部 gids 求交（被删任务的 gid 自动剔除），避免脏选中。

`useConnectionStore` 不变；错误反馈走 Naive UI `useMessage`（见 §5.6）。

### 3.4 类型扩展
`src/lib/aria2/types.ts` 的 `Aria2Task`：
- 新增 `dir: string`（下载目录，重试复用）。
- `files[]` 新增 `uris: Array<{ uri: string; status: string }>`（取原始链接 + 判断是否已失效）。

## 4. 断点续传

### 4.1 前提条件（3 个，全部满足才续传）
1. **部分文件不丢**：`aria2.remove` 仅把任务移出队列，不删磁盘文件（数据文件 + `.aria2` 控制文件均保留）。
2. **文件名一致**：重试必须用与原任务相同的 `dir` + `out`（文件名），aria2 才能识别为同一文件。换 token 的链接路径可能变化，由 aria2 从 URL 推断文件名会得到不同结果 → 必须显式传 `{dir, out}`。
3. **续传参数**：`--continue=true`（M1 已有）+ `--auto-file-renaming=false`（M2 补）。后者避免文件已存在时建 `.1` 副本而非续传。

### 4.2 aria2 启动参数改动
`src-tauri/src/aria2.rs` 的 `build_args` 追加：
- `--auto-file-renaming=false`
- `--allow-overwrite=true`

### 4.3 重试路径（均走断点续传）
- **默认重试**（error 态任务行内按钮）：取 `task.dir` + `basename(task.files[0].path)` 作为 out + `task.files[0].uris[0].uri` 作为原 URL → `remove(旧gid)` → `addUri([原URL], {dir, out})`。
- **更换链接重试**（右键/⋮ → RetryDialog）：预填原 URL，用户可改 → `remove(旧gid)` → `addUri([新URL], {dir, out})`。同一文件、换源链接续传。

> **验证点（实现时实测）**：`remove` 后 `.aria2` 控制文件是否保留，决定「精确片级续传」还是「按文件大小续传」——两者都能续传；实测一次 `remove + 重试` 确认行为并补入验证清单。

## 5. UI 组件与交互

### 5.1 布局（spec §6.1 布局 B 的 M2 子集）
```
┌──────────────────────────────────────────────┐
│ TopBar  AriaPanel  [全部暂停][全部继续]  状态 │
├──────────┬───────────────────────────────────┤
│ Sidebar  │ BulkToolbar  选中 N 项 [删除][清空] │ ← 选中>0 才显示
│ ·全部 12 │ ┌───────────────────────────────┐ │
│ ·下载中 2│ │☐│ 名称 │进度│速度│状态│ 操作 │ │
│ ·等待中 3│ │☐│ ...            (右键菜单)   │ │ TaskTable
│ ·已完成 7│ └───────────────────────────────┘ │
│ ───────  │                                    │
│ 分类(占位)│                                    │
│ 速度(占位)│                                    │
└──────────┴───────────────────────────────────┘
```

### 5.2 组件清单
| 组件 | 状态 | 职责 |
|---|---|---|
| `Sidebar.vue` | 新 | 4 个状态过滤项 + 计数 badge（来自 store 派生长度）；下方两块占位（分类/全局速度，M3 填） |
| `TopBar.vue` | 新 | 应用名 + 全部暂停/继续（`pauseAll/unpauseAll`）+ 连接状态（从 connection store） |
| `BulkToolbar.vue` | 新 | 选中数 + 「删除选中」（NPopconfirm）+「清空选择」；选中数为 0 时隐藏 |
| `TaskTable.vue` | 改造 | 加复选框列（表头全选）+ 操作列（行内主按钮 + `⋮` 更多） |
| `TaskContextMenu.vue` | 新 | `⋮` 下拉与右键菜单共用同一份菜单项 |
| `RetryDialog.vue` | 新 | 预填原 URL，可改后提交（`remove` 旧 + `addUri` 新） |

### 5.3 操作列规则（行内随状态切换主按钮）
- `active` → 「暂停」
- `paused` / `waiting` → 「恢复」
- `error` → 「重试」（原 URL）
- 常驻：「删除」「⋮」
- 其余（强制暂停/强制删除/更换链接重试/复制链接）进 `⋮` 下拉与右键菜单。

### 5.4 批量操作
- 复选框：点行复选框选中；表头复选框 = 全选当前 `visibleTasks`。
- 顶栏「全部暂停/全部继续」= `pauseAll/unpauseAll`（全局，不依赖选中）。
- 批量「删除选中」走 NPopconfirm，确认后对选中集逐个 `remove`，全部成功后 `refreshNow`。

### 5.5 右键菜单 / ⋮（同一份菜单项）
- 复制链接（`task.files[0].uris[0].uri`）
- 暂停 / 恢复（按当前状态显隐）
- 强制暂停
- 更换链接重试 → RetryDialog
- 删除 / 强制删除

### 5.6 错误处理与防误
- 任何 RPC 失败 → Naive `useMessage.error()`（瞬时通知，非应用状态，不进 store）。
- 删除（单任务/批量）走 `NPopconfirm` 二次确认。
- 操作进行中按钮禁用，防重复点击。

## 6. 测试策略

### 6.1 自动化（vitest，延续 M1 模式）
- **RPC**：`rpc-client.test.ts` 加用例——7 个操作方法的 method/params 正确、`addUri` 的 options 注入到 `params[2]`。
- **Poller**：`poller.test.ts` 加用例——`refreshNow()` 立即触发 tick（不等周期）、`inFlight` 防重入（进行中再调不叠加）。
- **Store**：`task.test.ts` 加用例——selection 的 toggle/selectAllVisible/clear、`apply()` 后失效 gid 自动剔除、`visibleTasks` 按 filter 过滤正确。
- **组件**：`TaskTable.test.ts` 扩展——复选框列渲染、操作列随 status 切换主按钮；新增 BulkToolbar/TaskContextMenu 渲染用例。
- **Rust**：`aria2.rs` 的 `build_args` 测试加断言——含 `--auto-file-renaming=false` 与 `--allow-overwrite=true`。

### 6.2 手工冒烟（tauri dev，见 §8 验证清单）

## 7. 已知简化与技术债
- **延续自 M1**：naive-ui 整体导入（bundle ~1.5MB）、`tauri.conf.json` identifier 仍为 `com.tauri.dev`（打包前改）。均不阻塞 M2，留 M4。
- **M2 引入**：续传鲁棒性依赖 aria2 启动参数（`--auto-file-renaming=false`）；selection 暂存 task store（若 M3 选中态变复杂可抽独立 ui store）。
- 重试不自动刷新失效链接的 token（手动换链接）。
- 批量操作仅删除 + 全部暂停/继续（不做批量重试/改优先级）。

## 8. 验证清单（手工冒烟）
1. 单任务暂停 → 列表状态即时变 waiting/paused；恢复 → 回到 active。
2. 单任务删除（确认）→ 从列表消失；强制删除对做种中的 BT 生效。
3. 批量选中 → BulkToolbar 显示计数；批量删除（确认）后全部消失；清空选择可用。
4. 顶栏全部暂停/全部继续生效。
5. 左导航切换 全部/下载中/等待中/已完成，列表正确过滤且计数准确。
6. **断点续传**：下一个大文件（如 `https://speed.hetzner.de/100MB.bin`），下载至部分进度 → remove → 默认重试（原 URL），确认从已下载部分继续、不重建副本；再测「更换链接重试」同样续传。
7. error 任务：行内「重试」用原 URL 重新发起并续传；「更换链接重试」弹窗预填原 URL、改后用新链接续传。
8. 右键菜单各项可用；复制链接正确。
9. 任意操作失败时弹出 error toast；操作中按钮禁用。
