# 全局 UI 美化 + 性能优化 + 转盘扁平极简重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为安科编辑器建立统一设计系统并重构全部页面布局，全项目替换 Lucide 图标，优化编辑器/列表性能，将转盘重新设计为扁平极简风格。

**Architecture:** 基于当前 `index.css` 的 CSS 变量作为唯一设计 token 源，以 CSS 工具类（而非新增 JS 组件）统一卡片/按钮/输入/骨架；lucide-react 图标组件统一尺寸与 stroke；转盘仅重写视觉层，保留数据模型与抽取算法。性能优化穿插逐页重构，编辑器高频回调最小化 setState。

**Tech Stack:** React 18、TypeScript、Vite 6、Zustand、lucide-react（^1.48.0 已装）、Tailwind、Vitest（happy-dom）。

---

## 阶段 0：前置验证基线

### Task 1: 建立测试/类型/构建基线

**Files:**
- 无（仅运行命令）

- [ ] **Step 1: 跑全量测试记录基线**

Run: `npm test`（沙箱若报 node_cache 写日志错误，改 `dangerouslyDisableSandbox:true`）
Expected: 774 通过 + 2 环境性失败（`electron/__tests__/e2e-real-file.test.ts` 缺桌面 `.anke.json` 文件，与代码无关）。

- [ ] **Step 2: 类型检查基线**

Run: `npx tsc --noEmit`（需 `dangerouslyDisableSandbox:true`）
Expected: 0 错误。

- [ ] **Step 3: 提交基线记录**

```bash
git add -A && git commit -m "chore: 记录阶段0前置验证基线"
```

---

## 阶段 1：全局设计系统（子工程 1 基础）

### Task 2: 统一设计 token 与通用 UI 工具类

**Files:**
- Modify: `src/index.css`
- Test: `src/index.css`（无独立测试；依赖浏览器/构建验证）

**内容：** 在 index.css 的 `:root`/`[data-theme='dark']` 已有 tokens 基础上，补齐通用类（`.anke-card`, `.anke-btn`, `.anke-input`, `.anke-page-header`），并保证既有 `.anke-btn*`/`.anke-input` 语义不被破坏。

- [ ] **Step 1: 在 `.anke-input:focus` 后追加通用卡片/按钮/页头工具类**

在 `src/index.css` 文件「通用组件样式」区段末尾追加：

```css
/* ================================
   全局 UI 工具类（设计系统统一）
   ================================ */
.anke-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.anke-card:hover {
  box-shadow: var(--shadow-sm);
}
.anke-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-md);
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.anke-btn:hover { background: var(--bg-active); }
.anke-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.anke-btn-primary {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}
.anke-btn-primary:hover { background: var(--accent); color: var(--text-on-accent); }
.anke-btn-danger { color: var(--danger); }
.anke-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color 0.15s ease;
}
.anke-input:focus { border-color: var(--accent); }
.anke-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}
```

> 注意：`--danger` 已在亮/暗两主题中定义，可直接引用。

- [ ] **Step 2: 生产构建验证**

Run: `npm run build-web`
Expected: 构建成功，无报错。

- [ ] **Step 3: 提交**

```bash
git add src/index.css && git commit -m "feat(design): 全局UI工具类与设计token统一"
```

---

### Task 3: Lucide 图标映射工具（全项目替换基础设施）

**Files:**
- Create: `src/components/common/Icon.tsx`
- Modify: 沿用 `lucide-react`

**内容：** 提供统一图标出口，保证同一个语义映射全局复用（防止各页面自行拼写不同）。

- [ ] **Step 1: 编写 Icon 映射组件 + 测试**

Create `src/components/common/Icon.tsx`:

```tsx
import {
  ArrowLeft, ArrowRight, Bot, BookOpen, BookOpenText, Clock, Copy,
  Dices, Download, FerrisWheel, FileText, FolderOpen, PartyPopper,
  PenLine, RotateCcw, Save, ScrollText, Search, Target, Trash2, Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const MAP = {
  back: ArrowLeft,
  forward: ArrowRight,
  bot: Bot,
  book: BookOpen,
  bookText: BookOpenText,
  clock: Clock,
  copy: Copy,
  dices: Dices,
  download: Download,
  wheel: FerrisWheel,
  fileText: FileText,
  folder: FolderOpen,
  party: PartyPopper,
  pen: PenLine,
  refresh: RotateCcw,
  save: Save,
  scroll: ScrollText,
  search: Search,
  target: Target,
  trash: Trash2,
  upload: Upload,
} as const

export type IconName = keyof typeof MAP

export function Icon({
  name, size = 16, className,
}: { name: IconName; size?: number; className?: string }) {
  const Cmp: LucideIcon = MAP[name] ?? ArrowRight
  return <Cmp size={size} className={className} strokeWidth={2} aria-hidden="true" />
}
```

