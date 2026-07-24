# AriaPanel M4a — 侧栏、分类与搜索 设计文档

- **状态**：已定稿，待评审
- **日期**：2026-07-24
- **前置里程碑**：M3（`afa7e34` on master）

## 1. 目标

在现有应用骨架上补齐三大核心体验：

1. **左侧导航栏完善** — 分类列表区 + 全局速度统计区，替换当前占位符
2. **分类系统** — Motrix 式预定义分类（每分类绑定独立目录），完整 CRUD
3. **搜索** — TopBar 搜索框，按任务名称实时过滤

## 2. 分类数据模型

### 2.1 类型定义

```ts
interface Category {
  id: string    // slug, 如 "music"，创建时生成
  name: string  // 显示名，如 "音乐"
  dir: string   // 绝对路径；空字符串 = 使用全局下载目录
}
```

### 2.2 默认分类

| id | name | dir |
|----|------|-----|
| `downloads` | 下载 | `""` |
| `music` | 音乐 | `""` |
| `video` | 视频 | `""` |
| `image` | 图片 | `""` |
| `doc` | 文档 | `""` |

首次启动（localStorage 无 `ap:categories`）写入上述默认值。用户后续可编辑各分类的 `dir`。

### 2.3 任务-分类匹配逻辑

```
matchCategory(task, category):
  if category.dir 为空:  → 该分类是"默认收件箱"，仅匹配 dir 不属于任何其他非空分类的任务
  else:                  → task.dir === category.dir
```

具体实现：

1. 对每个任务，先找所有 `dir` 非空的分类
2. 如果 `task.dir === category.dir`，归入该分类
3. 如果没有任何非空分类匹配，归入所有 `dir` 为空的分类（通常只有"下载"）

这样"下载"分类始终充当兜底。用户创建带目录的新分类后，任务自然分流。

### 2.4 持久化

- localStorage key: `ap:categories`
- 存储格式：JSON 数组 `Category[]`
- 与现有 `ap:filter`、`ap:sortKey`、`ap:theme` 一致

## 3. 过滤流水线

task store 的 `visibleTasks` 从单层状态过滤扩展为三段管道：

```
全量 tasks
  → statusFilter (all / active / waiting / stopped)   [现有]
  → categoryFilter (null = 全部分类)                    [新增]
  → searchFilter (name includes query, 不区分大小写)    [新增]
  → visibleTasks
```

### 3.1 新增 store 字段

```ts
// task.ts
const searchQuery = ref('')
const categoryFilter = ref<string | null>(null) // Category.id | null
```

### 3.2 分类计数

Sidebar 分类项的计数基于**全量 tasks**（不受 statusFilter / searchQuery 影响），这样用户切换分类时能看到该分类总任务数。

```ts
function categoryCount(catId: string): number {
  return [...tasks.values()].filter(t => matchCategory(t, getCategory(catId))).length
}
```

## 4. 侧栏布局

```
┌── Sidebar (170px) ──────────┐
│  全部            12          │  ← 状态分组（现有，无改动）
│  下载中           3          │
│  等待中           2          │
│  已完成           7          │
│ ───────────────────          │
│  分类                        │  ← 分类区（新增）
│  📁 下载          5          │
│  🎵 音乐          2          │
│  🎬 视频          1          │
│  🖼 图片          0          │
│  📄 文档          0          │
│  + 添加分类                  │
│ ───────────────────          │
│  ↓ 2.3 MB/s                  │  ← 速度统计（新增）
│  ↑ 0 B/s                     │
│ ───────────────────          │
│  保存到：                     │  ← 现有
│  C:\Downloads                │
└──────────────────────────────┘
```

### 4.1 分类区交互

- **点击分类名**：激活该分类过滤（`categoryFilter = id`）；再次点击取消（`categoryFilter = null`）
- **右键分类名**：弹出上下文菜单 — 编辑 / 删除
  - 删除时需确认（如果该分类下有任务，提示"N 个任务将变为未分类"）
  - 不可删除最后一个 `dir` 为空的分类（保证兜底）
