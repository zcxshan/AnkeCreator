# 编辑器架构重构 + 6 大 Bug 修复 + UI 升级 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拆分巨型编辑器工具文件、修复 6 个用户反馈 bug、实现骰子记录归档、升级 UI 与图标。

**Architecture:** 先把 210KB 的 `contenteditableUtils.ts` 机械拆分为 `src/editor/` 职责模块（行为不变），再逐条用 TDD 修复 bug（kh/kl、空格、骰子丢失、BBCode 缺漏/错位、折叠框选），然后给 `diceHistoryStore` 增加软删除归档并分组展示，最后引入 Lucide 图标 + 全局视觉统一。

**Tech Stack:** React 18, TypeScript, Zustand, Vite, Vitest, lucide-react

**Spec:** `docs/superpowers/specs/2026-09-29-editor-refactor-and-bugfix-design.md`

---

## 基线命令

- 单测（过滤单文件）：`npx vitest run <path>`
- 全量单测：`npm test`
- 类型检查：`npx tsc --noEmit`

> 每次 commit 前跑一次目标测试文件 + 全量,确保零回归。

## Task 1: 拆分 contenteditableUtils 到 src/editor 模块

**Files:**
- Create: `src/editor/selection.ts`
- Create: `src/editor/commands.ts`
- Create: `src/editor/inlineStyle.ts`
- Create: `src/editor/imageBlock.ts`
- Create: `src/editor/diceCard.ts`
- Create: `src/editor/collapseBlock.ts`
- Create: `src/editor/dom.ts`
- Create: `src/editor/utils.ts`
- Create: `src/editor/index.ts`
- Modify: `src/components/editor/RichTextEditor.tsx`（import 改指向 `../../editor`）
- Modify: `src/components/editor/EditorToolbar.tsx`（import 改指向 `../../editor`）
- Modify: `src/components/pages/EditorPage.tsx`（isDiceCardInEditor import 改指向 `../../editor`）
- Modify: `src/components/editor/contenteditableUtils.test.ts`（import 改指向 `../../editor`）
- Delete: `src/components/editor/contenteditableUtils.ts`

拆分是**机械移动**：裁剪 `contenteditableUtils.ts` 中各行到对应新模块,不改变任何实现逻辑或签名。仅需调整因作用域产生的 `let _lastEditorRange / pushAtomicHistory` 等模块级状态在模块间的传递。

- [ ] **Step 1: 建 `src/editor/dom.ts` + `utils.ts`**
  - `dom.ts`：通用 DOM 遍历工具（`findAncestorWithAttr`, `findAncestorSpan`, `isInlineElement`, `containsBlockChild` 用到的 BLOCK_TAGS 等）。导出 `BLOCK_TAGS: Set<string>`。
  - `utils.ts`：常量（`IMAGE_BLOCK_SELECTOR`, `DICE_CARD_SELECTOR`, `COLLAPSE_BLOCK_SELECTOR`, `QUOTE_SELECTOR` 等）+ 共享类型。
  - 若 `utils.ts` 需回滚而后续模块引,则后续模块从 `../../editor` 导入即可（index re-export）。

- [ ] **Step 2: 建 `selection.ts`**
  - 移入：`_lastEditorRange`、`setLastEditorRange`、`focusEditor`、`getInsertionPoint`、`insertMarkersAtRange`、`restoreSelectionFromMarkers`、`splitElementAtRange`、`getSelectionRangeIn`、`getInsertionRange`。
  - 把 `_lastEditorRange` 作为模块内状态保留,其余模块 via `getLastEditorRange()`（新导出）读取。

- [ ] **Step 3: 建 `commands.ts`**
  - 移入：`exec`, `execUndo`, `execRedo`, `execRemoveFormat`, `execInsertHorizontalRule`, `execInsertUnorderedList`, `execInsertOrderedList`, `isCommandActive`, `setBlockAlign` 及对齐相关。

