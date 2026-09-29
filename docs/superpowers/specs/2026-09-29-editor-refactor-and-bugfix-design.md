# 架构重构 + 6 大 Bug 修复 + UI 升级 设计方案

> 项目：安科作者助手（AnkeCreator）React + Zustand + Vite + Electron + Capacitor
> 日期：2026-09-29
> 状态：已与用户确认范围，待用户审阅

## 1. 目标与成功标准

本次改动分为三个阶段，按优先级依次执行：

1. **架构重构**（优先）：拆分巨型文件，让编辑器逻辑可维护、可测试，且行为完全不变（零回归）。
2. **Bug 修复**（次之）：修复用户反馈的 6 个高频问题（kh/kl、空格、骰子丢失、BBCode 缺漏/错位、折叠框选），并深度排查 BBCode 相关遗漏场景。
3. **UI 升级**（最后）：编辑器/骰子/折叠 + 全局视觉统一 + 图标升级（Lucide React）。

成功标准：
- 拆分后所有现有测试通过（`npm test`），无行为回归。
- 6 个用户反馈 bug 全部修复并可复现验证。
- 骰子记录删除作品后不再丢失，可在历史入口分组查看。
- UI 视觉统一，图标替换为 Lucide。
- 全部改动经 TDD 覆盖关键逻辑。

## 2. 架构重构

### 2.1 背景问题

`src/components/editor/contenteditableUtils.ts` 约 210KB、8000+ 行，混合了大量职责：
- 块级命令（exec/undo/redo/removeFormat/对齐/列表）
- 内联样式操作（颜色/字号/字体/b/i/u/s/sup/sub + span 包装去重）
- 图片块（插入/缩放/错误处理）
- 骰子卡（payload 读写/渲染/事件绑定）
- 折叠块（插入/删除/展开折叠/拖动/框选）
- 选区与光标工具（markers/range）
- 链接、表格、代码块、引用块等

### 2.2 拆分方案

新建 `src/editor/` 目录，按职责拆分（逻辑层；组件层 `RichTextEditor.tsx` 与 store 层不动）：

| 新模块 | 职责 | 提取的主要导出 |
|---|---|---|
| `editor/commands.ts` | 块级命令 | exec, execUndo, execRedo, execRemoveFormat, execInsertHorizontalRule, execInsertOrderedList, execInsertUnorderedList, setBlockAlign, isCommandActive 等 |
| `editor/inlineStyle.ts` | 内联样式 | applyInlineStyle, removeInlineStyle, applyColor, applyFontSize, applyFontFamily, applyActiveStylesToRange, applyActiveStylesToInsertion, 各 isBoldActive/isItalicActive 等 + span 包装/去重工具 |
| `editor/imageBlock.ts` | 图片块 | insertImageBlock, selectImageBlock, setImageBlockSize, attachImageBlockHandlers, attachImageErrorHandler 等 |
| `editor/diceCard.ts` | 骰子卡 | insertDiceCard, updateDiceBlock, removeDiceCard, rollDiceOnCard, renderDiceCard, get/setDicePayload, attachDiceCardHandlers, scrollToDiceCard, isDiceCardInEditor |
| `editor/collapseBlock.ts` | 折叠块 | insertCollapseBlock, removeCollapseBlock, attachCollapseBlockHandlers, insertQuoteBlock 等 |
| `editor/selection.ts` | 选区工具 | insertMarkersAtRange, restoreSelectionFromMarkers, splitElementAtRange, getSelectionRangeIn, focusEditor, setLastEditorRange, getInsertionPoint |
| `editor/utils.ts` | 共享工具 | 常量（各 SELECTOR）、BLOCK_TAGS、公共类型、通用 DOM 遍历工具 |

其他工具函数抽取到已有 utils（`diceEngine.ts`、`ngaHtmlToBBCode.ts`）或新建 `editor/dom.ts` 存放。

### 2.3 导入兼容

- `src/editor/index.ts` 统一 `export *`，`RichTextEditor.tsx`、`contenteditableUtils.test.ts` 的现有导入路径改为指向新模块。
- `contenteditableUtils.ts` 保留为薄壳或删除，取决于是否有其它文件直接导入。需用 Grep 确认全部导入来源后决定。

### 2.4 回归保障

- 拆分是"机械移动 + 保持签名不变"，不改变任何实现逻辑。
- 依赖 `src/components/editor/contenteditableUtils.test.ts` 等现有测试作为基线，拆分后 `npm test` 必须通过。
- 拆分期间改一处跑一次测试，确保 `contenteditableUtils.ts` 行为等效。