- **"+ 添加分类"**：打开 CategoryModal（空表单）
- **编辑分类**：打开 CategoryModal（回填数据）

### 4.2 速度统计

读取 `useConnectionStore().globalStat`：

```ts
const conn = useConnectionStore()
// conn.globalStat.downloadSpeed / uploadSpeed
```

格式化函数：`B/s → KB/s → MB/s → GB/s`，保留 1 位小数。与 TaskDetailDrawer 中的 `fmtSpeed` 复用。

## 5. 搜索

### 5.1 TopBar 搜索框

在 TopBar 中 `NInput`（size="small"，带清除按钮）：

```html
<NInput v-model:value="tasks.searchQuery" placeholder="搜索任务…" clearable size="small" style="width:200px" />
```

### 5.2 搜索匹配

```ts
function matchSearch(task: Aria2Task, query: string): boolean {
  if (!query) return true
  const name = task.bittorrent?.info?.name
    || task.files?.[0]?.path?.split(/[\\/]/).pop()
    || task.gid
  return name.toLowerCase().includes(query.toLowerCase())
}
```

实时响应——输入即过滤，无需回车。

## 6. 添加任务时的分类选择

AddUrlBar 现有字段：`url, dir, filename, proxy, split`。M4a 新增分类下拉：

- `NSelect` 列出所有分类（显示 `name`）
- 选择分类后，`dir` 自动填入该分类的 `dir`（如果非空）；用户仍可手动覆盖 `dir`
- 不选分类 = 使用默认下载目录

## 7. 受影响文件

### 新建

| 文件 | 职责 |
|------|------|
| `src/stores/category.ts` | useCategoryStore — categories ref, CRUD, localStorage 持久化, matchCategory helper |
| `src/stores/category.test.ts` | 默认分类初始化、CRUD roundtrip、localStorage 持久化 |
| `src/components/CategoryModal.vue` | 添加/编辑分类弹窗（name + dir 两个字段） |
| `src/components/CategoryModal.test.ts` | 添加模式、编辑模式回填、提交校验 |

### 修改

| 文件 | 改动 |
|------|------|
| `src/stores/task.ts` | 加 `searchQuery` + `categoryFilter` ref；`visibleTasks` 改为三段管道 |
| `src/components/Sidebar.vue` | 分类列表区 + 速度统计区 + 分类右键菜单 + 添加分类按钮 |
| `src/components/TopBar.vue` | 搜索 `NInput`，双向绑定 `tasks.searchQuery` |
| `src/components/AddUrlBar.vue` | 分类 `NSelect` 下拉，选分类时联动 `dir` |
| `src/views/TaskListView.vue` | 无直接改动（过滤逻辑在 store 层） |

## 8. 测试策略

### 单元测试

- **category store**：
  - 首次初始化写入 5 个默认分类
  - `addCategory` 追加并持久化
  - `updateCategory` 修改并持久化
  - `removeCategory` 删除并持久化
  - `removeCategory` 拒绝删除最后一个空 dir 分类
  - `matchCategory` 匹配逻辑（空 dir 兜底、非空 dir 精确匹配）

- **task store 三段管道**：
  - status only
  - status + category
  - status + search
  - category + search
  - 三层叠加

- **Sidebar 组件**：
  - 分类项渲染 + 计数
  - 速度格式化

- **CategoryModal**：
  - 添加模式（空表单）
  - 编辑模式（回填）
  - 空名称提交校验

### 验证门禁

- `pnpm test` — 全部通过
- `pnpm vue-tsc --noEmit` — 0 错误
- `cargo test --manifest-path src-tauri\Cargo.toml` — 不受影响（纯前端变更）

## 9. 非目标（M4a 不做）

- 不做分类拖拽排序（后续可加）
- 不做分类图标自定义（固定 emoji）
- 不做搜索历史 / 搜索建议
- 不做分类级速度统计（只有全局）
- 不修改 Rust 侧（纯前端里程碑）
