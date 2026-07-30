# AriaPanel 自更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app auto-update: silent check on startup, notification modal on new version, in-app download + install + relaunch.

**Architecture:** Tauri 2 updater plugin (Rust + JS), signing keypair (Ed25519), GitHub Releases as distribution channel with `latest.json`. Frontend composable `useUpdater` wraps the plugin API; `UpdateNotification` component shows modal and handles download/install flow. CI injects signing key to produce signed bundles + `latest.json`.

**Tech Stack:** Rust (tauri-plugin-updater, tauri-plugin-process), TypeScript (@tauri-apps/plugin-updater, @tauri-apps/plugin-process), Vue 3.5, Naive UI 2.44, Vitest + jsdom + @vue/test-utils

## Global Constraints

- **Windows + PowerShell**: No `&&` in commands — use `;` or `if ($?) {}`
- **Rust cargo** at `%USERPROFILE%\.cargo\bin` — prepend: `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`
- **Kill aria2c before cargo check**: `Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force`
- **pnpm** is the package manager (not npm/yarn)
- **No comments** in code unless explicitly requested
- **No emojis** in code or commit messages
- **Semicolons**: false; **Quotes**: single; **Trailing comma**: all; **Width**: 120
- **`@` alias** maps to `src/`
- **Naive UI** components imported individually (no global registration)
- **Test providers**: Components using `useMessage` must be wrapped with `NConfigProvider > NMessageProvider > NDialogProvider` in tests
- **NModal** teleports to `document.body` — tests must use `document.body.textContent`
- **Tauri 2 command parameter names**: no snake_case → camelCase conversion
- **GitHub repo**: `https://github.com/zj9488/AriaPanel`
- **Design spec**: `docs/superpowers/specs/2026-07-30-ariapanel-auto-update-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/Cargo.toml` | Modify | Add `tauri-plugin-updater` + `tauri-plugin-process` deps |
| `src-tauri/src/lib.rs` | Modify | Register updater + process plugins |
| `src-tauri/tauri.conf.json` | Modify | Add `plugins.updater` config (pubkey + endpoint) |
| `src-tauri/capabilities/default.json` | Modify | Add `updater:default` + `process:default` permissions |
| `src/composables/useUpdater.ts` | Create | Wrap updater plugin: check, download, install, relaunch |
| `src/composables/useUpdater.test.ts` | Create | Test composable state transitions |
| `src/components/UpdateNotification.vue` | Create | Modal showing version + notes + download/install buttons |
| `src/components/UpdateNotification.test.ts` | Create | Test modal rendering and interactions |
| `src/views/TaskListView.vue` | Modify | Render `<UpdateNotification />` |
| `.github/workflows/release.yml` | Modify | Inject signing keys, publish release, add updaterJsonPreferNsis |

---

## Task 1: Generate Signing Keys + Rust Plugin Registration + Config

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:16-18`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: `tauri-plugin-updater` and `tauri-plugin-process` registered in the Tauri app; updater config with publicKey + endpoint in `tauri.conf.json`; permissions in capabilities

- [ ] **Step 1: Generate signing keypair**

Run:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
pnpm tauri signer generate -w "$env:USERPROFILE\.tauri\ariapanel.key"
```

Enter a password (or leave empty for no password). Note the output — it prints both the **private key** and the **public key**. Save both securely.

- [ ] **Step 2: Add Rust dependencies**

In `src-tauri/Cargo.toml`, after line 30 (`serde_bencode = "0.2"`), add:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 3: Register plugins in lib.rs**

In `src-tauri/src/lib.rs`, after line 18 (`.plugin(tauri_plugin_clipboard_manager::init())`), add:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 4: Add updater config to tauri.conf.json**

In `src-tauri/tauri.conf.json`, add a top-level `plugins` key (after the `bundle` block, before the closing `}`):

```json
  ,
  "plugins": {
    "updater": {
      "publicKey": "PASTE_PUBLIC_KEY_HERE",
      "endpoints": [
        "https://github.com/zj9488/AriaPanel/releases/latest/download/latest.json"
      ]
    }
  }
```

Replace `PASTE_PUBLIC_KEY_HERE` with the public key from Step 1 (the long string starting with `dW50cnVzdGVkIGNvbW1lbnQ6...`).

- [ ] **Step 5: Add permissions to capabilities**

In `src-tauri/capabilities/default.json`, replace the `permissions` array:

```json
  "permissions": [
    "core:default",
    "dialog:default",
    "clipboard-manager:allow-read-text",
    "updater:default",
    "process:default"
  ]
```

