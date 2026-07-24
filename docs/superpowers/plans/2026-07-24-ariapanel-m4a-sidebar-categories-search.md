# AriaPanel M4a — 侧栏、分类与搜索 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有应用骨架上补齐侧栏分类列表、全局速度统计和任务搜索三大核心体验。

**Architecture:** 纯前端里程碑。新建 `useCategoryStore`（localStorage 持久化），task store 的 `visibleTasks` 扩展为三段过滤管道（status → category → search）。Sidebar 填充分类区和速度统计区，TopBar 加搜索框，AddUrlBar 加分类下拉。

**Tech Stack:** Vue 3.5 + TS, Pinia, Naive UI, Vitest.

## Global Constraints

- **平台/Shell**：Windows PowerShell。Rust/cargo 不在默认 PATH——每个 cargo 命令前加 `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"`。
- **前端测试**：`pnpm test`（= `vitest run`）。指定文件 `pnpm test -- <path>`。
- **类型门禁**：`pnpm vue-tsc --noEmit` 必须 0 错误。
- **路径别名**：`@` → `src/`（vite.config.ts + vitest.config.ts + tsconfig.json）。
- **naive-ui**：main.ts 已全局注册；`useMessage`/`useDialog`/`useNotification` 需在 AppShell providers 内。
- **commit 风格**：`feat(scope): ...` / `fix(scope): ...`。
- **DRY/YAGNI/TDD**，无注释（除非计划代码块中有）。
- **分支**：`feat/m4a-sidebar-categories-search`，从 master 创建。

---

## File Structure

**新建**
- `src/stores/category.ts` — useCategoryStore: Category[] + CRUD + matchCategory + getCategory
- `src/stores/category.test.ts` — store 单元测试
- `src/components/CategoryModal.vue` — 添加/编辑分类弹窗
- `src/components/CategoryModal.test.ts` — 组件测试
- `src/components/Sidebar.test.ts` — 侧栏组件测试

**修改**
- `src/stores/task.ts` — 加 searchQuery + categoryFilter，visibleTasks 三段管道
- `src/stores/task.test.ts` — 过滤管道测试（新建测试文件）
- `src/components/Sidebar.vue` — 分类列表区 + 速度统计区 + 右键菜单 + 添加分类
- `src/components/TopBar.vue` — 搜索 NInput
- `src/components/AddUrlBar.vue` — 分类 NSelect，选分类联动 dir

---

### Task 1: Category store

**Files:**
- Create: `src/stores/category.ts`
- Create: `src/stores/category.test.ts`

**Interfaces:**
- Consumes: `Aria2Task` from `@/lib/aria2/types`（matchCategory 参数）
- Produces: `Category` interface, `useCategoryStore()`, `matchCategory(task, categoryId)`

- [ ] **Step 1: 创建分支**

```powershell
git checkout -b feat/m4a-sidebar-categories-search
```

- [ ] **Step 2: 写失败测试**

