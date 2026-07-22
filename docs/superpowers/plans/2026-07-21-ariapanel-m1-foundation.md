# AriaPanel M1 · 地基 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产出一个可启动的 Tauri + Vue 桌面应用：启动时由 Rust 托管地 spawn 内置 aria2c、前端经 JSON-RPC（HTTP + WS）与 Poller 拉取任务，在任务列表中实时显示下载进度。

**Architecture:** Tauri v2 主进程（Rust）负责 aria2c 进程生命周期（spawn/健康检查/崩溃恢复/优雅退出）、生成随机端口与 RPC secret，经 `get_rpc_endpoint` 命令把 `(url, secret)` 交给前端。前端 Vue 持有 JSON-RPC 客户端（HTTP 请求 + WS 通知）、Poller（1s 活跃 / 5s 空闲）、connection/task Pinia stores，以及最小 UI（外壳 + 任务表 + 一个最小添加 URL 输入，用于端到端验证）。

**Tech Stack:** Tauri 2.x、Rust（stable）、reqwest（rustls）、Vue 3 + TypeScript + Vite、Pinia、vue-router、vue-i18n、Naive UI、Vitest + @vue/test-utils、pnpm。

## Global Constraints

- 包管理器：pnpm（已安装，v10.28.1）。
- Rust：stable toolchain；Windows 目标 `x86_64-pc-windows-msvc`（需 MSVC 构建工具）。
- aria2c 二进制：仅 Windows x64 纳入 M1 开发；三平台分发包由 M4 处理。二进制不入库（`.gitignore` 已排除），由 `scripts/fetch-aria2.ps1` 拉取。
- JSON-RPC：aria2 开启 `rpc-secret` 后，**每个**方法的 `params[0]` 必须为 `"token:<secret>"`。
- aria2c 仅绑定 `127.0.0.1`；前端 CSP 允许 `connect-src` 到 `http://127.0.0.1:*` 与 `ws://127.0.0.1:*`。
- UI 语言：仅简体中文（`zh-CN`）；主题跟随系统（亮/暗）。
- M1 不含：暂停/恢复/删除/重排控制、详情抽屉、分类、设置面板、剪贴板识别、托盘、BT 细节、Metalink、自更新——这些属 M2/M3。
- 遵循 DRY / YAGNI / TDD / 频繁提交。无占位符；每步给完整代码。

## File Structure

```
AriaPanel/
├─ package.json / pnpm-lock.yaml
├─ vite.config.ts / vitest.config.ts / tsconfig.json / tsconfig.node.json
├─ index.html
├─ src/                          # Vue 前端
│  ├─ main.ts                    # 入口：挂载 NaiveUI/Pinia/Router/i18n
│  ├─ App.vue
│  ├─ assets/main.css
│  ├─ i18n/{index.ts, locales/zh-CN.ts}
│  ├─ router/index.ts
│  ├─ lib/aria2/
│  │  ├─ types.ts                # Task / GlobalStat / RPC 类型
│  │  ├─ rpc-client.ts           # JSON-RPC over HTTP（fetch），含 token 注入
│  │  ├─ ws-notify.ts            # WS 通知订阅（重连）
│  │  ├─ poller.ts               # 轮询调度
│  │  └─ index.ts                # 门面：connect/disconnect
│  ├─ stores/{connection.ts, task.ts}
│  ├─ composables/{useAria2.ts, useTheme.ts}
│  ├─ views/TaskListView.vue
│  └─ components/{AppShell.vue, TaskTable.vue, AddUrlBar.vue}
├─ src-tauri/
│  ├─ Cargo.toml / build.rs / tauri.conf.json
│  ├─ icons/ (占位)
│  ├─ resources/aria2c.exe       # gitignored，fetch 脚本拉取
│  └─ src/
│     ├─ main.rs                 # 调用 lib::run()
│     ├─ lib.rs                  # 模块声明 + run()
│     ├─ secret.rs               # 端口 + secret 生成（纯函数）
│     ├─ aria2.rs                # CLI 参数构造 + 进程生命周期
│     └─ commands.rs             # get_rpc_endpoint 命令 + AppState
├─ scripts/fetch-aria2.ps1
└─ tests/ （前端测试与源码同目录 `*.test.ts`）
```

各文件单一职责：`secret.rs`/`aria2.rs` 纯逻辑可单测；`rpc-client.ts` 与传输解耦（依赖注入 token + fetch，测试注入 fake fetch）；`poller.ts` 仅调度；stores 仅归约；UI 组件仅渲染。

---

### Task 1: 前置依赖与项目骨架

**Files:**
- Create: `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `.gitignore`（已存在，合并）, `src/main.ts`, `src/App.vue`, `src/assets/main.css`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/icons/*`

**Interfaces:**
- Produces: 可运行的空 Tauri 应用骨架；`pnpm tauri dev` 能弹出一个标题为 AriaPanel 的空白窗口。

- [ ] **Step 1: 安装 Rust 工具链**

Run（PowerShell，按提示安装 stable + MSVC）：
```powershell
Invoke-WebRequest https://win.rustup.rs/x86_64 -OutFile "$env:TEMP\rustup-init.exe"
& "$env:TEMP\rustup-init.exe" -y
```
若提示缺 MSVC，安装"Visual Studio Build Tools 2022"勾选"使用 C++ 的桌面开发"工作负载。

- [ ] **Step 2: 验证工具链**

Run:
```powershell
# 刷新当前会话 PATH
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo --version
rustc --version
pnpm --version
```
Expected：三者均输出版本号。

- [ ] **Step 3: 写前端最小骨架文件**

`package.json`：
```json
{
  "name": "ariapanel",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "vue": "^3.5.0",
    "vue-router": "^4.4.0",
    "vue-i18n": "^10.0.0",
    "pinia": "^2.2.0",
    "naive-ui": "^2.40.0",
    "@tauri-apps/api": "^2.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.0",
    "@tauri-apps/cli": "^2.1.0",
    "typescript": "^5.6.0",
    "vue-tsc": "^2.1.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0",
    "@vue/test-utils": "^2.4.0",
    "jsdom": "^25.0.0",
    "@types/node": "^22.0.0"
  }
}
```

`vite.config.ts`：
```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
})
```

`vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom', globals: true },
})
```

`tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "types": ["vite/client", "node"],
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`：
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

`index.html`：
```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AriaPanel</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`：
```ts
import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'

createApp(App).mount('#app')
```

