# AriaPanel 自更新设计文档

- **状态**：已定稿，待评审
- **日期**：2026-07-30
- **关联**：设计文档 §2（自更新）、§7.2（构建与分发）

## 1. 概述

为 AriaPanel 添加应用内自更新能力。应用启动时静默检查 GitHub Releases 上的 `latest.json`，发现新版本时弹出通知 Modal，用户确认后应用内下载并安装更新，完成后自动重启。

目标平台：Windows（NSIS）、macOS（.app.tar.gz）、Linux（AppImage）。deb/rpm 不支持自更新（Tauri 限制），仅作为手动下载分发。

## 2. 架构

```
┌─── 应用启动 ───────────────────────────────────────────┐
│  useUpdater.check()                                     │
│    └→ GET https://github.com/zj9488/AriaPanel/          │
│         releases/latest/download/latest.json            │
│    └→ semver 比对 (current vs available.version)        │
│    └→ 有新版本 → 显示 NModal 通知                       │
│         ├→ "立即更新" → downloadAndInstall() → relaunch │
│         └→ "稍后"     → 关闭 Modal                      │
└─────────────────────────────────────────────────────────┘

┌─── CI (release.yml) ───────────────────────────────────┐
│  tag push → build → tauri-action (含签名密钥)           │
│    ├→ 生成 .sig 签名文件 (各平台)                       │
│    ├→ 生成 latest.json (版本 + 各平台下载URL + sig)     │
│    └→ 上传所有产物到 GitHub Release (published, 非 draft)│
└─────────────────────────────────────────────────────────┘
```

## 3. 组件

### 3.1 签名密钥对

- **生成**：`pnpm tauri signer generate -w ~/.tauri/ariapanel.key`，生成 Ed25519 密钥对
- **私钥**：存为 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`，仅 CI 可用
- **私钥密码**：存为 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（可为空字符串）
- **公钥**：嵌入 `tauri.conf.json` → `plugins.updater.publicKey`
- **本地**：私钥文件不入仓库（.gitignore 排除）

### 3.2 Rust 侧

**依赖**：
```toml
tauri-plugin-updater = "2"
```

**注册**：在 `lib.rs` 的 `Builder::default()` 链中添加 `.plugin(tauri_plugin_updater::Builder::new().build())`

**权限**：在 `capabilities/default.json` 中添加 updater 权限许可。

### 3.3 前端侧

**依赖**：
```json
"@tauri-apps/plugin-updater": "^2.0.0"
```

**新建 `src/composables/useUpdater.ts`**：
```ts
export function useUpdater() {
  const checking = ref(false)
  const updateAvailable = ref(false)
  const downloading = ref(false)
  const updateInfo = ref<{ version: string; date: string; body: string } | null>(null)
  const error = ref<string | null>(null)

  async function check() { /* 调用 @tauri-apps/plugin-updater check() */ }
  async function downloadAndInstall() { /* download + install + relaunch */ }

  return { checking, updateAvailable, updateInfo, downloading, error, check, downloadAndInstall }
}
```

**新建 `src/components/UpdateNotification.vue`**：
- NModal 弹窗，标题 "发现新版本 v{version}"
- 正文显示 release notes（Markdown 纯文本）
- 两个按钮："立即更新"（primary）/ "稍后"（default）
- 点击"立即更新"：按钮变为 loading 状态 + 进度文本（"下载中… xx%"），完成后自动重启
- 点击"稍后"：关闭 Modal

**集成点**：`TaskListView.vue` 在末尾添加 `<UpdateNotification />`，由 composable 内部在 `onMounted` 时触发静默检查。

**错误处理**：
- 网络失败：静默忽略，不弹窗（启动时检查不应打扰用户）
- 下载/安装失败：NMessage.error 提示，Modal 保持打开，用户可重试
- 版本相同或更低：不弹窗

### 3.4 tauri.conf.json 配置

```json
{
  "plugins": {
    "updater": {
      "publicKey": "<ED25519_PUBLIC_KEY>",
      "endpoints": [
        "https://github.com/zj9488/AriaPanel/releases/latest/download/latest.json"
      ]
    }
  }
}
```

### 3.5 CI 工作流修改 (release.yml)

**环境变量**（build job 的 tauri-action 步骤）：
```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