Create `src/components/common/Icon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon } from './Icon'

describe('Icon', () => {
  it('渲染指定名称的 svg 图标', () => {
    const { container } = render(<Icon name="dices" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
  it('未知名称回退到 ArrowRight', () => {
    const { container } = render(<Icon name={'nonexistent' as any} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run src/components/common/Icon.test.tsx`
Expected: 2 通过。

- [ ] **Step 3: 提交**

```bash
git add src/components/common/Icon.tsx src/components/common/Icon.test.tsx
git commit -m "feat(icon): 统一 Lucide 图标映射组件"
```

---

### Task 4: 页面骨架组件（页头 + 内容容器）

**Files:**
- Create: `src/components/common/PageScaffold.tsx`
- Test: `src/components/common/PageScaffold.test.tsx`

**内容：** 统一三要素骨架——页头（返回+标题+右侧操作）、内容容器、可选底栏。

- [ ] **Step 1: 编写 PageScaffold + 测试**

Create `src/components/common/PageScaffold.tsx`:

```tsx
import { ReactNode } from 'react'
import { Icon } from './Icon'

export function PageHeader({
  title, onBack, actions,
}: { title: ReactNode; onBack?: () => void; actions?: ReactNode }) {
  return (
    <div className="anke-page-header">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} aria-label="返回" className="anke-btn">
            <Icon name="back" size={14} />
          </button>
        )}
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full flex-1 flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div className="w-full max-w-4xl mx-auto px-4 py-4 md:px-6 md:py-6 flex flex-col gap-4 flex-1">
        {children}
      </div>
    </div>
  )
}
```

Create `src/components/common/PageScaffold.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader, PageContainer } from './PageScaffold'

describe('PageScaffold', () => {
  it('渲染标题与返回按钮', () => {
    const back = vi.fn()
    render(<PageHeader title="测试" onBack={back} />)
    expect(screen.getByRole('heading', { name: '测试' })).toBeTruthy()
    expect(screen.getByLabelText('返回')).toBeTruthy()
  })
  it('PageContainer 渲染子内容', () => {
    const { container } = render(<PageContainer><div>hello</div></PageContainer>)
    expect(container.textContent).toContain('hello')
  })
})
```

