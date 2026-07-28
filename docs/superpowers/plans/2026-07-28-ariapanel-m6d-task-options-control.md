# M6d: Task Options Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-task runtime option control to TaskDetailDrawer: file selection within multi-file BT torrents, per-task speed limits, per-task seed ratio, and context-aware seeding stop/start labels.

**Architecture:** Extend `useDetailPoller` to load `getOption` once on task selection (stored in `taskOptions` ref). Extend `useTaskOperations` with `changeTaskOption` wrapper. Pass both through TaskListView as props to TaskDetailDrawer, which renders contextual option controls with auto-apply on blur/change.

**Tech Stack:** Vue 3.5 Composition API, TypeScript, Naive UI 2.44, Pinia, Vitest + jsdom

## Global Constraints

- No comments in code unless explicitly requested
- No emojis in code or commit messages
- Semicolons: false (Prettier)
- Quotes: single (Prettier)
- Trailing comma: all
- `@` alias maps to `src/`
- Naive UI components imported individually (no global registration)
- NDrawer/NDrawerContent teleport to `document.body` — tests use `document.body.textContent` or `attachTo`
- No `&&` in PowerShell — use `;` or `if ($?) {}`
- Clipboard: `navigator.clipboard?.writeText(...)` pattern
- Test gate: `pnpm test` + `pnpm vue-tsc --noEmit` + `pnpm lint`

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/composables/useDetailPoller.ts` | Modify | Add `taskOptions` ref + `fetchOptions()` call on gid change |
| `src/composables/useTaskOperations.ts` | Modify | Add `changeTaskOption(gid, options)` function |
| `src/composables/useDetailPoller.test.ts` | Create | Test getOption loading on gid selection |
| `src/composables/useTaskOperations.test.ts` | Create | Test changeTaskOption RPC + error handling |
| `src/views/TaskListView.vue` | Modify | Wire `taskOptions` + `changeTaskOption` props to drawer |
| `src/components/TaskDetailDrawer.vue` | Modify | Add speed limits, seed ratio, file checkboxes, seeding label |
| `src/components/TaskDetailDrawer.test.ts` | Modify | Add tests for all four features |

---

## Task 1: Composable Infrastructure

**Files:**
- Create: `src/composables/useDetailPoller.test.ts`
- Create: `src/composables/useTaskOperations.test.ts`
- Modify: `src/composables/useDetailPoller.ts`
- Modify: `src/composables/useTaskOperations.ts`

**Interfaces:**
- Produces: `useDetailPoller` returns `{ detail: Ref<Aria2TaskDetail | null>, taskOptions: Ref<Record<string, string>> }`
- Produces: `useTaskOperations` returns `{ retry, operate, submitRetry, onAdd, changeTaskOption }`
- `changeTaskOption` signature: `(gid: string, options: Record<string, string>) => Promise<void>`

- [ ] **Step 1: Write failing tests for useDetailPoller**

Create `src/composables/useDetailPoller.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useDetailPoller } from './useDetailPoller'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'
import type { Aria2TaskDetail } from '@/lib/aria2/types'

const mockDetail: Aria2TaskDetail = {
  gid: 'g1',
  status: 'active',
  totalLength: '100',
  completedLength: '50',
  downloadSpeed: '10',
  uploadSpeed: '0',
  dir: '/dl',
  pieceLength: '1',
  numPieces: '10',
  bitfield: 'ff',
  connections: '5',
  files: [],
}

function makeApi() {
  return {
    client: {
      tellStatus: vi.fn(async () => mockDetail),
      getOption: vi.fn(async () => ({
        'max-download-limit': '1M',
        'max-upload-limit': '0',
        'seed-ratio': '2.0',
      })),
    },
    refresh: vi.fn(),
    dir: '/dl',
  } as unknown as Aria2Api
}

function mountPoller(api: Aria2Api | null) {
  let result!: ReturnType<typeof useDetailPoller>
  const apiRef = shallowRef<Aria2Api | null>(api)
  const wrapper = mount(
    defineComponent({
      setup() {
        const tasks = useTaskStore()
        result = useDetailPoller(apiRef, tasks)
        return () => h('div')
      },
    }),
  )
  return { result, wrapper }
}

