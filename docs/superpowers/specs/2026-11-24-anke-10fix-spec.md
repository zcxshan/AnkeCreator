# 安科作者助手 · 10 项修复与增强 · 设计规格（Spec）

- 日期：2026-11-24
- 版本号：保持 `4.0.0` 不变（用户明确要求）
- 现有验证基线：`npm run typecheck`、`npx vitest run src/ electron/ --reporter=dot --silent`、`npx vite build`

---

## 0. 结论先行（关键根因）

**第 2/3 项的根因已定位（最高优先级）**：

`@tiptap/core` v3 的 `editor.setEditable(editable, emitUpdate = true)` **默认会 emit 一次 `update` 事件**。
编辑器外层用 `editable={!sectionLoading}` 控制可编辑态，切节时必然触发：

1. 切节 → `sectionLoading=true` → `setEditable(false)` 用旧文档 emit update（此时 store.sectionId 仍是旧节，安全）；
2. 新节加载完成 → store 同时写入 `sectionId=新节`、`sectionContent=新节`、`sectionLoading=false`；
3. React 先执行声明在前的 `editable` effect → `setEditable(true)` **用仍是旧节的 DOM 再 emit 一次 update**；
4. `onUpdate` 回传旧节 HTML → `setSectionContent` 读取 store 里**已经是新节**的 `sectionId`，把旧节 HTML 排进新节的防抖保存队列；
5. 500ms 后落盘 → **新节正文被旧节内容覆盖**。

有选区时 DOM 序列化结果更容易与 `lastContentRef` 不一致（选区、NodeView 瞬态属性），`onUpdate` 的去重守卫失效，因此“选中文本后切节”稳定复现。
第 2 项“节之间串内容”是同一根因的另一表现。

修复策略（双保险，均必须做）：

- A. `setEditable(editable, false)`，从源头禁止可编辑态变化触发保存；
- B. 编辑回传携带“内容归属的 sectionId”，store 只接受与当前节一致的写入（跨节回传直接丢弃）。

---

## 1. 导出空节为 null 导致导入截断

### 现状/根因
`src/utils/storyExportBundle.ts` 中 `getSectionContent()` 返回 `null` 时直接
`throw new Error('第 N 节「标题」缺少正文')`；而导入端已允许空节（content/bbcode 均为 null）。
用户作品 `第一卷.anke.json`（72MB / 127 节）含 25 个空节，导出文件里这些节 `content: null`，导入链路把它当作异常数据，导致后续节被截断。

### 改动
- `src/utils/storyExportBundle.ts`
  - 删除 `if (content == null) throw ...`；
  - 改为 `if (content == null) content = ''`；
  - 注释说明“空节导出为空字符串，保证 JSON 结构稳定、导入不截断”。
- `src/utils/storyExportBundle.test.ts`
  - 原用例「任一节缺少正文时抛出带章节序号的中文错误」改为「空节导出为空字符串且不中断导出」：
    - 10 节、`s3` 返回 null；
    - 断言 `bundle.data.chapters[0].sections` 长度 10、`sections[3].content === ''`；
    - 断言进度最后一条为 `导出完成：10/10 节`。
- 导入端 `src/utils/storyImport.ts` 保留上一轮已改的“空节合法”逻辑（`content: null` 不报错）。
  另外把导入归一化改为 `content: content ?? ''`、`bbcode: bbcode ?? ''`（与导出口径一致，避免下游再次遇到 null）。

### 验收
- 含空节作品导出 → 导入 → 节数、顺序完全一致；
- 空节导入后进入编辑器显示空正文，可正常输入并保存。

---

## 2/3. 节内容互相串 / 切换节覆盖目标节

### 根因
见第 0 节。核心是 `setEditable` 默认 emit update + 回传不携带归属节 id。

### 改动