**tauri-action 参数**：
```yaml
with:
  updaterJsonPreferNsis: true
```
此参数让 tauri-action 自动生成包含各平台签名信息的 `latest.json` 并上传为 Release 附件。

**Release 发布策略**：
- 当前 `releaseDraft: true` 改为 `releaseDraft: false`
- tag push 后自动发布 published release（updater 需要公开访问 latest.json）
- 如需发布前审查，可保留 draft + 添加手动"发布"步骤，但 v1 先用自动发布

## 4. latest.json 格式

tauri-action 自动生成，格式示例：
```json
{
  "version": "0.2.0",
  "notes": "Release notes from GitHub Release body",
  "pub_date": "2026-07-30T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "content of .sig file",
      "url": "https://github.com/zj9488/AriaPanel/releases/download/v0.2.0/AriaPanel_0.2.0_x64-setup.exe"
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/zj9488/AriaPanel/releases/download/v0.2.0/AriaPanel_0.2.0_aarch64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "...",
      "url": "https://github.com/zj9488/AriaPanel/releases/download/v0.2.0/AriaPanel_0.2.0_amd64.AppImage"
    }
  }
}
```

## 5. 平台行为

| 平台 | 更新格式 | 行为 |
|------|---------|------|
| Windows | NSIS `.exe` | 下载后运行静默安装，替换旧版本 |
| macOS | `.app.tar.gz` | 下载解压替换 .app（需 codesign，否则 Gatekeeper 阻止） |
| Linux | AppImage | 下载替换 AppImage 文件，设置可执行权限 |

**macOS 注意**：当前未代码签名，updater 可以下载和替换文件，但替换后的 .app 可能被 Gatekeeper 阻止。完整的 macOS 自更新需要代码签名（后续单独处理）。

## 6. 权限配置

Tauri 2 需要在 `src-tauri/capabilities/default.json` 中声明 updater 权限：

```json
{
  "permissions": [
    "updater:default"
  ]
}
```

（与现有权限合并，不替换。）

## 7. 测试策略

- **前端单元测试**（`useUpdater.test.ts`）：
  - mock `@tauri-apps/plugin-updater` 的 `check()` 返回 `null`（无更新）→ `updateAvailable` 为 false
  - mock 返回 Update 对象（有更新）→ `updateAvailable` 为 true，`updateInfo` 含版本号
  - mock `check()` 抛异常 → `error` 被设置，`updateAvailable` 为 false
  - mock `downloadAndInstall()` 调用 `update.downloadAndInstall()` + `relaunch()`

- **UpdateNotification.test.ts**：
  - 无更新时 Modal 不显示
  - 有更新时 Modal 显示版本号和 release notes
  - 点击"稍后"关闭 Modal
  - 点击"立即更新"触发 downloadAndInstall

- **手动验证**：
  1. 本地构建 v0.1.0 并安装
  2. 升版本号到 v0.2.0，推 tag 触发 CI
  3. 等 Release 发布后，启动旧版本，确认弹窗出现
  4. 点击更新，验证下载+安装+重启

## 8. 实现顺序

1. 生成签名密钥对，配置 GitHub Secrets
2. Rust：添加 tauri-plugin-updater 依赖 + 注册插件 + 权限
3. tauri.conf.json：添加 updater 配置（publicKey + endpoint）
4. 前端：useUpdater composable + UpdateNotification 组件 + 集成到 TaskListView
5. CI：release.yml 注入签名环境变量 + 改 draft 为 published + updaterJsonPreferNsis
6. 前端测试
7. 手动验证端到端
