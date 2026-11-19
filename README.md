# AriaPanel

A lightweight desktop GUI for [aria2](https://aria2.github.io/), built with Tauri 2 + Vue 3 + TypeScript + Naive UI.

## Features

- HTTP/HTTPS/FTP and BitTorrent (magnet) downloads
- Batch URL input with auto type detection
- Advanced per-task options: split, max connections, proxy, filename, category
- Motrix-style predefined categories with full CRUD (persisted to localStorage)
- Task table with sorting, multi-select, context menu, and right-click actions
- Detail drawer with real-time progress, file list, and URI status
- Clipboard monitoring with auto-detect download links
- System tray with pause-all / resume-all
- Light / dark / system theme
- Settings panel with aria2 global options; RPC port/secret are generated per launch
- Bundled aria2c — no external installation required

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [Rust](https://www.rust-lang.org/tools/install) 1.77.2+ (with `cargo` on PATH)
- Windows 10+ (aria2c binary is bundled for Windows)

## Getting Started

```bash
pnpm install
```

### Development

```bash
pnpm tauri dev
```

This starts the Vite dev server (port 5173) and launches the Tauri window. The bundled aria2c is spawned automatically by the Rust backend.

### Production Build

```bash
pnpm tauri build
```

Outputs an installer to `src-tauri/target/release/bundle/`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server (frontend only) |
| `pnpm build` | Type-check + build frontend to `dist/` |
| `pnpm test` | Run Vitest test suite |
| `pnpm lint` | Run ESLint on `src/` |
| `pnpm lint:fix` | Auto-fix ESLint issues |
| `pnpm format` | Format `src/` with Prettier |
| `pnpm tauri dev` | Full-stack dev mode |
| `pnpm tauri build` | Production build |

## Architecture

```
src/
├── assets/           CSS
├── components/       Vue components (TaskTable, NewTaskModal, Sidebar, etc.)
├── composables/      Vue composables (useAria2, useTaskOperations, useTheme, etc.)
├── lib/
│   ├── aria2/        aria2 RPC client, WebSocket notifier, poller, types
│   ├── format.ts     Shared formatters (fmtSpeed, fmtBytes, fmtProgress, taskName)
│   └── task-op.ts    Task operation union type
├── stores/           Pinia stores (task, category, connection, preferences)
├── views/            TaskListView (main view)
├── App.vue           Root: aria2 lifecycle, tray events, provide api ref
├── AppShell.vue      Naive UI providers (config, message, dialog, notification)
└── main.ts           App entry (Pinia only — no router/i18n)

src-tauri/
├── src/
│   ├── aria2/        Rust aria2 supervisor (spawn, health-check, restart)
│   ├── commands.rs   Tauri IPC commands
│   ├── settings.rs   Settings persistence
│   └── lib.rs        App entry, tray menu, plugin registration
├── resources/        Bundled aria2c.exe
└── Cargo.toml        Rust dependencies
```

### Data Flow

```
App.vue (onMounted)
  → useAria2.start() — spawns aria2c, waits for RPC endpoint
  → Poller polls tellActive/tellWaiting/tellStopped every 1-5s
  → WsNotifier listens for aria2 download events via WebSocket
  → api ref provided via provide/inject to all children
```

### Key Patterns

- **No global UI registration**: Components import Naive UI individually (removed `app.use(naive)`)
- **Composables**: `useTaskOperations` (operate/retry/add), `useDetailPoller`, `useDirBrowser`, `useCategoryDir`
- **Filter pipeline**: `statusFilter → categoryFilter → searchFilter` in task store
- **Shared formatters**: All formatting logic centralized in `lib/format.ts`
- **Bundle splitting**: `naive-ui` and `vue+pinia` in separate chunks via `manualChunks`

## License

MIT