## 3. Bug 修复

### 3.1 kh/kl 不生效（根因已确认）

**根因**：[diceEngine.ts](src/utils/diceEngine.ts) `parsePrimary()`（约 L220-L223）把 dice token 构造为 AST 节点时，只传了 `count` 和 `faces`，丢弃了 `mode/keep/threshold`。因此 `1d100kh2`、`1d100kl1` 在求值阶段 `<dice>` 分支走默认求和。

**修复**：`parsePrimary()` 中 dice 分支将 `mode/keep/threshold` 一并传给 `{type:'dice'}` 节点，使 `evaluateAst` 能正确进入 kh/kl 分支。

**验证**：
- 单测：`rollExpression("4d6kh3")` 值为 keep 高 3 颗之和；`4d6kl2` 为 keep 低 2 颗之和。
- 表达式预览 `parseDiceExpression` 也应显示 `kh/kl` 后缀。

### 3.2 编辑时打不了空格（根因已确认）

**根因**：[RichTextEditor.tsx](src/components/editor/RichTextEditor.tsx) `onBeforeInputNative`（约 L496-L542）在 `activeStylesLocked` 且无样式时，对 `insertText`（含空格）调用 `applyActiveStylesToInsertion`，若返回 `false` 仍会走到 `e.preventDefault()` 阻断默认插入（v9 注释提到要防，但空格场景仍可能被拦）。

**修复**：
- 空格（`e.data === ' '`）始终放行，不接管、不 `preventDefault`。
- 重构接管逻辑：**仅当 `applyActiveStylesToInsertion` 返回 `true` 才 `preventDefault`**；返回 `false` 时放行浏览器默认插入。
- 增加对纯空白文本的豁免（`e.data` 全为空白则直接放行）。

**验证**：
- 测试：锁定样式状态下输入空格不会被阻断；正常文字输入仍被接管并应用样式。
- 手动：编辑器任意位置可输入空格。

### 3.3 导入再导出骰子丢失（根因相关）

**根因**：[WorksListPage.tsx](src/components/pages/WorksListPage.tsx) 导入流程（约 L756-L766）把 `dice_history` 记录写入时：
- `id` 重置为空、`sectionId` 经 `sectionIdMap` 映射，缺失时写空。
- 采用 `addRecords` 的 FIFO 裁剪（200 条），多次导入同一作品会重复/覆盖。
- 且 `diceHistoryStore` 按 storyId 关联，删除作品时级联清除，导致"导出的记录跟着作品被删/丢失"。

**修复**（结合 3.5 归档设计）：
- 导入时**保留原记录 id**（避免重复导入去重冲突时无法识别），`sectionId` 映射失败时保留原值而非清空。
- `addRecords` 增加按 `(id)` 去重，避免重复导入堆积。
- 删除作品不再物理清除骰子记录，改为软删除归档（见 3.5）。

**验证**：
- 同一作品导出→删除→再导入，骰子记录完整保留。
- 单测覆盖去重与 id 保留。

### 3.4 BBCode 缺漏/断点 + 3.5 骰子错位（根因相关）

**根因**：
- [ngaHtmlToBBCode.ts](src/utils/ngaHtmlToBBCode.ts) 的 `collapseBbCode`（L219-L253）与 `unwrapDeepRedundant` 等大量正则清洗，在多层嵌套样式（如折叠块内含骰子卡 + 引用）时可能误吞正文；`stripOrphanCloseTags` 统计开闭标签数，若正文含字面 `[xxx]` 会误删闭标签造成"断在某个地方"。
- 骰子以 `[quote]`/`[collapse]` 输出，若外层还有引用/折叠包裹，`processBlockChildren` 的块序输出可能导致位置错位。

**修复**：
- 收紧正则清洗：**只在"层级受保护"时合并/去重**，避免把含子块的容器整体误清；为嵌套块（collapse/quote/code）提前"占位隔离"，清洗后再还原，防止正文被误吞。
- `stripOrphanCloseTags` 改为**识别被引用/折叠包裹的整块后再决定**，不再仅靠全局计数。
- 骰子卡：转换时严格按 DOM 顺序输出，确保骰子位置与视觉一致。
- 深度排查 BBCode↔HTML 往返：补充回环测试（视觉→BBCode→视觉 内容层级不丢）。

**验证**：
- 单测：含折叠+骰子的内容往返 BBCode，正文不丢、骰子位置正确、无断点。
- 现有 `ngaHtmlToBBCode.test.ts` 全部通过。