#### A. `src/editor/tiptap/TiptapEditorPane.tsx`
1. `RichTextEditorProps` 新增：
   - `sectionId: string | null`（当前展示内容所属的节）；
   - `onChangeContent: (html: string, sectionId: string | null) => void`（第二参为内容归属节）。
2. 新增 `appliedSectionIdRef = useRef<string | null>(null)`：
   - `onCreate` 时写入当前 `sectionId`；
   - `content` 同步 effect 成功应用内容后写入当前 `sectionId`（含 `domShowsContent` 快路径）。
3. `useEffect([editor, editable])` 改为 `editor.setEditable(editable, false)`，并注明原因（Tiptap v3 默认 emitUpdate=true 会污染保存队列）。
4. `onUpdate`：
   - 计算 `html` 后先判断 `const owner = appliedSectionIdRef.current`；
   - 仅当 `owner === sectionIdRef.current`（当前 props 的节）时才回传；
   - 回传 `onChangeContentRef.current(html, owner)`。
5. `content` 同步 effect 中，若 `sectionId` 已变化但内容尚未应用，不更新 `appliedSectionIdRef`，保证旧 DOM 的回传永远带旧节 id。

#### B. `src/components/editor/VisualEditorPane.tsx`
- 订阅 `const sectionId = useEditorStore((s) => s.sectionId)`；
- 传 `sectionId={sectionId}`；
- `onChangeContent={(html, ownerId) => setSectionContent(html, undefined, ownerId)}`。

#### C. `src/store/editorStore.ts`
- 签名扩展为
  `setSectionContent: (content: string, bbcode?: string | null, forSectionId?: string | null) => void`；
- 实现：
  ```ts
  const { sectionId } = get();
  if (forSectionId !== undefined && forSectionId !== sectionId) return; // 丢弃跨节回传
  set(...);
  if (sectionId) scheduleDebouncedSave(sectionId, content, bbcode);
  ```
- `flushSectionContent` 不受影响（内部仍用当前节）。
- 现有两参调用（编辑器撤销、BBCode 回写等）保持兼容。

#### D. 补充保护
- `loadSection` 成功落地新节后，若 `pendingSaveSectionId` 存在且不等于新节（异常残留），清零该 pending，避免下一轮 500ms 定时器写错节。
  正常路径中 pending 已被 `flushPendingSave()` 消费，此分支仅作兜底。

### 测试
- `src/store/editorStore.test.ts` 新增：
  - `forSectionId === 当前节` → 正常防抖保存；
  - `forSectionId` 为其他节 → 不写库、不改 `sectionContent`、不产生 pending。
- 现有 `src/store/__tests__/loadSection.test.ts`、`src/hooks/__tests__/useSectionEditor.test.ts` 必须保持全绿。

### 验收（手动）
1. 在 A 节选中一段文本 → 点目录切到 B 节 → B 正文保持原样；
2. A→B→A 往返 10 次，两节内容不串；
3. 在 A 节输入后 500ms 内立刻切到 B，A 的最新内容不丢、B 不被覆盖。

---

## 4. 收集安科 / 收集安价的默认起始楼层改为 0

### 现状
`src/hooks/useNgaCollectCommon.ts:33`：`useState('1')`。安科/安价两页共用该 hook，因此两页默认都是 1 楼。
两页的校验文案写死“楼层数必须为正整数”。

### 改动
- `src/hooks/useNgaCollectCommon.ts`
  - `startFloor` 默认值 `'0'`；
  - 校验：`Number.isInteger(start) && start >= 0`，错误文案改为「楼层数必须为非负整数」；
  - 范围判断保持 `end >= start`。
- `src/components/pages/AnjiaCollectPage.tsx`
  - 所有 `parseInt(startFloor, 10)` 后的 `< 1` / `<= 0` 判断改为 `< 0`；
  - 文案同步为「非负整数」。
- `src/components/pages/AnkeCollectPage.tsx`
  - 同上（该页从 hook 解构 `startFloor`，仅需改自身校验文案/边界）。
