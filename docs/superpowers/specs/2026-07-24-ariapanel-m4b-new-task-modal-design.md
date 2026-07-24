# AriaPanel M4b — 新建任务 Modal 设计文档

- **状态**：已定稿，待评审
- **日期**：2026-07-24
- **依赖**：M4a（分类 store、task store filter pipeline）

## 1. 概述

M4b 为 AriaPanel 增加完整的新建下载任务 Modal。现有 AddUrlBar 快捷栏保留不变，TopBar 新增「+」按钮触发 Modal。Modal 支持批量 URL 粘贴、自动类型识别（HTTP / BT / 混合）、高级折叠面板（精简选项组），以及智能字段隐藏（磁力链隐藏 BT 无关字段）。

## 2. 范围

### 2.1 包含

- `NewTaskModal.vue` 组件：NModal + textarea + 类型检测 + 高级折叠
- TopBar 新增「+」按钮
- TaskListView 集成 modal 状态管理
- 批量提交（多行 textarea，逐行解析，逐个 addUri）
- 自动类型识别：`http(s)/ftp` → HTTP，`magnet:` → BT，混合 → mixed
- 高级选项（精简组）：重命名(out)、目录(dir)、分类、分块(split)、单服务器连接数(max-connection-per-server)、代理(all-proxy)
- 智能字段隐藏：纯磁力链时隐藏 filename、split、maxConnPerServer
- 表单关闭时自动重置

### 2.2 不包含（推 M4d）

- .torrent / .metalink 文件选择与添加（`aria2.addTorrent` / `aria2.addMetalink`）
- 种子内文件选择 UI
- BT 选项（做种时间、顺序下载）
- Referer / User-Agent / Headers（留后续迭代）

### 2.3 非目标

- 不修改现有 AddUrlBar 的行为
- 不修改现有 RetryDialog 的行为
- 不新增 aria2 RPC 方法（复用 `addUri`）

## 3. 组件架构

### 3.1 文件清单

| 文件 | 变更 | 职责 |
|------|------|------|
| `src/components/NewTaskModal.vue` | 新增 | Modal 组件：textarea + 类型检测 + 高级折叠 + 批量提交 |
| `src/components/NewTaskModal.test.ts` | 新增 | 12 项单元测试 |
| `src/components/TopBar.vue` | 修改 | 新增「+」按钮，emit `new-task` |
| `src/views/TaskListView.vue` | 修改 | 监听 `@new-task`，管理 `newTaskShow` ref，集成 modal |

### 3.2 集成方式

```
TaskListView.vue
├── <TopBar @new-task="newTaskShow = true" />
├── <AddUrlBar ... />                        ← 不变
├── <NewTaskModal
│     v-model:show="newTaskShow"
│     :default-dir="api?.dir ?? ''"
│     @submitted="api?.refresh()"
│   />
├── ...其他现有组件
```

**TaskListView 新增状态：**
```ts
const newTaskShow = ref(false)
```

**TopBar 新增：**
- `NButton` 「+」按钮（`type="primary"` 或 quaternary）
- `defineEmits` 新增 `'new-task': []`

## 4. NewTaskModal 组件设计

### 4.1 Props & Emits

```ts
defineProps<{ show: boolean; defaultDir: string }>()
defineEmits<{
  'update:show': [v: boolean]
  'submitted': []
}>()
```

### 4.2 表单状态

| Ref | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `urls` | `string` | `''` | textarea 内容 |
| `selectedCategory` | `string \| null` | `null` | 分类下拉选中值 |
| `dir` | `string` | `props.defaultDir` | 保存目录 |
| `filename` | `string` | `''` | out 参数（BT 隐藏） |
| `split` | `number` | `5` | 分块数（BT 隐藏） |
| `maxConnPerServer` | `number` | `5` | 单服务器连接数（BT 隐藏） |
| `proxy` | `string` | `''` | all-proxy |
| `advancedOpen` | `boolean` | `false` | NCollapse 折叠状态（使用 `expandedNames: string[]` ref 绑定 `v-model:expanded-names`，空数组 = 折叠） |
| `submitting` | `boolean` | `false` | 提交 loading |

### 4.3 类型检测

```ts
const urlList = computed(() =>
  urls.value.split('\n').map(s => s.trim()).filter(Boolean)
)

const detectedType = computed<'http' | 'bt' | 'mixed'>(() => {
  if (urlList.value.length === 0) return 'http'
  const types = new Set(
    urlList.value.map(u => u.startsWith('magnet:') ? 'bt' : 'http')
  )
  return types.size === 1 ? [...types][0] : 'mixed'
})
```

- `detectedType === 'bt'`：隐藏 filename、split、maxConnPerServer
- `detectedType === 'http'` 或 `'mixed'`：全部显示

textarea 下方显示 `NTag`，标注当前检测结果。

### 4.4 分类联动

选分类时，若分类有 dir 则自动填充 dir 字段（复用 AddUrlBar M4a 的 watch 模式）：

```ts
watch(selectedCategory, id => {
  if (!id) return
  const cat = cats.getCategory(id)
  if (cat && cat.dir) dir.value = cat.dir
})
```

### 4.5 Options 构造

