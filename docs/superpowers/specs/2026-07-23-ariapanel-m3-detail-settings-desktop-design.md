# AriaPanel M3 — 详情、设置与桌面集成 设计

- **日期**：2026-07-23
- **里程碑**：M3（详情、设置与桌面集成）
- **前置**：M1（地基）+ M2（核心下载管理）已合入 master
- **状态**：已确认，待出实现计划

## 1. 目标与范围

### 1.1 目标

在 M2 的任务管理基础上，补齐下载管理器的核心体验：任务详情查看、全局参数配置、桌面级集成（托盘/剪贴板/打开文件夹）、UI 偏好持久化。

### 1.2 包含

1. **详情抽屉**：右侧抽屉展示任务完整信息（基本信息、分块进度、文件列表+选择、链接列表、高级选项、错误详情），底部含快捷操作。
2. **全局设置 modal**：配置 aria2 全局参数（并发/连接、速度限制、下载目录、代理、RPC 参数），持久化到 settings.json，运行时可变项即时生效，RPC 参数变更自动重启 aria2。
3. **系统托盘**：关闭窗口最小化到托盘；托盘菜单（显示窗口/全部暂停/全部继续/退出）。
4. **剪贴板监听**：检测剪贴板中的 HTTP/HTTPS 链接，弹出通知，点击填入下载栏。
5. **打开文件夹**：右键菜单 + 抽屉按钮，调用系统资源管理器打开文件所在目录。
6. **UI 偏好持久化**：排序状态、侧边栏筛选、主题模式、窗口几何存 localStorage，重启恢复。

### 1.3 不做（推 M4+）

- BT 支持（.torrent 添加、磁力链接、种子文件选择、做种管理）→ M4 独立里程碑
- naive-ui 全量导入优化（bundle 体积）→ M4 技术债
- `tauri.conf.json` identifier 改名 → 打包前处理
- 跨平台兼容（macOS/Linux 打开文件夹等）→ M3 先做 Windows

## 2. 架构概览

M3 不改变 M1/M2 分层（Rust 管进程 / 前端三层），Rust 侧新增配置持久化与重启能力。

### 2.1 分层

```
┌─ Rust ────────────────────────────────────────────────┐
│  settings.json (app_data_dir)                          │
│  └→ Settings { port, secret, dir,                      │
│       maxConcurrentDownloads, maxConnectionPerServer,  │
│       minSplitSize, split,                             │
│       maxOverallDownloadLimit, maxOverallUploadLimit,  │
│       allProxy, clipboardWatch }                       │
│                                                        │
│  启动: load_settings() → build_args(含用户全局选项)     │
│  重启: shutdown aria2 → 用新 args respawn → emit事件    │
│                                                        │
│  新增 Tauri commands:                                  │
│  · get_settings() → Settings                           │
│  · save_settings(s) → 写文件 + 判断是否需重启           │
│  · open_folder(path) → 调系统资源管理器                 │
│                                                        │
│  新增 Tauri plugins:                                   │
│  · tauri-plugin-clipboard-manager (剪贴板读取)          │
│  · TrayIcon (Tauri 2 内置 API)                         │
└────────────────────────────────────────────────────────┘

┌─ Frontend ─────────────────────────────────────────────┐
│  lib/aria2:                                             │
│  · Aria2Client + getGlobalOption/changeGlobalOption     │
│  · Aria2Client + tellStatus (全字段, 含 bitfield/pieces) │
│  · Aria2Client + changeOption (文件选择)                 │
│                                                         │
│  stores:                                                │
│  · settings store (get/save via Tauri commands)         │
│  · preferences store (localStorage: sort/filter/theme)  │
│  · task store + selectedGid (详情抽屉选中态)              │
│                                                         │
│  components:                                            │
│  · TaskDetailDrawer.vue (侧抽屉)                        │
│  · SettingsModal.vue (全局设置)                         │
│  · useClipboardWatcher composable                       │
│  · useWindowGeometry composable                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 新增依赖

- Rust: `tauri-plugin-clipboard-manager = "2"`
- npm: `@tauri-apps/plugin-clipboard-manager`
- Tray: Tauri 2 内置 `TrayIcon` API，无需额外 plugin

### 2.3 capabilities/default.json 新增权限

- `clipboard-manager:allow-read-text`
- `core:window:allow-hide`、`core:window:allow-show`（如需前端控制）

## 3. 配置持久化与全局设置

### 3.1 Settings 结构（Rust 侧 `settings.json`）

```json
{
  "port": null,
  "secret": null,
  "dir": "",
  "maxConcurrentDownloads": 5,
  "maxConnectionPerServer": 5,
  "minSplitSize": "20M",
  "split": 5,
  "maxOverallDownloadLimit": "0",
  "maxOverallUploadLimit": "0",
  "allProxy": "",
  "clipboardWatch": true
}
```

- `port`/`secret` 为 `null` 时首次启动自动生成并回写。
- `dir` 默认 `app_data_dir/downloads`。

### 3.2 生命周期

| 时机 | 行为 |
|---|---|
| 首次启动 | 无 settings.json → 生成默认值 → 写文件 → 构建 aria2 args（含 `--max-concurrent-downloads` 等全局选项）→ spawn |
| 后续启动 | 读 settings.json → 用持久化值构建 args → spawn |
| 保存设置（仅运行时可变项变更） | 写文件 → 前端 `changeGlobalOption` 立即生效，无需重启 |
| 保存设置（RPC port/secret 变更） | 写文件 → Rust `shutdown` aria2 → 用新 args `respawn` → health check → emit `aria2://restarted` 新端点 → 前端重连 |

