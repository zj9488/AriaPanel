# AriaPanel 设计文档

- **状态**：已定稿，待评审
- **日期**：2026-07-21
- **产品名**：AriaPanel
- **定位**：一个轻量、易用的 aria2 跨平台图形界面

## 1. 概述

AriaPanel 是一个基于 Tauri 的跨平台桌面应用，为 aria2(`aria2c`)提供图形界面。应用**内置并托管** aria2c 进程，用户双击安装包即可使用，无需安装或配置 aria2。

核心目标：

- **轻量**：安装包 < ~15MB，运行内存 < ~150MB，空闲 CPU ~0。
- **易用**：零配置开箱即用；智能添加下载；剪贴板自动识别；关到托盘后台下载。
- **全功能**：覆盖 HTTP/HTTPS/FTP、磁链与 .torrent、Metalink；BT 任务管理（选择性下载文件、Peers/DHT 信息、做种控制）；分类。

目标平台：Windows 10+、macOS 11+、Ubuntu 22.04+（x64；macOS 含 Apple Silicon）。

## 2. 关键决策汇总

| 维度 | 决策 |
|---|---|
| 交付形态 | Tauri 跨平台桌面应用（Rust 主进程 + WebView 前端） |
| aria2 进程模型 | 内置 aria2c，由 Rust 托管生命周期，仅绑定 127.0.0.1 |
| 功能范围 | 全功能：HTTP/FTP + BT/磁链 + Metalink + BT 细节管理 + 分类 |
| 前端框架 | Vue 3 + TypeScript + Vite |
| UI 组件 | Naive UI |
| 界面语言 | 首期仅简体中文，预留 i18n（vue-i18n） |
| 主题 | 亮/暗双主题，默认跟随系统，可手动覆盖 |
| 界面布局 | 两栏（左导航 + 主任务列表）+ 右侧详情抽屉（Motrix 风） |
| 新建下载交互 | 智能快捷输入（回车即下）+ 高级折叠，自动识别类型 |
| 剪贴板 | 自动识别下载链接（http/https/磁链），可在设置中关闭 |
| aria2c 分发 | 各平台官方预编译二进制随安装包分发（Tauri resources） |
| 设置界面 | 精选常用项 + 完整 aria2 选项的高级折叠编辑器 |
| 托盘 | 关闭窗口→最小化到托盘；托盘右键菜单；设置可改为"关闭即退出" |
| 自更新 | 应用经 Tauri updater 自更新；aria2c 跟随应用版本 |
| 集成架构 | 方案 1：Rust 托管 aria2c，前端直连 aria2c WebSocket + JSON-RPC |

## 3. 总体架构与数据流

### 3.1 组件拓扑

```
┌──────────────────────── AriaPanel 进程 ────────────────────────┐
│                                                                  │
│  ┌─── Tauri 主进程 (Rust) ───┐      ┌─── WebView (Chromium) ───┐ │
│  │ aria2 生命周期             │ init │  Vue 3 SPA                │ │
│  │   spawn / kill / 健康检查   │─cmd─→│  • Pinia stores           │ │
│  │ RPC secret + 随机端口生成   │      │  • 路由 / 视图            │ │
│  │ 窗口 / 托盘 / 文件对话框    │      │  • Naive UI 组件          │ │
│  │ 自更新 (updater 插件)      │      │  • 剪贴板监听             │ │
│  └──────────┬────────────────┘      └────────────▲─────────────┘ │
│             │ spawn                               │ WS + JSON-RPC │
│             ▼                       localhost     │               │
│  ┌─── aria2c (sidecar) ────┐◄─────────────────────┘               │
│  │ 127.0.0.1:随机端口       │                                     │
│  │ rpc-secret=<随机 token>  │                                     │
│  └──────────┬───────────────┘                                     │
└─────────────┼─────────────────────────────────────────────────────┘
              ▼ 文件 I/O
        📁 用户下载目录
```

### 3.2 职责边界

- **Rust 侧（薄）**：aria2c 进程生命周期、安全（生成 secret、仅 127.0.0.1）、窗口/托盘、原生文件对话框、自更新。**不碰下载域逻辑**。
- **前端侧（厚）**：持有全部下载域逻辑——JSON-RPC 客户端、WebSocket 订阅、Pinia store、UI。

### 3.3 数据流