`src/App.vue`：
```vue
<script setup lang="ts"></script>

<template>
  <div class="root">AriaPanel</div>
</template>

<style scoped>
.root { font-family: system-ui, sans-serif; padding: 1rem }
</style>
```

`src/assets/main.css`：
```css
:root { color-scheme: light dark }
body { margin: 0 }
```

- [ ] **Step 4: 安装依赖并初始化 Tauri**

Run（在仓库根）：
```powershell
pnpm install
pnpm add -D @tauri-apps/cli@^2.1.0
```
然后用非交互方式在当前前端工程里添加 `src-tauri`：
```powershell
pnpm tauri init --app-name AriaPanel --window-title AriaPanel --dev-url http://localhost:5173 --before-dev-command "pnpm dev" --before-build-command "pnpm build" --frontend-dist ../dist --ci
```

- [ ] **Step 5: 调整 `src-tauri/tauri.conf.json` 的 CSP 与窗口尺寸**

把 `app.windows[0]` 改为 `"width":1100,"height":720,"minWidth":800,"minHeight":500`；把 `app.security.csp` 改为：
```
"default-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
```

- [ ] **Step 6: 验证 dev 启动**

Run:
```powershell
pnpm tauri dev
```
Expected：编译完成后弹出一个标题为 "AriaPanel"、内容显示 "AriaPanel" 文字的窗口。Ctrl+C 停止。

- [ ] **Step 7: 提交**

```powershell
git add -A
git commit -m "chore: scaffold Tauri + Vue + TS project"
```

---

### Task 2: aria2c 拉取脚本与资源打包（Windows）

**Files:**
- Create: `scripts/fetch-aria2.ps1`
- Verify: `src-tauri/resources/aria2c.exe`
- Modify: `src-tauri/tauri.conf.json`（`bundle.resources`）

**Interfaces:**
- Produces: `src-tauri/resources/aria2c.exe` 存在且 `--version` 可用；`tauri.conf.json` 的 `bundle.resources` 包含 `resources/aria2c.exe`，使其在打包时随应用分发。

- [ ] **Step 1: 写拉取脚本**

`scripts/fetch-aria2.ps1`：
```powershell
# 获取 aria2c.exe (Windows x64) 到 src-tauri/resources/
# 优先使用系统已安装的 aria2c（如 scoop/winget 装的官方 1.37.0）；找不到再从官方 release 下载。
$ErrorActionPreference = 'Stop'
$dst = "$PSScriptRoot\..\src-tauri\resources"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$target = Join-Path $dst 'aria2c.exe'

# 1) 优先复制系统已装的 aria2c
$sys = (Get-Command aria2c -ErrorAction SilentlyContinue).Source
if ($sys) {
    Copy-Item $sys $target -Force
    Write-Output "copied system aria2c: $sys -> $target"
} else {
    # 2) 从官方 release 下载
    $ver = '1.37.0'
    $url = "https://github.com/aria2/aria2/releases/download/release-$ver/aria2-$ver-win-64bit-build1.zip"
    $tmp = "$env:TEMP\aria2.zip"
    Invoke-WebRequest $url -OutFile $tmp
    Expand-Archive $tmp -DestinationPath "$env:TEMP\aria2-extract" -Force
    Copy-Item "$env:TEMP\aria2-extract\aria2-$ver-win-64bit-build1\aria2c.exe" $target -Force
    Remove-Item $tmp, "$env:TEMP\aria2-extract" -Recurse -Force
    Write-Output "downloaded aria2c $ver -> $target"
}
& $target --version
```

- [ ] **Step 2: 运行脚本并验证**

Run:
```powershell
pwsh -File scripts/fetch-aria2.ps1   # 或 powershell -File ...
& "$PWD\src-tauri\resources\aria2c.exe" --version
```
Expected：打印 `aria2 version 1.37.0`。

- [ ] **Step 3: 配置 `bundle.resources`**

编辑 `src-tauri/tauri.conf.json`，在 `bundle` 内加入：
```json
"resources": ["resources/aria2c.exe"]
```

- [ ] **Step 4: 确认 `.gitignore` 排除二进制**

确认仓库根 `.gitignore` 含 `src-tauri/resources/aria2c*`（M1 计划全局约束已要求；若无则追加）。验证 `git status` 不显示 `aria2c.exe`。

- [ ] **Step 5: 提交**

```powershell
git add scripts/fetch-aria2.ps1 src-tauri/tauri.conf.json .gitignore
git commit -m "build: add aria2c fetch script and resource bundling"
```

---

### Task 3: Rust — 端口与 secret 生成

**Files:**
- Create: `src-tauri/src/secret.rs`
- Modify: `src-tauri/src/lib.rs`（声明 `pub mod secret;`）
- Test: `src-tauri/src/secret.rs`（`#[cfg(test)] mod tests`）

**Interfaces:**
- Produces:
  - `pub fn pick_free_port() -> u16`（绑定 127.0.0.1:0 取空闲端口后释放）
  - `pub fn generate_secret() -> String`（64 个十六进制字符）

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/secret.rs`：
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_port_returns_ephemeral_port() {
        let p = pick_free_port();
        assert!((49152..=65535).contains(&p));
    }

    #[test]
    fn generate_secret_is_64_hex_chars() {
        let s = generate_secret();
        assert_eq!(s.len(), 64);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_secret_is_unique() {
        assert_ne!(generate_secret(), generate_secret());
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml secret
```
Expected：编译失败 / 函数未定义。

- [ ] **Step 3: 写实现**

在 `src-tauri/src/secret.rs` 顶部加入：
```rust
use std::net::TcpListener;

/// 绑定 127.0.0.1:0 取一个空闲端口并立即释放（与 aria2c 绑定之间存在轻微竞态，可接受）。
pub fn pick_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind 127.0.0.1:0 failed");
    listener.local_addr().expect("local_addr failed").port()
}

/// 生成 32 字节的十六进制 secret（64 字符），用作 aria2 RPC token。
pub fn generate_secret() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("getrandom failed");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}
```

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 加入：
```toml
getrandom = "0.3"
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml secret
```
Expected：3 个测试通过。

- [ ] **Step 5: 在 lib.rs 声明模块**

在**已有的** `src-tauri/src/lib.rs`（Task 1 脚手架生成的，含 `run()`）顶部加入一行声明——**保留文件已有内容，不要替换整个文件**：
```rust
pub mod secret;
```

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/secret.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(core): add port and rpc secret generation"
```

---

### Task 4: Rust — aria2c CLI 参数构造

**Files:**
- Create: `src-tauri/src/aria2.rs`（参数构造部分）
- Modify: `src-tauri/src/lib.rs`（声明 `pub mod aria2;`）
- Test: `src-tauri/src/aria2.rs`（`#[cfg(test)] mod tests`）

