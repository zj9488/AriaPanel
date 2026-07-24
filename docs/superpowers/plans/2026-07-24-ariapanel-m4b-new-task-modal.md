# AriaPanel M4b — 新建任务 Modal 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增完整的新建下载任务 Modal，支持批量 URL 粘贴、自动类型识别（HTTP/BT/混合）、高级折叠面板和智能字段隐藏。

**Architecture:** 纯前端里程碑。新增 `NewTaskModal.vue` 自包含组件（NModal + textarea + NCollapse），TopBar 加「+」按钮触发，TaskListView 集成。复用现有 `addUri` RPC 和 `useCategoryStore`。现有 AddUrlBar 快捷栏不变。

**Tech Stack:** Vue 3.5 + TS, Pinia, Naive UI (NModal, NInput, NCollapse, NSelect, NInputNumber, NTag, NButton), Vitest.

## Global Constraints

- **平台/Shell**：Windows PowerShell。Rust/cargo 不在默认 PATH——每个 cargo 命令前加 `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`。
- **前端测试**：`pnpm test`（= `vitest run`）。指定文件 `pnpm test -- <path>`。
- **类型门禁**：`pnpm vue-tsc --noEmit` 必须 0 错误。
- **路径别名**：`@` → `src/`（vite.config.ts + vitest.config.ts + tsconfig.json）。
- **naive-ui**：main.ts 已全局注册；`useMessage`/`useDialog`/`useNotification` 需在 AppShell providers 内。
- **Provider wrapper 测试模式**：测试需包裹 `NConfigProvider > NMessageProvider > NDialogProvider`，NModal 内容 teleport 到 `document.body`，用 `document.body.querySelector` + `DOMWrapper` 交互。
- **commit 风格**：`feat(scope): ...` / `fix(scope): ...`。
- **DRY/YAGNI/TDD**，无注释（除非计划代码块中有）。
- **分支**：`feat/m4b-new-task-modal`，从 master 创建。

---

## File Structure

**新建**
- `src/components/NewTaskModal.vue` — Modal 组件：textarea + 类型检测 + 高级折叠 + 批量提交
- `src/components/NewTaskModal.test.ts` — 12 项单元测试

**修改**
- `src/components/TopBar.vue` — 新增「+」按钮，emit `new-task`
- `src/views/TaskListView.vue` — 监听 `@new-task`，管理 `newTaskShow` ref，集成 modal

---

### Task 1: NewTaskModal 组件

**Files:**
- Create: `src/components/NewTaskModal.vue`
- Create: `src/components/NewTaskModal.test.ts`

**Interfaces:**
- Consumes: `useCategoryStore` from `@/stores/category`（分类联动 dir）；`Aria2Api` from `@/composables/useAria2`（via inject `aria2-api`，调用 `client.addUri`）；`open` from `@tauri-apps/plugin-dialog`（浏览目录）；`useMessage` from `naive-ui`
- Produces: `NewTaskModal` component with props `{ show: boolean; defaultDir: string }` and emits `{ 'update:show': [boolean]; 'submitted': [] }`

- [ ] **Step 1: 创建分支**

```powershell
git checkout -b feat/m4b-new-task-modal
```

- [ ] **Step 2: 写测试文件**

