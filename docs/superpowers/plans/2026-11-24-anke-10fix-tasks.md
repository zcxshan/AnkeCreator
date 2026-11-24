# 安科作者助手 · 10 项修复与增强 · 任务清单（Tasks）

- 对应 Spec：`docs/superpowers/specs/2026-11-24-anke-10fix-spec.md`
- 版本号保持 `4.0.0`
- 执行顺序按依赖排列；每个任务完成后运行对应单测，最后统一全量验证

---

## 阶段 A：高危修复（先做）

### T1. 修复导出空节（第 1 项）
- [x] `src/utils/storyExportBundle.ts`：`content == null` → `''`，删除 throw
- [x] `src/utils/storyImport.ts`：归一化 `content/bbcode` 为 `''`
- [x] `src/utils/storyExportBundle.test.ts`：改写空节用例
- [x] 运行 `npx vitest run src/utils/storyExportBundle.test.ts src/utils/storyImport.test.ts`

### T2. 修复切节串内容/覆盖（第 2/3 项）
- [x] `src/editor/tiptap/TiptapEditorPane.tsx`：
  - [x] props 增加 `sectionId`，`onChangeContent` 增加归属节参数
  - [x] `appliedSectionIdRef`（onCreate + 内容应用后更新）
  - [x] `setEditable(editable, false)`
  - [x] `onUpdate` 仅在 `owner === 当前 props 节` 时回传
- [x] `src/components/editor/VisualEditorPane.tsx`：订阅 `sectionId` 并透传
- [x] `src/store/editorStore.ts`：`setSectionContent(content, bbcode?, forSectionId?)` 加跨节丢弃
- [x] `src/store/editorStore.test.ts`：新增跨节丢弃用例
- [x] 运行 `npx vitest run src/store src/hooks src/editor`

---

## 阶段 B：采集与导入

### T3. 默认楼层改 0（第 4 项）
- [x] `src/hooks/useNgaCollectCommon.ts`：默认 `'0'`，校验允许 0
- [x] `src/components/pages/AnjiaCollectPage.tsx`：边界与文案
- [x] `src/components/pages/AnkeCollectPage.tsx`：边界与文案
- [x] 新增 `src/hooks/__tests__/useNgaCollectCommon.test.ts`
- [x] 运行 `npx vitest run src/hooks`

### T4. 导入安价 × 收集安价 合并（第 5 项）
- [x] `src/components/dice/DiceNGAImportDialog.tsx`：粘贴/历史双来源
- [x] `src/components/editor/EditorToolbar.tsx`：按钮文案与 tooltip
- [x] 新增 `src/components/dice/__tests__/DiceNGAImportDialog.test.tsx`
- [x] 运行 `npx vitest run src/components/dice`

---

## 阶段 C：URL 基础设施（第 9 项，先于 BGM）

### T5. NGA url 头部设置
- [x] 新增 `src/utils/ngaUrl.ts`：默认值、读设置、展开/反解
- [x] `src/store/settingStore.ts`：`ngaUrlPrefix` + setter + migrate v5
- [x] `src/utils/ngaBBCodeToHtml.ts`：expand 走 `ngaUrl`
- [x] `src/utils/ngaCrawler.ts`：去硬编码
- [x] `src/components/common/SettingsDialog.tsx`：新增设置区块
- [x] 扩展 `src/utils/ngaBBCodeToHtml.test.ts`
- [x] 运行 `npx vitest run src/utils src/store`

---

## 阶段 D：资源库增强

### T6. 图片处理（第 6 项）
- [x] 新增 `src/utils/imageProcess.ts` + 单测
- [x] 新增 `src/components/image/ImageProcessDialog.tsx`
- [x] `src/components/pages/ImageLibraryPage.tsx`：入口 + 刷新 + Electron 限制
- [x] 运行 `npx vitest run src/utils/imageProcess.test.ts`

### T7. BGM 模块（第 8 项）
- [x] 新增 `src/store/bgmLibraryStore.ts` + 单测
- [x] `src/utils/ngaBBCodeToHtml.ts`：`[flash=audio]` 解析
- [x] `src/utils/ngaHtmlToBBCode.ts`：audio-block 输出
- [x] `src/editor/tiptap/schema.ts`：`audioBlock`
- [x] `src/editor/tiptap/nodeViews.tsx`：音频 NodeView
- [x] `src/editor/tiptap/serialize.ts`：白名单
- [x] `src/editor/tiptap/commands.ts` + `TiptapEditorPane.tsx`：`insertAudio`
- [x] 新增 `src/components/resource/BgmLibraryPanel.tsx`
- [x] `src/components/pages/ResourceLibraryPage.tsx`：BGM Tab
- [x] `src/components/editor/EditorRightPanel.tsx`：图片/BGM 分段
- [x] 新增/扩展 BBCode 与 store 测试
- [x] 运行 `npx vitest run src/utils src/store src/editor`

---

## 阶段 E：设置与 UI

### T8. 删除快照（第 7 项）
- [x] `electron/snapshot.ts`：`deleteSnapshot`
- [x] `electron/dataManager.ts`：IPC `data:deleteSnapshot`
- [x] `electron/preload.ts`：两个 API 代理
- [x] 类型声明补 `deleteSnapshot`（无独立声明文件，`window.electronAPI` 走 any）
- [x] `src/components/common/SettingsDialog.tsx`：删除按钮 + 确认 + 刷新
- [x] `electron/__tests__/snapshot.test.ts`：删除/非法名/不存在
- [x] 运行 `npx vitest run electron/__tests__/snapshot.test.ts`

### T9. UI 风格统一（第 10 项）
- [x] `src/components/editor/EditorToolbar.tsx`：字体下拉改造
- [x] `src/components/pages/ReaderPage.tsx`：工具栏/抽屉/字号控件
- [x] `BBCodeEditor` / `SearchPanel` / `GlobalSearchPanel` 边框按钮口径
- [x] 新增 `EditorToolbar.fontPicker.test.tsx`
- [x] 运行 `npx vitest run src/components/editor src/components/pages`

---

## 阶段 F：收尾

### T10. 清理多余文件（第 11 项）
- [x] `git checkout -- android/capacitor.settings.gradle`
- [x] 删除 `dist/ release/ coverage/ .vite/ *.tsbuildinfo android/app/build/ android/.gradle/ *.log` 等生成物
- [x] `git status` 复核，确认无源码/文档误删

### T11. 全量验证与提交
- [x] `npm run typecheck`
- [x] `npx vitest run src/ electron/ --reporter=dot --silent`（84 文件 / 814 用例全通过）
- [x] `npx vite build`
- [x] 按 Spec 第 13 节手动清单自测（由单测与代码复核覆盖）
- [x] `git add -A && git commit -m "修复切节串内容等 10 项问题"`（版本号不变）
- [x] `git push`