> 需要 `@testing-library/react` 已安装（当前项目编辑器测试已用它）；`react-dom/test-utils` 替代亦可。

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run src/components/common/PageScaffold.test.tsx`
Expected: 2 通过。

- [ ] **Step 3: 提交**

```bash
git add src/components/common/PageScaffold.tsx src/components/common/PageScaffold.test.tsx
git commit -m "feat(ui): 页面骨架组件 PageHeader/PageContainer"
```

---

## 阶段 2：逐页重构

### Task 5: 首页重构（HomePage）+ 加载性能

**Files:**
- Modify: `src/components/pages/HomePage.tsx`
- Test: 复用既有首页相关测试（如有）

**内容：**
- 按钮区 emoji 图标 → `<Icon>`（资源库`folder`/教程`bookText`/收集安价`scroll`/收集安科`book`/寻找安科`search`/玩骰子`dices`/玩转盘`wheel`/创作日志`pen`/新建`fileText`）。
- 统计卡片图标 📝/🎲/📚 → `pen`/`dices`/`book`。
- 最近作品行内图标 🕒📖🎲✏️ → `clock`/`bookText`/`dices`/`pen`（size 12）。
- 近期性能：`compute()` 中骰子统计从逐作品 `filter` 改为一次 `new Map(storyId→count)` 索引。

- [ ] **Step 1: 重构统计为一次 Map 索引 + 替换图标**

在 `src/components/pages/HomePage.tsx` 的 `compute()` 内，把「最近作品摘要」的 `diceCount: diceRecords.filter(...).length` 改为预建索引：

```tsx
// 一次索引：storyId -> 骰点记录数（替代逐作品 filter）
const diceCountByStory = new Map<string, number>()
for (const r of diceRecords) {
  diceCountByStory.set(r.storyId, (diceCountByStory.get(r.storyId) ?? 0) + 1)
}
```
然后摘要处改用 `diceCount: diceCountByStory.get(story.id) ?? 0`。

图标：导入 `Icon`，替换各按钮内 `<span>📚</span>` 等为 `<Icon name="bookText" size={16} />`（桌面端）或 `size={14}`（Capacitor）。统计卡片 `<span className="text-2xl">{stat.icon}</span>` 改为图标渲染。

- [ ] **Step 2: 构建 + 类型检查**

Run: `npx tsc --noEmit && npm run build-web`（tsc 需禁用沙箱）
Expected: 0 错误，构建成功。

- [ ] **Step 3: 全量测试**

Run: `npm test`（禁用沙箱）
Expected: 基线数量，无新增失败。

- [ ] **Step 4: 提交**

```bash
git add src/components/pages/HomePage.tsx
git commit -m "feat(home): 首页图标Lucide化 + 统计Map索引性能优化"
```

---

### Task 6: 作品列表页重构（WorksListPage）

**Files:**
- Modify: `src/components/pages/WorksListPage.tsx`

**内容：** 卡片改 `.anke-card` 骨架、em->Lucide 图标（`bookText`/`clock`/`dices`/`pen`/`trash`/`upload`/`download`），利用 `PageHeader`/`PageContainer`（若该页自带 header 注明不强行替换）。

- [ ] **Step 1: 重构列表卡片**

N/A（对该页既有卡片结构按 Task 5 同法替换图标 + 套 `.anke-card` 类，替换批次内联）。完成后构建 + tsc + 全测。

- [ ] **Step 2: 提交**

```bash
git add -A && git commit -m "feat(works): 作品列表页布局与图标统一"
```

---

### Task 7: 转盘三视图重构（子工程 4 主体，扁平极简）

**Files:**
- Modify: `src/components/wheel/WheelCanvas.tsx`
- Modify: `src/components/wheel/WheelPlayground.tsx`
- Modify: `src/components/wheel/SchemeEditor.tsx`
- Modify: `src/components/pages/WheelPage.tsx`

**内容：**
- `WheelCanvas`：去高饱和彩色板，改中性灰阶 `SECTOR_COLORS` = `['#6b7280','#9ca3af','#4b5563','#d1d5db','#374151']` 循环（弱交替），中奖扇区用 `var(--accent)` 高亮描边；去渐变/重阴影，保持 transform 旋转。
- `WheelPlayground`：按钮 🎲→`Dices`，结果卡片 `.anke-card`，完成界面 🎉→`party`、📋→`copy`、🔄→`refresh`；稍显扁平（弱化内联彩色背景）。
- `SchemeEditor`：🆙↓（视觉箭头改 lucide `ChevronUp/Down` 或保持文本箭头但套统一按钮类）、🗑→`trash`、💾→`save`；选项/阶段输入框改 `.anke-input`。
- `WheelPage`：🎡→`wheel`、🎯→`target`、📝→`fileText`、🤖→`bot`、🕒→`clock`、🎲→`dices`、✏️→`pen`、📤→`upload`、📥→`download`、📋→`copy`、🗑→`trash`、📜→`scroll`、🎉→`party`、🔄→`refresh`、←→`back`。空态大图标 📜/🎡 → `<Icon size={48}/>`。

- [ ] **Step 1: 重写 WheelCanvas 扇区配色为扁平灰阶 + 中奖高亮**

在 `src/components/wheel/WheelCanvas.tsx` 替换 `SECTOR_COLORS`：

```tsx
// 扁平极简：中性灰阶弱交替，中奖扇区用 --accent 高亮
const SECTOR_COLORS = ['#6b7280', '#9ca3af', '#4b5563', '#d1d5db', '#374151']
```
并将中奖 `path` 的 `stroke` 改为 `var(--accent)`、`strokeWidth` 加大到 4；文字色保持 `#fff`。

- [ ] **Step 2: WheelPage/WheelPlayground/SchemeEditor 图标与骨架统一**

按上述映射逐处替换 emoji → `<Icon ...>`，卡片套 `.anke-card`，输入框改 `.anke-input`。保持 onClick/state/逻辑不变。

- [ ] **Step 3: 构建 + 类型检查 + 全测**

Run: `npx tsc --noEmit && npm test`（禁用沙箱）
Expected: 0 错误，基线数量。

- [ ] **Step 4: 浏览器/逻辑验证**

用 `npm run build-web` + `npx vite preview`，进入 首页→玩转盘→新建方案→加阶段方式 验证抽取动画与结果；确认无 React 错误。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(wheel): 转盘扁平极简重设计 + 全图标Lucide化"
```

---

### Task 8: 资源库/教程/收集/阅读/骰子页图标与骨架统一

**Files:**
- Modify: `src/components/pages/ResourceLibraryPage.tsx`
- Modify: `src/components/pages/TutorialPage.tsx`
- Modify: `src/components/pages/AnjiaCollectPage.tsx`
- Modify: `src/components/pages/AnkeCollectPage.tsx`
- Modify: `src/components/pages/ReaderPage.tsx`（仅工具图标层，不动 BBCode 注入结构）
- Modify: `src/components/pages/DicePlaygroundPage.tsx`
- Modify: `src/components/common/WorkCard.tsx`

**内容：** 逐文件将可见 emoji/文本图标替换为 `<Icon>`（映射同前），卡片/输入框套统一类。**禁止改动 `ngaBBCodeToHtml.ts`/`ngaHtmlToBBCode.ts` 及 contenteditable 注入的 DOM 结构**（BBCode 回归保护）。

- [ ] **Step 1: 逐文件替换**

对每个 `Modify` 文件重复：引入 `Icon`，替换可见 emoji，卡片/输入统一类。改完一个文件即跑一次 `npx tsc --noEmit`。

- [ ] **Step 2: 全量测试 + 构建**

Run: `npm test && npm run build-web`（禁用沙箱）
Expected: 基线数量，构建成功。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat(ui): 资源库/教程/收集/阅读/骰子页图标与布局统一"
```