### 3.6 折叠框选 BUG（根因已确认区域）

**根因**：[contenteditableUtils.ts](src/components/editor/contenteditableUtils.ts) `attachCollapseBlockHandlers`（L4728-L4990）中，`onMouseDown`/`clearCollapseSelection` 与文本选中有冲突；折叠块 `contenteditable` 属性与整块 `draggable` 切换易导致框选断裂、显示错误。

**修复**：
- 重组 `onMouseDown`：点击折叠块 title 允许正常编辑；点击 body 文本不拦截选中；仅点击 head 空白/把手才处理选中。
- 拖动把手与文本选中彻底隔离（拖动把手 `contenteditable=false` + `userSelect=none`，已部分实现，补齐边界）。
- 修复展开/折叠状态切换导致的 DOM 显示错乱（`data-collapsed` 与 `display:none` 不同步问题）。
- 拆分后在 `collapseBlock.ts` 内重构该逻辑。

**验证**：
- 手动：折叠块内可框选文本、可拖动、可删除、展开折叠状态正确。
- 单测覆盖折叠块选择/删除关键路径。

## 4. 骰子记录归档（不改页）

**方案**：删除作品时不再物理清除骰子记录，改为软删除归档，历史入口分组展示。

### 4.1 store 改动
- [diceHistoryStore.ts](src/store/diceHistoryStore.ts)：`DiceHistoryRecord` 增加 `isArchived?: boolean`。
- 新增 `archiveByStory(storyId)`：把该作品所有记录置 `isArchived=true`（替代 delete 派生的 `clearByStory`）。
- `clearByStory` 保留供"真正清空归档"使用（可由用户主动操作）。

### 4.2 分组展示
- 历史入口（HomePage / 相关骰子历史面板）增加 tab 或折叠组："当前作品" / "已删除作品"。
- 默认仅当存在 `isArchived=true` 记录时展示"已删除作品"分组。
- 已归档记录仍可查看、可手动清除。

### 4.3 导出/导入
- 导出 `dice_history` 时含 `isArchived` 字段；导入保留。

**验证**：
- 删除作品 → 骰子记录仍在"已删除作品"分组可见。
- `clearByStory` 不再在删除作品链路被调用（[storyStore.ts](src/store/storyStore.ts) L300-301 改为调 `archiveByStory`）。

## 5. UI 升级

### 5.1 编辑器/骰子/折叠
- 编辑器工具栏：统一图标（Lucide）、hover/激活态视觉、分组间距。
- 骰子卡：卡片化样式（圆角/阴影/配色/滚动结果动效），与整体视觉语言一致。
- 折叠块：head 视觉（展开/折叠图标用 Lucide Chevron），body 过渡动画，拖动手柄可见性优化。

### 5.2 全局视觉统一
- 统一 CSS 变量体系（`index.css` 现有 `--bg-*`/`--text-*`/`--border-color`），补全圆角/阴影/间距 token。
- 卡片、列表、弹窗、按钮统一样式；暗色模式校对。

### 5.3 图标升级（Lucide React）
- 新增依赖 `lucide-react`。
- 将工具栏、按钮、封面、各处 Unicode/emoji 图标替换为 Lucide 组件（按需引入）。
- 保持图标语义不变，仅视觉升级。

> 说明：本阶段 UI 升级在架构+bug 完成后再实施，避免在重构过程中叠加视觉变更带来不确定性。

## 6. 依赖与边界

- 新增依赖：`lucide-react`（仅 UI 阶段）。
- 除非必要，不新增其它依赖；拆分仅移动代码。
- 不改动用户预设模板、不改数据库 schema（除 diceHistory 的 isArchived 字段）。

## 7. 测试策略

- 全程 TDD：每个 bug 修复先写失败测试，再实现。
- 拆分阶段：以现有测试为回归基线。
- 新增：`diceEngine.khkl.test.ts`、`diceHistoryStore.archive.test.ts`、`ngaHtmlToBBCode.roundtrip.test.ts`、`collapseBlock.test.ts`。
- 手动清单：空格输入、骰子 kh/kl、导入导出丢骰子、BBCode 往返、折叠框选、删除作品看归档。

## 8. 实施顺序

1. 架构拆分（editor/ 模块化）→ 回归通过
2. Bug：kh/kl → 空格 → 骰子丢失/归档 → BBCode 缺漏/错位 → 折叠框选
3. 骰子归档 UI（历史分组）
4. UI 升级（Lucide 图标 → 编辑器/骰子/折叠 → 全局视觉）
5. 全量 `npm test` + 手动验证清单