describe('useDetailPoller', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('loads taskOptions via getOption when gid is selected', async () => {
    const api = makeApi()
    const { result, wrapper } = mountPoller(api)
    const tasks = useTaskStore()
    tasks.selectedGid = 'g1'
    await nextTick()
    await flushPromises()
    expect(api.client.getOption).toHaveBeenCalledWith('g1')
    expect(result.taskOptions.value['max-download-limit']).toBe('1M')
    expect(result.taskOptions.value['seed-ratio']).toBe('2.0')
    wrapper.unmount()
  })

  it('clears taskOptions when gid is deselected', async () => {
    const api = makeApi()
    const { result, wrapper } = mountPoller(api)
    const tasks = useTaskStore()
    tasks.selectedGid = 'g1'
    await nextTick()
    await flushPromises()
    expect(result.taskOptions.value['max-download-limit']).toBe('1M')
    tasks.selectedGid = ''
    await nextTick()
    expect(result.taskOptions.value).toEqual({})
    wrapper.unmount()
  })
})
```

- [ ] **Step 2: Write failing tests for useTaskOperations**

Create `src/composables/useTaskOperations.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskOperations } from './useTaskOperations'
import { useTaskStore } from '@/stores/task'
import type { Aria2Api } from '@/composables/useAria2'

