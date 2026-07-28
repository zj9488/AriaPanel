# Category Count Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix overlapping category counts by removing the empty-dir catch-all behavior and adding an explicit "未分类" pseudo-category.

**Architecture:** `matchCategory` changes from catch-all to exact dir match. A new `isUncategorized` function identifies tasks matching no configured category. The sidebar renders a system-level "未分类" item with its own count and filter.

**Tech Stack:** Vue 3.5 (Composition API), Pinia, TypeScript, Naive UI, Vitest

## Global Constraints

- No comments in code unless explicitly requested
- No emojis in code or commit messages (emoji icons in Sidebar template are existing UI data, not new additions)
- Semicolons: false. Quotes: single. Trailing commas: all. Print width: 120
- `@` alias maps to `src/`
- PowerShell: use `;` or `if ($?) {}` to chain, never `&&`
- Test gate: `pnpm test` must pass. Type check: `pnpm vue-tsc --noEmit`. Lint: `pnpm lint`

---

### Task 1: Category Store — matchCategory, isUncategorized, removeCategory

**Files:**
- Modify: `src/stores/category.ts`
- Test: `src/stores/category.test.ts`

**Interfaces:**
- Produces: `UNCATEGORIZED_ID` constant (string, value `'__uncategorized__'`), `isUncategorized(task: { dir: string }): boolean` on the store, updated `matchCategory` signature unchanged but behavior different (exact match only, empty-dir returns false).

- [ ] **Step 1: Update existing test `matchCategory: empty-dir category catches unmatched tasks`**

In `src/stores/category.test.ts`, replace the test at lines 76-81:

```ts
  it('matchCategory: empty-dir category catches unmatched tasks', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.matchCategory(mkTask('g1', 'D:/Music'), 'downloads')).toBe(false)
    expect(s.matchCategory(mkTask('g2', 'D:/Other'), 'downloads')).toBe(true)
  })
```

With:

```ts
  it('matchCategory: empty-dir category matches nothing', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.matchCategory(mkTask('g1', 'D:/Music'), 'downloads')).toBe(false)
    expect(s.matchCategory(mkTask('g2', 'D:/Other'), 'downloads')).toBe(false)
  })
```

- [ ] **Step 2: Update existing test `removeCategory refuses to remove last empty-dir category`**

In `src/stores/category.test.ts`, replace the test at lines 57-67:

```ts
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
```

With:

```ts
  it('removeCategory allows deleting all categories', () => {
    const s = useCategoryStore()
    s.removeCategory('music')
    s.removeCategory('video')
    s.removeCategory('image')
    s.removeCategory('doc')
    expect(s.removeCategory('downloads')).toBe(true)
    expect(s.categories).toHaveLength(0)
  })
```

- [ ] **Step 3: Add two new isUncategorized tests**

In `src/stores/category.test.ts`, after the `matchCategory: empty-dir category matches nothing` test, add:

```ts
  it('isUncategorized: tasks not matching any configured category', () => {
    const s = useCategoryStore()
    s.updateCategory('music', '音乐', 'D:/Music')
    expect(s.isUncategorized(mkTask('g1', 'D:/Music'))).toBe(false)
    expect(s.isUncategorized(mkTask('g2', 'D:/Other'))).toBe(true)
  })

  it('isUncategorized: all categories unconfigured means all tasks uncategorized', () => {
    const s = useCategoryStore()
    expect(s.isUncategorized(mkTask('g1', 'D:/dl'))).toBe(true)
  })
```

- [ ] **Step 4: Run tests to verify failures**

Run: `pnpm test -- --run src/stores/category.test.ts`
Expected: FAIL — `matchCategory: empty-dir category matches nothing` fails (old catch-all returns true for `downloads`). `removeCategory allows deleting all categories` fails (old constraint blocks deletion). `isUncategorized` tests fail (function does not exist).

- [ ] **Step 5: Add `UNCATEGORIZED_ID` constant export**

In `src/stores/category.ts`, after line 10 (`const STORAGE_KEY = 'ap:categories'`), add:

```ts

export const UNCATEGORIZED_ID = '__uncategorized__'
```

- [ ] **Step 6: Simplify `removeCategory` — remove empty-dir constraint**

In `src/stores/category.ts`, replace the `removeCategory` function (lines 50-59):