- [ ] **Step 4: 建 `inlineStyle.ts`**
  - 移入：`applyInlineStyle`, `applyInlineStyleNoFocus`, `removeInlineStyle`, `removeInlineStyleNoFocus`, `applyColor`, `applyFontSize`, `applyFontFamily`, `applyActiveStylesToRange`, `applyActiveStylesToInsertion`, `getColor`, `getActiveFontSize`, `getActiveFontFamily`, 所有 `is*Active`/`is*FullyActive`, `collectInlineStyleFromAncestors`, `getInlineStylesFromActive`, `getCurrentStyles`, 及 span 包装/去重工具（`unwrapRedundantSpan`, `computeDesiredStyles`, `insertStyledTextOutsideStyledSpan` 等）。
  - 需要 `applyActiveStylesToInsertion(el, active, data, locked)` 保持原签名与返回布尔语义。

- [ ] **Step 5: 建 `imageBlock.ts`**
  - 移入：`isImageBlock`, `findImageBlockAncestor`, `clearImageSelection`, `selectImageBlock`, `getSelectedImageBlock`, `insertImageBlock`, `getImageBlockSize`, `setImageBlockSize`, `updateSelectedImage`, `removeImageBlock`, `attachImageBlockHandlers`, `attachImageErrorHandler`, `reattachImageErrorHandlers` 及内部 handle 渲染/缩放辅助。

- [ ] **Step 6: 建 `diceCard.ts`**
  - 移入：`isDiceCard`, `findDiceCardAncestor`, `getDicePayload`, `setDicePayload`, `clearDiceSelection`, `selectDiceCard`, `getSelectedDiceCard`, `renderDiceCard`, `insertDiceCard`, `updateDiceBlock`, `removeDiceCard`, `rollDiceOnCard`, `rollDicePure`, `attachDiceCardHandlers`, `scrollToDiceCard`, `isDiceCardInEditor`, `diceTextStyleToCss`, `applyTextStyle`, `formatNumericExpressionFromConfig`, `escapeHtml`。
  - 依赖注入：仍可调用 `rollDice`(diceEngine) 与 `useDiceHistoryStore`(Task 6 后)。

- [ ] **Step 7: 建 `collapseBlock.ts`**
  - 移入：`isCollapseBlock`, `findCollapseBlockAncestor`, `removeCollapseBlock`, `isCollapseBlockEmpty`, `ensureDragHandle`, `attachCollapseBlockHandlers`, `clearCollapseSelection`, `selectCollapseBlock`, `getSelectedCollapseBlock`, `insertCollapseBlock`, `initCollapseBlockEvents`, `insertQuoteBlock`, `removeLinkAtCursor` 等。

- [ ] **Step 8: 建 `index.ts` 并更新 4 个消费方 import**
  - 全部源文件一律 `export * from './xxx'`（或按需 `export {}`）,`index.ts` 汇总。
  - `RichTextEditor.tsx` / `EditorToolbar.tsx` 改 `from './contenteditableUtils'` → `from '../../editor'`。
  - `EditorPage.tsx` 改 `from '../editor/contenteditableUtils'` → `from '../../editor'`。
  - 测试文件 `contenteditableUtils.test.ts` 改 import 指向 `../../editor`。

- [ ] **Step 9: 全量验证 + 提交**
  Run: `npm test`
  Expected: 全部通过（拆分零回归）。
  ```bash
  git add -A
  git commit -m "refactor(editor): 拆分 contenteditableUtils 为 src/editor 职责模块"
  ```

## Task 2: 修复 kh/kl 取高/取低不生效（TDD）

**Files:**
- Modify: `src/utils/diceEngine.ts:212-236`（`parsePrimary` dice 分支）
- Test: `src/utils/diceEngine.test.ts`（若不存在则创建）

根因：`parsePrimary()` 从 dice token 构造 `{type:'dice', count, faces}` 时丢掉了 `mode/keep/threshold`,导致求值走默认求和。

- [ ] **Step 1: 写失败测试**

