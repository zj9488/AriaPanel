# Design: Windows NSIS Packaging

**Date:** 2026-07-28
**Status:** Approved
**Author:** Brainstorming session

## Problem

AriaPanel has completed all feature milestones (M1-M6d) but has never produced a distributable Windows installer. The Tauri config has `bundle.targets: "all"` with no platform-specific customization. Need to configure NSIS packaging and verify the build produces a working installer.

## Solution

Configure NSIS installer settings in `tauri.conf.json`, then build and manually verify. No code changes required — aria2c.exe resource resolution (`BaseDirectory::Resource`) and all app functionality already work in production builds.

## Changes

### 1. `src-tauri/tauri.conf.json` — NSIS Configuration

**Change `bundle` block:**

Current:
```jsonc
"bundle": {
  "active": true,
  "targets": "all",
  "resources": ["resources/aria2c.exe"],
  "icon": [...]
}
```

New:
```jsonc
"bundle": {
  "active": true,
  "targets": ["nsis"],
  "publisher": "zj9488",
  "resources": ["resources/aria2c.exe"],
  "icon": [...],
  "windows": {
    "nsis": {
      "installMode": "currentUser",
      "languages": ["SimpChinese"],
      "displayLanguageSelector": false
    }
  }
}
```

**Key decisions:**

| Config | Value | Rationale |
|--------|-------|-----------|
| `targets` | `["nsis"]` | Only `.exe` installer, skip MSI |
| `publisher` | `"zj9488"` | Displayed in Windows Programs control panel |
| `installMode` | `currentUser` | Installs to `%LOCALAPPDATA%\Programs\AriaPanel\`, no UAC prompt |
| `languages` | `["SimpChinese"]` | v1 is zh-CN only |
| `displayLanguageSelector` | `false` | Single language, no selector dialog |
| WebView2 | Tauri default (bootstrapper) | Win10/11 usually pre-installed; auto-downloads if missing |

### 2. Already Working (No Changes Needed)

| Component | Status |
|-----------|--------|
| aria2c.exe bundling | `bundle.resources` configured; `binary_path()` uses `BaseDirectory::Resource` (`aria2.rs:81-84`) |
| App icons | `.ico` + PNG variants in `src-tauri/icons/` |
| Frontend build | `beforeBuildCommand: "pnpm build"` runs `vue-tsc --noEmit && vite build` |
| Version | `0.1.0` in `tauri.conf.json`, `Cargo.toml`, `package.json` |

### 3. Build Command

```bash
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/nsis/AriaPanel_0.1.0_x64-setup.exe`

### 4. Manual QA Checklist

- Installer runs without error (double-click `.exe`)
- App launches from Start Menu shortcut
- aria2c starts correctly (task list loads, speed stats visible)
- Create HTTP download task, verify download completes
- Uninstall via Windows Settings (no residual files in install dir)

## Non-Goals

- Code signing (deferred — SmartScreen warning acceptable for initial release)
- GitHub Actions CI/CD (manual builds for now)
- Tauri updater / self-update (future milestone)
- Custom installer wizard pages (NSIS defaults sufficient)
- Cross-platform packaging (macOS/Linux — future milestone)

## Files Touched

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.json` | Add NSIS config, change targets, add publisher |