1. **启动**：Tauri 主进程启动 → 生成随机 `secret` + 选空闲端口 → spawn `aria2c`（参数见 §4.2）→ 轮询 `aria2.getVersion` 健康检查通过 → 通过 `init` command 把 `(ws://127.0.0.1:port/jsonrpc, secret)` 交给前端。
2. **实时更新**：aria2c 的 WebSocket **只推状态变更通知**（`onDownloadStart/Complete/Error/Pause` 等），**不推逐帧进度**；进度由前端 Poller 轮询，状态变更由 WS 通知即时触发刷新。
3. **控制操作**：前端发 JSON-RPC（`aria2.addUri / pause / unpause / remove / changePosition / changeGid / getOption / changeOption / getFiles / getPeers …`）→ aria2c 执行并返回。
4. **退出**：关窗 → 隐藏到托盘；托盘"退出"或系统关机 → `aria2.shutdown`（优雅停，刷 session）→ 等待 ≤5s → 超时强杀。

### 3.4 安全约束

- aria2c 仅绑定 `127.0.0.1`；secret 仅存于进程内存与同进程前端；**v1 不开放远程 RPC**。
- WS 与 JSON-RPC 走同一 secret；WebView CSP 允许 `connect-src` 到 `ws://127.0.0.1:*` 与 `http://127.0.0.1:*`。

## 4. aria2c 进程管理（Rust 侧）

### 4.1 二进制布局

Tauri `resources` 按平台打包三套 aria2c：Windows x64、macOS universal（arm64 + x64 合一）、Linux x64。运行时从 resource 路径调用（只读，需注意非 Windows 上的可执行权限）。

### 4.2 启动参数（关键项）

- `--enable-rpc --rpc-listen-all=false --rpc-allow-origin-all=false`
- `--rpc-listen-port=<空闲端口>`（Rust 先 bind 测试，在 49152–65535 选空闲端口）
- `--rpc-secret=<32B hex 随机>`（每次启动新生成，仅存内存）
- `--dir=<默认目录>`、`--continue=true`（断点续传）、`--file-allocation=none`
- `--input-file=<session> --save-session=<session>`（app data 目录，崩溃恢复未完成任务）
- `--max-concurrent-downloads / --split / --max-connection-per-server / --bt-listen-port / --dht-listen-port` 等从用户设置注入
- stdout/stderr 重定向到 app log 目录的滚动日志

### 4.3 健康检查

spawn 后轮询 JSON-RPC `aria2.getVersion`（≤ 50 次 × 100ms），通过后经 `init` command 把 RPC 端点与 secret 交给前端；失败则读 stderr 日志报错并进入诊断面板。

### 4.4 崩溃恢复

Rust 监听子进程退出——非用户主动退出视为崩溃，自动重启（≤ 3 次/会话）；重启后前端 WS 重连、session 文件恢复任务。超限则前端连接 store 进入 error 态并显示全局横幅。

### 4.5 退出流程

用户退出 → 发 `aria2.shutdown`（优雅刷 session）→ 等子进程 ≤ 5s → 超时强杀。

## 5. 前端数据层

### 5.1 刷新策略（混合）

- **Poller**：有活跃任务时每 1s 调 `aria2.tellActive`（含 completedLength / downloadSpeed / pieces…）；无活跃任务时降频到 5s。一次批量取 `tellActive / tellWaiting / tellStopped`。
- **WS 通知**：状态变更即时触发一次刷新，保证 UI 响应。

### 5.2 RPC 客户端（`lib/aria2` 模块）

- WS + HTTP 双通道；请求/响应按 JSON-RPC id 匹配。
- WS 断线指数退避重连（上限 30s）；定时 `aria2.getGlobalStat` 兼作心跳与全局速度。

### 5.3 Pinia stores

- `useTaskStore`：`tasks: Map<gid, Task>`，派生 active / waiting / stopped 列表、当前选中 gid。
- `useCategoryStore`：分类定义（每分类可独立目录）。
- `useSettingsStore`：精选项 + 高级 raw options。
- `useConnectionStore`：连接状态机（connecting / connected / reconnecting / error）+ 全局统计（downloadSpeed / uploadSpeed / active 数）。

### 5.4 持久化

- 任务状态：以 aria2 **session 文件**为权威源。
- UI 偏好（主题 / 语言 / 窗口尺寸 / 分类定义 / 列宽 / 视图选中项）：用 Tauri Store 插件存 JSON 到 config 目录。

## 6. UI 结构与交互

### 6.1 应用外壳（布局 B）

顶栏（应用名 · 搜索 · + 新建 · 全部开始/暂停 · 设置 · 主题切换）+ 左导航（状态分组：全部/下载中/等待中/已完成；分类列表；+ 管理分类；底部全局速度统计）+ 主任务列表（表格 + 多选批量操作 + 可调列宽）；右侧按需滑出详情抽屉。

### 6.2 视图 / 页面清单