**Interfaces:**
- Consumes: `crate::secret::{pick_free_port, generate_secret}`
- Produces:
  - `pub struct Aria2Config { pub port: u16, pub secret: String, pub dir: PathBuf, pub session: PathBuf }`
  - `pub fn new_config(dir: PathBuf, session: PathBuf) -> Aria2Config`
  - `pub fn build_args(cfg: &Aria2Config) -> Vec<String>`（产出 aria2c 命令行参数）

- [ ] **Step 1: 写失败测试**

`src-tauri/src/aria2.rs`：
```rust
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Aria2Config {
        Aria2Config {
            port: 50000,
            secret: "abc".into(),
            dir: PathBuf::from("/dl"),
            session: PathBuf::from("/s/session.gz"),
        }
    }

    #[test]
    fn build_args_enables_rpc_on_localhost() {
        let a = build_args(&cfg());
        assert!(a.contains(&"--enable-rpc".to_string()));
        assert!(a.contains(&"--rpc-listen-all=false".to_string()));
        assert!(a.contains(&"--rpc-listen-port=50000".to_string()));
        assert!(a.contains(&"--rpc-allow-origin-all=false".to_string()));
    }

    #[test]
    fn build_args_sets_secret_dir_session() {
        let a = build_args(&cfg());
        assert!(a.contains(&"--rpc-secret=abc".to_string()));
        assert!(a.contains(&"--dir=/dl".to_string()));
        assert!(a.contains(&"--continue=true".to_string()));
        assert!(a.contains(&"--input-file=/s/session.gz".to_string()));
        assert!(a.contains(&"--save-session=/s/session.gz".to_string()));
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml aria2
```
Expected：编译失败。

- [ ] **Step 3: 写实现**

在 `src-tauri/src/aria2.rs` 顶部加入：
```rust
use crate::secret::{generate_secret, pick_free_port};
use std::path::PathBuf;

pub struct Aria2Config {
    pub port: u16,
    pub secret: String,
    pub dir: PathBuf,
    pub session: PathBuf,
}

pub fn new_config(dir: PathBuf, session: PathBuf) -> Aria2Config {
    Aria2Config {
        port: pick_free_port(),
        secret: generate_secret(),
        dir,
        session,
    }
}

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
        format!("--input-file={}", cfg.session.display()),
        format!("--save-session={}", cfg.session.display()),
        "--quiet=true".into(),
    ]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml aria2
```
Expected：2 个测试通过。

- [ ] **Step 5: 在 lib.rs 声明模块**

在**已有的** `src-tauri/src/lib.rs` 顶部加入（保留已有内容，不要替换整个文件；与 Task 3 的 `pub mod secret;` 共存）：
```rust
pub mod aria2;
pub mod secret;
```

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/aria2.rs src-tauri/src/lib.rs
git commit -m "feat(core): build aria2c cli args"
```

---

### Task 5: Rust — aria2c 资源路径、spawn 与健康检查

**Files:**
- Modify: `src-tauri/src/aria2.rs`（新增 `binary_path`、`spawn`、`health_check`）
- Test: `src-tauri/src/aria2.rs`（健康检查对真实 aria2c 的集成测试，标 `#[ignore]`，需 aria2c.exe 存在）

**Interfaces:**
- Consumes: `build_args`；`tauri::AppHandle`（解析 resource 路径）。
- Produces:
  - `pub fn binary_path(app: &tauri::AppHandle) -> tauri::Result<PathBuf>`
  - `pub fn spawn(binary: &Path, cfg: &Aria2Config) -> std::io::Result<std::process::Child>`
  - `pub async fn health_check(port: u16, secret: &str) -> bool`
  - `pub fn rpc_http_url(port: u16) -> String`（`http://127.0.0.1:{port}/jsonrpc`）

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/aria2.rs` 测试模块追加：
```rust
    #[tokio::test]
    #[ignore] // 需先运行 scripts/fetch-aria2.ps1
    async fn health_check_against_real_aria2() {
        let binary = concat!(env!("CARGO_MANIFEST_DIR"), "\\resources\\aria2c.exe");
        let cfg = Aria2Config {
            port: pick_free_port_for_test(),
            secret: "testsecret".into(),
            dir: std::env::temp_dir(),
            session: std::env::temp_dir().join("ap_test.session.gz"),
        };
        let _child = std::process::Command::new(binary)
            .args(build_args(&cfg))
            .spawn()
            .expect("spawn aria2c");
        let ok = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            health_check(cfg.port, &cfg.secret),
        ).await.expect("health_check timed out");
        assert!(ok);
    }

    fn pick_free_port_for_test() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap().local_addr().unwrap().port()
    }
}
```
（注意：上面 `}` 闭合测试模块；若已有 `}`，把新测试插到模块内末尾、闭合括号之前。）

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml aria2 -- --ignored
```
Expected：编译失败（`health_check`/`rpc_http_url` 未定义）。

- [ ] **Step 3: 写实现**

在 `src-tauri/src/aria2.rs` 加入：
```rust
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub fn rpc_http_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/jsonrpc")
}

pub fn binary_path(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    let name = if cfg!(windows) { "resources/aria2c.exe" } else { "resources/aria2c" };
    app.path().resolve(name, tauri::path::BaseDirectory::Resource)
}

pub fn spawn(binary: &Path, cfg: &Aria2Config) -> std::io::Result<Child> {
    Command::new(binary)
        .args(build_args(cfg))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
}

/// 轮询 aria2.getVersion（带 token），最多约 5 秒。
pub async fn health_check(port: u16, secret: &str) -> bool {
    let url = rpc_http_url(port);
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "aria2.getVersion",
        "params": [format!("token:{secret}")]
    });
    for _ in 0..50 {
        if let Ok(resp) = client.post(&url).json(&body).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    false
}
```

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 加入：
```toml
tauri = { version = "2", features = [] }
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
serde_json = "1"
tokio = { version = "1", features = ["rt", "time", "rt-multi-thread", "macros"] }
```
（`tauri-plugin-log` 等后续任务再加。）

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml aria2 -- --ignored
```
Expected：集成测试通过（需先跑过 `scripts/fetch-aria2.ps1`）。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/aria2.rs src-tauri/Cargo.toml
git commit -m "feat(core): spawn aria2c and health-check via rpc"
```