- `src/components/editor/NgaUpdateDialog.tsx` **不改**（它属于“更新追加”，语义不同）。

### 测试
- 新增 `src/hooks/__tests__/useNgaCollectCommon.test.ts`（仅测默认值与校验边界，不触碰网络）：
  - 默认 `startFloor === '0'`；
  - `0` 合法、`-1` 非法。

### 验收
进入「收集安科」「收集安价」页面，起始楼层输入框默认显示 `0`，填 0 可正常抓取。

---

## 5. 「导入安价」与「收集安价」功能结合

### 决策
不新增页面；“收集安价”抓取结果已持久化在 `src/utils/anjiaHistory.ts`（localStorage `anjia-history`，最多 10 条）。
把该历史直接接入编辑器的「导入安价」弹窗，形成“粘贴文本 / 收集历史”双来源，即完成功能合并。

### 改动
- `src/components/dice/DiceNGAImportDialog.tsx`
  - 新增来源切换：`'paste' | 'history'`（顶部两个贴纸胶囊按钮）；
  - `history` 视图：`loadHistory()` 列出 `label`、`formatHistoryTime(createdAt)`、`items.length` 条；
    点击某条 → 直接把 `entry.items` 转为选项（`displayValue = 序号`，`content = item.content`），并同步填入文本框便于二次编辑；
  - 空历史时显示引导文案：「先到「收集安价」抓取楼层，结果会自动出现在这里」；
  - 保持 `onConfirm` 签名不变，`EditorToolbar` 无需改调用逻辑。
- `src/components/editor/EditorToolbar.tsx`
  - 按钮文案从「导入安价」改为「安价」，`title` 说明“粘贴文本或选择收集历史”。

### 测试
- 新增 `src/components/dice/__tests__/DiceNGAImportDialog.test.tsx`：
  - 预置 `localStorage['anjia-history']` 一条记录；
  - 切到“收集历史” → 点击记录 → 确认 → `onConfirm` 收到按顺序的选项。

---

## 6. 资源库图片模块：图片处理（改尺寸 / 转格式）

### 决策
新增独立弹窗，不改图片库存储结构；处理结果作为**新文件**落盘并更新该条记录的 `url`/`filename`，旧本地文件删除。

### 改动
- 新增 `src/utils/imageProcess.ts`（纯函数 + canvas 辅助）：
  - `computeTargetSize(srcW, srcH, targetW?, targetH?, keepRatio)`；
  - `extForMime(mime)` → `png|jpg|webp`；
  - `canvasToBlob(canvas, mime, quality)`；
  - `blobToBase64(blob)`；
  - `loadImageElement(src, readAsDataUrl?)`（`local://` 走 `window.electronAPI.readAsDataUrl`）。
- 新增 `src/components/image/ImageProcessDialog.tsx`：
  - 入参 `{ open, item: ImageLibraryItem, folderId, folderName, onClose, onSaved }`；
  - 控件：宽度、高度、锁定比例、格式（保持原格式 / PNG / JPEG / WebP）、质量（JPEG/WebP 时 1–100）；
  - 确认：
    1. canvas 绘制 → `toBlob`；
    2. `window.electronAPI.saveImageLocal({ buffer: base64, filename: '<原名>.<ext>', mimeType, folderId, folderName })`；
    3. `updateImageLibraryItem(item.id, { url: res.url, filename: displayName })`；
    4. 旧 `url` 以 `local://` 开头时调用 `window.electronAPI.deleteImageLocal({ url: oldUrl })`；
    5. `onSaved()` → 父级 `refresh()`。
- `src/components/pages/ImageLibraryPage.tsx`
  - 图片卡片操作区新增「处理」按钮（与重命名/删除同组）；
  - 新增 `processTarget` state 与弹窗渲染；
  - 仅 Electron（`saveImageLocal` 存在）可用，否则按钮禁用并提示。

### 测试
- 新增 `src/utils/imageProcess.test.ts`：`computeTargetSize` 等比/固定尺寸、`extForMime` 映射。
- 弹窗交互不做 DOM 测试，走手动验收。