- [ ] **Step 6: Add GitHub Secrets**

Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
- Name: `TAURI_SIGNING_PRIVATE_KEY`, Value: the private key from Step 1
- Name: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, Value: the password from Step 1 (or empty string if none)

- [ ] **Step 7: Verify Rust compiles**

Run:
```powershell
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: compiles with 0 errors

- [ ] **Step 8: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(rust): register updater and process plugins with signing config"
```

---

## Task 2: useUpdater Composable

**Files:**
- Modify: `package.json` (add npm deps)
- Create: `src/composables/useUpdater.ts`
- Create: `src/composables/useUpdater.test.ts`

**Interfaces:**
- Produces: `useUpdater()` returns `{ updateAvailable: Ref<boolean>, updateInfo: Ref<{ version: string; date: string; body: string } | null>, downloading: Ref<boolean>, progress: Ref<number>, error: Ref<string | null>, check: () => Promise<void>, downloadAndInstall: () => Promise<void> }`

- [ ] **Step 1: Install npm dependencies**

Run:
```powershell
pnpm add @tauri-apps/plugin-updater@^2.0.0 @tauri-apps/plugin-process@^2.0.0
```

- [ ] **Step 2: Write failing tests**

Create `src/composables/useUpdater.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUpdater } from './useUpdater'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

import { check as mockCheck } from '@tauri-apps/plugin-updater'
import { relaunch as mockRelaunch } from '@tauri-apps/plugin-process'

function mountComposable() {
  let result!: ReturnType<typeof useUpdater>
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useUpdater()
        return () => h('div')
      },
    }),
  )
  return { result, wrapper }
}

describe('useUpdater', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('no update available sets updateAvailable false', async () => {
    vi.mocked(mockCheck).mockResolvedValue(null)
    const { result } = mountComposable()
    await result.check()
    expect(result.updateAvailable.value).toBe(false)
    expect(result.updateInfo.value).toBeNull()
  })

  it('update available sets updateAvailable true and stores info', async () => {
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: 'Bug fixes',
      downloadAndInstall: vi.fn(),
    } as never)
    const { result } = mountComposable()
    await result.check()
    expect(result.updateAvailable.value).toBe(true)
    expect(result.updateInfo.value).toEqual({
      version: '0.2.0',
      date: '2026-07-30',
      body: 'Bug fixes',
    })
  })

  it('network error sets error and keeps updateAvailable false', async () => {
    vi.mocked(mockCheck).mockRejectedValue(new Error('network'))
    const { result } = mountComposable()
    await result.check()
    expect(result.updateAvailable.value).toBe(false)
    expect(result.error.value).toBe('network')
  })

  it('downloadAndInstall calls plugin then relaunch', async () => {
    const dni = vi.fn().mockResolvedValue(undefined)
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    vi.mocked(mockRelaunch).mockResolvedValue(undefined)
    const { result } = mountComposable()
    await result.check()
    await result.downloadAndInstall()
    expect(dni).toHaveBeenCalledOnce()
    expect(mockRelaunch).toHaveBeenCalledOnce()
  })

  it('downloadAndInstall sets downloading true during operation', async () => {
    const dni = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    vi.mocked(mockRelaunch).mockResolvedValue(undefined)
    const { result } = mountComposable()
    await result.check()
    const promise = result.downloadAndInstall()
    expect(result.downloading.value).toBe(true)
    await promise
    expect(result.downloading.value).toBe(false)
  })

  it('downloadAndInstall sets error on failure', async () => {
    const dni = vi.fn().mockRejectedValue(new Error('install failed'))
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    const { result } = mountComposable()
    await result.check()
    await result.downloadAndInstall()
    expect(result.error.value).toBe('install failed')
    expect(result.downloading.value).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- --run src/composables/useUpdater.test.ts`
Expected: FAIL — module `./useUpdater` does not exist

- [ ] **Step 4: Implement useUpdater composable**

Create `src/composables/useUpdater.ts`:

```typescript
import { ref } from 'vue'
import { check as checkUpdate, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export function useUpdater() {
  const updateAvailable = ref(false)
  const updateInfo = ref<{ version: string; date: string; body: string } | null>(null)
  const downloading = ref(false)
  const progress = ref(0)
  const error = ref<string | null>(null)
  let pendingUpdate: Update | null = null

  async function check() {
    error.value = null
    try {
      const update = await checkUpdate()
      if (update) {
        pendingUpdate = update
        updateAvailable.value = true
        updateInfo.value = {
          version: update.version,
          date: update.date,
          body: update.body,
        }
      } else {
        updateAvailable.value = false
        updateInfo.value = null
      }
    } catch (e) {
      error.value = String(e).replace(/^Error:\s*/, '')
    }
  }

  async function downloadAndInstall() {
    if (!pendingUpdate) return
    downloading.value = true
    error.value = null
    progress.value = 0
    try {
      let total = 0
      let downloaded = 0
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          total = event.data.contentLength
        } else if (event.event === 'Progress' && event.data.chunkLength) {
          downloaded += event.data.chunkLength
          if (total > 0) {
            progress.value = Math.round((downloaded / total) * 100)
          }
        }
      })
      await relaunch()
    } catch (e) {
      error.value = String(e).replace(/^Error:\s*/, '')
    } finally {
      downloading.value = false
    }
  }

  return { updateAvailable, updateInfo, downloading, progress, error, check, downloadAndInstall }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- --run src/composables/useUpdater.test.ts`
Expected: PASS — all 6 tests pass

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml src/composables/useUpdater.ts src/composables/useUpdater.test.ts
git commit -m "feat: add useUpdater composable with check and downloadAndInstall"
```

---

## Task 3: UpdateNotification Component

**Files:**
- Create: `src/components/UpdateNotification.vue`
- Create: `src/components/UpdateNotification.test.ts`

**Interfaces:**
- Consumes: `useUpdater` from Task 2
- Produces: Self-contained `<UpdateNotification />` component that checks for updates on mount and renders NModal

- [ ] **Step 1: Write failing tests**

Create `src/components/UpdateNotification.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import UpdateNotification from './UpdateNotification.vue'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

import { check as mockCheck } from '@tauri-apps/plugin-updater'

function mountReal() {
  document.body.innerHTML = ''
  return mount(
    {
      components: { NConfigProvider, NMessageProvider, NDialogProvider, UpdateNotification },
      template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <UpdateNotification />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
    },
  )
}