```ts
  function removeCategory(id: string): boolean {
    const cat = categories.value.find((c) => c.id === id)
    if (!cat) return false
    if (!cat.dir) {
      const emptyDirCount = categories.value.filter((c) => !c.dir).length
      if (emptyDirCount <= 1) return false
    }
    categories.value = categories.value.filter((c) => c.id !== id)
    return true
  }
```

With:

```ts
  function removeCategory(id: string): boolean {
    const cat = categories.value.find((c) => c.id === id)
    if (!cat) return false
    categories.value = categories.value.filter((c) => c.id !== id)
    return true
  }
```

- [ ] **Step 7: Replace `matchCategory` with exact-match-only version**

In `src/stores/category.ts`, replace the `matchCategory` function (lines 65-71):

```ts
  function matchCategory(task: { dir: string }, categoryId: string): boolean {
    const cat = categories.value.find((c) => c.id === categoryId)
    if (!cat) return false
    if (cat.dir) return task.dir === cat.dir
    const nonEmpty = categories.value.filter((c) => c.dir)
    return !nonEmpty.some((c) => c.dir === task.dir)
  }
```

With:

```ts
  function matchCategory(task: { dir: string }, categoryId: string): boolean {
    const cat = categories.value.find((c) => c.id === categoryId)
    if (!cat || !cat.dir) return false
    return task.dir === cat.dir
  }
```

- [ ] **Step 8: Add `isUncategorized` function**

In `src/stores/category.ts`, after the `matchCategory` function, add:

```ts

  function isUncategorized(task: { dir: string }): boolean {
    return !categories.value.some((c) => c.dir && c.dir === task.dir)
  }
```

- [ ] **Step 9: Export `isUncategorized` from store return**

In `src/stores/category.ts`, replace the return statement (line 73):

```ts
  return { categories, addCategory, updateCategory, removeCategory, getCategory, matchCategory }
```

With:

```ts
  return { categories, addCategory, updateCategory, removeCategory, getCategory, matchCategory, isUncategorized }
```

- [ ] **Step 10: Run tests to verify all pass**