### 验收
选择一张本地图片 → 处理 → 宽 800（等比）→ 转 WebP → 保存；图库缩略图更新，原图文件被清理。

---

## 7. 设置中的快照支持删除

### 改动
- `electron/snapshot.ts`
  - 新增 `export function deleteSnapshot(dataDir: string, name: string): { ok: boolean; error?: string }`：
    - `isSafeSnapshotName(name)` 不通过 → `{ok:false,error:'非法快照名称'}`；
    - 目录不存在 → `{ok:false,error:'快照不存在'}`；
    - `fs.rmSync(dir,{recursive:true,force:true})` → `{ok:true}`。
- `electron/dataManager.ts`
  - 注册 `ipcMain.handle('data:deleteSnapshot', (_e, name) => deleteSnapshot(getDataDir(), name))`（import 补 `deleteSnapshot`）。
- `electron/preload.ts`
  - `electronAPI.deleteSnapshot` 与 `dataAPI.deleteSnapshot` 各加一个代理（与 `restoreSnapshot` 并列）。
- `src/types` 中 `window.electronAPI` 的类型声明补 `deleteSnapshot`（若为集中声明文件则改该文件）。
- `src/components/common/SettingsDialog.tsx`
  - 快照卡片右侧新增「删除」按钮（`an-btn an-btn--sm`，danger 色）；
  - `handleDeleteSnapshot(name)`：`askConfirm` 危险确认 → `window.electronAPI.deleteSnapshot(name)` → toast + `refreshDataInfo()`。
- `electron/__tests__/snapshot.test.ts`
  - 新增：创建两个快照 → 删除其一 → `listSnapshots` 只剩另一个；非法名 `../../etc` 返回失败；不存在返回失败。

### 验收
设置 → 数据目录与备份 → 删除某个快照 → 列表即时消失，磁盘 snapshots 目录同步减少。

---

## 8. 资源库新增 BGM 模块 + 编辑器插入 `[flash=audio]`

### 决策
- BGM 仅支持 URL 添加（用户要求），持久化到 localStorage（新 store）。
- 正文中的音频以 Tiptap 原子节点 `audioBlock`（`<div data-type="audio-block" data-src="...">`）存储，导出 BBCode 为
  `[flash=audio]./mon_202403/17/lsQ2t-db02X10Za0.mp3?filename=...[/flash]`
  （若 `data-src` 能反解为 NGA 相对路径，则输出 `./` 相对形式，否则输出完整 URL）。

### 改动

#### 存储
- 新增 `src/store/bgmLibraryStore.ts`（zustand + persist，key `anke-bgm-library`，version 1）：
  ```ts
  interface BgmItem { id: string; name: string; url: string; createdAt: number }
  items: BgmItem[]
  addByUrl(name: string, url: string): { ok: boolean; error?: string }
  remove(id: string): void
  ```
  - `addByUrl` 校验非空、`http(s)://` 或 `./`/`mon_` 相对地址；相对地址入库前用第 9 项前缀补全为可播放 URL，同时保留 `raw` 原文用于 BBCode 回写。
    （`BgmItem` 增加可选 `raw?: string`。）

#### BBCode ↔ HTML
- 新增 `src/utils/ngaUrl.ts`（第 9 项共用）：
  - `DEFAULT_NGA_URL_PREFIX = 'https://img.nga.cn/attachments'`；
  - `getNgaUrlPrefix()` 读取 `useSettingStore.getState().ngaUrlPrefix`，空值回退默认；
  - `expandNgaUrl(url, prefix?)`：`./` / `mon_` 相对地址拼接前缀；其他原样；
  - `toNgaRelativeUrl(url, prefix?)`：以前缀开头时反解为 `./...`。