### 3.3 build_args 扩展

在现有 args 基础上追加用户全局选项：`--max-concurrent-downloads`、`--max-connection-per-server`、`--min-split-size`、`--split`、`--max-overall-download-limit`、`--max-overall-upload-limit`、`--all-proxy`（空值跳过）。

### 3.4 新增 Tauri commands

- `get_settings() → Settings`
- `save_settings(s: Settings) → SaveResult { restarted: bool, endpoint: Option<RpcEndpoint> }`
  - Rust 侧判断 port/secret 是否变更，变更则重启 aria2 并返回新端点。
- `open_folder(path: String)` — 调用系统资源管理器打开文件所在目录。

### 3.5 Settings Modal UI

NDrawer 或 NModal，5 个分区：

1. **下载设置**：最大并发下载数（NInputNumber）、单任务最大连接数（NInputNumber）、最小分块大小（NInput）
2. **速度限制**：全局下载限速（NInput，0=不限）、全局上传限速（NInput）
3. **下载目录**：默认路径（NInput + 浏览按钮）
4. **代理**：全局代理（NInput）
5. **RPC 设置**（⚠ 需重启标记）：RPC 端口（NInputNumber）、RPC 密钥（NInput）
6. **行为**：剪贴板监听（NCheckbox）

保存流程：先调 `save_settings` → 如果 `restarted=true`，用新端点重连 → 否则 `changeGlobalOption` 推送运行时可变项 → 关闭 modal。

入口：TopBar 右上角齿轮图标。

### 3.6 重启流程

1. 用户保存设置 → 前端调 `save_settings(settings)`
2. Rust 写 settings.json
3. 如果 port/secret 变更：
   a. Rust: shutdown 当前 aria2（graceful）
   b. Rust: 用新 args respawn
   c. Rust: health check
   d. Rust: emit `aria2://restarted` 事件，携带新 RpcEndpoint
   e. 前端: 接收事件 → 用新 url/secret 重建 Aria2Client + 重启 Poller
4. 如果仅运行时可变项变更：
   a. 前端: 调 `changeGlobalOption` RPC
   b. 无需重启

## 4. 详情抽屉

### 4.1 触发

点击任务行任意位置 → 打开右侧 NDrawer（width 420px），不遮挡左侧列表。

### 4.2 数据策略

- 轮询器继续用 `tellActive/tellWaiting/tellStopped` 拉基础字段（列表用）。
- 抽屉打开时，每次轮询周期额外调一次 `tellStatus(gid)` 获取完整字段（含 `bitfield`、`numPieces`、`pieceLength`、`connections`）。
- 抽屉关闭则停止额外调用。

### 4.3 新增 RPC 方法

```ts
tellStatus(gid: string) → Aria2TaskDetail
changeOption(gid: string, options: Record<string, string>)
```

### 4.4 新增类型

```ts
interface Aria2TaskDetail extends Aria2Task {
  pieceLength: string
  numPieces: string
  bitfield: string       // hex 编码的分片位图
  connections: string    // 当前活跃连接数
}
```

### 4.5 抽屉布局（6 个分区）

1. **基本信息**：状态、大小、已下载、速度（↓↑）、保存路径、用时、剩余时间（ETA）
2. **分块进度**：N/Total 块已完成，活跃连接数，分块大小，SVG/Canvas 分片条（绿=已完成，灰=未完成）
3. **文件列表 + 选择**：每个文件显示路径、大小、进度。勾选框调 `changeOption(gid, { 'select-file': '1,2' })`。HTTP 单文件任务隐藏复选框。
4. **链接列表**：所有 URI + 状态标签（已用/等待/错误）
5. **高级选项**（只读）：线程数、代理、最大连接数（来自 `getOption`）
6. **错误详情**（仅 error 任务）：errorCode、errorMessage

底部操作栏：暂停/恢复、删除、复制链接、打开目录。

### 4.6 状态管理

task store 新增 `selectedGid: string | null`。点击行设置，关闭抽屉置 null。