---

## 阶段 3：性能专项

### Task 9: 编辑器流畅度（最小化高频 setState / 局部操作）

**Files:**
- Modify: `src/editor/*` 中内容键入/光标相关（`selection.ts`, `commands.ts` 若有高频 setState）
- Modify: `src/components/pages/EditorPage.tsx`（若 onInput/onSelectionChange 触发全量状态）

**内容：**
- 检查 `onInput`/光标 handler：若每次都 `setContent(...)` 全量重建导致卡顿，改为仅更新字数等必要最小状态；文本内容交由 contenteditable 自身维护，页面级 setContent 仅在失焦/保存时同步。
- 对高频 `onSelectionChange` 做去抖（如 80ms）。

- [ ] **Step 1: 定位高频 setState**

Grep `setContent|onSelectionChange|onInput` in `src/components/pages/EditorPage.tsx` 与 `src/editor`，标注每次击键即触发全量 `setContent` 的位置。

- [ ] **Step 2: 最小化状态更新**

对全量 `setContent` 调用：若属「实时同步备份」而非渲染必需，改为 debounce（`useRef` 存 timer，80ms），或只在 `onBlur`/显式保存时同步。渲染级必需状态保持即时。

- [ ] **Step 3: 全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`（禁用沙箱）
Expected: 基线数量，0 错误。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "perf(editor): 高频输入回调debounce,减少全量setState"
```

---

### Task 10: 首页/列表加载复核（图片懒加载 + 记忆化）

**Files:**
- Modify: `src/components/pages/ResourceLibraryPage.tsx`（图片 `loading="lazy"`）
- Modify: `src/components/common/WorkCard.tsx`（React.memo + 稳定 key）

**内容：**
- 图库图片加 `loading="lazy"` + `decoding="async"`。
- 列表子项 `memo` 包裹，key 用稳定 id。首页统计的 Map 索引已在 Task 5 完成。

- [ ] **Step 1: 实现懒加载 + memo**

对图片标签添加 `loading="lazy" decoding="async"`；对 `WorkCard` 导出包 `React.memo`。

- [ ] **Step 2: 全测 + 构建**

Run: `npm test && npm run build-web`（禁用沙箱）
Expected: 基线数量，构建成功。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "perf(list): 图库图片懒加载 + 列表子项memo化"
```

---

## 阶段 4：全量验收

### Task 11: 回归验收 + 浏览器实测

- [ ] **Step 1: 全量测试 + tsc**

Run: `npm test && npx tsc --noEmit`（禁用沙箱）
Expected: 基线数量（774 + 2 环境性），0 错误。

- [ ] **Step 2: 生产构建**

Run: `npm run build-web`
Expected: 成功。

- [ ] **Step 3: 浏览器逐页实测**

Run: `npx vite preview --port 5174`，验证首页/作品列表/资源库/转盘/骰子等页面布局、图标渲染、转盘抽取动画。用 chrome-devtools 检查无 React 控制台错误。
Expected: 无报错、布局不破碎、暗色模式正常。

- [ ] **Step 4: 提交收尾**

```bash
git add -A && git commit -m "chore: 阶段4全量验收通过"
```

---

## Self-Review

1. **Spec 覆盖**：
   - 子工程1（设计系统+骨架）→ Task 2/4，逐页布局 → Task 5–8。
   - 子工程2（图标）→ Task 3 基建 + Task 5–8 落地。
   - 子工程3（性能：编辑器 + 首页/列表）→ Task 5（Map 索引）、Task 9（编辑器）、Task 10（懒加载/memo）。
   - 子工程4（转盘扁平极简）→ Task 7。
   - 验收 → Task 11。全部覆盖，无遗漏。
2. **占位符检查**：Task 6/8 存在「批次内联替换」描述而非完整代码——因这些文件较大且操作为机械图标替换，按 Task 5/7 给出精确映射表与统一规则；无 "TBD/TODO"。Task 9 Step 1 标为「定位」属调查步骤（有精确 grep 命令），非占位实现。
3. **类型一致性**：`IconName`（Task 3 定义）在 Task 5–8 复用；`Icon(name, size)` props 一致；`PageHeader`/`PageContainer`（Task 4）在 Task 6 复用。命名无冲突。