创建 `src/stores/category.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCategoryStore } from './category'
import type { Aria2Task } from '@/lib/aria2/types'

function mkTask(gid: string, dir: string): Aria2Task {
  return { gid, status: 'active', totalLength: '0', completedLength: '0', downloadSpeed: '0', uploadSpeed: '0', dir, files: [{ path: `${dir}/f.bin`, length: '0', completedLength: '0', selected: 'true', uris: [] }] }
}

describe('useCategoryStore', () => {
  beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

  it('initializes with 5 default categories', () => {
    const s = useCategoryStore()
    expect(s.categories).toHaveLength(5)
    expect(s.categories.map(c => c.name)).toEqual(['下载', '音乐', '视频', '图片', '文档'])
  })

  it('addCategory appends and persists', () => {
    const s = useCategoryStore()
    s.addCategory('游戏', 'D:/Games')
    expect(s.categories).toHaveLength(6)
    expect(s.categories[5].name).toBe('游戏')
    expect(s.categories[5].dir).toBe('D:/Games')
    const raw = localStorage.getItem('ap:categories')
    expect(raw).toContain('游戏')
  })

  it('updateCategory modifies and persists', () => {
    const s = useCategoryStore()
    s.updateCategory('music', 'Music', 'D:/Music')
    const cat = s.getCategory('music')!
    expect(cat.name).toBe('Music')
    expect(cat.dir).toBe('D:/Music')
    expect(localStorage.getItem('ap:categories')!).toContain('D:/Music')
  })

  it('removeCategory deletes and persists', () => {
    const s = useCategoryStore()
    s.removeCategory('doc')
    expect(s.categories).toHaveLength(4)
    expect(s.getCategory('doc')).toBeUndefined()
  })

  it('removeCategory refuses to remove last empty-dir category', () => {
    const s = useCategoryStore()
    s.removeCategory('music')
    s.removeCategory('video')
    s.removeCategory('image')
    s.removeCategory('doc')
    expect(s.categories).toHaveLength(1)
    const result = s.removeCategory('downloads')
    expect(result).toBe(false)
    expect(s.categories).toHaveLength(1)
  })

  it('matchCategory: non-empty dir exact match', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.matchCategory(mkTask('g1', 'D:/Music'), 'music')).toBe(true)
    expect(s.matchCategory(mkTask('g2', 'D:/Other'), 'music')).toBe(false)
  })

  it('matchCategory: empty-dir category catches unmatched tasks', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.matchCategory(mkTask('g1', 'D:/Music'), 'downloads')).toBe(false)
    expect(s.matchCategory(mkTask('g2', 'D:/Other'), 'downloads')).toBe(true)
  })

  it('restores from localStorage', () => {
    localStorage.setItem('ap:categories', JSON.stringify([{ id: 'custom', name: '自定义', dir: '/x' }]))
    const s = useCategoryStore()
    expect(s.categories).toHaveLength(1)
    expect(s.categories[0].name).toBe('自定义')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test -- src/stores/category.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 写实现**

创建 `src/stores/category.ts`：

```ts
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'

export interface Category {
  id: string
  name: string
  dir: string
}

const STORAGE_KEY = 'ap:categories'

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'downloads', name: '下载', dir: '' },
  { id: 'music', name: '音乐', dir: '' },
  { id: 'video', name: '视频', dir: '' },
  { id: 'image', name: '图片', dir: '' },
  { id: 'doc', name: '文档', dir: '' },
]

function load(): Category[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return [...DEFAULT_CATEGORIES]
  try {
    const parsed = JSON.parse(raw) as Category[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_CATEGORIES]
    return parsed
  } catch { return [...DEFAULT_CATEGORIES] }
}