创建 `src/components/NewTaskModal.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import NewTaskModal from './NewTaskModal.vue'
import { useCategoryStore } from '@/stores/category'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const mockAddUri = vi.fn().mockResolvedValue('gid123')
const mockApi = {
  client: { addUri: mockAddUri },
  refresh: vi.fn(),
  dir: 'D:/downloads',
}

function mountModal(props: Record<string, unknown> = {}) {
  return mount(
    {
      components: { NConfigProvider, NMessageProvider, NDialogProvider, NewTaskModal },
      provide: { 'aria2-api': shallowRef(mockApi) },
      props: ['show', 'defaultDir'],
      template: `
        <NConfigProvider>
          <NMessageProvider>
            <NDialogProvider>
              <NewTaskModal :show="show" :default-dir="defaultDir" />
            </NDialogProvider>
          </NMessageProvider>
        </NConfigProvider>
      `,
    },
    { props: { show: true, defaultDir: 'D:/downloads', ...props } },
  )
}

function el(selector: string): HTMLElement {
  return document.body.querySelector(selector)!
}

describe('NewTaskModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    mockAddUri.mockClear()
  })

  it('renders textarea and submit button', () => {
    mountModal()
    expect(el('textarea')).toBeTruthy()
    expect(document.body.textContent).toContain('开始下载')
  })

  it('detects HTTP type from url', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    expect(document.body.textContent).toContain('HTTP')
  })

  it('detects BT type from magnet', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('magnet:?xt=urn:btih:abc123')
    expect(document.body.textContent).toContain('BT')
  })

  it('detects mixed type', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip\nmagnet:?xt=urn:btih:abc123')
    expect(document.body.textContent).toContain('混合')
  })

  it('hides BT-irrelevant fields when magnet', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('magnet:?xt=urn:btih:abc123')
    expect(document.body.textContent).not.toContain('文件名')
    expect(document.body.textContent).not.toContain('分块')
  })

  it('shows all fields for HTTP', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    expect(document.body.textContent).toContain('文件名')
    expect(document.body.textContent).toContain('分块')
  })

  it('submits single HTTP url with correct options', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).toHaveBeenCalledTimes(1)
    expect(mockAddUri).toHaveBeenCalledWith(
      ['http://example.com/file.zip'],
      expect.objectContaining({
        dir: 'D:/downloads',
        split: '5',
        'max-connection-per-server': '5',
      }),
    )
  })

  it('submits multiple urls in batch', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://a.com/1.zip\nhttp://b.com/2.zip\nhttp://c.com/3.zip')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).toHaveBeenCalledTimes(3)
  })

  it('skips empty lines in textarea', async () => {
    mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://a.com/1.zip\n\n  \nhttp://b.com/2.zip')
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).toHaveBeenCalledTimes(2)
  })

  it('warns when textarea is empty', async () => {
    mountModal()
    await new DOMWrapper(el('button[data-test="submit"]')).trigger('click')
    await flushPromises()
    expect(mockAddUri).not.toHaveBeenCalled()
  })

  it('resets form on close', async () => {
    const w = mountModal()
    await new DOMWrapper(el('textarea')).setValue('http://example.com/file.zip')
    expect((el('textarea') as HTMLTextAreaElement).value).toBe('http://example.com/file.zip')
    await w.setProps({ show: false })
    await flushPromises()
    await w.setProps({ show: true })
    await flushPromises()
    expect((el('textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('category select fills dir', async () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const w = mountModal({ defaultDir: 'D:/downloads' })
    const modal = w.findComponent(NewTaskModal)
    const selects = modal.findAllComponents({ name: 'NSelect' })
    expect(selects.length).toBeGreaterThanOrEqual(1)
    selects[0].vm.$emit('update:value', 'music')
    await flushPromises()
    const dirInput = document.body.querySelector('input[placeholder="保存目录"]') as HTMLInputElement
    expect(dirInput?.value).toBe('D:/Music')
  })
})
```

> **测试说明：**
> - `resets form on close` 测试用 `w.setProps({ show: false/true })` 模拟 prop 变化触发 reset watch。不能用 `modal.vm.$emit` 因为 inline template 没有 `v-model:show`，emit 不改变 prop。
> - `category select fills dir` 测试用 `findAllComponents({ name: 'NSelect' })` 找到 Naive UI NSelect 组件（Vue 3 teleport 保持逻辑组件树），直接 emit `update:value` 触发 watch。如果 Naive UI 版本导致 `name` 匹配失败，改用 `findAllComponents` 遍历后按 `vm.$.type.name` 筛选。
> - NCollapse 使用 `display-directive="show"`，折叠时内容仍在 DOM 中（display:none），所以 `v-if` 控制的字段在折叠状态下也能检测到。

- [ ] **Step 3: 运行测试，验证全部失败**

```powershell
pnpm test -- src/components/NewTaskModal.test.ts
```

Expected: 所有测试 FAIL（组件不存在）

- [ ] **Step 4: 实现 NewTaskModal.vue**

创建 `src/components/NewTaskModal.vue`：