---

### Task 6: Rust — 进程生命周期（崩溃恢复 + 优雅退出）

**Files:**
- Modify: `src-tauri/src/aria2.rs`（新增 `Supervisor`：启动→健康检查→监听退出→重启）
- Test: `src-tauri/src/aria2.rs`（单测重启计数与 `should_restart` 判定）

**Interfaces:**
- Produces:
  - `pub struct Supervisor { child: Option<Child>, restarts: u32, max_restarts: u32 }`
  - `impl Supervisor { pub fn new() -> Self; pub async fn start(&mut self, binary:&Path, cfg:&Aria2Config) -> bool; pub async fn ensure_alive(&mut self, binary:&Path, cfg:&Aria2Config) -> bool; pub async fn shutdown(&mut self, port:u16, secret:&str); }`

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/aria2.rs` 测试模块追加：
```rust
    #[test]
    fn supervisor_starts_with_zero_restarts() {
        let s = Supervisor::new();
        assert_eq!(s.restarts_count(), 0);
        assert_eq!(s.max_restarts(), 3);
    }

    #[test]
    fn supervisor_respects_max_restarts() {
        let mut s = Supervisor::new();
        s.restarts = 3; // 模拟已达上限
        assert!(!s.can_restart());
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml supervisor
```
Expected：编译失败（`Supervisor` 未定义）。

- [ ] **Step 3: 写实现**

在 `src-tauri/src/aria2.rs` 加入：
```rust
const MAX_RESTARTS: u32 = 3;

pub struct Supervisor {
    pub child: Option<Child>,
    pub restarts: u32,
    max_restarts: u32,
}

impl Supervisor {
    pub fn new() -> Self {
        Self { child: None, restarts: 0, max_restarts: MAX_RESTARTS }
    }
    pub fn restarts_count(&self) -> u32 { self.restarts }
    pub fn max_restarts(&self) -> u32 { self.max_restarts }
    pub fn can_restart(&self) -> bool { self.restarts < self.max_restarts }

    /// spawn 子进程并健康检查；失败返回 false。
    pub async fn start(&mut self, binary: &Path, cfg: &Aria2Config) -> bool {
        match spawn(binary, cfg) {
            Ok(c) => {
                self.child = Some(c);
                health_check(cfg.port, &cfg.secret).await
            }
            Err(_) => false,
        }
    }

    /// 若子进程已退出且未超上限，则重启。
    pub async fn ensure_alive(&mut self, binary: &Path, cfg: &Aria2Config) -> bool {
        let dead = match self.child.as_mut() {
            None => true,
            Some(c) => match c.try_wait() {
                Ok(None) => false,
                _ => true,
            },
        };
        if dead {
            if !self.can_restart() { return false; }
            self.restarts += 1;
            return self.start(binary, cfg).await;
        }
        true
    }

    /// 优雅停：发 aria2.shutdown，等待 ≤5s，超时强杀。
    pub async fn shutdown(&mut self, port: u16, secret: &str) {
        let url = rpc_http_url(port);
        if let Ok(client) = reqwest::Client::builder().build() {
            let body = serde_json::json!({
                "jsonrpc":"2.0","id":1,"method":"aria2.shutdown",
                "params":[format!("token:{secret}")]
            });
            let _ = client.post(&url).json(&body).send().await;
        }
        if let Some(mut c) = self.child.take() {
            let start = std::time::Instant::now();
            while start.elapsed() < std::time::Duration::from_secs(5) {
                if c.try_wait().ok().flatten().is_some() { return; }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            let _ = c.kill();
        }
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```powershell
cargo test --manifest-path src-tauri\Cargo.toml supervisor
```
Expected：2 个测试通过。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/aria2.rs
git commit -m "feat(core): aria2 supervisor with crash recovery and graceful shutdown"
```

---

### Task 7: Rust — `get_rpc_endpoint` 命令与 AppState

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`（声明模块、`run()`、setup 启动 supervisor、注册命令、退出钩子）
- Modify: `src-tauri/src/main.rs`（调用 `lib::run()`）

**Interfaces:**
- Consumes: `Supervisor`、`new_config`、`binary_path`。
- Produces: 前端可调用 `invoke('get_rpc_endpoint')` → `{ url: string, secret: string }`，其中 `url` 为 `http://127.0.0.1:{port}/jsonrpc`。

- [ ] **Step 1: 写命令与状态**

`src-tauri/src/commands.rs`：
```rust
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Serialize, Clone)]
pub struct RpcEndpoint {
    pub url: String,
    pub secret: String,
}

pub struct AppState {
    pub endpoint: Mutex<Option<RpcEndpoint>>,
    pub port: Mutex<Option<u16>>,
    pub secret: Mutex<Option<String>>,
    pub supervisor: Mutex<crate::aria2::Supervisor>,
}

#[tauri::command]
pub fn get_rpc_endpoint(state: State<'_, AppState>) -> Option<RpcEndpoint> {
    state.endpoint.lock().ok().and_then(|g| g.clone())
}
```

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 加入：
```toml
serde = { version = "1", features = ["derive"] }
```

- [ ] **Step 2: 写 `run()`：setup 启动 supervisor，注册命令，退出钩子**

`src-tauri/src/lib.rs`：
```rust
pub mod aria2;
pub mod commands;
pub mod secret;

use aria2::{binary_path, new_config, rpc_http_url};
use commands::{AppState, RpcEndpoint};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState {
            endpoint: Mutex::new(None),
            port: Mutex::new(None),
            secret: Mutex::new(None),
            supervisor: Mutex::new(aria2::Supervisor::new()),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let binary = match binary_path(&handle) {
                    Ok(p) => p,
                    Err(e) => { eprintln!("aria2 binary not found: {e}"); return; }
                };
                let dir = handle.path().app_data_dir().unwrap_or_default();
                let session = dir.join("aria2.session.gz");
                let cfg = new_config(dir, session);
                let port = cfg.port;
                let secret = cfg.secret.clone();
                let st = match handle.try_state::<AppState>() { Some(s) => s, None => return };
                let ok = {
                    let mut sup = st.supervisor.lock().unwrap();
                    sup.start(&binary, &cfg).await
                };
                if ok {
                    if let Ok(mut g) = st.endpoint.lock() {
                        *g = Some(RpcEndpoint { url: rpc_http_url(port), secret: secret.clone() });
                    }
                    if let Ok(mut p) = st.port.lock() { *p = Some(port); }
                    if let Ok(mut s) = st.secret.lock() { *s = Some(secret); }
                    let _ = handle.emit("aria2://started", ());
                } else {
                    let _ = handle.emit("aria2://failed", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::get_rpc_endpoint])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 优雅退出（spec §4.5）：最后一个窗口关闭触发 ExitRequested，
    // 同步执行 aria2.shutdown → 等待 ≤5s → 强杀。
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(st) = app_handle.try_state::<AppState>() {
                let port = st.port.lock().ok().and_then(|g| *g);
                let secret = st.secret.lock().ok().and_then(|g| g.clone());
                if let (Some(port), Some(secret)) = (port, secret) {
                    let mut sup = st.supervisor.lock().unwrap();
                    tauri::async_runtime::block_on(sup.shutdown(port, &secret));
                }
            }
        }
    });
}
```

`src-tauri/src/main.rs`：
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { ariapanel_lib::run() }
```

- [ ] **Step 3: 验证编译与运行**

Run:
```powershell
pnpm tauri dev
```
Expected：窗口出现；终端日志显示 aria2 启动（控制台输出来自 `println!`/`eprintln!`）。前端尚未调用命令，仅验证 Rust 侧启动无 panic。

- [ ] **Step 4: 提交**

```powershell
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat(core): expose rpc endpoint command and wire lifecycle"
```

---

### Task 8: 前端 — 类型与 JSON-RPC 客户端（HTTP）

**Files:**
- Create: `src/lib/aria2/types.ts`, `src/lib/aria2/rpc-client.ts`
- Test: `src/lib/aria2/rpc-client.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `RpcResponse<T>`, `Aria2Task`, `GlobalStat`
  - `rpc-client.ts`: `class Aria2Client { constructor(url:string, secret:string, fetchImpl?:typeof fetch); async call<T>(method:string, params?:unknown[]): Promise<T>; getVersion(); getGlobalStat(): Promise<GlobalStat>; tellActive(): Promise<Aria2Task[]>; tellWaiting(offset:number,num:number); tellStopped(offset:number,num:number) }`

- [ ] **Step 1: 写失败测试**

`src/lib/aria2/rpc-client.test.ts`：
```ts
import { describe, it, expect, vi } from 'vitest'
import { Aria2Client } from './rpc-client'

function fakeFetch(resp: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => resp,
  } as unknown as Response))
}

describe('Aria2Client', () => {
  it('injects token as first param', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: { version: '1.37.0' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await c.getVersion()
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body.method).toBe('aria2.getVersion')
    expect(body.params).toEqual(['token:S'])
  })

  it('throws on rpc error', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'bad' } })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    await expect(c.getVersion()).rejects.toThrow('bad')
  })

  it('tellActive returns result array', async () => {
    const f = fakeFetch({ jsonrpc: '2.0', id: 1, result: [{ gid: 'g1' }] })
    const c = new Aria2Client('http://127.0.0.1:1/jsonrpc', 'S', f as unknown as typeof fetch)
    const r = await c.tellActive()
    expect(r).toEqual([{ gid: 'g1' }])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected：失败（模块不存在）。

- [ ] **Step 3: 写实现**

`src/lib/aria2/types.ts`：
```ts
export interface RpcError { code: number; message: string }
export interface RpcResponse<T> { jsonrpc: '2.0'; id: number; result?: T; error?: RpcError }

export interface Aria2Task {
  gid: string
  status: 'active' | 'waiting' | 'paused' | 'complete' | 'removed' | 'error'
  totalLength: string
  completedLength: string
  downloadSpeed: string
  uploadSpeed: string
  files: Array<{ path: string; length: string; completedLength: string; selected: string }>
  bittorrent?: { info: { name?: string } }
  errorCode?: string
  errorMessage?: string
}

export interface GlobalStat {
  downloadSpeed: string
  uploadSpeed: string
  active: string
  waiting: string
  stoppedTotal: string
}
```

`src/lib/aria2/rpc-client.ts`：
```ts
import type { Aria2Task, GlobalStat, RpcResponse } from './types'

export class Aria2Client {
  private id = 0
  constructor(
    private url: string,
    private secret: string,
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.id
    const body = { jsonrpc: '2.0', id, method, params: [`token:${this.secret}`, ...params] }
    const resp = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`rpc http ${resp.status}`)
    const data = (await resp.json()) as RpcResponse<T>
    if (data.error) throw new Error(data.error.message)
    return data.result as T
  }

  getVersion() { return this.call<{ version: string }>('aria2.getVersion') }
  getGlobalStat() { return this.call<GlobalStat>('aria2.getGlobalStat') }
  tellActive() { return this.call<Aria2Task[]>('aria2.tellActive') }
  tellWaiting(offset: number, num: number) { return this.call<Aria2Task[]>('aria2.tellWaiting', [offset, num]) }
  tellStopped(offset: number, num: number) { return this.call<Aria2Task[]>('aria2.tellStopped', [offset, num]) }
  addUri(uris: string[]) { return this.call<string>('aria2.addUri', [uris]) }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/lib/aria2/rpc-client.test.ts`
Expected：3 个测试通过。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/aria2/types.ts src/lib/aria2/rpc-client.ts src/lib/aria2/rpc-client.test.ts
git commit -m "feat(rpc): json-rpc http client with token injection"
```

---

### Task 9: 前端 — WS 通知与 Poller

**Files:**
- Create: `src/lib/aria2/ws-notify.ts`, `src/lib/aria2/poller.ts`
- Test: `src/lib/aria2/poller.test.ts`

**Interfaces:**
- Consumes: `Aria2Client`
- Produces:
  - `ws-notify.ts`: `class WsNotifier { constructor(wsUrl:string, secret:string, onEvent:(m:string)=>void); start(); stop() }`
  - `poller.ts`: `class Poller { constructor(client:Aria2Client, onTick:(a:Aria2Task[],w:Aria2Task[],s:Aria2Task[])=>void); start(); stop() }`，活跃时 1s、空闲时 5s。

- [ ] **Step 1: 写失败测试**

`src/lib/aria2/poller.test.ts`：
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Poller } from './poller'
import type { Aria2Client } from './rpc-client'

function makeClient(active = 0) {
  return {
    tellActive: vi.fn(async () => Array.from({ length: active }, (_, i) => ({ gid: String(i) }))),
    tellWaiting: vi.fn(async () => []),
    tellStopped: vi.fn(async () => []),
  } as unknown as Aria2Client
}

describe('Poller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('probes immediately then polls every 1s when there are active tasks', async () => {
    const onTick = vi.fn()
    const p = new Poller(makeClient(2), onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTick).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTick).toHaveBeenCalledTimes(3)
    p.stop()
  })

  it('slows to 5s cadence when idle after the bootstrap probe', async () => {
    const onTick = vi.fn()
    const p = new Poller(makeClient(0), onTick)
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(onTick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTick).toHaveBeenCalledTimes(2)
    p.stop()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/aria2/poller.test.ts`
Expected：失败。

- [ ] **Step 3: 写实现**

`src/lib/aria2/ws-notify.ts`：
```ts
type NotifyMethod =
  | 'aria2.onDownloadStart' | 'aria2.onDownloadPause' | 'aria2.onDownloadStop'
  | 'aria2.onDownloadComplete' | 'aria2.onDownloadError' | 'aria2.onBtDownloadComplete'

export class WsNotifier {
  private ws: WebSocket | null = null
  private stopped = false
  private retry = 0
  constructor(
    private wsUrl: string,
    private secret: string,
    private onEvent: (method: NotifyMethod) => void,
  ) {}

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }

  private connect() {
    if (this.stopped) return
    try {
      this.ws = new WebSocket(this.wsUrl)
    } catch { this.scheduleReconnect(); return }
    this.ws.onopen = () => { this.retry = 0 }
    this.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data)
        if (typeof m?.method === 'string') this.onEvent(m.method as NotifyMethod)
      } catch { /* ignore */ }
    }
    this.ws.onclose = () => this.scheduleReconnect()
    this.ws.onerror = () => this.ws?.close()
  }

  private scheduleReconnect() {
    if (this.stopped) return
    const delay = Math.min(30000, 500 * 2 ** this.retry++)
    setTimeout(() => this.connect(), delay)
  }
}
```

`src/lib/aria2/poller.ts`：
```ts
import type { Aria2Client } from './rpc-client'
import type { Aria2Task } from './types'

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false
  constructor(
    private client: Aria2Client,
    private onTick: (a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) => void,
  ) {}

  start() { this.schedule(0) }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null }

  private schedule(ms: number) {
    this.timer = setTimeout(() => { this.tick() }, ms)
  }

  private async tick() {
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
    }
    this.schedule(this.active ? 1000 : 5000)
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/lib/aria2/poller.test.ts`
Expected：2 个测试通过。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/aria2/ws-notify.ts src/lib/aria2/poller.ts src/lib/aria2/poller.test.ts
git commit -m "feat(rpc): ws notifier and adaptive poller"
```