export const useCategoryStore = defineStore('category', () => {
  const categories = ref<Category[]>(load())

  watch(categories, v => localStorage.setItem(STORAGE_KEY, JSON.stringify(v)), { deep: true, flush: 'sync' })

  function addCategory(name: string, dir: string) {
    const id = name.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now().toString(36)
    categories.value.push({ id, name, dir })
  }

  function updateCategory(id: string, name: string, dir: string) {
    const cat = categories.value.find(c => c.id === id)
    if (cat) { cat.name = name; cat.dir = dir }
  }

  function removeCategory(id: string): boolean {
    const cat = categories.value.find(c => c.id === id)
    if (!cat) return false
    if (!cat.dir) {
      const emptyDirCount = categories.value.filter(c => !c.dir).length
      if (emptyDirCount <= 1) return false
    }
    categories.value = categories.value.filter(c => c.id !== id)
    return true
  }

  function getCategory(id: string): Category | undefined {
    return categories.value.find(c => c.id === id)
  }

  function matchCategory(task: { dir: string }, categoryId: string): boolean {
    const cat = categories.value.find(c => c.id === categoryId)
    if (!cat) return false
    if (cat.dir) return task.dir === cat.dir
    const nonEmpty = categories.value.filter(c => c.dir)
    return !nonEmpty.some(c => c.dir === task.dir)
  }

  return { categories, addCategory, updateCategory, removeCategory, getCategory, matchCategory }
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test -- src/stores/category.test.ts`
Expected: 8 passed。

- [ ] **Step 6: 类型检查**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 7: 提交**

```powershell
git add src/stores/category.ts src/stores/category.test.ts
git commit -m "feat(store): category store with CRUD, matchCategory, localStorage persistence"
```

---

### Task 2: Task store — filter pipeline

**Files:**
- Modify: `src/stores/task.ts`
- Create: `src/stores/task.test.ts`

**Interfaces:**
- Consumes: `useCategoryStore` from Task 1
- Produces: `searchQuery: Ref<string>`, `categoryFilter: Ref<string | null>` on task store; `visibleTasks` now 3-stage

- [ ] **Step 1: 写失败测试**

创建 `src/stores/task.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskStore } from './task'
import { useCategoryStore } from './category'
import type { Aria2Task } from '@/lib/aria2/types'

function mkTask(gid: string, status: Aria2Task['status'], dir: string): Aria2Task {
  return {
    gid, status, totalLength: '1000', completedLength: '500', downloadSpeed: '100', uploadSpeed: '0', dir,
    files: [{ path: `${dir}/${gid}.bin`, length: '1000', completedLength: '500', selected: 'true', uris: [{ uri: `http://x/${gid}.bin`, status: 'used' }] }],
  }
}

describe('useTaskStore filter pipeline', () => {
  beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

  it('status filter only', () => {
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/dl')], [mkTask('g2', 'waiting', 'D:/dl')], [])
    ts.setFilter('active')
    expect(ts.visibleTasks.map(t => t.gid)).toEqual(['g1'])
  })

  it('category filter', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/Music'), mkTask('g2', 'active', 'D:/dl')], [], [])
    ts.categoryFilter = 'music'
    expect(ts.visibleTasks.map(t => t.gid)).toEqual(['g1'])
  })

  it('search filter by filename', () => {
    const ts = useTaskStore()
    ts.apply([mkTask('alpha', 'active', 'D:/dl'), mkTask('beta', 'active', 'D:/dl')], [], [])
    ts.searchQuery = 'alp'
    expect(ts.visibleTasks.map(t => t.gid)).toEqual(['alpha'])
  })

  it('three-stage pipeline: status + category + search', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply([
      mkTask('g1', 'active', 'D:/Music'),
      mkTask('g2', 'active', 'D:/Music'),
      mkTask('g3', 'active', 'D:/dl'),
    ], [], [
      mkTask('g4', 'complete', 'D:/Music'),
    ])
    ts.setFilter('active')
    ts.categoryFilter = 'music'
    ts.searchQuery = 'g2'
    expect(ts.visibleTasks.map(t => t.gid)).toEqual(['g2'])
  })

  it('clearing categoryFilter shows all', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/Music'), mkTask('g2', 'active', 'D:/dl')], [], [])
    ts.categoryFilter = 'music'
    expect(ts.visibleTasks).toHaveLength(1)
    ts.categoryFilter = null
    expect(ts.visibleTasks).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/stores/task.test.ts`
Expected: FAIL（`searchQuery` / `categoryFilter` 属性不存在）。

- [ ] **Step 3: 改 task.ts**

3a. 顶部 import 加 `useCategoryStore`：

把：
```ts
import { defineStore } from 'pinia'
import { computed, ref, shallowReactive, watch } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'
```
改为：
```ts
import { defineStore } from 'pinia'
import { computed, ref, shallowReactive, watch } from 'vue'
import type { Aria2Task } from '@/lib/aria2/types'
import { useCategoryStore } from './category'
```

3b. 在 `selectedGid` 之后加两个 ref：

```ts
  const searchQuery = ref('')
  const categoryFilter = ref<string | null>(null)
```

3c. 改 `visibleTasks` — 把整个 computed 替换：

把：
```ts
  const visibleTasks = computed(() => {
    switch (filter.value) {
      case 'active': return active.value
      case 'waiting': return waiting.value
      case 'stopped': return stopped.value
      default: return [...active.value, ...waiting.value, ...stopped.value]
    }
  })
```
改为：
```ts
  const visibleTasks = computed(() => {
    let list: Aria2Task[]
    switch (filter.value) {
      case 'active': list = active.value; break
      case 'waiting': list = waiting.value; break
      case 'stopped': list = stopped.value; break
      default: list = [...active.value, ...waiting.value, ...stopped.value]
    }
    if (categoryFilter.value) {
      const catStore = useCategoryStore()
      const cid = categoryFilter.value
      list = list.filter(t => catStore.matchCategory(t, cid))
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(t => {
        const name = t.bittorrent?.info?.name
          || t.files?.[0]?.path?.split(/[\\/]/).pop()
          || t.gid
        return name.toLowerCase().includes(q)
      })
    }
    return list
  })
```

3d. 在 return 中加 `searchQuery` 和 `categoryFilter`：

把：
```ts
    tasks, order, selection, filter, selectedGid, active, waiting, stopped, visibleTasks,
    apply, upsert, clear, toggleSelect, selectMany, selectAllVisible, clearSelection, setFilter,
```
改为：
```ts
    tasks, order, selection, filter, selectedGid, searchQuery, categoryFilter, active, waiting, stopped, visibleTasks,
    apply, upsert, clear, toggleSelect, selectMany, selectAllVisible, clearSelection, setFilter,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/stores/task.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 运行全部前端测试**

Run: `pnpm test`
Expected: 全部通过（含原有 + 新增）。

- [ ] **Step 6: 类型检查**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 7: 提交**

```powershell
git add src/stores/task.ts src/stores/task.test.ts
git commit -m "feat(store): three-stage filter pipeline (status + category + search)"
```

---

### Task 3: CategoryModal component

**Files:**
- Create: `src/components/CategoryModal.vue`
- Create: `src/components/CategoryModal.test.ts`

**Interfaces:**
- Consumes: none（纯 UI 组件）
- Produces: `CategoryModal` with props `{ show, category }`, emits `update:show`, `submit`

- [ ] **Step 1: 写失败测试**

创建 `src/components/CategoryModal.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CategoryModal from './CategoryModal.vue'

describe('CategoryModal', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders empty form in add mode', () => {
    const w = mount(CategoryModal, { props: { show: true, category: null } })
    expect(w.text()).toContain('添加分类')
    expect(w.find('input[placeholder="分类名称"]').exists()).toBe(true)
  })

  it('renders title edit mode and prefills', () => {
    const w = mount(CategoryModal, { props: { show: true, category: { id: 'music', name: '音乐', dir: 'D:/Music' } } })
    expect(w.text()).toContain('编辑分类')
    expect(w.find('input[placeholder="分类名称"]').element.value).toBe('音乐')
  })

  it('emits submit with name and dir', async () => {
    const w = mount(CategoryModal, { props: { show: true, category: null } })
    await w.find('input[placeholder="分类名称"]').setValue('游戏')
    await w.find('input[placeholder="保存目录（留空使用默认目录）"]').setValue('D:/Games')
    await w.find('button[data-test="submit"]').trigger('click')
    expect(w.emitted('submit')).toBeTruthy()
    expect(w.emitted('submit')![0]).toEqual(['游戏', 'D:/Games'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/components/CategoryModal.test.ts`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 创建组件**

创建 `src/components/CategoryModal.vue`：

```vue
<script setup lang="ts">
import { NModal, NInput, NButton, useMessage } from 'naive-ui'
import { ref, watch } from 'vue'
import type { Category } from '@/stores/category'

const props = defineProps<{ show: boolean; category: Category | null }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; submit: [name: string, dir: string] }>()

const name = ref('')
const dir = ref('')
const isEdit = ref(false)
const message = useMessage()

watch(() => props.show, v => {
  if (!v) return
  if (props.category) {
    name.value = props.category.name
    dir.value = props.category.dir
    isEdit.value = true
  } else {
    name.value = ''
    dir.value = ''
    isEdit.value = false
  }
})

function submit() {
  if (!name.value.trim()) {
    message.warning('请输入分类名称')
    return
  }
  emit('submit', name.value.trim(), dir.value.trim())
  emit('update:show', false)
}
</script>

<template>
  <NModal :show="show" @update:show="emit('update:show', $event)" preset="card" :title="isEdit ? '编辑分类' : '添加分类'" style="width:400px;max-width:90vw">
    <div style="display:flex;flex-direction:column;gap:16px;padding:8px 0">
      <NInput v-model:value="name" placeholder="分类名称" />
      <NInput v-model:value="dir" placeholder="保存目录（留空使用默认目录）" />
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton size="small" type="primary" data-test="submit" @click="submit">确定</NButton>
      </div>
    </div>
  </NModal>
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/components/CategoryModal.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 类型检查**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```powershell
git add src/components/CategoryModal.vue src/components/CategoryModal.test.ts
git commit -m "feat(ui): CategoryModal for add/edit categories"
```

---

### Task 4: Sidebar — categories, speed stats, context menu

**Files:**
- Modify: `src/components/Sidebar.vue`
- Create: `src/components/Sidebar.test.ts`

**Interfaces:**
- Consumes: `useCategoryStore` from Task 1, `useConnectionStore`, `useTaskStore`, `CategoryModal` from Task 3
- Produces: Sidebar with status filters + category list + speed stats + context menu

- [ ] **Step 1: 写失败测试**

创建 `src/components/Sidebar.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Sidebar from './Sidebar.vue'
import { useTaskStore } from '@/stores/task'
import { useCategoryStore } from '@/stores/category'
import { useConnectionStore } from '@/stores/connection'
import type { Aria2Task } from '@/lib/aria2/types'

function mkTask(gid: string, dir: string): Aria2Task {
  return { gid, status: 'active', totalLength: '0', completedLength: '0', downloadSpeed: '0', uploadSpeed: '0', dir, files: [{ path: `${dir}/${gid}.bin`, length: '0', completedLength: '0', selected: 'true', uris: [] }] }
}

describe('Sidebar', () => {
  beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

  it('renders status filter items', () => {
    const w = mount(Sidebar)
    expect(w.text()).toContain('全部')
    expect(w.text()).toContain('下载中')
    expect(w.text()).toContain('等待中')
    expect(w.text()).toContain('已完成')
  })

  it('renders default categories', () => {
    const w = mount(Sidebar)
    expect(w.text()).toContain('音乐')
    expect(w.text()).toContain('视频')
    expect(w.text()).toContain('添加分类')
  })

  it('renders speed stats from connection store', () => {
    const conn = useConnectionStore()
    conn.setStat({ downloadSpeed: '2621440', uploadSpeed: '1024', active: '1', waiting: '0', stoppedTotal: '0' })
    const w = mount(Sidebar)
    expect(w.text()).toContain('2.5 MB/s')
  })

  it('clicking a category sets categoryFilter', async () => {
    const ts = useTaskStore()
    const w = mount(Sidebar)
    const catButtons = w.findAll('[data-cat]')
    expect(catButtons.length).toBeGreaterThan(0)
    await catButtons[0].trigger('click')
    expect(ts.categoryFilter).not.toBeNull()
  })

  it('shows category task counts', () => {
    const ts = useTaskStore()
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    ts.apply([mkTask('g1', 'D:/Music'), mkTask('g2', 'D:/dl')], [], [])
    const w = mount(Sidebar)
    expect(w.text()).toContain('1')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/components/Sidebar.test.ts`
Expected: FAIL（"音乐"/"添加分类" 文本不存在，当前为占位符）。

- [ ] **Step 3: 改 Sidebar.vue**

把 `src/components/Sidebar.vue` 整体替换为：

```vue
<script setup lang="ts">
import { computed, ref, inject, type Ref } from 'vue'
import { NDropdown, useDialog } from 'naive-ui'
import { useTaskStore, type TaskFilter } from '@/stores/task'
import { useCategoryStore, type Category } from '@/stores/category'
import { useConnectionStore } from '@/stores/connection'
import type { Aria2Api } from '@/composables/useAria2'
import CategoryModal from './CategoryModal.vue'

const tasks = useTaskStore()
const cats = useCategoryStore()
const conn = useConnectionStore()
const api = inject<Ref<Aria2Api | null>>('aria2-api')
const dialog = useDialog()

const statusItems = computed(() => [
  { key: 'all' as TaskFilter, label: '全部', count: tasks.active.length + tasks.waiting.length + tasks.stopped.length },
  { key: 'active' as TaskFilter, label: '下载中', count: tasks.active.length },
  { key: 'waiting' as TaskFilter, label: '等待中', count: tasks.waiting.length },
  { key: 'stopped' as TaskFilter, label: '已完成', count: tasks.stopped.length },
])

const CATEGORY_ICONS: Record<string, string> = {
  downloads: '📁', music: '🎵', video: '🎬', image: '🖼', doc: '📄',
}

function iconFor(cat: Category): string {
  return CATEGORY_ICONS[cat.id] ?? '📂'
}

function catCount(catId: string): number {
  let count = 0
  for (const gid of tasks.order) {
    const t = tasks.tasks.get(gid)
    if (t && cats.matchCategory(t, catId)) count++
  }
  return count
}

function fmtSpeed(s: string): string {
  const n = Number(s)
  if (!n) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${u[i]}`
}

function selectCategory(id: string) {
  tasks.categoryFilter = tasks.categoryFilter === id ? null : id
}

const catCtx = ref({ show: false, x: 0, y: 0, id: '' })

function onCategoryContext(e: MouseEvent, id: string) {
  e.preventDefault()
  catCtx.value = { show: true, x: e.clientX, y: e.clientY, id }
}

function catMenuOptions() {
  return [{ label: '编辑', key: 'edit' }, { label: '删除', key: 'delete' }]
}

function catMenuPick(key: string) {
  const id = catCtx.value.id
  catCtx.value.show = false
  if (key === 'edit') {
    editingCategory.value = cats.getCategory(id) ?? null
    catModalShow.value = true
  } else if (key === 'delete') {
    const count = catCount(id)
    const cat = cats.getCategory(id)
    const label = cat?.name ?? '该分类'
    dialog.warning({
      title: '删除分类',
      content: count > 0 ? `「${label}」下有 ${count} 个任务，删除后这些任务将变为未分类。确定删除？` : `确定删除「${label}」？`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => { cats.removeCategory(id) },
    })
  }
}

const catModalShow = ref(false)
const editingCategory = ref<Category | null>(null)

function openAddCategory() {
  editingCategory.value = null
  catModalShow.value = true
}

function onCategorySubmit(name: string, dir: string) {
  if (editingCategory.value) {
    cats.updateCategory(editingCategory.value.id, name, dir)
  } else {
    cats.addCategory(name, dir)
  }
}
</script>

<template>
  <nav style="width:170px;flex-shrink:0;border-right:1px solid var(--n-border-color,#eee);padding:8px 0;display:flex;flex-direction:column">
    <button
      v-for="it in statusItems" :key="it.key"
      @click="tasks.setFilter(it.key)"
      :style="{
        display:'flex',justifyContent:'space-between',alignItems:'center',
        width:'100%',padding:'6px 14px',border:'none',background:'transparent',cursor:'pointer',
        fontWeight: tasks.filter === it.key ? 700 : 400,
        color: tasks.filter === it.key ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
    >
      <span>{{ it.label }}</span>
      <span style="opacity:.6;font-size:12px">{{ it.count }}</span>
    </button>

    <div style="margin-top:12px;padding:0 14px;font-size:12px;opacity:.5">分类</div>
    <button
      v-for="cat in cats.categories" :key="cat.id"
      data-cat
      @click="selectCategory(cat.id)"
      @contextmenu="onCategoryContext($event, cat.id)"
      :style="{
        display:'flex',justifyContent:'space-between',alignItems:'center',
        width:'100%',padding:'4px 14px',border:'none',background:'transparent',cursor:'pointer',
        fontWeight: tasks.categoryFilter === cat.id ? 700 : 400,
        color: tasks.categoryFilter === cat.id ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
    >
      <span>{{ iconFor(cat) }} {{ cat.name }}</span>
      <span style="opacity:.6;font-size:12px">{{ catCount(cat.id) }}</span>
    </button>
    <button @click="openAddCategory" style="display:flex;align-items:center;gap:4px;width:100%;padding:4px 14px;border:none;background:transparent;cursor:pointer;font-size:13px;opacity:.6">
      + 添加分类
    </button>

    <div style="margin-top:12px;padding:0 14px;font-size:12px;display:flex;flex-direction:column;gap:2px">
      <span style="opacity:.6">↓ {{ fmtSpeed(conn.globalStat.downloadSpeed) }}</span>
      <span style="opacity:.6">↑ {{ fmtSpeed(conn.globalStat.uploadSpeed) }}</span>
    </div>

    <div style="margin-top:auto;padding:8px 14px 0;font-size:11px;opacity:.5;word-break:break-all">
      保存到：<br>{{ api?.dir ?? '…' }}
    </div>
  </nav>

  <NDropdown
    placement="bottom-start"
    trigger="manual"
    :show="catCtx.show"
    :x="catCtx.x" :y="catCtx.y"
    :options="catMenuOptions()"
    @select="catMenuPick"
    @clickoutside="catCtx.show = false"
  />
  <CategoryModal
    v-model:show="catModalShow"
    :category="editingCategory"
    @submit="onCategorySubmit"
  />
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/components/Sidebar.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 运行全部测试**

Run: `pnpm test`
Expected: 全部通过。

- [ ] **Step 6: 类型检查**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 7: 提交**

```powershell
git add src/components/Sidebar.vue src/components/Sidebar.test.ts
git commit -m "feat(ui): sidebar with category list, speed stats, context menu"
```

---

### Task 5: TopBar search box

**Files:**
- Modify: `src/components/TopBar.vue`

**Interfaces:**
- Consumes: `useTaskStore().searchQuery` from Task 2
- Produces: TopBar with search input

- [ ] **Step 1: 改 TopBar.vue**

1a. 在 `<script setup>` 中加 import `NInput` 和 `useTaskStore`：

把：
```ts
import { NButton, NSpace, useMessage } from 'naive-ui'
import { inject, type Ref } from 'vue'
import { useConnectionStore } from '@/stores/connection'
```
改为：
```ts
import { NButton, NSpace, NInput, useMessage } from 'naive-ui'
import { inject, type Ref } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import { useTaskStore } from '@/stores/task'
```

1b. 在 `const conn = useConnectionStore()` 后加：

```ts
const tasks = useTaskStore()
```

1c. 在 template 中，把 `<NSpace :size="8">` 块之后、`<span style="margin-left:auto` 之前加搜索框：

把：
```html
    </NSpace>
    <span style="margin-left:auto;font-size:12px;opacity:.7">{{ conn.status }}</span>
```
改为：
```html
    </NSpace>
    <NInput v-model:value="tasks.searchQuery" placeholder="搜索任务…" clearable size="small" style="width:200px" />
    <span style="margin-left:auto;font-size:12px;opacity:.7">{{ conn.status }}</span>
```

- [ ] **Step 2: 类型检查**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 3: 提交**

```powershell
git add src/components/TopBar.vue
git commit -m "feat(ui): search box in TopBar bound to task store"
```

---

### Task 6: AddUrlBar category select

**Files:**
- Modify: `src/components/AddUrlBar.vue`

**Interfaces:**
- Consumes: `useCategoryStore` from Task 1
- Produces: AddUrlBar with category dropdown that fills dir on select

- [ ] **Step 1: 改 AddUrlBar.vue**

1a. 在 `<script setup>` 中加 import：

把：
```ts
import { NButton, NInput, NInputNumber } from 'naive-ui'
import { ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
```
改为：
```ts
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui'
import { ref, watch, computed } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useCategoryStore } from '@/stores/category'
```

1b. 在 `const split = ref(5)` 后加：

```ts
const cats = useCategoryStore()
const selectedCategory = ref<string | null>(null)

const categoryOptions = computed(() =>
  cats.categories.map(c => ({ label: c.name, value: c.id }))
)

watch(selectedCategory, id => {
  if (!id) return
  const cat = cats.getCategory(id)
  if (cat && cat.dir) dir.value = cat.dir
})
```

1c. 在 template 的第二行 `<div style="display:flex;gap:8px;align-items:center">` 中，在 `<NInput v-model:value="dir"` 前加分类下拉：

把：
```html
    <div style="display:flex;gap:8px;align-items:center">
      <NInput v-model:value="dir" size="small" placeholder="保存路径" />
```
改为：
```html
    <div style="display:flex;gap:8px;align-items:center">
      <NSelect v-model:value="selectedCategory" :options="categoryOptions" size="small" placeholder="分类" clearable style="width:120px;flex-shrink:0" />
      <NInput v-model:value="dir" size="small" placeholder="保存路径" />
```

- [ ] **Step 2: 类型检查**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 3: 提交**

```powershell
git add src/components/AddUrlBar.vue
git commit -m "feat(ui): category select in AddUrlBar, dir auto-fill on category change"
```

---

### Task 7: Final integration verification

**Files:**
- None (verification only)

- [ ] **Step 1: 全部前端测试**

Run: `pnpm test`
Expected: 全部通过（原有 33 + 新增约 16 = ~49）。

- [ ] **Step 2: 类型检查**

Run: `pnpm vue-tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 3: 构建检查**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 4: 提交（如有遗漏修复）**

```powershell
git add -A
git commit -m "fix: M4a integration fixes"
```

- [ ] **Step 5: 合并到 master**

```powershell
git checkout master
git merge feat/m4a-sidebar-categories-search --no-ff -m "merge: M4a — sidebar categories, speed stats, and search"
```
