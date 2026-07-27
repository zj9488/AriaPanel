# AGENTS.md

Guide for AI agents working on this codebase.

## Commands

| Task | Command |
|------|---------|
| Run tests | `pnpm test` |
| Type check | `pnpm vue-tsc --noEmit` |
| Lint | `pnpm lint` |
| Lint (auto-fix) | `pnpm lint:fix` |
| Format | `pnpm format` |
| Full build | `pnpm build` |
| Dev server | `pnpm tauri dev` |
| Rust check | `cargo check --manifest-path src-tauri\Cargo.toml` |
| Rust test | `cargo test --manifest-path src-tauri\Cargo.toml` |

**Run these before committing**: `pnpm lint && pnpm vue-tsc --noEmit && pnpm test`

## Environment Notes

- **Windows + PowerShell**: Rust `cargo` is at `%USERPROFILE%\.cargo\bin`, may not be on default PATH. Prepend: `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`
- **pnpm** is the package manager (not npm/yarn)
- **`@` alias** maps to `src/` in imports
- **No `&&` in PowerShell** — use `;` or `if ($?) {}` to chain commands
- **Bundled aria2c**: If `aria2c.exe` is locked by a running process, `cargo check` fails with OS error 32. Kill aria2c first: `Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force`

## Tech Stack

- **Frontend**: Vue 3.5 (Composition API, `<script setup>`), TypeScript, Vite 6, Naive UI 2.44
- **State**: Pinia (stores: task, category, connection, preferences)
- **Backend**: Tauri 2 (Rust), bundled aria2c, aria2 JSON-RPC over HTTP + WebSocket
- **Testing**: Vitest + jsdom + @vue/test-utils

## Code Conventions

- **No comments** unless explicitly requested
- **No emojis** in code or commit messages
- **Semicolons**: false (Prettier)
- **Quotes**: single (Prettier)
- **Components**: self-contained `<script setup lang="ts">` with explicit Naive UI imports (no global registration)
- **Composables** in `src/composables/`, shared utilities in `src/lib/`
- **Formatting**: All `src/` files formatted with Prettier (enforced by pre-commit hook via lint-staged)

## Architecture Quick Reference

- `App.vue` → `AppShell` (Naive UI providers) → `TaskListView` (main and only view)
- **No vue-router** — single view rendered directly
- **No i18n** — strings are hardcoded in Chinese
- **aria2 API** injected via `provide/inject` key `'aria2-api'`
- **Task operations** extracted to `useTaskOperations` composable (not inline in view)
- **Detail polling** extracted to `useDetailPoller` composable with proper interval cleanup
- **Shared formatters** in `lib/format.ts`: `fmtSpeed`, `fmtBytes`, `fmtProgress`, `taskName`

## Known Naive UI Quirks

- **NCollapse** lazily mounts body — not in DOM until first expand, even with `display-directive="show"`. Tests must click the header to expand before asserting content.
- **NSelect** internal component name is `'Select'`, not `'NSelect'`. Use component-reference matching in tests.
- **NDrawer/NModal** teleport to `document.body` — tests must use `document.body.textContent` or provider wrappers.
- **useMessage/useDialog** throw without providers — test mounts must wrap with `NConfigProvider > NMessageProvider > NDialogProvider`.

## Tauri 2 Lifecycle

- Windows accessible inside `setup()` closure and during event handlers, but NOT between `build()` return and `run()`.
- Plugins registered: `tauri-plugin-dialog`, `tauri-plugin-clipboard-manager`.
- Tray via Tauri 2 built-in `TrayIcon` API.
- App data dir: `%APPDATA%\com.ariapanel.app`

## Testing Patterns

```ts
// Provider wrapper for components using useMessage/useDialog
const wrapper = mount(Component, {
  global: {
    provide: { 'aria2-api': apiRef },
    plugins: [createTestingPinia()],
  },
  // Wrap with NConfigProvider > NMessageProvider > NDialogProvider if needed
})
```