---

### Task 10: 前端 — connection 与 task stores

**Files:**
- Create: `src/stores/connection.ts`, `src/stores/task.ts`
- Test: `src/stores/task.test.ts`, `src/stores/connection.test.ts`

**Interfaces:**
- Consumes: `types`
- Produces:
  - `useConnectionStore`：state 机 `status: 'idle'|'connecting'|'connected'|'reconnecting'|'error'`、`globalStat`、actions `setConnected/setReconnecting/setError/setStat`。
  - `useTaskStore`：`tasks: Map<gid,Aria2Task>`、`order: string[]`、getter `active/waiting/stopped`、action `apply(a,w,s)`、`upsert(task)`、`clear()`。

- [ ] **Step 1: 写失败测试**

`src/stores/task.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskStore } from './task'
import type { Aria2Task } from '@/lib/aria2/types'

function t(gid: string, status: Aria2Task['status']): Aria2Task {
  return { gid, status, totalLength: '100', completedLength: '0', downloadSpeed: '0', uploadSpeed: '0', files: [] }
}

describe('useTaskStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('applies and partitions tasks', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [t('2', 'waiting')], [t('3', 'complete')])
    expect(s.active.map(x => x.gid)).toEqual(['1'])
    expect(s.waiting.map(x => x.gid)).toEqual(['2'])
    expect(s.stopped.map(x => x.gid)).toEqual(['3'])
    expect(s.order).toEqual(['1', '2', '3'])
  })

  it('upsert merges existing task', () => {
    const s = useTaskStore()
    s.apply([t('1', 'active')], [], [])
    s.upsert({ ...t('1', 'active'), completedLength: '50' })
    expect(s.tasks.get('1')?.completedLength).toBe('50')
  })
})
```