### 4.7 分块可视化

`bitfield` 为 hex 字符串，每个 bit 代表一个分片（1=已完成）。渲染为分片条：遍历 bitfield，每 bit 映射为一个色块。与摘要文本（N/Total 块）互补展示。

## 5. 系统托盘 + 关闭即最小化

### 5.1 托盘菜单

```
AriaPanel
────────────────
显示主窗口
全部暂停
全部继续
────────────────
退出
```

### 5.2 行为规则

| 动作 | 行为 |
|---|---|
| 点窗口 ✕ 按钮 | 阻止关闭 → 隐藏窗口（`window.hide()`） |
| 点托盘图标 | 显示窗口 + 聚焦 |
| 托盘「显示主窗口」 | 同上 |
| 托盘「全部暂停/继续」 | Rust emit 事件 → 前端调 `pauseAll`/`unpauseAll` + refresh |
| 托盘「退出」 | 设 `allow_exit = true` → 正常退出流程（ExitRequested → shutdown aria2 → exit） |

### 5.3 退出标志

AppState 新增 `allow_exit: AtomicBool`。`CloseRequested` 事件：`false` → `prevent_close` + `hide`；`true` → 放行。托盘「退出」设为 `true` 后调用 `window.close()`。

### 5.4 Rust 侧改动

- `lib.rs` setup 中创建 `TrayIconBuilder` + `Menu`，注册 `on_menu_event`（emit 事件 / show window / exit）和 `on_tray_icon_event`（click → show window）。
- `RunEvent` 改为监听 `WindowEvent::CloseRequested`，检查 `allow_exit` 标志。
- 图标复用 `src-tauri/icons/icon.ico`。

### 5.5 前端监听

```ts
listen('tray://pause-all', () => { c.pauseAll(); refresh() })
listen('tray://resume-all', () => { c.unpauseAll(); refresh() })
```

## 6. 剪贴板监听

### 6.1 方案

轮询（每 2s）+ 窗口聚焦时立即检查。

### 6.2 新增依赖

- Rust: `tauri-plugin-clipboard-manager = "2"`
- npm: `@tauri-apps/plugin-clipboard-manager`
- capabilities: `clipboard-manager:allow-read-text`

### 6.3 Composable `useClipboardWatcher`

```
启动 (App.vue onMounted，仅 clipboardWatch=true 时)
  │
  ├─ 每 2s 轮询 readText()
  │    └─ 与 lastText 比较 → 相同则跳过
  │    └─ 不同且匹配 ^https?:// → 发 NNotification
  │
  └─ 监听窗口 focus 事件
       └─ 聚焦时立即 readText() 检查一次
```

### 6.4 去重

记录 `lastNotifiedUrl`。同一 URL 不重复通知。用户复制其他内容后再次复制同一 URL 才重新通知。

### 6.5 URL 检测

正则 `^https?:\/\/[^\s]+$`（M3 仅 HTTP/HTTPS，M4 加 BT 时扩展 `magnet:?`）。

### 6.6 通知交互

- NNotification `type: info`，10s 自动关闭。
- 显示检测到的 URL。
- 点击通知 → URL 填入 AddUrlBar 输入框 + 聚焦。
- 关闭通知 → 无操作。

### 6.7 开关

Settings Modal「行为」分区含「剪贴板监听」复选框，持久化到 settings.json（`clipboardWatch`）。关闭时不轮询。

## 7. 打开文件夹

### 7.1 自定义 Tauri command

```rust
#[tauri::command]
pub fn open_folder(path: String) {
    let p = Path::new(&path);
    #[cfg(target_os = "windows")]
    {
        if p.is_file() {
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", p.display()))
                .spawn().ok();
        } else {
            std::process::Command::new("explorer.exe")
                .arg(p)
                .spawn().ok();
        }
    }
}
```

### 7.2 触发入口

- 右键菜单「打开文件夹」：新增菜单项，位于「复制链接」下方。
- 详情抽屉底部「打开目录」按钮。

### 7.3 TaskOp 扩展

新增 `'openFolder'` 到 `TaskOp` 类型。TaskContextMenu 新增对应菜单项。

### 7.4 安全性

path 来自 aria2 返回的 `task.dir` 或 `task.files[0].path`，均为本地可信路径。不直接拼接用户输入。

### 7.5 跨平台

M3 先做 Windows（`explorer.exe`），macOS/Linux 留 `#[cfg]` 占位。

## 8. UI 偏好持久化

### 8.1 持久化内容