- `src/utils/ngaBBCodeToHtml.ts`
  - 新增 `[flash=audio]URL[/flash]` → `<div data-type="audio-block" data-src="${expandNgaUrl(URL)}"></div>`；
  - 现有 `expandNgaImageUrl` 改为调用 `ngaUrl.ts` 的 `expandNgaUrl`（保留导出名，测试兼容）；
  - 兼容 `<audio src>` 粘贴：解析为同一 `audio-block`。
- `src/utils/ngaHtmlToBBCode.ts`
  - `div[data-type="audio-block"]` → `[flash=audio]${toNgaRelativeUrl(src)}[/flash]`；
  - 已有图片相对化逻辑复用 `toNgaRelativeUrl`（不改变现有图片输出行为）。

#### 编辑器内核
- `src/editor/tiptap/schema.ts`
  - 新增 `audioBlock` 节点：`group: 'block'`、`atom: true`、`draggable: true`、`attrs: { src: { default: '' } }`；
  - `parseHTML: 'div[data-type="audio-block"]'`；`renderHTML`: `<div data-type="audio-block" data-src="src">`。
- `src/editor/tiptap/nodeViews.tsx`
  - 新增 `audioBlock()` NodeView：`<div data-type="audio-block" contenteditable="false"><audio controls preload="none" src="..."></audio></div>`；
  - 失败兜底：`<audio>` error 时显示“音频加载失败 + 原始 URL”，并提供删除按钮（事务删除，与图片块一致）。
- `src/editor/tiptap/TiptapEditorPane.tsx`
  - 扩展装配里为 `audioBlock` 挂 NodeView；
  - `RichTextEditorCommands` 新增 `insertAudio(url: string): void`。
- `src/editor/tiptap/commands.ts`
  - 实现 `insertAudio`：`editor.chain().focus().insertContent({ type:'audioBlock', attrs:{ src: url } }).run()`。
- `src/editor/tiptap/serialize.ts`
  - 确认清洗规则不会剥掉 `data-type="audio-block"`（按现有 imageBlock 白名单方式补一条）。

#### 资源库 UI
- 新增 `src/components/resource/BgmLibraryPanel.tsx`：
  - 顶部输入框（名称可选 + URL 必填）+「添加」；
  - 列表：名称、URL、`<audio controls preload="none">` 试听、删除；
  - `compact` 模式：窄栏样式，点击条目录制 `onPick(url, raw)`。
- `src/components/pages/ResourceLibraryPage.tsx`
  - `ResourceTab` 增加 `'bgm'`，Tab 列表加 `{ key:'bgm', label:'BGM', icon:'music' }`（若 `Icon` 无 music，用 `volume`/`play` 现有图标）；
  - 渲染 `<BgmLibraryPanel />`。
- `src/components/editor/CompactImageLibraryPanel.tsx`
  - 不改内部逻辑；在 `src/components/editor/EditorRightPanel.tsx` 的 `gallery` Tab 顶部加分段按钮「图片 / BGM」，
    分别渲染 `CompactImageLibraryPanel` 与 `BgmLibraryPanel compact`；
  - BGM 选中回调 → `richTextEditorCommandsRef.current.insertAudio(url)` + toast「已插入 BGM」。

### 测试
- `src/utils/ngaBBCodeToHtml.test.ts`：`[flash=audio]./mon_x.mp3[/flash]` → 含 `data-type="audio-block"` 且 `data-src` 为补全后的 URL。
- 新增 `src/utils/ngaHtmlToBBCode.audio.test.ts`：audio-block → `[flash=audio]./mon_x.mp3[/flash]`。
- 新增 `src/store/bgmLibraryStore.test.ts`：URL 校验、添加/删除、相对路径补全。

### 验收
资源库 → BGM → 输入 `./mon_202403/17/lsQ2t-db02X10Za0.mp3?filename=...` → 添加；
编辑器右栏资源库 → BGM → 点击插入 → 正文出现可播放音频；切到 BBCode 视图得到 `[flash=audio]...[/flash]`。

---