`src/stores/connection.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConnectionStore } from './connection'

describe('useConnectionStore', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('transitions states and stores stat', () => {
    const s = useConnectionStore()
    expect(s.status).toBe('idle')
    s.setConnecting(); expect(s.status).toBe('connecting')
    s.setConnected(); expect(s.status).toBe('connected')
    s.setStat({ downloadSpeed: '1000', uploadSpeed: '0', active: '1', waiting: '0', stoppedTotal: '0' })
    expect(s.globalStat.active).toBe('1')
    s.setError('boom'); expect(s.status).toBe('error')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/stores`
Expected：失败（模块不存在；且需在 `vite.config.ts` 配 `@` 别名，见 Step 3）。

- [ ] **Step 3: 配置 `@` 路径别名**

`tsconfig.json` 的 `compilerOptions` 加：
```json
"baseUrl": ".", "paths": { "@/*": ["src/*"] }
```
`vite.config.ts` 加 resolver：
```ts
import { fileURLToPath, URL } from 'node:url'
// plugins 之前加：
resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
```

- [ ] **Step 4: 写实现**

`src/stores/connection.ts`：
```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GlobalStat } from '@/lib/aria2/types'

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export const useConnectionStore = defineStore('connection', () => {
  const status = ref<ConnStatus>('idle')
  const error = ref<string | null>(null)
  const globalStat = ref<GlobalStat>({ downloadSpeed: '0', uploadSpeed: '0', active: '0', waiting: '0', stoppedTotal: '0' })
  const setConnecting = () => { status.value = 'connecting' }
  const setConnected = () => { status.value = 'connected'; error.value = null }
  const setReconnecting = () => { status.value = 'reconnecting' }
  const setError = (e: string) => { status.value = 'error'; error.value = e }
  const setStat = (s: GlobalStat) => { globalStat.value = s }
  return { status, error, globalStat, setConnecting, setConnected, setReconnecting, setError, setStat }
})
```

