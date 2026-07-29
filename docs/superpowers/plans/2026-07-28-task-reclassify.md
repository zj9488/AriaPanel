# Task Reclassify via Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "重新分类" submenu to the task right-click context menu that lets users reclassify a task by changing its `dir` via `aria2.changeOption`.

**Architecture:** `TaskContextMenu` gains a `categories` prop and renders a nested submenu for categories with configured dirs. Selecting a category emits `reclassify` with the dir string. `TaskListView` handles the emit by calling the existing `changeTaskOption(gid, { dir })`.

**Tech Stack:** Vue 3.5 (Composition API), Pinia, TypeScript, Naive UI 2.44 NDropdown, Vitest

## Global Constraints

- No comments in code unless explicitly requested
- No emojis in code or commit messages
- Semicolons: false. Quotes: single. Trailing commas: all. Print width: 120
- `@` alias maps to `src/`
- PowerShell: use `;` or `if ($?) {}` to chain, never `&&`
- Test gate: `pnpm test` must pass. Type check: `pnpm vue-tsc --noEmit`. Lint: `pnpm lint`
- Naive UI: NDropdown teleports popover to `document.body`; in tests, access options via `findComponent(NDropdown).props('options')` rather than DOM queries
- Tauri 2 command parameter names: no snake_case → camelCase conversion; JS-side names match Rust exactly

---

### Task 1: TaskContextMenu — Reclassify Submenu + Tests

**Files:**
- Modify: `src/components/TaskContextMenu.vue`
- Create: `src/components/TaskContextMenu.test.ts`

**Interfaces:**
- Produces: `categories` prop (`{ name: string; dir: string }[]`), `reclassify` emit (`[dir: string]`). The `options()` function return type widens from `{ label: string; key: TaskOp }[]` to allow `string` keys and optional `children`.

- [ ] **Step 1: Write failing tests**

Create `src/components/TaskContextMenu.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { NDropdown } from 'naive-ui'
import TaskContextMenu from './TaskContextMenu.vue'

const baseProps = {
  show: true,
  x: 0,
  y: 0,
  status: 'active' as const,
  isBittorrent: false,
  categories: [] as { name: string; dir: string }[],
}

function mountMenu(extra: Partial<typeof baseProps> = {}) {
  return mount(TaskContextMenu, { props: { ...baseProps, ...extra } })
}

describe('TaskContextMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders reclassify submenu when categories have configured dirs', () => {
    const w = mountMenu({
      categories: [
        { name: '下载', dir: '' },
        { name: '音乐', dir: 'D:/Music' },
      ],
    })
    const opts = w.findComponent(NDropdown).props('options') as Array<{
      key: string
      label: string
      children?: Array<{ key: string; label: string }>
    }>
    const reclassify = opts.find((o) => o.key === 'reclassify')
    expect(reclassify).toBeDefined()
    expect(reclassify!.children).toHaveLength(1)
    expect(reclassify!.children![0].label).toBe('音乐')
    expect(reclassify!.children![0].key).toBe('reclassify:D:/Music')
  })

  it('hides reclassify when no categories have configured dirs', () => {
    const w = mountMenu({
      categories: [
        { name: '下载', dir: '' },
        { name: '音乐', dir: '' },
      ],
    })
    const opts = w.findComponent(NDropdown).props('options') as Array<{
      key: string
    }>
    expect(opts.find((o) => o.key === 'reclassify')).toBeUndefined()
  })

  it('selecting a category emits reclassify with dir', async () => {
    const w = mountMenu({
      categories: [{ name: '音乐', dir: 'D:/Music' }],
    })
    const dropdown = w.findComponent(NDropdown)
    dropdown.vm.$emit('select', 'reclassify:D:/Music')
    await flushPromises()
    expect(w.emitted('reclassify')).toBeTruthy()
    expect(w.emitted('reclassify')![0]).toEqual(['D:/Music'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/components/TaskContextMenu.test.ts`
Expected: FAIL — tests fail because `TaskContextMenu` does not accept a `categories` prop, does not emit `reclassify`, and `options()` has no reclassify entry.