## 9. 设置新增「NGA 的 url 头部」

### 改动
- `src/store/settingStore.ts`
  - 新增 `ngaUrlPrefix: string`（默认 `'https://img.nga.cn/attachments'`）与 `setNgaUrlPrefix`；
  - persist `version: 5`，`migrate` v4→v5 补默认值。
- 新增 `src/utils/ngaUrl.ts`（见第 8 项），所有 URL 补全集中于此。
- `src/utils/ngaBBCodeToHtml.ts` / `src/utils/ngaCrawler.ts`
  - 删除硬编码 `https://img.nga.cn/attachments`，统一走 `expandNgaUrl`。
- `src/components/common/SettingsDialog.tsx`
  - 新增 `Section title="NGA 的 url 头部"`：
    - 输入框（占位 `https://img.nga.cn/attachments`）；
    - 「保存」与「恢复默认」按钮（`an-btn`，3px 墨线风格）；
    - 说明：正文里以 `./mon_` 或 `mon_` 开头的图片 / BGM 地址会自动拼接该前缀。
- 校验与容错：保存时 trim、去掉末尾 `/`；空字符串回退默认值。

### 测试
- 扩展 `src/utils/ngaBBCodeToHtml.test.ts`：
  - 改 store 前缀为 `https://example.com/att` → `./mon_1.jpg` 展开为 `https://example.com/att/mon_1.jpg`；
  - afterEach 恢复默认，避免影响其他用例。

### 验收
设置里把前缀改成自定义值 → 重新导入含 `./mon_...` 的 BBCode → 图片/音频 URL 使用新前缀。

---

## 10. UI 风格统一（字体下拉 / 阅读界面 / 其他旧风格组件）

### 目标风格
沿用现有二次元贴纸手账风：3px `--an-ink` 墨线描边、`--an-card`/`--an-paper` 底、`--an-radius-*` 圆角、
`--an-shadow-pop` 硬投影、`--an-ease-bounce` 弹入、粉色 `--an-pink` 强调。

### 改动
- `src/components/editor/EditorToolbar.tsx`
  - 约 L993–1030 的字体原生 `<select>` 替换为「贴纸按钮 + 自定义下拉面板」：
    - 按钮显示当前字体名（无则「默认字体」），墨线 2–3px；
    - 面板：`--an-card` 背景、3px 墨线、`--an-shadow-pop`、圆角 `--an-radius-card`、逐项 hover `--an-pink-soft`；
    - 交互：点击外部/Esc 关闭；选择后调用现有 `ttCmd.setFontFamily(...)` 逻辑，保持 `activeStyles/cursorStyles` 同步不变；
    - 复用现有 `ToolbarBtn` 与 popover 实现方式（若已有 `ContextMenu` 定位逻辑则复用坐标计算）。
- `src/components/pages/ReaderPage.tsx`
  - 顶部工具栏、返回按钮、目录按钮、上/下一节、字号控制、设置面板：
    - 按钮统一 `an-btn an-btn--sm`（或同等 token 内联样式），3px 墨线 + `--an-shadow-pop`；
    - 顶栏背景 `--an-pink-soft`，底边 `var(--an-line)`；
    - 目录抽屉：`--an-paper` 背景 + 3px 墨线右侧边；
    - 保留 `reader-theme-*` 阅读主题（纸张/夜间）与字号持久化逻辑不变。
- 附带排查（仅改样式，不改逻辑）：
  - `src/components/editor/BBCodeEditor.tsx` 的 textarea 边框/圆角统一为 `an-btn`/`an-input` 口径；
  - `src/components/editor/GlobalSearchPanel.tsx`、`src/components/editor/SearchPanel.tsx` 的输入框/按钮统一。

### 测试
- 现有 `src/components/pages/ReaderPage.test.tsx`、`src/components/editor/EditorToolbar.fontSizeInput.test.tsx` 必须通过。
- 新增 `src/components/editor/EditorToolbar.fontPicker.test.tsx`：打开字体面板 → 点击某字体 → 调用命令/回调。