```vue
<script setup lang="ts">
import { NModal, NInput, NButton, NSelect, NInputNumber, NCollapse, NCollapseItem, NTag, useMessage } from 'naive-ui'
import { ref, computed, watch, inject, type Ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useCategoryStore } from '@/stores/category'
import type { Aria2Api } from '@/composables/useAria2'

const props = defineProps<{ show: boolean; defaultDir: string }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; 'submitted': [] }>()

const api = inject<Ref<Aria2Api | null>>('aria2-api')
const message = useMessage()
const cats = useCategoryStore()

const urls = ref('')
const selectedCategory = ref<string | null>(null)
const dir = ref(props.defaultDir)
const filename = ref('')
const split = ref(5)
const maxConnPerServer = ref(5)
const proxy = ref('')
const expandedNames = ref<string[]>([])
const submitting = ref(false)

const categoryOptions = computed(() =>
  cats.categories.map(c => ({ label: c.name, value: c.id })),
)

const urlList = computed(() =>
  urls.value.split('\n').map(s => s.trim()).filter(Boolean),
)

const detectedType = computed<'http' | 'bt' | 'mixed'>(() => {
  if (urlList.value.length === 0) return 'http'
  const types = new Set(
    urlList.value.map(u => u.startsWith('magnet:') ? 'bt' : 'http'),
  )
  return types.size === 1 ? [...types][0] as 'http' | 'bt' : 'mixed'
})

const typeLabel = computed(() => {
  switch (detectedType.value) {
    case 'http': return 'HTTP'
    case 'bt': return 'BT'
    case 'mixed': return '混合'
  }
})

const typeTagType = computed(() => {
  switch (detectedType.value) {
    case 'http': return 'info'
    case 'bt': return 'success'
    case 'mixed': return 'warning'
  }
})

watch(selectedCategory, id => {
  if (!id) return
  const cat = cats.getCategory(id)
  if (cat && cat.dir) dir.value = cat.dir
})

watch(() => props.show, v => {
  if (!v) {
    urls.value = ''
    selectedCategory.value = null
    dir.value = props.defaultDir
    filename.value = ''
    split.value = 5
    maxConnPerServer.value = 5
    proxy.value = ''
    expandedNames.value = []
  }
}, { flush: 'sync' })

async function browse() {
  const selected = await open({ directory: true, defaultPath: dir.value })
  if (selected) dir.value = selected
}

function buildOptions(): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    dir: dir.value.trim() || props.defaultDir,
  }
  if (detectedType.value !== 'bt') {
    if (filename.value.trim() && urlList.value.length === 1) opts.out = filename.value.trim()
    opts.split = String(split.value)
    opts['max-connection-per-server'] = String(maxConnPerServer.value)
  }
  if (proxy.value.trim()) opts['all-proxy'] = proxy.value.trim()
  return opts
}

async function submit() {
  const list = urlList.value
  if (list.length === 0) {
    message.warning('请输入至少一个链接')
    return
  }
  const c = api?.value?.client
  if (!c) return
  submitting.value = true
  const options = buildOptions()
  let success = 0
  const errors: string[] = []
  for (const url of list) {
    try {
      await c.addUri([url], options)
      success++
    } catch (e) {
      errors.push(`${url}: ${String(e)}`)
    }
  }
  submitting.value = false
  if (errors.length > 0) {
    message.error(`${success} 成功，${errors.length} 失败：${errors.join('; ')}`)
  } else {
    message.success(`已添加 ${success} 个任务`)
  }
  emit('update:show', false)
  emit('submitted')
}
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="card" title="新建任务" style="width:600px;max-width:90vw">
    <div style="display:flex;flex-direction:column;gap:12px;padding:8px 0">
      <NInput v-model:value="urls" type="textarea" :rows="4" placeholder="粘贴下载链接，每行一个" />

      <div style="display:flex;align-items:center;gap:8px">
        <NTag :type="typeTagType" size="small">{{ typeLabel }}</NTag>
        <span style="font-size:12px;opacity:.6">{{ urlList.length }} 个链接</span>
      </div>

      <NCollapse v-model:expanded-names="expandedNames" :display-directive="'show'">
        <NCollapseItem title="高级设置" name="advanced">
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;width:56px;flex-shrink:0">分类</span>
              <NSelect v-model:value="selectedCategory" :options="categoryOptions" placeholder="选择分类" clearable size="small" style="flex:1" />
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;width:56px;flex-shrink:0">目录</span>
              <NInput v-model:value="dir" placeholder="保存目录" size="small" style="flex:1" />
              <NButton size="small" quaternary @click="browse">浏览</NButton>
            </div>
            <div v-if="detectedType !== 'bt'" style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;width:56px;flex-shrink:0">文件名</span>
              <NInput v-model:value="filename" placeholder="文件名（可选）" size="small" style="flex:1" />
            </div>
            <div v-if="detectedType !== 'bt'" style="display:flex;align-items:center;gap:16px">
              <div style="display:flex;align-items:center;gap:4px">
                <span style="font-size:13px">分块</span>
                <NInputNumber v-model:value="split" size="small" :min="1" :max="16" style="width:80px" />
              </div>
              <div style="display:flex;align-items:center;gap:4px">
                <span style="font-size:13px">连接数</span>
                <NInputNumber v-model:value="maxConnPerServer" size="small" :min="1" :max="16" style="width:80px" />
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;width:56px;flex-shrink:0">代理</span>
              <NInput v-model:value="proxy" placeholder="如 http://127.0.0.1:7890" size="small" style="flex:1" />
            </div>
          </div>
        </NCollapseItem>
      </NCollapse>
    </div>

    <template #footer>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="submitting" data-test="submit" @click="submit">开始下载</NButton>
      </div>
    </template>
  </NModal>
</template>
```

