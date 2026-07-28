# Design: Task Reclassify via Context Menu

**Date:** 2026-07-28
**Status:** Approved
**Author:** Brainstorming session

## Problem

Tasks cannot change category after creation. The category is determined by the task's `dir` field (matched against category `dir` values). Users need a way to reclassify tasks from the right-click context menu.

## Solution

Add a "重新分类" submenu to `TaskContextMenu` that lists categories with configured `dir` values. Selecting a category calls `changeOption(gid, {dir: catDir})` to update the task's directory, which immediately changes its category assignment.

### Existing Infrastructure (No Changes Needed)

| Component | Status |
|-----------|--------|
| `Aria2Client.changeOption(gid, options)` | Already implemented (`rpc-client.ts`) |
| `useTaskOperations.changeTaskOption(gid, options)` | Already implemented, used by `TaskDetailDrawer` |
| Category store `matchCategory` / `isUncategorized` | Already handles dir-based matching |

## Changes

### 1. `src/components/TaskContextMenu.vue`

**Add `categories` prop:**

```ts
defineProps<{
  show: boolean
  x: number
  y: number
  status: TaskStatus
  isBittorrent: boolean
  categories: { name: string; dir: string }[]
}>()
```

**Add `reclassify` emit:**

```ts
defineEmits<{
  select: [op: TaskOp]
  close: []
  reclassify: [dir: string]
}>()
```

**Add submenu to `options()` — after "打开文件夹", before "强制暂停":**

```ts
const configured = props.categories.filter((c) => c.dir)
if (configured.length > 0) {
  base.push({
    label: '重新分类',
    key: 'reclassify',
    children: configured.map((c) => ({
      label: c.name,
      key: `reclassify:${c.dir}`,
    })),
  })
}
```

**Update `pick()` to handle reclassify keys:**

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

### 2. `src/views/TaskListView.vue`

**Pass categories and handle reclassify:**

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

`changeTaskOption` is already destructured from `useTaskOperations` in `TaskListView` (used by `TaskDetailDrawer` at line 149).

### 3. Test Updates

#### `src/components/TaskContextMenu.test.ts`

- **Add** `renders reclassify submenu when categories have configured dirs`:
  - Pass categories with at least one non-empty `dir`.
  - Assert the menu options text includes "重新分类" and the category name.

- **Add** `hides reclassify when no categories have configured dirs`:
  - Pass categories with all empty `dir`.
  - Assert "重新分类" is absent.

- **Add** `selecting a category emits reclassify with dir`:
  - Pass categories with configured dirs.
  - Select a category child item.
  - Assert `reclassify` emit payload is the category's `dir`.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Submenu (not modal) | One click to reclassify; fastest UX |
| Only show categories with non-empty `dir` | Empty-dir categories have no target path |
| Hide entry when no configured categories exist | Avoid empty submenu |
| Position: after "打开文件夹" | Groups file/location-related actions together |
| Encode dir in key (`reclassify:${dir}`) | Avoids store access in presentational component; dir is the value needed for `changeOption` |
| No "move to uncategorized" | User confirmed not needed |

## Uncategorized Tasks

Uncategorized tasks (whose `dir` matches no configured category) can be reclassified normally — they pick a category from the submenu, `changeOption` updates their `dir`, and they immediately appear in the selected category after refresh.

## Non-Goals

- Batch reclassification (context menu operates on single tasks)
- Visual marker for current category in submenu
- Moving downloaded files to the new directory (`changeOption` only updates metadata)
- Moving tasks to "未分类" (no meaningful dir to assign)

## Files Touched

| File | Change |
|------|--------|
| `src/components/TaskContextMenu.vue` | Add `categories` prop, "重新分类" submenu, `reclassify` emit |
| `src/views/TaskListView.vue` | Pass `categories` prop, handle `@reclassify` |
| `src/components/TaskContextMenu.test.ts` | Add 3 tests for submenu rendering and emit |