---

## 11. 清理项目多余文件

### 决策（只删生成物与噪音，不动源码/文档）
- `git checkout -- android/capacitor.settings.gradle`（构建产物噪音，不属于本次功能）。
- 删除（若存在且未被 git 跟踪）：
  - `dist/`、`release/`、`coverage/`、`.vite/`、`*.tsbuildinfo`；
  - `android/app/build/`、`android/.gradle/`；
  - 根目录 `*.log`、`npm-debug.log*`。
- 不删除：`docs/app-intro.md`、`docs/superpowers/**`（历史设计资产）、任何 `src/` 源文件。

---

## 12. 变更文件清单（汇总）

新增：
- `src/utils/ngaUrl.ts`
- `src/utils/imageProcess.ts`
- `src/store/bgmLibraryStore.ts`
- `src/components/image/ImageProcessDialog.tsx`
- `src/components/resource/BgmLibraryPanel.tsx`
- 测试：`useNgaCollectCommon.test.ts`、`DiceNGAImportDialog.test.tsx`、`imageProcess.test.ts`、
  `ngaHtmlToBBCode.audio.test.ts`、`bgmLibraryStore.test.ts`、`EditorToolbar.fontPicker.test.tsx`

修改：
- `src/utils/storyExportBundle.ts` / `.test.ts`
- `src/utils/storyImport.ts`
- `src/store/editorStore.ts` / `.test.ts`
- `src/store/settingStore.ts`
- `src/editor/tiptap/TiptapEditorPane.tsx`、`schema.ts`、`nodeViews.tsx`、`commands.ts`、`serialize.ts`
- `src/components/editor/VisualEditorPane.tsx`、`EditorToolbar.tsx`、`EditorRightPanel.tsx`
- `src/components/dice/DiceNGAImportDialog.tsx`
- `src/components/pages/ImageLibraryPage.tsx`、`ResourceLibraryPage.tsx`、`ReaderPage.tsx`
- `src/components/common/SettingsDialog.tsx`
- `src/hooks/useNgaCollectCommon.ts`
- `src/components/pages/AnjiaCollectPage.tsx`、`AnkeCollectPage.tsx`
- `src/utils/ngaBBCodeToHtml.ts`、`ngaHtmlToBBCode.ts`、`ngaCrawler.ts`
- `electron/snapshot.ts`、`dataManager.ts`、`preload.ts`、`electron/__tests__/snapshot.test.ts`
- 类型声明文件（`window.electronAPI.deleteSnapshot`）

---

## 13. 验证步骤（全部通过才算完成）

1. `npm run typecheck`
2. `npx vitest run src/ electron/ --reporter=dot --silent`
3. `npx vite build`
4. 手动清单：
   - 含 25 个空节的 127 节作品：导出 → 删除本地作品 → 导入 → 节数与内容一致；
   - 切节选区覆盖复现路径连续 10 次无覆盖；
   - 收集安科/安价默认 0 楼；
   - 编辑器「安价」弹窗能看到收集历史并生成选项；
   - 图片处理改尺寸+WebP 成功；
   - 设置里删除快照成功；
   - 资源库添加 BGM → 正文插入 → BBCode 正确；
   - 修改 NGA 前缀后 `./mon_` 图片/BGM 正确展开；
   - 字体下拉与阅读界面为贴纸手账风。

---

## 14. 明确不做

- 不改版本号；
- 不做 BGM 本地上传（仅 URL）；
- 不重构图片库存储结构；
- 不改“NGA 更新”弹窗的默认楼层；
- 不删除任何源码/历史文档。

---

## 15. 待用户确认

请确认本 Spec（尤其是第 5 项“用收集历史合并导入安价”、第 8 项音频节点方案、第 11 项清理范围）。
确认后进入实现阶段，按 `2026-11-24-anke-10fix-tasks.md` 顺序执行。