`src/stores/task.ts`：
```ts
import { defineStore } from 'pinia'
import { computed, ref, shallowReactive } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'

export const useTaskStore = defineStore('task', () => {
  const tasks = shallowReactive(new Map<string, Aria2Task>())
  const order = ref<string[]>([])

  const active = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && t.status === 'active'))
  const waiting = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'waiting' || t.status === 'paused')))
  const stopped = computed(() => order.value.map(g => tasks.get(g)!).filter(t => t && (t.status === 'complete' || t.status === 'removed' || t.status === 'error')))

  function apply(a: Aria2Task[], w: Aria2Task[], s: Aria2Task[]) {
    tasks.clear()
    const all = [...a, ...w, ...s]
    for (const t of all) tasks.set(t.gid, t)
    order.value = all.map(t => t.gid)
  }

  function upsert(task: Aria2Task) {
    if (!tasks.has(task.gid)) order.value.push(task.gid)
    tasks.set(task.gid, task)
  }

  function clear() { tasks.clear(); order.value = [] }

  return { tasks, order, active, waiting, stopped, apply, upsert, clear }
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test -- src/stores`
Expected：3 个测试通过。

- [ ] **Step 6: 提交**

```powershell
git add src/stores vite.config.ts tsconfig.json
git commit -m "feat(store): connection state machine and task store"
```

---

### Task 11: 前端 — useAria2 组装 + 主题 + i18n + router + main

**Files:**
- Create: `src/composables/useAria2.ts`, `src/composables/useTheme.ts`, `src/i18n/index.ts`, `src/i18n/locales/zh-CN.ts`, `src/router/index.ts`
- Modify: `src/main.ts`, `src/App.vue`

**Interfaces:**
- Consumes: `Aria2Client`、`Poller`、`WsNotifier`、connection/task stores、`@tauri-apps/api` `invoke`。
- Produces：应用启动后自动调用 `invoke('get_rpc_endpoint')` 取端点→连接→起 Poller 与 WsNotifier→任务进入 task store。

- [ ] **Step 1: 写 i18n 与 router**

`src/i18n/locales/zh-CN.ts`：
```ts
export default {
  app: { title: 'AriaPanel' },
  nav: { all: '全部', active: '下载中', waiting: '等待中', completed: '已完成' },
  table: { name: '名称', size: '大小', progress: '进度', speed: '速度', status: '状态' },
  status: { connecting: '连接中…', reconnecting: '重连中…', error: '连接错误', connected: '已连接' },
  add: { placeholder: '粘贴下载链接，回车开始', button: '添加' },
}
```

`src/i18n/index.ts`：
```ts
import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'

export const i18n = createI18n({ legacy: false, locale: 'zh-CN', fallbackLocale: 'zh-CN', messages: { 'zh-CN': zhCN } })
```

`src/router/index.ts`：
```ts
import { createRouter, createWebHashHistory } from 'vue-router'
import TaskListView from '@/views/TaskListView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', name: 'tasks', component: TaskListView }],
})
```

- [ ] **Step 2: 写 useTheme**

`src/composables/useTheme.ts`：
```ts
import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

export function useTheme() {
  const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const mode = ref<ThemeMode>(prefersDark() ? 'dark' : 'light')
  const apply = (m: ThemeMode) => { mode.value = m }
  // 监听系统变化
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', e => { mode.value = e.matches ? 'dark' : 'light' })
  return { mode, apply }
}
```

- [ ] **Step 3: 写 useAria2 组装**

`src/composables/useAria2.ts`：
```ts
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Aria2Client } from '@/lib/aria2/rpc-client'
import { Poller } from '@/lib/aria2/poller'
import { WsNotifier } from '@/lib/aria2/ws-notify'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'

export function useAria2() {
  const conn = useConnectionStore()
  const tasks = useTaskStore()
  let client: Aria2Client | null = null
  let poller: Poller | null = null
  let ws: WsNotifier | null = null

  async function start() {
    conn.setConnecting()
    // 等待 Rust 侧 supervisor 就绪事件（或轮询命令）
    await listen('aria2://failed', () => conn.setError('aria2 启动失败'))
    const ep = await waitForEndpoint()
    if (!ep) return
    const wsUrl = ep.url.replace(/^http/, 'ws')
    client = new Aria2Client(ep.url, ep.secret)
    conn.setConnected()
    poller = new Poller(client, (a, w, s) => { tasks.apply(a, w, s); refreshStat() })
    poller.start()
    ws = new WsNotifier(wsUrl, ep.secret, () => {/* M1：仅作触发；Poller 会刷新 */})
    ws.start()
  }

  async function waitForEndpoint(): Promise<{ url: string; secret: string } | null> {
    for (let i = 0; i < 100; i++) {
      const ep = await invoke<{ url: string; secret: string } | null>('get_rpc_endpoint')
      if (ep) return ep
      await new Promise(r => setTimeout(r, 100))
    }
    conn.setError('获取 aria2 端点超时')
    return null
  }

  async function refreshStat() {
    if (!client) return
    try { conn.setStat(await client.getGlobalStat()) } catch { /* ignore */ }
  }

  function getClient() { return client }

  return { start, getClient }
}

async function addUrl(url: string) {
  // 由组件调用：通过当前 client 发 addUri
}
```
（`addUrl` 留在组件层通过 `getClient()` 实现；此处仅导出连接控制。）

- [ ] **Step 4: 改造 main.ts 与 App.vue**

`src/main.ts`：
```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(naive)
app.mount('#app')
```

`src/App.vue`：
```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useAria2 } from '@/composables/useAria2'

const aria = useAria2()
onMounted(() => { aria.start() })
</script>

<template>
  <router-view />
</template>
```

- [ ] **Step 5: 验证类型与构建**

Run:
```powershell
pnpm vue-tsc --noEmit
```
Expected：无类型错误。（`TaskListView.vue` 尚未创建会报错——下一个任务补；若失败属预期，留到 Task 12 完成后再次验证。）

- [ ] **Step 6: 提交**

```powershell
git add src/composables src/i18n src/router src/main.ts src/App.vue
git commit -m "feat(app): wire rpc connection, theme, i18n, router"
```

---

### Task 12: 前端 — UI 外壳 + 任务表 + 最小添加栏 + 端到端冒烟

**Files:**
- Create: `src/views/TaskListView.vue`, `src/components/AppShell.vue`, `src/components/TaskTable.vue`, `src/components/AddUrlBar.vue`
- Test: `src/components/TaskTable.test.ts`

**Interfaces:**
- Consumes: stores、`useAria2().getClient()`、i18n、theme。
- Produces：一个显示实时任务（名称/大小/进度/速度/状态）的界面，可通过添加栏粘贴 URL 触发下载并看到它出现在列表中。

- [ ] **Step 1: 写失败测试（TaskTable 渲染）**