```ts
function buildOptions(): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    dir: dir.value.trim() || props.defaultDir
  }
  if (detectedType.value !== 'bt') {
    if (filename.value.trim() && urlList.value.length === 1) opts.out = filename.value.trim()
    opts.split = String(split.value)
    opts['max-connection-per-server'] = String(maxConnPerServer.value)
  }
  if (proxy.value.trim()) opts['all-proxy'] = proxy.value.trim()
  return opts
}
```

**注意：** 多 URL 时 filename 仅对单 URL 有意义。当 `urlList.length > 1` 时，filename 不附加到 options（避免所有文件同名）。

### 4.6 批量提交流程

```
1. urlList = parse textarea → trim → filter empty
2. if empty → message.warning('请输入至少一个链接')，return
3. submitting = true
4. options = buildOptions()
5. success = 0, errors: string[] = []
6. for (url of urlList):
   - try: await c.addUri([url], options); success++
   - catch: errors.push(`${url}: ${e}`)
7. submitting = false
8. 结果反馈:
   - errors.length > 0 → message.error(`${success} 成功，${errors.length} 失败：${errors.join('; ')}`)
   - 全成功 → message.success(`已添加 ${success} 个任务`)
9. emit('update:show', false)
10. emit('submitted')
```

- `addUri` 逐个 await（不并行），避免 aria2 提交顺序问题
- 单个失败不中断后续提交
- loading 期间禁用关闭按钮和提交按钮

### 4.7 表单重置

关闭 modal 时重置所有字段：

```ts
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
})
```

### 4.8 UI 布局

```
┌─ NModal preset="card" title="新建任务" width=600px ──────────┐
│                                                               │
│  NInput textarea: 粘贴链接，每行一个                           │
│  type="textarea" :rows="4"                                    │
│                                                               │
│  NTag: HTTP / BT / 混合（根据 detectedType）                   │
│                                                               │
│  NCollapse v-model:expanded-names="expandedNames">              │
│    NCollapseItem title="高级设置" name="advanced"              │
│      分类: NSelect (categoryOptions)                           │
│      目录: NInput + NButton「浏览」                            │
│      文件名: NInput (v-if="detectedType !== 'bt'")            │
│      分块: NInputNumber (v-if="detectedType !== 'bt'")        │
│      连接数: NInputNumber (v-if="detectedType !== 'bt'")      │
│      代理: NInput                                             │
│    </NCollapseItem>                                           │
│  </NCollapse>                                                 │
│                                                               │
│  Footer: NButton「取消」  NButton type="primary"「开始下载」   │
│                   :loading="submitting" @click="submit"      │
└───────────────────────────────────────────────────────────────┘
```

## 5. 测试策略

### 5.1 测试清单

| # | 测试名 | 验证点 |
|---|--------|--------|
| 1 | renders textarea and submit button | 基本渲染：textarea 存在，按钮存在 |
| 2 | detects HTTP type from url | 单行 http URL → NTag 显示 HTTP |
| 3 | detects BT type from magnet | magnet: URL → NTag 显示 BT |
| 4 | detects mixed type | http + magnet → NTag 显示混合 |
| 5 | hides BT-irrelevant fields when magnet | filename/split/connPerServer 不可见 |
| 6 | shows all fields for HTTP | 所有高级字段可见 |
| 7 | submits single HTTP url with correct options | addUri 调用一次，参数含 dir/split/max-connection-per-server |
| 8 | submits multiple urls in batch | addUri 调用 N 次 |
| 9 | skips empty lines in textarea | 空行不触发 addUri |
| 10 | warns when textarea is empty | 空提交 → message.warning，addUri 不调用 |
| 11 | resets form on close | 关闭后再打开，字段为默认值 |
| 12 | category select fills dir | 选分类后 dir 自动填充 |

### 5.2 测试约束

- 需要 Provider wrapper（`NConfigProvider > NMessageProvider > NDialogProvider`），因 modal 使用 `useMessage`
- mock aria2 client（`addUri` → `vi.fn().mockResolvedValue('gid')`）
- NModal 内容可能 teleport 到 `document.body`，测试用 `document.body.textContent` 或 `wrapper.html()` 检查

## 6. 现有代码影响

### 6.1 TopBar.vue

- 新增 `NButton`「+」按钮
- `defineEmits` 新增 `'new-task': []`
- 无破坏性变更

### 6.2 TaskListView.vue

- 新增 `import NewTaskModal`
- 新增 `const newTaskShow = ref(false)`
- TopBar 标签新增 `@new-task="newTaskShow = true"`
- 模板新增 `<NewTaskModal ...>`
- 无破坏性变更

### 6.3 AddUrlBar.vue

- 不变

### 6.4 RPC Client

- 不变（复用现有 `addUri`）

## 7. 实现方案

采用**方案 A：自包含 Modal**。`NewTaskModal.vue` 包含所有表单状态、类型检测和提交逻辑。不引入额外 composable 或 store。

理由：
- 类型检测是一个 `startsWith` 检查，批量提交是一个 `for` 循环，复杂度不足以需要独立抽象
- 遵循现有 SettingsModal 模式（自包含、props/emits 驱动）
- 如果后续 M4c/M4d 需要类似逻辑，按 three-strikes 规则再提取