- [ ] **Step 5: 运行测试，验证通过**

```powershell
pnpm test -- src/components/NewTaskModal.test.ts
```

Expected: 12 项全部 PASS

> 如果 `findAllComponents({ name: 'NSelect' })` 在当前 Naive UI 版本下无法匹配，改用 `modal.findAllComponents(c => c.$.type.__name === 'NSelect' || c.$.type.name === 'NSelect')` 或将测试改为验证 store watch 逻辑的其他方式。

- [ ] **Step 6: 类型检查**

```powershell
pnpm vue-tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 7: 提交**

```powershell
git add src/components/NewTaskModal.vue src/components/NewTaskModal.test.ts
git commit -m "feat(ui): NewTaskModal with batch URL, type detection, advanced options"
```

---

### Task 2: TopBar + TaskListView 集成

**Files:**
- Modify: `src/components/TopBar.vue`
- Modify: `src/views/TaskListView.vue`

**Interfaces:**
- Consumes: `NewTaskModal` component from Task 1
- Produces: TopBar emits `'new-task': []`; TaskListView wires modal open/close + refresh

- [ ] **Step 1: 修改 TopBar.vue**

在 `src/components/TopBar.vue` 中：

1a. `defineEmits` 新增 `'new-task'`：

找到（第 15 行附近）:
```ts
const emit = defineEmits<{ settings: [] }>()
```
替换为:
```ts
const emit = defineEmits<{ settings: []; 'new-task': [] }>()
```

1b. 模板中加「+」按钮。找到（第 39 行附近）:
```html
    <NSpace :size="8">
      <NButton size="small" @click="run('pauseAll','全部暂停')">全部暂停</NButton>
      <NButton size="small" @click="run('unpauseAll','全部继续')">全部继续</NButton>
    </NSpace>
```
替换为:
```html
    <NButton size="small" type="primary" @click="emit('new-task')">+ 新建</NButton>
    <NSpace :size="8">
      <NButton size="small" @click="run('pauseAll','全部暂停')">全部暂停</NButton>
      <NButton size="small" @click="run('unpauseAll','全部继续')">全部继续</NButton>
    </NSpace>
```

- [ ] **Step 2: 修改 TaskListView.vue**

在 `src/views/TaskListView.vue` 中：

2a. 新增 import。找到（第 10 行附近）:
```ts
import AddUrlBar from '@/components/AddUrlBar.vue'
```
在其下方加:
```ts
import NewTaskModal from '@/components/NewTaskModal.vue'
```

2b. 新增 ref。找到（第 55 行附近）:
```ts
const settingsShow = ref(false)
```
在其下方加:
```ts
const newTaskShow = ref(false)
```

2c. TopBar 标签加事件监听。找到（第 181 行附近）:
```html
    <TopBar @settings="settingsShow = true" />
```
替换为:
```html
    <TopBar @settings="settingsShow = true" @new-task="newTaskShow = true" />
```

2d. 模板中加 NewTaskModal。找到（第 198 行附近）:
```html
    <SettingsModal v-model:show="settingsShow" @saved="api?.refresh()" />
```
在其下方加:
```html
    <NewTaskModal v-model:show="newTaskShow" :default-dir="api?.dir ?? ''" @submitted="api?.refresh()" />
```

- [ ] **Step 3: 类型检查**

```powershell
pnpm vue-tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 4: 全量测试 + 构建**

```powershell
pnpm test
```

Expected: 全部通过（54 + 12 = 66 或更多）

```powershell
pnpm build
```

Expected: 构建成功

- [ ] **Step 5: 提交**

```powershell
git add src/components/TopBar.vue src/views/TaskListView.vue
git commit -m "feat(ui): wire NewTaskModal into TopBar and TaskListView"
```

---

### Final: 全分支验证与合并

- [ ] **Step 1: 全量验证**

```powershell
pnpm test
pnpm vue-tsc --noEmit
pnpm build
```

全部通过后继续。

- [ ] **Step 2: 合并到 master**

```powershell
git checkout master
git merge feat/m4b-new-task-modal --no-ff -m "merge: M4b — new task modal with batch, type detection, advanced options"
```