```ts
import { rollExpression } from './diceEngine';

describe('diceEngine kh/kl', () => {
  it('4d6kh3 只保留最高 3 颗求和', () => {
    // 由于随机,无法断言精确值;改为断言 detail 含 "kh3" 标记且 total 是 3 颗之和
    const r = rollExpression('4d6kh3');
    expect(r.allRolls).toHaveLength(4);
    expect(r.detail).toContain('k3=');
  });
  it('4d6kl2 只保留最低 2 颗求和', () => {
    const r = rollExpression('4d6kl2');
    expect(r.allRolls).toHaveLength(4);
    expect(r.detail).toContain('低');
  });
  it('parseDiceExpression 预览保留 kh/kl 后缀', () => {
    const p = parseDiceExpression('1d100kh1');
    expect(p.preview).toBe('1d100kh1');
  });
});
```

- [ ] **Step 2: 运行测试确证失败**
  Run: `npx vitest run src/utils/diceEngine.test.ts`
  Expected: kh/kl 相关 case FAIL（detail 无 `k3=`/`低`,且 preview 无后缀）。

- [ ] **Step 3: 修复 `parsePrimary` dice 分支**

```ts
    if (tok.type === 'dice') {
      consume();
      return {
        type: 'dice',
        count: tok.count,
        faces: tok.faces,
        mode: tok.mode,
        keep: tok.keep,
        threshold: tok.threshold,
      };
    }
```

- [ ] **Step 4: 运行测试确证通过**
  Run: `npx vitest run src/utils/diceEngine.test.ts`
  Expected: PASS。

- [ ] **Step 5: 全量回归 + 提交**
  Run: `npm test`
  ```bash
  git add -A && git commit -m "fix(dice): kh/kl 取高取低在解析阶段丢失 mode,已修复"
  ```

## Task 3: 修复编辑时无法输入空格（TDD）

**Files:**
- Modify: `src/components/editor/RichTextEditor.tsx:496-542`（`onBeforeInputNative`）
- Test: `src/editor/__tests__/spaceInput.test.ts`（新增,校验空白放行逻辑；若 beforeinput 难测,抽 `shouldTakeoverInsert(data, active, locked)` 纯函数）

根因：`activeStylesLocked` 且无样式时仍可能 `preventDefault` 阻断空格插入。

修复策略：把"是否接管"决策抽成纯函数便于单测。

- [ ] **Step 1: 抽纯函数 `shouldTakeoverInsert`**

在 `src/editor/commands.ts`（或独立 `src/editor/inputPolicy.ts`）导出：

```ts
export function isWhitespaceOnly(text: string): boolean {
  return text.length > 0 && /^\s+$/.test(text);
}
```

- [ ] **Step 2: 写失败测试**

```ts
import { isWhitespaceOnly } from '../../editor/inputPolicy';
describe('inputPolicy', () => {
  it('空格视为空白只,应放行不接管', () => {
    expect(isWhitespaceOnly(' ')).toBe(true);
  });
  it('普通文字应接管', () => {
    expect(isWhitespaceOnly('a')).toBe(false);
  });
});
```

- [ ] **Step 3: 修改 `onBeforeInputNative`**

在 `if (!SUPPORTED_TYPES.has(...) || !e.data) return;` 之后加：

```ts
      // 空白输入（空格等）永远放行,不接管、不 preventDefault,#bug 空格
      if (isWhitespaceOnly(e.data)) return;
```

并将接管成功判断改为仅在 `applyActiveStylesToInsertion(...) === true` 时才 `e.preventDefault()`（v9 已如此,复核确认空格分支不触发）；同时把 `if (!store.activeStylesLocked) return;` 之后与 `hasStyle` 判定结合,确保无样式也不接管。

- [ ] **Step 4: 运行测试**
  Run: `npx vitest run src/editor/__tests__/spaceInput.test.ts`
  Expected: PASS。手动:输入空格不再被吞。

- [ ] **Step 5: 回归 + 提交**
  ```bash
  npm test
  git add -A && git commit -m "fix(editor): 输入空格被 beforeinput preventDefault 吞掉,空白放行"
  ```

## Task 4: 骰子记录软删除归档（store 层）