`src/components/TaskTable.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskTable from './TaskTable.vue'
import type { Aria2Task } from '@/lib/aria2/types'

const tasks: Aria2Task[] = [{
  gid: 'g1', status: 'active', totalLength: '1000', completedLength: '500',
  downloadSpeed: '100', uploadSpeed: '0',
  files: [{ path: 'D:/dl/file.bin', length: '1000', completedLength: '500', selected: 'true' }],
}]

describe('TaskTable', () => {
  it('renders task name, progress and speed', () => {
    const w = mount(TaskTable, { props: { tasks } })
    expect(w.text()).toContain('file.bin')
    expect(w.text()).toContain('50%')
    expect(w.text()).toContain('100 B/s')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/components/TaskTable.test.ts`
Expected：失败。

- [ ] **Step 3: 写组件实现**

`src/components/TaskTable.vue`：
```vue
<script setup lang="ts">
import { NProgress, NTable } from 'naive-ui'
import { computed } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'

const props = defineProps<{ tasks: Aria2Task[] }>()

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
const rows = computed(() => props.tasks.map(t => ({ t, name: name(t), pct: pct(t) })))
</script>

<template>
  <NTable size="small" :bordered="false">
    <thead><tr><th>名称</th><th>进度</th><th>速度</th><th>状态</th></tr></thead>
    <tbody>
      <tr v-for="r in rows" :key="r.t.gid">
        <td>{{ r.name }}</td>
        <td style="width:180px"><NProgress :percentage="r.pct" :height="10" /></td>
        <td>{{ fmtBytes(r.t.downloadSpeed) }}</td>
        <td>{{ r.t.status }}</td>
      </tr>
    </tbody>
  </NTable>
</template>
```

`src/components/AddUrlBar.vue`：
```vue
<script setup lang="ts">
import { NButton, NInput } from 'naive-ui'
import { ref } from 'vue'
const props = defineProps<{ onAdd: (url: string) => void }>()
const url = ref('')
function submit() {
  const v = url.value.trim()
  if (!v) return
  props.onAdd(v)
  url.value = ''
}
</script>

<template>
  <div style="display:flex;gap:8px;padding:8px">
    <NInput v-model:value="url" placeholder="粘贴下载链接，回车开始" @keydown.enter="submit" />
    <NButton type="primary" @click="submit">添加</NButton>
  </div>
</template>
```

`src/components/AppShell.vue`：
```vue
<script setup lang="ts">
import { NConfigProvider, darkTheme } from 'naive-ui'
import { useTheme } from '@/composables/useTheme'
const { mode } = useTheme()
</script>

<template>
  <NConfigProvider :theme="mode === 'dark' ? darkTheme : null">
    <slot />
  </NConfigProvider>
</template>
```

`src/views/TaskListView.vue`：
```vue
<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'
import AppShell from '@/components/AppShell.vue'
import TaskTable from '@/components/TaskTable.vue'
import AddUrlBar from '@/components/AddUrlBar.vue'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'
import type { Aria2Client } from '@/lib/aria2/rpc-client'

const conn = useConnectionStore()
const tasks = useTaskStore()
const client = inject<Ref<Aria2Client | null>>('aria2-client')!

const list = computed(() => [...tasks.active, ...tasks.waiting, ...tasks.stopped])

async function onAdd(url: string) {
  if (!client.value) return
  await client.value.addUri([url])
}
</script>

<template>
  <AppShell>
    <div style="padding:8px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--n-border-color,#eee)">
      <strong>AriaPanel</strong>
      <span style="margin-left:auto;font-size:12px;opacity:.7">{{ conn.status }}</span>
    </div>
    <AddUrlBar :on-add="onAdd" />
    <TaskTable :tasks="list" />
  </AppShell>
</template>
```

为让 `inject('aria2-client')` 生效，需在 `useAria2` 内 `provide`。更新 `src/App.vue`：
```vue
<script setup lang="ts">
import { onMounted, provide, shallowRef, type Ref } from 'vue'
import { useAria2 } from '@/composables/useAria2'
import type { Aria2Client } from '@/lib/aria2/rpc-client'

const aria = useAria2()
const clientRef = shallowRef<Aria2Client | null>(null)
provide<Ref<Aria2Client | null>>('aria2-client', clientRef)
onMounted(async () => {
  await aria.start()
  clientRef.value = aria.getClient()
})
</script>

<template>
  <router-view />
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/components/TaskTable.test.ts`
Expected：1 个测试通过。

- [ ] **Step 5: 运行全部前端测试**

Run: `pnpm test`
Expected：全部通过。

- [ ] **Step 6: 类型与构建**

Run:
```powershell
pnpm vue-tsc --noEmit
pnpm tauri dev
```
Expected：窗口显示 AriaPanel 外壳，状态栏最终为"已连接"，添加栏输入一个直链（如 `https://speed.hetzner.de/100MB.bin`）后列表出现该任务并实时刷新进度。

- [ ] **Step 7: 手工冒烟并提交**

确认：能添加 HTTP 直链、进度与速度实时变化、aria2c 退出随窗口关闭。
```powershell
git add src/views src/components src/App.vue
git commit -m "feat(ui): task list shell with live progress and minimal add-url"
```

---

## 自审（Self-Review）

**Spec 覆盖**：M1 范围对应 spec §3（架构/数据流）、§4（进程管理）、§5（前端数据层）的地基部分，以及 §6.1 外壳的最小可用形态。暂停/恢复/删除、详情抽屉、分类、设置、剪贴板、托盘、BT 细节、Metalink、自更新、打包——均按计划归属 M2/M3/M4，M1 不涉及，符合里程碑切分。

**占位扫描**：无 TBD/TODO；每个代码步均含完整代码。

**类型一致性**：`Aria2Client.call/addUri/tellActive/...`、`Poller`、`WsNotifier`、stores 的 `apply/upsert`、Rust 的 `new_config/build_args/Supervisor/get_rpc_endpoint` 在各任务间命名与签名一致；前端 `Aria2Task` 类型跨 RPC/store/UI 一致。

**已知简化（留给后续里程碑）**：
- M1 最后一个窗口关闭即触发优雅退出（ExitRequested → `Supervisor::shutdown`），无托盘"最小化到托盘"行为；托盘属 M2（与 spec §6.4 一致）。
- `AppShell.vue` 的 `<script lang="ts">` 混用 `setup` 与选项式仅为引用 `NConfigProvider`，可在 Task 12 内简化为仅 `import`（Naive UI 已全局注册）。实现者按需收敛。