| 偏好 | localStorage key | 默认值 | 说明 |
|---|---|---|---|
| 排序字段 | `ap:sortKey` | `name` | name / size / progress / speed / status |
| 排序方向 | `ap:sortOrder` | `asc` | asc / desc |
| 侧边栏筛选 | `ap:filter` | `all` | 已存在于 task store，加 localStorage 同步 |
| 主题模式 | `ap:theme` | `system` | light / dark / system |
| 窗口宽度 | `ap:winW` | — | 启动时恢复 |
| 窗口高度 | `ap:winH` | — | 启动时恢复 |
| 窗口 X | `ap:winX` | — | 启动时恢复 |
| 窗口 Y | `ap:winY` | — | 启动时恢复 |

### 8.2 preferences store（`stores/preferences.ts`）

```ts
const usePrefStore = defineStore('prefs', () => {
  const sortKey = ref(localStorage.getItem('ap:sortKey') ?? 'name')
  const sortOrder = ref(localStorage.getItem('ap:sortOrder') ?? 'asc')
  const themeMode = ref(localStorage.getItem('ap:theme') ?? 'system')

  watch(sortKey, v => localStorage.setItem('ap:sortKey', v))
  watch(sortOrder, v => localStorage.setItem('ap:sortOrder', v))
  watch(themeMode, v => localStorage.setItem('ap:theme', v))

  return { sortKey, sortOrder, themeMode, setSort, setTheme }
})
```

task store 的 `filter` 加 `watch(filter, v => localStorage.setItem('ap:filter', v))`，初始化时读回。

### 8.3 主题改造（`useTheme.ts`）

- `themeMode` 来源改为 preferences store。
- `system` 模式：跟随 `prefers-color-scheme`（当前行为）。
- `light` / `dark`：用户显式选择，覆盖系统。
- 入口：TopBar 新增三态主题切换（☀ / 🌙 / 💻）。

### 8.4 排序实现（TaskTable 改造）

- 表头可点击切换排序字段 + 方向。
- 当前排序列显示 ↑/↓ 箭头。
- `visibleTasks` 经 computed 排序后渲染。
- 比较器：name（localeCompare）、size（Number 比较）、progress（百分比比较）、speed（Number 比较）、status（字符串比较）。

### 8.5 窗口几何持久化（`useWindowGeometry` composable）

- 监听 Tauri resize/move 事件 → debounce 500ms → 存 localStorage。
- 启动时读回 → `window.setSize()` + `window.setPosition()`。
- 最小化/托盘隐藏不触发保存。

## 9. 测试策略

### 9.1 自动化（vitest + cargo test）

| 层 | 文件 | 用例 |
|---|---|---|
| Rust | `settings.rs`（新） | Settings 序列化/反序列化、默认值、load/save 往返 |
| Rust | `aria2.rs` | `build_args` 含用户全局选项（`--max-concurrent-downloads` 等） |
| RPC | `rpc-client.test.ts` | `tellStatus` params、`changeOption` params、`getGlobalOption`、`changeGlobalOption` |
| Store | `preferences.test.ts`（新） | localStorage 读写、watch 持久化、默认值回退 |
| Store | `task.test.ts` | 排序逻辑（各字段 × asc/desc） |
| 组件 | `TaskDetailDrawer.test.ts`（新） | 渲染基本信息/文件列表/链接列表/错误详情 |
| 组件 | `SettingsModal.test.ts`（新） | 渲染分区、保存触发 save_settings |

### 9.2 手工冒烟（tauri dev）

1. **设置**：改并发数 → 保存 → 验证新任务生效；改 RPC 端口 → 保存 → aria2 自动重启、任务列表恢复。
2. **详情抽屉**：点击各状态任务 → 验证 6 个分区正确渲染；分块条与进度一致；文件勾选切换。
3. **托盘**：点 ✕ → 窗口隐藏、托盘可见 → 点托盘 → 窗口恢复 → 托盘「退出」→ 正常退出。
4. **剪贴板**：浏览器复制下载链接 → 切回 AriaPanel → 通知弹出 → 点击 → URL 填入输入框。
5. **打开文件夹**：右键 → 打开文件夹 → 资源管理器打开并选中文件。
6. **持久化**：改排序/筛选/主题 → 关闭重开 → 偏好恢复；缩放/移动窗口 → 重开 → 几何恢复。

### 9.3 门禁

`pnpm vue-tsc --noEmit`（0 错误）、`pnpm test`（全绿）、`pnpm build`、`cargo test`。

## 10. 已知简化与技术债

- **打开文件夹**仅 Windows（`explorer.exe`），macOS/Linux 留 `#[cfg]` 占位。
- **文件选择**对 HTTP 单文件任务隐藏复选框，M4 BT 加入后多文件才生效。
- **分块可视化**用轻量 SVG/Canvas，不做交互（缩放/tooltip）。
- **剪贴板监听**为轮询模式（2s），非事件驱动（Tauri 无 clipboard change event）。
- naive-ui 全量导入、`tauri.conf.json` identifier 改名留 M4。