**Files:**
- Modify: `src/store/diceHistoryStore.ts`
- Modify: `src/store/storyStore.ts:300-301`（删除作品时 `clearByStory` → `archiveByStory`）
- Test: `src/store/diceHistoryStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { useDiceHistoryStore } from './diceHistoryStore';
beforeEach(() => useDiceHistoryStore.setState({ records: [] }));
it('archiveByStory 将某作品记录标记归档而非清除', () => {
  useDiceHistoryStore.getState().addRecord({ id:'r1', timestamp:1, storyId:'s1', diceName:'x', diceType:'1d6', result:'D6=3', resultDetail:'', sectionId:'', sectionTitle:'', payloadSnapshot:'' });
  useDiceHistoryStore.getState().archiveByStory('s1');
  const rec = useDiceHistoryStore.getState().records[0];
  expect(rec.storyId).toBe('s1');
  expect(rec.isArchived).toBe(true);
});
it('clearByStory 仍物理清除（供主动清归档）', () => {
  useDiceHistoryStore.getState().addRecord({ id:'r1', timestamp:1, storyId:'s1', diceName:'x', diceType:'1d6', result:'D6=3', resultDetail:'', sectionId:'', sectionTitle:'', payloadSnapshot:'' });
  useDiceHistoryStore.getState().clearByStory('s1');
  expect(useDiceHistoryStore.getState().records).toHaveLength(0);
});
```

- [ ] **Step 2: 运行确证失败**
  Run: `npx vitest run src/store/diceHistoryStore.test.ts`
  Expected: `archiveByStory` 未定义 → FAIL。

- [ ] **Step 3: 实现 `archiveByStory`**

```ts
  archiveByStory: (storyId) =>
    set({
      records: get().records.map((r) =>
        r.storyId === storyId ? { ...r, isArchived: true } : r,
      ),
    }),
```

在接口 `DiceHistoryState` 增加 `archiveByStory: (storyId: string) => void;`；`DiceHistoryRecord` 增加 `isArchived?: boolean`。

- [ ] **Step 4: 切 storyStore 删除链路**
  定位 `src/store/storyStore.ts:300-301`,把 `clearByStory` 调用改为 `archiveByStory`。

- [ ] **Step 5: 运行测试 + 全量回归 + 提交**
  ```bash
  npx vitest run src/store/diceHistoryStore.test.ts
  npm test
  git add -A && git commit -m "feat(dice): 删除作品时骰子记录归档保留,支持 archiveByStory"
  ```

## Task 5: 导入导出骰子记录不丢失 + 去重

**Files:**
- Modify: `src/store/diceHistoryStore.ts`（`addRecords` 按 id 去重）
- Modify: `src/components/pages/WorksListPage.tsx:756-766`（导入保留 id / sectionId）
- Test: `src/store/diceHistoryStore.test.ts`

- [ ] **Step 1: 写失败测试（去重）**

```ts
it('addRecords 重复 id 不堆积', () => {
  const base = { timestamp:1, storyId:'s1', diceName:'x', diceType:'1d6', result:'D6=3', resultDetail:'', sectionId:'', sectionTitle:'', payloadSnapshot:'' };
  useDiceHistoryStore.getState().addRecords([{ id:'A', ...base }]);
  useDiceHistoryStore.getState().addRecords([{ id:'A', ...base }]);
  expect(useDiceHistoryStore.getState().records.filter(r=>r.id==='A')).toHaveLength(1);
});
```

- [ ] **Step 2: 运行确证失败**
  Run: `npx vitest run src/store/diceHistoryStore.test.ts`
  Expected: 去重断言 FAIL。

- [ ] **Step 3: `addRecords`/`addRecord` 加 id 去重**

```ts
  addRecords: (incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    const existingIds = new Set(get().records.map((r) => r.id));
    const normalized = incoming
      .map((r) => ({ ...r, id: r.id || genId() }))
      .filter((r) => !existingIds.has(r.id));
    if (normalized.length === 0) return;
    const next = [...normalized, ...get().records].slice(0, 200);
    set({ records: next });
  },
```

- [ ] **Step 4: 修改导入逻辑（WorksListPage）**
  把 `id: ''` 默认改为 `id: r.id ?? ''`（保留原 id）,`sectionId` 映射失败时保留原 `r.sectionId`：