- [ ] **Step 3: Add `categories` prop and `reclassify` emit**

In `src/components/TaskContextMenu.vue`, replace the `defineProps` and `defineEmits` lines (lines 7-8):

```ts
const props = defineProps<{ show: boolean; x: number; y: number; status: TaskStatus; isBittorrent: boolean; categories: { name: string; dir: string }[] }>()
const emit = defineEmits<{ select: [op: TaskOp]; close: []; reclassify: [dir: string] }>()
```

- [ ] **Step 4: Widen `options()` return type and add reclassify submenu**

In `src/components/TaskContextMenu.vue`, replace the entire `options()` function (lines 10-20):

```ts
function options() {
  const base: { label: string; key: string; children?: { label: string; key: string }[] }[] = [
    { label: '复制链接', key: 'copyLink' },
  ]
  if (props.status === 'active') base.push({ label: '暂停', key: 'pause' })
  if (props.status === 'paused' || props.status === 'waiting') base.push({ label: '恢复', key: 'unpause' })
  base.push({ label: '打开文件夹', key: 'openFolder' })
  const configured = props.categories.filter((c) => c.dir)
  if (configured.length > 0) {
    base.push({
      label: '重新分类',
      key: 'reclassify',
      children: configured.map((c) => ({ label: c.name, key: `reclassify:${c.dir}` })),
    })
  }
  base.push({ label: '强制暂停', key: 'forcePause' })
  if (!props.isBittorrent) base.push({ label: '更换链接重试', key: 'retryWithUrl' })
  base.push({ label: '删除', key: 'remove' })
  base.push({ label: '强制删除', key: 'forceRemove' })
  return base
}
```

- [ ] **Step 5: Update `pick()` to handle reclassify keys**

In `src/components/TaskContextMenu.vue`, replace the `pick` function (lines 21-24):

```ts
function pick(key: string) {
  if (key.startsWith('reclassify:')) {
    emit('reclassify', key.slice('reclassify:'.length))
    emit('close')
    return
  }
  emit('select', key as TaskOp)
  emit('close')
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- --run src/components/TaskContextMenu.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 7: Run full suite, type check, and lint**

Run: `pnpm test -- --run`
Expected: all tests pass.

Run: `pnpm vue-tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/TaskContextMenu.vue src/components/TaskContextMenu.test.ts
git commit -m "feat(menu): add reclassify submenu to task context menu"
```

---

### Task 2: TaskListView — Wire Category Store and Reclassify Handler

**Files:**
- Modify: `src/views/TaskListView.vue`

**Interfaces:**
- Consumes: `TaskContextMenu`'s `categories` prop and `reclassify` emit (Task 1). `changeTaskOption(gid, options)` from `useTaskOperations` (already destructured at line 59). `useCategoryStore` from `@/stores/category`.

- [ ] **Step 1: Add category store import**

In `src/views/TaskListView.vue`, after line 16 (`import { usePrefStore } from '@/stores/preferences'`), add:

```ts
import { useCategoryStore } from '@/stores/category'
```

- [ ] **Step 2: Instantiate category store**

In `src/views/TaskListView.vue`, after line 30 (`const conn = useConnectionStore()`), add:

```ts
const cats = useCategoryStore()
```

- [ ] **Step 3: Pass `categories` prop and add `@reclassify` handler**

In `src/views/TaskListView.vue`, replace the `TaskContextMenu` usage (lines 126-134):

```vue
    <TaskContextMenu
      :show="ctx.show"
      :x="ctx.x"
      :y="ctx.y"
      :status="ctx.status"
      :is-bittorrent="ctx.isBittorrent"
      :categories="cats.categories"
      @select="(op) => operate(ctx.gid, op)"
      @reclassify="(dir) => changeTaskOption(ctx.gid, { dir })"
      @close="ctx.show = false"
    />
```

- [ ] **Step 4: Run full suite, type check, and lint**

Run: `pnpm test -- --run`
Expected: all tests pass.

Run: `pnpm vue-tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/TaskListView.vue
git commit -m "feat(view): wire reclassify handler in TaskListView"
```