describe('useTaskOperations', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function makeOps(changeOption: ReturnType<typeof vi.fn>) {
    const api = shallowRef({
      client: { changeOption },
      refresh: vi.fn(),
      dir: '/dl',
    } as unknown as Aria2Api)
    const tasks = useTaskStore()
    const message = { error: vi.fn() }
    const ops = useTaskOperations(api, tasks, message as never)
    return { ops, message }
  }

  it('changeTaskOption calls changeOption with correct params', async () => {
    const changeOption = vi.fn(async () => 'OK')
    const { ops } = makeOps(changeOption)
    await ops.changeTaskOption('g1', { 'max-download-limit': '2M' })
    expect(changeOption).toHaveBeenCalledWith('g1', { 'max-download-limit': '2M' })
  })

  it('changeTaskOption shows error on failure', async () => {
    const changeOption = vi.fn().mockRejectedValue(new Error('rpc error'))
    const { ops, message } = makeOps(changeOption)
    await ops.changeTaskOption('g1', { 'max-download-limit': '2M' })
    expect(message.error).toHaveBeenCalledWith('操作失败：Error: rpc error')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- --run src/composables/useDetailPoller.test.ts src/composables/useTaskOperations.test.ts`

Expected: FAIL — `taskOptions` does not exist on `useDetailPoller` result; `changeTaskOption` does not exist on `useTaskOperations` result.

- [ ] **Step 4: Implement useDetailPoller changes**

Replace the full contents of `src/composables/useDetailPoller.ts` with:

```typescript
import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { Aria2Api } from '@/composables/useAria2'
import type { useTaskStore } from '@/stores/task'
import type { Aria2TaskDetail } from '@/lib/aria2/types'

export function useDetailPoller(api: Ref<Aria2Api | null>, tasks: ReturnType<typeof useTaskStore>) {
  const detail = ref<Aria2TaskDetail | null>(null)
  const taskOptions = ref<Record<string, string>>({})
  let timer: ReturnType<typeof setInterval> | null = null

  function clearTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  async function fetch() {
    if (!tasks.selectedGid) return
    const c = api?.value?.client
    if (!c) return
    try {
      detail.value = await c.tellStatus(tasks.selectedGid)
    } catch {
      /* ignore */
    }
  }

  async function fetchOptions() {
    if (!tasks.selectedGid) return
    const c = api?.value?.client
    if (!c) return
    try {
      taskOptions.value = await c.getOption(tasks.selectedGid)
    } catch {
      /* ignore */
    }
  }

  watch(
    () => tasks.selectedGid,
    (gid) => {
      clearTimer()
      if (gid) {
        fetch()
        fetchOptions()
        timer = setInterval(fetch, 2000)
      } else {
        detail.value = null
        taskOptions.value = {}
      }
    },
  )

  onUnmounted(clearTimer)

  return { detail, taskOptions }
}
```

- [ ] **Step 5: Implement useTaskOperations changes**

In `src/composables/useTaskOperations.ts`, add the `changeTaskOption` function before the `return` statement (after `onAdd`), and add it to the return:

Add this function after the `onAdd` function (after line 115, before the return):

```typescript
  async function changeTaskOption(gid: string, options: Record<string, string>) {
    const c = api.value?.client
    if (!c) return
    try {
      await c.changeOption(gid, options)
      refresh()
    } catch (e) {
      message.error(`操作失败：${String(e)}`)
      refresh()
    }
  }
```

Change the return statement from:

```typescript
  return { retry, operate, submitRetry, onAdd }
```

to:

```typescript
  return { retry, operate, submitRetry, onAdd, changeTaskOption }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- --run src/composables/useDetailPoller.test.ts src/composables/useTaskOperations.test.ts`

Expected: PASS — all 4 tests pass.

- [ ] **Step 7: Run full test suite + type check**

Run: `pnpm test -- --run`

Expected: 100 tests pass (96 existing + 4 new).

Run: `pnpm vue-tsc --noEmit`

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/composables/useDetailPoller.ts src/composables/useTaskOperations.ts src/composables/useDetailPoller.test.ts src/composables/useTaskOperations.test.ts
git commit -m "feat: add taskOptions loading and changeTaskOption to composables"
```

---

## Task 2: TaskDetailDrawer UI Integration

**Files:**
- Modify: `src/views/TaskListView.vue:59-60` (destructure + props)
- Modify: `src/components/TaskDetailDrawer.vue` (full template + script changes)
- Modify: `src/components/TaskDetailDrawer.test.ts` (new fixtures + tests)

**Interfaces:**
- Consumes: `useDetailPoller` returns `{ detail, taskOptions }` from Task 1
- Consumes: `useTaskOperations` returns `{ ..., changeTaskOption }` from Task 1
- Produces: TaskDetailDrawer accepts new props `taskOptions: Record<string, string>` and `changeOption: (gid: string, options: Record<string, string>) => void`

- [ ] **Step 1: Write failing tests**

Add these fixtures and tests to `src/components/TaskDetailDrawer.test.ts`. Insert the new fixtures after the existing `btDetail` definition (after line 47), and add the new tests inside the `describe` block (after the last test, before the closing `})`).

New fixtures (add after line 47, after `btDetail`):

```typescript
const taskOpts: Record<string, string> = {
  'max-download-limit': '1M',
  'max-upload-limit': '0',
  'seed-ratio': '2.0',
}

const multiFileBtDetail: Aria2TaskDetail = {
  ...btDetail,
  bittorrent: { info: { name: 'multi torrent' }, mode: 'multi' },
  files: [
    {
      path: 'D:/Downloads/torrent/file1.bin',
      length: '52428800',
      completedLength: '26214400',
      selected: 'true',
      uris: [],
    },
    {
      path: 'D:/Downloads/torrent/file2.bin',
      length: '52428800',
      completedLength: '0',
      selected: 'false',
      uris: [],
    },
    {
      path: 'D:/Downloads/torrent/file3.bin',
      length: '52428800',
      completedLength: '52428800',
      selected: 'true',
      uris: [],
    },
  ],
}

const seedingBtDetail: Aria2TaskDetail = {
  ...btDetail,
  status: 'active',
  totalLength: '104857600',
  completedLength: '104857600',
}
```

New tests (add inside `describe` block, after the last existing test):

```typescript
  it('renders speed limit inputs from taskOptions', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: taskOpts, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('下载限速')
    expect(document.body.textContent).toContain('上传限速')
  })

  it('blur on download limit calls changeOption', async () => {
    const changeOption = vi.fn()
    const w = mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: taskOpts, operate: () => {}, changeOption },
      attachTo: document.body,
    })
    const input = w.find('[data-test="dl-limit"] input')
    await input.setValue('2M')
    await input.trigger('blur')
    expect(changeOption).toHaveBeenCalledWith('g1', { 'max-download-limit': '2M' })
  })

  it('renders seed ratio input for BT tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail: btDetail, taskOptions: taskOpts, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('做种比例')
  })

  it('hides seed ratio input for non-BT tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: taskOpts, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).not.toContain('做种比例')
  })

  it('renders file checkboxes for multi-file BT tasks', () => {
    const w = mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption: () => {},
      },
      attachTo: document.body,
    })
    expect(w.findAll('[data-test="file-checkbox"]')).toHaveLength(3)
    expect(document.body.textContent).toContain('全选')
    expect(document.body.textContent).toContain('全不选')
  })

  it('hides file checkboxes for single-file tasks', () => {
    const w = mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(w.findAll('[data-test="file-checkbox"]')).toHaveLength(0)
  })

  it('select all calls changeOption with all indices', async () => {
    const changeOption = vi.fn()
    const w = mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption,
      },
      attachTo: document.body,
    })
    await w.find('[data-test="select-all-files"]').trigger('click')
    expect(changeOption).toHaveBeenCalledWith('g1', { 'select-file': '1,2,3' })
  })

  it('deselect all calls changeOption with empty string', async () => {
    const changeOption = vi.fn()
    const w = mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption,
      },
      attachTo: document.body,
    })
    await w.find('[data-test="deselect-all-files"]').trigger('click')
    expect(changeOption).toHaveBeenCalledWith('g1', { 'select-file': '' })
  })

  it('toggling file checkbox calls changeOption with correct indices', async () => {
    const changeOption = vi.fn()
    const w = mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: multiFileBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption,
      },
      attachTo: document.body,
    })
    const checkboxes = w.findAll('[data-test="file-checkbox"]')
    await checkboxes[0].trigger('click')
    expect(changeOption).toHaveBeenCalledWith('g1', { 'select-file': '3' })
  })

  it('shows stop seeding label for completed BT tasks', () => {
    mount(TaskDetailDrawer, {
      props: {
        show: true,
        detail: seedingBtDetail,
        taskOptions: {},
        operate: () => {},
        changeOption: () => {},
      },
    })
    expect(document.body.textContent).toContain('停止做种')
  })

  it('shows pause label for incomplete tasks', () => {
    mount(TaskDetailDrawer, {
      props: { show: true, detail, taskOptions: {}, operate: () => {}, changeOption: () => {} },
    })
    expect(document.body.textContent).toContain('暂停')
    expect(document.body.textContent).not.toContain('停止做种')
  })
```

Also add `vi` to the imports at line 1:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/components/TaskDetailDrawer.test.ts`

Expected: FAIL — new tests fail because `taskOptions` and `changeOption` props don't exist, speed limit / seed ratio / file checkboxes / seeding labels not rendered.

- [ ] **Step 3: Wire TaskListView props**

In `src/views/TaskListView.vue`, change line 59 from:

```typescript
const { retry, operate, submitRetry, onAdd } = useTaskOperations(api, tasks, message)
const { detail } = useDetailPoller(api, tasks)
```

to:

```typescript
const { retry, operate, submitRetry, onAdd, changeTaskOption } = useTaskOperations(api, tasks, message)
const { detail, taskOptions } = useDetailPoller(api, tasks)
```

And change the TaskDetailDrawer usage (line 144) from:

```html
    <TaskDetailDrawer :show="detailShow" :detail="detail" :operate="operate" @update:show="onDrawerClose" />
```

to:

```html
    <TaskDetailDrawer
      :show="detailShow"
      :detail="detail"
      :task-options="taskOptions"
      :operate="operate"
      :change-option="changeTaskOption"
      @update:show="onDrawerClose"
    />
```

- [ ] **Step 4: Implement TaskDetailDrawer script changes**

Replace the `<script setup>` block (lines 1-40) of `src/components/TaskDetailDrawer.vue` with:

```typescript
<script setup lang="ts">
import { NButton, NCheckbox, NDrawer, NDrawerContent, NInput, NProgress, NTag } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import type { Aria2TaskDetail } from '@/lib/aria2/types'
import type { TaskOp } from '@/lib/task-op'
import BtPeerSection from './BtPeerSection.vue'
import { fmtSpeed, fmtBytes, fmtProgress, taskName } from '@/lib/format'

const props = defineProps<{
  show: boolean
  detail: Aria2TaskDetail | null
  taskOptions: Record<string, string>
  operate: (gid: string, op: TaskOp) => void
  changeOption: (gid: string, options: Record<string, string>) => void
}>()
const emit = defineEmits<{ 'update:show': [v: boolean] }>()

const t = computed(() => props.detail)

const dlLimit = ref('0')
const ulLimit = ref('0')
const seedRatio = ref('0')

watch(
  () => props.taskOptions,
  (opts) => {
    dlLimit.value = opts['max-download-limit'] ?? '0'
    ulLimit.value = opts['max-upload-limit'] ?? '0'
    seedRatio.value = opts['seed-ratio'] ?? '0'
  },
  { immediate: true },
)

const isMultiFileBt = computed(() => {
  const d = t.value
  return !!(d?.bittorrent && d.files.length > 1)
})

const isSeeding = computed(() => {
  const d = t.value
  if (!d?.bittorrent) return false
  return Number(d.completedLength) >= Number(d.totalLength) && Number(d.totalLength) > 0
})

function applyDlLimit() {
  if (!t.value) return
  const val = dlLimit.value.trim()
  if (val === (props.taskOptions['max-download-limit'] ?? '0')) return
  props.changeOption(t.value.gid, { 'max-download-limit': val })
}

function applyUlLimit() {
  if (!t.value) return
  const val = ulLimit.value.trim()
  if (val === (props.taskOptions['max-upload-limit'] ?? '0')) return
  props.changeOption(t.value.gid, { 'max-upload-limit': val })
}

function applySeedRatio() {
  if (!t.value) return
  const val = seedRatio.value.trim()
  if (val === (props.taskOptions['seed-ratio'] ?? '0')) return
  props.changeOption(t.value.gid, { 'seed-ratio': val })
}

function toggleFile(index: number) {
  const d = t.value
  if (!d) return
  const current = d.files
    .map((f, i) => (f.selected === 'true' ? i + 1 : -1))
    .filter((i) => i > 0)
  const pos = current.indexOf(index + 1)
  if (pos >= 0) current.splice(pos, 1)
  else current.push(index + 1)
  current.sort((a, b) => a - b)
  props.changeOption(d.gid, { 'select-file': current.join(',') })
}

function selectAllFiles() {
  const d = t.value
  if (!d) return
  const indices = d.files.map((_, i) => i + 1).join(',')
  props.changeOption(d.gid, { 'select-file': indices })
}

function deselectAllFiles() {
  const d = t.value
  if (!d) return
  props.changeOption(d.gid, { 'select-file': '' })
}

function completedPieces(d: Aria2TaskDetail): number {
  if (!d.bitfield) return 0
  let count = 0
  for (const ch of d.bitfield) {
    const nibble = parseInt(ch, 16)
    if (isNaN(nibble)) continue
    count += (nibble & 8 ? 1 : 0) + (nibble & 4 ? 1 : 0) + (nibble & 2 ? 1 : 0) + (nibble & 1 ? 1 : 0)
  }
  return count
}
function uriStatusColor(s: string): 'success' | 'warning' | 'error' | 'default' {
  switch (s) {
    case 'used':
      return 'success'
    case 'waiting':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'default'
  }
}
</script>
```

- [ ] **Step 5: Implement TaskDetailDrawer template changes**

Replace the `<template>` block (lines 42-118) of `src/components/TaskDetailDrawer.vue` with:

```html
<template>
  <NDrawer :show="show" :width="420" placement="right" @update:show="emit('update:show', $event)">
    <NDrawerContent v-if="t" :title="taskName(t)" closable>
      <div style="display: flex; flex-direction: column; gap: 16px">
        <NProgress :percentage="fmtProgress(t)" />

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">基本信息</h4>
          <div style="font-size: 13px; line-height: 1.8">
            状态：{{ t.status }}<br />
            大小：{{ fmtBytes(t.totalLength) }}<br />
            已下载：{{ fmtBytes(t.completedLength) }}<br />
            速度：↓ {{ fmtSpeed(t.downloadSpeed) }} ↑ {{ fmtSpeed(t.uploadSpeed) }}<br />
            保存路径：{{ t.dir }}
          </div>
          <div style="font-size: 13px; line-height: 1.8; margin-top: 8px">
            <label style="display: flex; align-items: center; gap: 8px">
              下载限速
              <NInput
                v-model:value="dlLimit"
                data-test="dl-limit"
                size="small"
                placeholder="0=不限"
                style="width: 120px"
                @blur="applyDlLimit"
              />
            </label>
            <label style="display: flex; align-items: center; gap: 8px">
              上传限速
              <NInput
                v-model:value="ulLimit"
                data-test="ul-limit"
                size="small"
                placeholder="0=不限"
                style="width: 120px"
                @blur="applyUlLimit"
              />
            </label>
          </div>
        </section>

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">分块进度</h4>
          <div style="font-size: 13px; line-height: 1.8">
            {{ completedPieces(t) }}/{{ t.numPieces }} 块已完成，{{ t.connections }} 个活跃连接<br />
            分块大小：{{ fmtBytes(t.pieceLength) }}
          </div>
        </section>

        <section v-if="t.bittorrent">
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">做种设置</h4>
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px">
            做种比例
            <NInput
              v-model:value="seedRatio"
              data-test="seed-ratio"
              size="small"
              placeholder="0=跟随全局"
              style="width: 100px"
              @blur="applySeedRatio"
            />
          </label>
        </section>

        <BtPeerSection v-if="t?.bittorrent" :detail="t" />

        <section>
          <div style="display: flex; align-items: center; justify-content: space-between">
            <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">文件列表</h4>
            <div v-if="isMultiFileBt" style="display: flex; gap: 4px">
              <NButton size="tiny" data-test="select-all-files" @click="selectAllFiles">全选</NButton>
              <NButton size="tiny" data-test="deselect-all-files" @click="deselectAllFiles">全不选</NButton>
            </div>
          </div>
          <div
            v-for="(f, i) in t.files"
            :key="i"
            style="font-size: 13px; line-height: 1.6; display: flex; align-items: center; gap: 6px"
          >
            <NCheckbox
              v-if="isMultiFileBt"
              :checked="f.selected === 'true'"
              data-test="file-checkbox"
              @update:checked="toggleFile(i)"
            />
            <span style="flex: 1">
              {{ f.path.split(/[\\/]/).pop() }} — {{ fmtBytes(f.length) }}
              <NProgress
                :percentage="Number(f.length) ? Math.round((Number(f.completedLength) / Number(f.length)) * 100) : 0"
                :height="6"
              />
            </span>
          </div>
        </section>

        <section>
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7">链接列表</h4>
          <div v-for="(f, i) in t.files" :key="'u' + i">
            <div
              v-for="(u, j) in f.uris"
              :key="j"
              style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 2px"
            >
              <NTag :type="uriStatusColor(u.status)" size="small" round>{{ u.status }}</NTag>
              <span style="word-break: break-all">{{ u.uri }}</span>
            </div>
          </div>
        </section>

        <section v-if="t.errorCode">
          <h4 style="margin: 0 0 4px; font-size: 13px; opacity: 0.7; color: #e88080">错误详情</h4>
          <div style="font-size: 13px; line-height: 1.6">
            错误码：{{ t.errorCode }}<br />
            {{ t.errorMessage }}
          </div>
        </section>
      </div>

      <template #footer>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <NButton v-if="t.status === 'active'" size="small" @click="operate(t.gid, 'pause')">
            {{ isSeeding ? '停止做种' : '暂停' }}
          </NButton>
          <NButton
            v-if="t.status === 'paused' || t.status === 'waiting'"
            size="small"
            @click="operate(t.gid, 'unpause')"
          >
            {{ isSeeding ? '开始做种' : '恢复' }}
          </NButton>
          <NButton size="small" @click="operate(t.gid, 'copyLink')">复制链接</NButton>
          <NButton size="small" @click="operate(t.gid, 'openFolder')">打开目录</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/TaskDetailDrawer.test.ts`

Expected: PASS — all 18 tests pass (6 existing + 12 new).

- [ ] **Step 7: Run full test suite + type check + lint**

Run: `pnpm test -- --run`

Expected: 112 tests pass (96 existing + 4 composable + 12 drawer).

Run: `pnpm vue-tsc --noEmit`

Expected: No errors.

Run: `pnpm lint`

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/views/TaskListView.vue src/components/TaskDetailDrawer.vue src/components/TaskDetailDrawer.test.ts
git commit -m "feat(ui): task option controls in TaskDetailDrawer"
```