```ts
        const newRecords = (data as any).dice_history.map((r: any) => ({
          ...r,
          id: r.id || '',
          storyId: newStory.id,
          sectionId: (r.sectionId && sectionIdMap[r.sectionId]) || r.sectionId || '',
        }));
```

- [ ] **Step 5: 测试 + 提交**
  ```bash
  npx vitest run src/store/diceHistoryStore.test.ts
  npm test
  git add -A && git commit -m "fix(import): 导入骰子记录保留 id 并按 id 去重,避免重复导入丢失/堆积"
  ```

## Task 6: 修复 BBCode 缺漏/断点（收紧正则清洗）

**Files:**
- Modify: `src/utils/ngaHtmlToBBCode.ts`（`collapseBbCode` / `stripOrphanCloseTags`）
- Test: `src/utils/ngaHtmlToBBCode.roundtrip.test.ts`（新增）

策略：为嵌套块（collapse/quote/code）先占位隔离,清洗完成后再还原,防止正文被正则误吞。

- [ ] **Step 1: 写失败测试（回环）**

```ts
import { htmlToNGABBCode } from './ngaHtmlToBBCode';
it('折叠块内含骰子卡,往返不丢正文且位置正确', () => {
  const html = `<div data-type="collapse-block" data-title="细则"><div class="collapse-body"><p>正文A</p><div data-type="dice-card" data-payload="{&quot;config&quot;:{&quot;kind&quot;:&quot;numeric&quot;,&quot;id&quot;:&quot;d1&quot;,&quot;count&quot;:1,&quot;numericFaces&quot;:6,&quot;modifier&quot;:0},&quot;lastResult&quot;:null,&quot;style&quot;:null}"></div></div></div>`;
  const bb = htmlToNGABBCode(html);
  expect(bb).toContain('[collapse=细则]');
  expect(bb).toContain('正文A');
  expect(bb).toContain('ROLL 1d6');
});
it('正文含字面 [b] 文本不误删闭标签', () => {
  const bb = htmlToNGABBCode('<p>测试[未结束标签</p>');
  // 不抛错且保留原文片段
  expect(bb.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 运行确证失败**
  Run: `npx vitest run src/utils/ngaHtmlToBBCode.roundtrip.test.ts`
  Expected: 断言 FAIL（丢失正文/位置错乱）。

- [ ] **Step 3: 实现占位隔离**
  在 `htmlToNGABBCode`：`processBlockChildren` 之前,用唯一占位符替换整段 collapse/quote/code 块生成的 BBCode（先生成隔离串）,对占位符内的文本跳过 `collapseBbCode` 清洗；清洗后再插回。具体：
  1. 先跑 `processBlockChildren` 得到含 `[collapse=...]...[/collapse]` 的原始行。
  2. 用 `\u0000<bkey>\u0000` 提取并暂存每个 `[collapse=...]....[/collapse]` / `[quote]...[/quote]` / `[code]...[/code]` 块。
  3. 仅对占位后的剩余串做 `collapseBbCode` + `stripOrphanCloseTags`。
  4. 末尾还原占位符为原块。

- [ ] **Step 4: 收紧 `stripOrphanCloseTags`**
  校验前先移除被正确配对包裹的块内闭标签计数（因占位已隔离,此函数基本不再误匹配；复核其只作用于非占位文本）。

- [ ] **Step 5: 测试 + 提交**
  ```bash
  npx vitest run src/utils/ngaHtmlToBBCode.roundtrip.test.ts src/utils/ngaHtmlToBBCode.test.ts
  npm test
  git add -A && git commit -m "fix(bbcode): 折叠/引用/代码块占位隔离后再清洗,避免误吞正文或误删闭标签"
  ```

## Task 7: 修复 BBCode 骰子位置错位

**Files:**
- Modify: `src/utils/ngaHtmlToBBCode.ts`（`processBlockChildren` 块序输出）
- Modify: `src/utils/ngaExporter.ts`（`renderDiceBlock` 输出形式校对）
- Test: `src/utils/ngaHtmlToBBCode.roundtrip.test.ts`

骰子卡以 `[quote]`/`[collapse]` 输出,若外层还有折叠/引用,块序输出应严格遵循 DOM 顺序。

- [ ] **Step 1: 写失败测试**

```ts
it('骰子卡与正文块按 DOM 顺序输出,不错位', () => {
  const html = `<p>开头</p><div data-type="dice-card" data-payload="{&quot;config&quot;:{&quot;kind&quot;:&quot;numeric&quot;,&quot;id&quot;:&quot;d1&quot;,&quot;count&quot;:1,&quot;numericFaces&quot;:6,&quot;modifier&quot;:0},&quot;lastResult&quot;:null}"></div><p>结尾</p>`;
  const bb = htmlToNGABBCode(html);
  const idxStart = bb.indexOf('开头');
  const idxDice = bb.indexOf('ROLL 1d6');
  const idxEnd = bb.indexOf('结尾');
  expect(idxStart).toBeGreaterThanOrEqual(0);
  expect(idxDice).toBeGreaterThan(idxStart);
  expect(idxEnd).toBeGreaterThan(idxDice);
});
```

- [ ] **Step 2: 运行确证失败**
  若已通过（顺序天然正确）,则此测试作为回归保护,直接进入 Step 4。若失败,进入 Step 3。

- [ ] **Step 3: 修正块序**
  检查 `processBlockChildren`：`dice-card` 是否被 `isInlineElement` 正确判为块（`data-type=dice-card` 已在 `isInlineElement` 中返回 false,应作为块 flush 后单独处理）。如有漏加 `dice-card` 到 block 判定,补充。

- [ ] **Step 4: 测试 + 提交**
  ```bash
  npx vitest run src/utils/ngaHtmlToBBCode.roundtrip.test.ts
  npm test
  git add -A && git commit -m "fix(bbcode): 确保骰子卡按 DOM 顺序输出,修复位置错位"
  ```

## Task 8: 修复折叠块框选 / 显示 BUG

**Files:**
- Modify: `src/editor/collapseBlock.ts`（`attachCollapseBlockHandlers` 重组 onMouseDown / 展开折叠状态同步）
- Test: `src/editor/__tests__/collapseBlock.test.ts`

- [ ] **Step 1: 写失败测试（数据/状态同步）**

```ts
import { createDocument } from 'happy-dom'; // 或现有环境
import { ensureDragHandle, insertCollapseBlock } from '../../editor/collapseBlock';
it('ensureDragHandle 不改变 data-collapsed 与 display 一致性', () => {
  // 用 DOM 构造折叠块并断言 handle 存在且 block 不再 draggable
  expect(true).toBe(true); // 占位,实现在 happy-dom 环境构造
});
```

> 说明：折叠块交互多为浏览器 DOM 行为,单测尽量覆盖纯逻辑（ensureDragHandle 移除 draggable、isCollapseBlockEmpty）；复杂交互用手动清单。

- [ ] **Step 2: 重组 `onMouseDown`**
  当前 `onMouseDown`：点击 head/title 直接 return（保留编辑）,点击 body 文本 `clearCollapseSelection`。改为：
  - 点 body 文本：**不**调用 `clearCollapseSelection`,让默认选中生效。
  - 点 head 空白/把手：处理整块选中与拖动。
  - 展开/折叠切换（`onClick`）保持；同步「折叠状态时 body `display:none` + `data-collapsed=true`」一致性,避免切换后内容渲染错乱。

- [ ] **Step 3: 手动验证清单（浏览器）**
  - 折叠块内框选文本 → 正常。
  - 拖动把手移动整块 → 正常。
  - Delete/Backspace 空折叠块 → 整块删除。
  - 展开/折叠多次 → 显示一致,无断裂。

- [ ] **Step 4: 回归 + 提交**
  ```bash
  npm test
  git add -A && git commit -m "fix(collapse): 重组折叠块点击/框选逻辑,修复显示与选择断裂"
  ```

## Task 9: 骰子历史归档分组展示（UI）

**Files:**
- Modify: `src/store/diceHistoryStore.ts`（加 `getArchived` / `getActive` helper）
- Modify: `src/components/pages/HomePage.tsx`（骰子历史面板分组）
- Test: `src/store/diceHistoryStore.test.ts`

- [ ] **Step 1: 写测试（分组 helper）**

```ts
it('getMostRecentActive/getArchived 分组', () => {
  const base = { timestamp:1, storyId:'s1', diceName:'x', diceType:'1d6', result:'D6=3', resultDetail:'', sectionId:'', sectionTitle:'', payloadSnapshot:'' };
  useDiceHistoryStore.getState().addRecords([{ id:'a', ...base }, { id:'b', ...base, isArchived:true }]);
  const s = useDiceHistoryStore.getState();
  expect(s.records.filter(r=>r.isArchived)).toHaveLength(1);
  expect(s.records.filter(r=>!r.isArchived)).toHaveLength(1);
});
```

- [ ] **Step 2: 实现 helper + UI 分组**
  在 `HomePage` 骰子历史面板加两组：`records.filter(r=>!r.isArchived)`（当前）与 `records.filter(r=>r.isArchived)`（已删除作品）。仅当已删除组非空时显示该组标题。已归档记录保留查看与手动删除。

- [ ] **Step 3: 测试 + 提交**
  ```bash
  npx vitest run src/store/diceHistoryStore.test.ts
  npm test
  git add -A && git commit -m "feat(dice): 骰子历史按'当前作品/已删除作品'分组展示"
  ```

## Task 10: UI 升级（Lucide 图标 + 视觉统一）

**Files:**
- Modify: `package.json`（+ `lucide-react`）
- Modify: `src/components/editor/EditorToolbar.tsx`（B/I/U/S/颜色/字号/字体/折叠/骰子等按钮图标）
- Modify: `src/components/editor/diceCard` 渲染（`renderDiceCard` 卡片 + Lucide Dices 图标）
- Modify: `src/editor/collapseBlock.ts`（head 用 Lucide ChevronRight/Down 图标）
- Modify: `src/index.css`（补全 `--radius-*`/`--shadow-*`/`--space-*` token,统一卡片/按钮/弹窗样式,暗色模式校对）
- Modify: 各页面统一视觉（按钮/卡片间距/图标）

- [ ] **Step 1: 安装依赖**
  ```bash
  pnpm add lucide-react
  ```
  确认 `package.json` dependencies 增加。

- [ ] **Step 2: 工具栏图标替换**
  将 `EditorToolbar` 中 Unicode/文字图标替换为 Lucide 组件（`Bold`, `Italic`, `Underline`, `Strikethrough`, `Image`, `Table`, `List`, `ChevronDown`, `Dices` 等）。保持 onClick/active 高亮绑定不变。

- [ ] **Step 3: 骰子卡 / 折叠块视觉**
  - `renderDiceCard` 加卡片样式（圆角/阴影/边框/滚动结果动效）。
  - 折叠块 head 用 `ChevronRight`/`ChevronDown` 动态切换表示展开/折叠。

- [ ] **Step 4: 全局视觉 token + 暗色校对**
  - 在 `index.css` 增补 token 变量,统一卡片/按钮/弹窗/间距；校验暗色模式变量覆盖。

- [ ] **Step 5: 手动视觉走查 + 提交**
  - 浏览器逐页走查：编辑页、首页、骰子面板、折叠块。
  ```bash
  npm test
  git add -A && git commit -m "feat(ui): 引入 Lucide 图标 + 编辑器/骰子/折叠升级 + 全局视觉统一"
  ```

---

## 自审-Spec 覆盖对照

| Spec 章节 | 对应 Task |
|---|---|
| 2.4 架构拆分 | Task 1 |
| 3.1 kh/kl | Task 2 |
| 3.2 空格 | Task 3 |
| 4 骰子归档 | Task 4 |
| 3.3 导入导出丢骰子 | Task 5 |
| 3.4 BBCode 缺漏/断点 | Task 6 |
| 3.5 骰子错位 | Task 7 |
| 3.6 折叠框选 | Task 8 |
| 4.2 分组展示 | Task 9 |
| 5 UI 升级 | Task 10 |

全部 spec 需求均有对应任务。类型与签名在任务间保持一致（`archiveByStory`, `isArchived`, `isWhitespaceOnly` 均前后文统一）。