# Design: Category Count Fix — Explicit "未分类" Pseudo-Category

**Date:** 2026-07-28
**Status:** Approved
**Author:** Brainstorming session

## Problem

When a new task is created without a category, all category counts increment simultaneously. Root cause: all 5 default categories have `dir: ''`, and `matchCategory` treats empty-dir categories as catch-alls. With multiple catch-alls, every uncategorized task matches all of them, inflating every count.

## Root Cause Analysis

`src/stores/category.ts:65-71` — `matchCategory`:

```ts
function matchCategory(task: { dir: string }, categoryId: string): boolean {
  const cat = categories.value.find((c) => c.id === categoryId)
  if (!cat) return false
  if (cat.dir) return task.dir === cat.dir
  // empty-dir catch-all: matches anything not claimed by a specific category
  const nonEmpty = categories.value.filter((c) => c.dir)
  return !nonEmpty.some((c) => c.dir === task.dir)
}
```

With all 5 defaults having `dir: ''`, the catch-all branch runs for all of them, and every task matches every category.

## Solution: Approach A — Explicit "未分类" Pseudo-Category

Remove the catch-all behavior. Empty-dir categories match nothing (they are "unconfigured"). Add a system-level "未分类" item in the sidebar that collects all tasks not matching any configured category.

### Design Principles

- **No overlap:** Each task contributes to at most one count — either a specific category (exact dir match) or the "未分类" bucket, never both.
- **Unconfigured = invisible:** A category with `dir: ''` is a placeholder that matches nothing until the user configures its download directory.
- **Eternal fallback:** "未分类" always exists, cannot be edited or deleted, and catches all unmatched tasks.

## Changes

### 1. `src/stores/category.ts`

**Export constant:**

```ts
export const UNCATEGORIZED_ID = '__uncategorized__'
```

**`matchCategory` — remove catch-all, exact match only:**

```ts
function matchCategory(task: { dir: string }, categoryId: string): boolean {
  const cat = categories.value.find((c) => c.id === categoryId)
  if (!cat || !cat.dir) return false
  return task.dir === cat.dir
}
```

Empty-dir categories return `false` for all tasks. No more overlapping counts.

**Add `isUncategorized`:**

```ts
function isUncategorized(task: { dir: string }): boolean {
  return !categories.value.some((c) => c.dir && c.dir === task.dir)
}
```

Returns `true` if no configured category (one with a non-empty `dir`) matches the task's `dir`.

**Remove `removeCategory` constraint:**

The current logic refuses to delete the last empty-dir category (lines 53-56) to guarantee a catch-all always exists. With the "未分类" pseudo-category serving as the eternal fallback, this constraint is no longer needed. Users may delete all custom categories; all tasks simply fall into "未分类".

**Update store return:** export `isUncategorized` and `UNCATEGORIZED_ID`.

### 2. `src/stores/task.ts`

**`visibleTasks` computed — handle `UNCATEGORIZED_ID`:**

Current (line 44-48):

```ts
if (categoryFilter.value) {
  const catStore = useCategoryStore()
  const cid = categoryFilter.value
  list = list.filter((t) => catStore.matchCategory(t, cid))
}
```

New:

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

Import `UNCATEGORIZED_ID` from `./category`.

### 3. `src/components/Sidebar.vue`

**Add "未分类" item after the category list, before "+ 添加分类":**

```html
<button
  data-uncategorized
  :style="{ ... }"
  @click="selectUncategorized()"
>
  <span>📂 未分类</span>
  <span style="opacity: 0.6; font-size: 12px">{{ uncategorizedCount }}</span>
</button>
```

**Add `uncategorizedCount` function:**

```ts
function uncategorizedCount(): number {
  let count = 0
  for (const gid of tasks.order) {
    const t = tasks.tasks.get(gid)
    if (t && cats.isUncategorized(t)) count++
  }
  return count
}
```

**Add `selectUncategorized` function:**

```ts
function selectUncategorized() {
  tasks.categoryFilter =
    tasks.categoryFilter === UNCATEGORIZED_ID ? null : UNCATEGORIZED_ID
}
```

**Active style:** `tasks.categoryFilter === UNCATEGORIZED_ID` gets bold + primary color, same as regular categories.

**No context menu:** The "未分类" button does not bind `@contextmenu`.

**Import:** `UNCATEGORIZED_ID` from `@/stores/category`.

### 4. Test Updates

#### `src/stores/category.test.ts`

- **Update** `matchCategory: empty-dir category catches unmatched tasks` (line 76-81):
  - Rename to `matchCategory: empty-dir category matches nothing`.
  - Assert `matchCategory(task, 'downloads')` returns `false` for any task when `downloads` has `dir: ''`.
  - Both `D:/Music` task and `D:/Other` task should return `false`.

- **Add** `isUncategorized: tasks not matching any configured category`:
  - Configure `music` with `dir: 'D:/Music'`.
  - Task with `dir: 'D:/Music'` → `isUncategorized` returns `false`.
  - Task with `dir: 'D:/Other'` → `isUncategorized` returns `true`.

- **Add** `isUncategorized: all categories unconfigured means all tasks uncategorized`:
  - Default categories (all empty dir).
  - Any task → `isUncategorized` returns `true`.

- **Update** `removeCategory refuses to remove last empty-dir category` (line 57-67):
  - Rename to `removeCategory allows deleting all categories`.
  - Delete all 5 defaults; assert categories array is empty.

#### `src/stores/task.test.ts`

- **Add** `uncategorized filter`:
  - Configure `music` with `dir: 'D:/Music'`.
  - Tasks: `g1` with `dir: 'D:/Music'`, `g2` with `dir: 'D:/dl'`.
  - Set `categoryFilter = UNCATEGORIZED_ID`.
  - Assert `visibleTasks` returns `['g2']` only.

#### `src/components/Sidebar.test.ts`

- **Add** `renders uncategorized item`:
  - Mount sidebar; assert text contains `未分类`.

- **Add** `clicking uncategorized sets categoryFilter`:
  - Mount sidebar; click `[data-uncategorized]` button.
  - Assert `tasks.categoryFilter === UNCATEGORIZED_ID`.

- **Add** `uncategorized count reflects unmatched tasks`:
  - Configure `music` with `dir: 'D:/Music'`.
  - Apply tasks: `g1` dir `D:/Music`, `g2` dir `D:/dl`.
  - Assert sidebar text shows uncategorized count as `1`.

## Non-Goals

- **Dir uniqueness across categories:** Two categories sharing the same `dir` will both match the same tasks. This is an existing behavior and out of scope.
- **Explicit categoryId on tasks:** Considered (Approach C) but rejected for excessive refactor cost.
- **Migration of existing user data:** No migration needed. Empty-dir categories simply start showing 0 instead of inflated counts.

## Files Touched

| File | Change |
|------|--------|
| `src/stores/category.ts` | `matchCategory` exact-match, add `isUncategorized`, export `UNCATEGORIZED_ID`, remove `removeCategory` constraint |
| `src/stores/task.ts` | `visibleTasks` handles `UNCATEGORIZED_ID` |
| `src/components/Sidebar.vue` | Add "未分类" item + count + click handler |
| `src/stores/category.test.ts` | Update matchCategory test, add isUncategorized tests, update removeCategory test |
| `src/stores/task.test.ts` | Add uncategorized filter test |
| `src/components/Sidebar.test.ts` | Add uncategorized item tests |