describe('UpdateNotification', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('does not show modal when no update', async () => {
    vi.mocked(mockCheck).mockResolvedValue(null)
    mountReal()
    await flushPromises()
    expect(document.body.textContent).not.toContain('发现新版本')
  })

  it('shows modal with version when update available', async () => {
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '修复了若干问题',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    } as never)
    mountReal()
    await flushPromises()
    expect(document.body.textContent).toContain('发现新版本')
    expect(document.body.textContent).toContain('0.2.0')
    expect(document.body.textContent).toContain('修复了若干问题')
  })

  it('later button closes modal', async () => {
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    } as never)
    const wrapper = mountReal()
    await flushPromises()
    const laterBtn = Array.from(wrapper.findAll('button')).find((b) => b.text().includes('稍后'))
    expect(laterBtn).toBeTruthy()
    await laterBtn!.trigger('click')
    expect(document.body.textContent).not.toContain('发现新版本')
  })

  it('update button triggers downloadAndInstall', async () => {
    const dni = vi.fn().mockResolvedValue(undefined)
    vi.mocked(mockCheck).mockResolvedValue({
      version: '0.2.0',
      date: '2026-07-30',
      body: '',
      downloadAndInstall: dni,
    } as never)
    const { relaunch: mockRelaunch } = await import('@tauri-apps/plugin-process')
    vi.mocked(mockRelaunch).mockResolvedValue(undefined)
    const wrapper = mountReal()
    await flushPromises()
    const updateBtn = Array.from(wrapper.findAll('button')).find((b) => b.text().includes('立即更新'))
    expect(updateBtn).toBeTruthy()
    await updateBtn!.trigger('click')
    await flushPromises()
    expect(dni).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/components/UpdateNotification.test.ts`
Expected: FAIL — `UpdateNotification.vue` does not exist

- [ ] **Step 3: Implement UpdateNotification.vue**

Create `src/components/UpdateNotification.vue`:

```vue
<script setup lang="ts">
import { NModal, NButton, NSpin } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useUpdater } from '@/composables/useUpdater'

const { updateAvailable, updateInfo, downloading, progress, error, check, downloadAndInstall } =
  useUpdater()

const dismissed = ref(false)

onMounted(() => {
  check()
})

const showModal = computed(() => updateAvailable.value && !dismissed.value)

function later() {
  dismissed.value = true
}

async function doUpdate() {
  await downloadAndInstall()
}
</script>

<template>
  <NModal :show="showModal" :mask-closable="false" :close-on-esc="false">
    <div
      style="
        width: 420px;
        max-width: 90vw;
        background: var(--n-color, #fff);
        border-radius: 8px;
        padding: 24px;
      "
    >
      <h3 style="margin: 0 0 12px">发现新版本 v{{ updateInfo?.version }}</h3>
      <div v-if="updateInfo?.body" style="font-size: 14px; line-height: 1.6; margin-bottom: 16px">
        {{ updateInfo.body }}
      </div>
      <div v-if="downloading" style="margin-bottom: 16px">
        <NSpin size="small" />
        <span style="margin-left: 8px; font-size: 13px">下载中… {{ progress }}%</span>
      </div>
      <div v-if="error" style="color: #e88080; font-size: 13px; margin-bottom: 16px">
        更新失败：{{ error }}
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <NButton v-if="!downloading" size="small" @click="later">稍后</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="downloading"
          :disabled="downloading"
          @click="doUpdate"
        >
          立即更新
        </NButton>
      </div>
    </div>
  </NModal>
</template>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/UpdateNotification.test.ts`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: Commit**

```powershell
git add src/components/UpdateNotification.vue src/components/UpdateNotification.test.ts
git commit -m "feat(ui): UpdateNotification modal with download and install"
```

---

## Task 4: Integrate UpdateNotification into TaskListView

**Files:**
- Modify: `src/views/TaskListView.vue`

**Interfaces:**
- Consumes: `UpdateNotification` component from Task 3

- [ ] **Step 1: Add import and render component**

In `src/views/TaskListView.vue`, add import after line 14 (`import DiagnosticsModal from '@/components/DiagnosticsModal.vue'`):

```typescript
import UpdateNotification from '@/components/UpdateNotification.vue'
```

In the `<template>`, after line 180 (`<DiagnosticsModal />`), add:

```html
    <UpdateNotification />
```

- [ ] **Step 2: Run lint and type check**

Run:
```powershell
pnpm lint; if ($?) { pnpm vue-tsc --noEmit }
```
Expected: 0 errors

- [ ] **Step 3: Run all tests**

Run: `pnpm test -- --run`
Expected: all tests pass (131 existing + 10 new = 141)

- [ ] **Step 4: Commit**

```powershell
git add src/views/TaskListView.vue
git commit -m "feat(view): integrate UpdateNotification into TaskListView"
```

---

## Task 5: CI Workflow — Signing + Published Release + latest.json

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Produces: CI builds signed bundles, generates `latest.json`, publishes (non-draft) GitHub Release

- [ ] **Step 1: Add signing env vars to tauri-action**

In `.github/workflows/release.yml`, replace the `tauri-action` step (lines 104-112):

```yaml
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ inputs.tag || github.ref_name }}
          releaseName: 'AriaPanel ${{ inputs.tag || github.ref_name }}'
          releaseDraft: false
          prerelease: false
          updaterJsonPreferNsis: true
          args: ${{ matrix.target && format('--target {0}', matrix.target) || '' }}
```

- [ ] **Step 2: Change create-release job from draft to published**

In `.github/workflows/release.yml`, in the `create-release` job (line 28), change:

```yaml
          draft: true
```

to:

```yaml
          draft: false
```

- [ ] **Step 3: Verify YAML syntax**

Run:
```powershell
pnpm tauri --version
```
Expected: prints version (confirms tauri CLI available for local YAML validation if needed)

The YAML changes are straightforward key-value changes. Verify by reading the file back.

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/release.yml
git commit -m "ci: sign update bundles and publish releases for auto-update"
```

- [ ] **Step 5: Final verification — full build**

Run:
```powershell
pnpm test -- --run
```
Expected: all tests pass

Run:
```powershell
pnpm lint; if ($?) { pnpm vue-tsc --noEmit }
```
Expected: 0 errors

Run:
```powershell
Get-Process aria2c -ErrorAction SilentlyContinue | Stop-Process -Force
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo check --manifest-path src-tauri\Cargo.toml
```
Expected: 0 errors

- [ ] **Step 6: End-to-end manual verification (after CI)**

This step is manual and requires a published release:

1. Bump version to `0.2.0` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
2. Tag and push: `git tag v0.2.0; git push origin v0.2.0`
3. Wait for CI to complete — verify Release is **published** (not draft) with `latest.json` attached
4. Install the v0.2.0 build
5. Bump version to `0.3.0`, tag and push: `git tag v0.3.0; git push origin v0.3.0`
6. Wait for CI to complete
7. Launch the v0.2.0 app — update notification should appear within seconds
8. Click "立即更新" — verify download + install + relaunch to v0.3.0