Run: `pnpm test -- --run src/stores/category.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 11: Commit**

```bash
git add src/stores/category.ts src/stores/category.test.ts
git commit -m "fix(category): exact dir match, add isUncategorized, remove catch-all"
```

---

### Task 2: Task Store — visibleTasks handles UNCATEGORIZED_ID

**Files:**
- Modify: `src/stores/task.ts`
- Test: `src/stores/task.test.ts`

**Interfaces:**
- Consumes: `UNCATEGORIZED_ID` from `./category` (Task 1), `isUncategorized` on the category store (Task 1).
- Produces: `visibleTasks` correctly filters by uncategorized when `categoryFilter === UNCATEGORIZED_ID`.

- [ ] **Step 1: Add failing test for uncategorized filter**

In `src/stores/task.test.ts`, add `UNCATEGORIZED_ID` to the import on line 4:

```ts
import { useCategoryStore, UNCATEGORIZED_ID } from './category'
```

Then, after the `clearing categoryFilter shows all` test (line 94), add:

```ts

  it('uncategorized filter', () => {
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    const ts = useTaskStore()
    ts.apply([mkTask('g1', 'active', 'D:/Music'), mkTask('g2', 'active', 'D:/dl')], [], [])
    ts.categoryFilter = UNCATEGORIZED_ID
    expect(ts.visibleTasks.map((t) => t.gid)).toEqual(['g2'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/stores/task.test.ts`
Expected: FAIL — `uncategorized filter` fails because `visibleTasks` passes `UNCATEGORIZED_ID` to `matchCategory`, which returns false for all tasks (no category with id `__uncategorized__`), resulting in an empty list instead of `['g2']`.

- [ ] **Step 3: Update import to include UNCATEGORIZED_ID**

In `src/stores/task.ts`, replace line 5:

```ts
import { useCategoryStore } from './category'
```

With:

```ts
import { useCategoryStore, UNCATEGORIZED_ID } from './category'
```

- [ ] **Step 4: Update `visibleTasks` to handle UNCATEGORIZED_ID**

In `src/stores/task.ts`, replace lines 44-48:

```ts
    if (categoryFilter.value) {
      const catStore = useCategoryStore()
      const cid = categoryFilter.value
      list = list.filter((t) => catStore.matchCategory(t, cid))
    }
```

With:

```ts
    if (categoryFilter.value) {
      const catStore = useCategoryStore()
      const cid = categoryFilter.value
      if (cid === UNCATEGORIZED_ID) {
        list = list.filter((t) => catStore.isUncategorized(t))
      } else {
        list = list.filter((t) => catStore.matchCategory(t, cid))
      }
    }
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm test -- --run src/stores/task.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/stores/task.ts src/stores/task.test.ts
git commit -m "feat(task): visibleTasks supports uncategorized filter"
```

---

### Task 3: Sidebar — "未分类" Pseudo-Category Item

**Files:**
- Modify: `src/components/Sidebar.vue`
- Test: `src/components/Sidebar.test.ts`

**Interfaces:**
- Consumes: `UNCATEGORIZED_ID` from `@/stores/category` (Task 1), `isUncategorized` on the category store (Task 1), `categoryFilter` on the task store (existing).
- Produces: A `[data-uncategorized]` button in the sidebar that displays uncategorized count and toggles `categoryFilter` to/from `UNCATEGORIZED_ID`.

- [ ] **Step 1: Add failing test for rendering uncategorized item**

In `src/components/Sidebar.test.ts`, add import of `UNCATEGORIZED_ID` after line 7:

```ts
import { useCategoryStore, UNCATEGORIZED_ID } from '@/stores/category'
```

Then, after the last test (line 84), add:

```ts

  it('renders uncategorized item', () => {
    const w = mountSidebar()
    expect(w.text()).toContain('未分类')
  })

  it('clicking uncategorized sets categoryFilter', async () => {
    const ts = useTaskStore()
    const w = mountSidebar()
    await w.find('[data-uncategorized]').trigger('click')
    expect(ts.categoryFilter).toBe(UNCATEGORIZED_ID)
  })

  it('uncategorized count reflects unmatched tasks', () => {
    const ts = useTaskStore()
    const cs = useCategoryStore()
    cs.updateCategory('music', '音乐', 'D:/Music')
    ts.apply([mkTask('g1', 'D:/Music'), mkTask('g2', 'D:/dl')], [], [])
    const w = mountSidebar()
    expect(w.find('[data-uncategorized]').text()).toContain('1')
  })
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm test -- --run src/components/Sidebar.test.ts`
Expected: FAIL — `renders uncategorized item` fails (no "未分类" text). `clicking uncategorized sets categoryFilter` fails (no `[data-uncategorized]` element). `uncategorized count reflects unmatched tasks` fails (same).

- [ ] **Step 3: Update Sidebar import to include UNCATEGORIZED_ID**

In `src/components/Sidebar.vue`, replace line 5:

```ts
import { useCategoryStore, type Category } from '@/stores/category'
```

With:

```ts
import { useCategoryStore, type Category, UNCATEGORIZED_ID } from '@/stores/category'
```

- [ ] **Step 4: Add `uncategorizedCount` and `selectUncategorized` functions**

In `src/components/Sidebar.vue`, after the `catCount` function (line 44), add:

```ts

function uncategorizedCount(): number {
  let count = 0
  for (const gid of tasks.order) {
    const t = tasks.tasks.get(gid)
    if (t && cats.isUncategorized(t)) count++
  }
  return count
}

function selectUncategorized() {
  tasks.categoryFilter = tasks.categoryFilter === UNCATEGORIZED_ID ? null : UNCATEGORIZED_ID
}
```

- [ ] **Step 5: Add "未分类" button in template**

In `src/components/Sidebar.vue`, insert the following between the category `v-for` button (ending at line 162 `</button>`) and the "+ 添加分类" button (line 163):

```html
    <button
      data-uncategorized
      :style="{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        padding: '4px 14px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontWeight: tasks.categoryFilter === UNCATEGORIZED_ID ? 700 : 400,
        color: tasks.categoryFilter === UNCATEGORIZED_ID ? 'var(--n-primary-color,#18a058)' : 'inherit',
      }"
      @click="selectUncategorized()"
    >
      <span>📂 未分类</span>
      <span style="opacity: 0.6; font-size: 12px">{{ uncategorizedCount() }}</span>
    </button>
```

The insertion point is: after the closing `</button>` of the `v-for="cat in cats.categories"` loop, before the `<button` that contains `@click="openAddCategory"`.

- [ ] **Step 6: Run tests to verify all pass**

Run: `pnpm test -- --run src/components/Sidebar.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 7: Run full test suite, type check, and lint**

Run: `pnpm test -- --run`
Expected: all tests pass.

Run: `pnpm vue-tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Sidebar.vue src/components/Sidebar.test.ts
git commit -m "feat(sidebar): add uncategorized pseudo-category item"
```