1. **任务列表**（主视图，按左 nav 选中过滤；表格 + 多选批量）
2. **新建下载**（modal，智能快捷输入 + 高级折叠，自动识别 HTTP/磁链/.torrent/.metalink）
3. **设置**（modal）：常规(目录/并发/速度限制/代理) · BT · 高级(完整 aria2 选项编辑器，带字段说明) · 外观(主题/语言) · 关于(版本/自更新/aria2c 版本)
4. **剪贴板提示**（toast：检测到链接 → 添加 / 忽略）
5. **诊断**（错误时自动弹：连接状态 / aria2c 日志 / 重启 aria2c）

### 6.3 新建下载 modal

- 首屏：大输入框（粘贴 URL/磁链，支持多行批量）+ 拖入 `.torrent` / `.metalink` 区；回车即用默认设置开始。
- 高级折叠：重命名 · 目录 · 分类 · 分块数(split) · 单服务器连接数 · Referer/User-Agent/Headers · 代理 · BT 选项（做种时间/顺序下载）。
- 类型自动识别：http(s)/ftp → HTTP 任务；磁链 → BT；.torrent → BT；.metalink → Metalink。

### 6.4 系统托盘

托盘图标（可带速度 badge）；右键菜单：显示窗口 / 全部暂停 / 全部继续 / 退出。关闭窗口 → 最小化到托盘（设置可改为"关闭即退出"）。

### 6.5 i18n 与主题

- i18n：vue-i18n，首期仅简体中文，键结构预留 en；语言切换即时生效。
- 主题：Naive UI `darkTheme` + `themeOverrides`；默认跟随系统 `prefers-color-scheme`，可手动覆盖为 light/dark/system；持久化。单一主色，暂不做复杂换肤。

## 7. 工程化

### 7.1 目录结构

```
AriaPanel/
├─ src/                  # Vue 前端
│  ├─ views/             # TaskList, NewTask, Settings, Diagnostics
│  ├─ components/        # TaskTable, TaskDrawer, ClipboardToast…
│  ├─ stores/            # Pinia: task / category / settings / connection
│  ├─ lib/aria2/         # JSON-RPC client + WS + poller + 类型定义
│  ├─ composables/       # useClipboard / useTheme / useTray
│  ├─ i18n/              # zh-CN（预留 en）
│  └─ router/
├─ src-tauri/            # Rust 后端
│  ├─ src/  (main.rs, aria2.rs, secret.rs, commands.rs)
│  ├─ resources/         # aria2c 二进制（按平台，.gitignore）
│  └─ tauri.conf.json
├─ scripts/              # fetch-aria2（按平台拉取校验）、签名
└─ package.json
```

### 7.2 构建与分发

- 前端 `vite build` → Tauri 打包；`scripts/fetch-aria2` 按目标平台从官方 release 下载并校验放入 `resources/`。
- 产物：Windows（MSI / NSIS exe）、macOS（dmg，universal 或 arm64/x64，codesign + notarize）、Linux（AppImage + deb）。
- CI：GitHub Actions matrix（win/mac/linux），每 target 独立 job（二进制平台相关）。
- 自更新：Tauri updater 从 GitHub Releases 拉签名包 + `latest.json`，公钥嵌入应用。

### 7.3 错误处理

- aria2c 启动失败 → 健康检查超时 → 诊断面板展示 stderr 日志 + 重试。
- aria2c 崩溃 → Rust 自动重启（≤ 3 次）；超限 → 连接 store 进入 error 态 + 全局横幅。
- WS 断连 → 指数退避重连，UI 显示"重连中"，控制操作临时禁用。
- 任务错误 → 行标红 + 错误信息 + "重新下载"。
- 二进制缺失/损坏 → 启动检测并引导重装。

### 7.4 测试策略

- 前端：Vitest 单元（RPC client mock、poller 调度、store 归约、组件交互）；Playwright E2E（添加 → 出现 → 完成关键流）。
- Rust：cargo test（端口选择、secret 生成、参数构造）+ 真实 aria2c 集成（spawn / 健康检查 / 优雅退出）。
- 手工 QA 清单覆盖三平台冒烟（HTTP/磁链/BT/分类/托盘/主题/自更新）。

## 8. 成功标准（v1）

- 双击安装包，零配置即可添加 HTTP/磁链/.torrent 并下载。
- 资源：内存 < ~150MB、空闲 CPU ~0、安装包 < ~15MB（aria2c ~5MB + Tauri ~8MB）。
- 进度/速度与 aria2c 状态一致；崩溃后能恢复未完成任务。
- Win10+/macOS 11+/Ubuntu 22.04+ 关键路径可用。
- 精选设置 + 高级折叠覆盖 90% 常见配置。

## 9. 非目标（v1 明确不做）

- 远程/多实例 RPC 连接（只管本地内置实例）。
- aria2c 独立自更新。
- 浏览器扩展 / URL 拦截。
- 复杂换肤 / 插件系统。
- RSS 订阅 / 站点抓取。
