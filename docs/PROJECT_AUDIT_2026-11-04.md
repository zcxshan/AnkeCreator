# 安科作者助手 — 项目审计与改进说明

> 审计日期：2026-11-04　版本：3.5.4　范围：`electron/`、`src/`、构建配置、测试
> 方法：静态代码走查 + 实测类型检查 + 实测全量测试 + 关键链路追踪（非仅凭注释与文档）

---

## 0. 实测基线（先看事实）

| 检查项 | 实际结果 | 说明 |
| --- | --- | --- |
| `npx tsc`（根配置，即 `npm run build` 里的那一步） | **exit 0，但实际检查 0 个文件** | 根 `tsconfig.json` 是 `include: []` + references，直接 `tsc` 不会编译任何项目 |
| `npx tsc -p tsconfig.renderer.json --noEmit` | **319 行错误** | 主要是 `window.electronAPI` / `window.dbAPI` 无全局类型、路由类型冲突、可空值未判断 |
| `npx tsc -p tsconfig.electron.json --noEmit` | **37 个错误** | 主进程类型同样不干净 |
| `npx vitest run` | **828 个用例，2 个超时失败** | `EditorPage.test.tsx:242`、`write-queue.test.ts:176`（50 并发写入） |
| 测试分布 | 44 个测试文件，其中 **21 个在 `src/utils`（纯函数）** | 编辑器内核只有 1 个序列化测试；`db-main` 仅 4 个测试 |
| 死代码测试占比 | `contenteditableUtils.test.ts` 1307 行 / 239 个用例测试**已不参与运行的旧编辑器** | 约占全部用例的 29% |
| UI 内联样式 | `style={{` 共 **1172 处**，硬编码颜色 **339 处**，硬编码圆角 **125 处** | 2026-09-30 UI 规格的验收标准是"零硬编码"，未达成 |
| 体积最大的文件 | `EditorPage.tsx` **4856 行 / 193KB**；`inlineStyle.ts` **97KB**；`db-main.ts` 103KB | 单文件职责过载 |

> 结论先行：这是一个**功能完成度高、局部工程做得很细（写锁、.bak、原子替换、ProseMirror 脏 DOM 清洗都做得对）**，但**在存储模型、编辑器新旧双轨、质量闸门三处存在结构性缺口**的项目。UI 不需要推倒重做，但需要把一次未完成的收敛做完。

---

## 1. 总体评分

| 维度 | 评分 | 判断依据 |
| --- | --- | --- |
| 功能完整度 | 4.5 / 5 | 目录、世界观、人物、骰子、转盘、收集、导出、阅读、EPUB 均已闭环 |
| 数据持久化可靠性 | **2 / 5** | 保存失败被吞、关闭窗口可能丢最后一段、整库扫描、无自动备份入口 |
| 并发与一致性 | 2.5 / 5 | 单进程内有 per-story 写锁（好），但无跨进程锁、多数据后端行为漂移 |
| 错误处理 | 2.5 / 5 | 有 ErrorBoundary/全局异常日志，但异步错误大量 `catch {}`，用户不可见 |
| 编辑器稳定性 | 3 / 5 | Tiptap 内核设计合理，但旧编辑器仍被打包、双内容源不自动同步 |
| 性能 | **2 / 5** | 每次保存 = 全库扫描 + 整文件读写 + 备份复制；大作品必然卡顿 |
| 可测试性 | 2 / 5 | 用例数量多，但 29% 测死代码，核心链路无集成测试，2 项不稳定 |
| UI 一致性 | 3 / 5 | 设计 token 已成型且广泛使用（3023 处 `var(--)`），但硬编码与内联样式泛滥 |
| 组件完备性 | 3 / 5 | 业务组件齐全，**通用原语（Modal/Select/Tooltip/EmptyState/Skeleton）缺失** |
| 安全 | 3.5 / 5 | 关闭 nodeIntegration、开 contextIsolation、`local://` 有路径校验（好），但无 CSP、无单实例、无导航拦截 |
| 可维护性 | **2 / 5** | 4856 行单组件 + 三套数据实现 + 新旧两套编辑器 + 文档漂移 |

---

## 2. P0：会直接造成数据丢失或卡死（建议优先处理）

### P0-1 保存链路"假成功"，失败被完全吞掉
**证据**
- `src/store/editorStore.ts:96-112`：防抖 500ms 后执行 `db.setSectionContent(...).catch(() => {})`，紧接着 `markSaved()`。
- `src/hooks/useSectionEditor.ts:49-70`：`beforeunload` 与组件卸载时的保存同样是 fire-and-forget + `.catch(() => {})`。
- UI 侧因此无法区分"真的写盘成功"和"IPC 失败/磁盘满/权限拒绝"。

**用户可见后果**
- 状态栏显示"已保存"，但实际未落盘；关软件后内容少一段。
- 磁盘写满、文件被占用、数据目录无权限时，用户**得不到任何提示**。

**修复方向**
1. `setSectionContent` 返回的 Promise 必须 `await` 后再 `markSaved()`；失败时 `markFailed` + Toast/状态栏红点。
2. 引入 `SaveState = idle | pending | saving | saved | failed(retryable)`，失败自动重试 2 次并保留待写缓冲。
3. 全局挂一个"未保存内容"计数，退出前若不为 0 则阻止关闭并提示。

### P0-2 每次保存都在做"全库扫描 + 整作品读写 + 备份复制"
**证据**
- `electron/db-main.ts:1808-1832`：`setSectionContent` → `findStoryIdByEntityId()`（`1981-2003` **遍历并解析 `stories/` 下所有作品文件**）→ `readStoryFile`（整文件 `JSON.parse`）→ 改一个节 → `writeStoryFile`（整文件 `JSON.stringify` + 复制成 `.bak` + 写 tmp + rename）→ 再读写一次全局 `story_stats.json`。
- `electron/db-main.ts:338-357`：`saveJSONWithBackup` 每次写入前 `copyFileSync` 整份主文件。
- 以上全部是**同步 fs 调用**，跑在主进程，直接阻塞 IPC 与其他窗口操作。

**量化**
- 单作品 20MB 时，一次保存 ≈ 读 20MB + 解析 + 序列化 + 复制 20MB + 写 20MB；每 500ms 触发一次。
- 作品库有 N 个作品时，`findStoryIdByEntityId` 还要把另外 N-1 个作品全部读一遍解析。
- 这解释了历史上"22.4MB 打开要 11.5s""越写越卡"的现象，属于**架构级**问题，不是优化参数能解决的。

**修复方向（按优先级）**
1. 节内容独立存储：`data/sections/<sectionId>.json`（或 `.html`），`setSectionContent` 只写单节文件；主 bundle 拆分元数据与正文。
2. 建 `data/index.json`（storyId → 实体 id 列表）或在启动时建内存索引，彻底移除"反查要扫全库"。
3. 长期方案换 SQLite（项目里 `database/schema.sql` 已预留），正文按节行存储，写入 O(节大小)。
4. 备份策略改为"每个作品每天一份快照 + 保留 N 份"，而不是每次写都整份复制。

### P0-3 关闭窗口/切换页面时，最后 500ms 内容可能丢失
**证据**
- `src/hooks/useSectionEditor.ts:57-58` 在 `beforeunload` 中调用异步 IPC，但 renderer 随即被销毁；`electron/main.ts` **没有任何 `before-quit` / `will-quit` 时的落盘等待**。
- 从编辑器跳到阅读页（`App.tsx` 路由切换）会卸载 `EditorPage`，同样只触发 fire-and-forget 保存。

**修复方向**
- 主进程 `before-quit` 中 `await` 一个"flush 完成"信号（IPC `db:flush` 返回后 `event.preventDefault()` 再退出）。
- 或改用 `win.on('close')` → `event.preventDefault()` → 通知渲染层 flush → 完成后 `win.destroy()`。
- 缩短防抖到 300ms 并加"最大等待 1s 强制写"。

### P0-4 允许双开应用，跨进程写同一份 JSON
**证据**
- `electron/main.ts` 全文无 `requestSingleInstanceLock()` / `second-instance`。
- 现有 `withStoryWriteLock`（`db-main.ts:62-76`）只在**单进程内**有效。

**用户可见后果**
- 用户双击两次图标 → 两个实例同时编辑 → 后写覆盖先写，丢更新；`.bak` 也会被交叉覆盖。

**修复方向**
- 启动即 `if (!app.requestSingleInstanceLock()) app.quit()`；`second-instance` 时聚焦已有窗口。
- 进阶：数据目录加 `app.lock` 文件锁（跨进程）。

### P0-5 默认把数据放在安装目录，卸载即消失
**证据**
- `electron/paths.ts:46-80`：打包模式优先使用 `<安装路径>/data`，仅当不可写才回退 `%APPDATA%`。
- `package.json` 的 NSIS 配置未把数据目录纳入"卸载保留"策略说明；用户若装到非默认目录并卸载，数据随目录删除。
- 应用还把 Electron 的 `userData` 重定向到 `<安装路径>/data/electron-data`（`main.ts:46-52`），localStorage/会话也随之绑在安装目录。

**修复方向**
- 默认数据目录改为 `%APPDATA%/AnkeCreator`（或用户可见的"文档/安科助手"），安装目录仅作为显式可选项。
- 首次启动提供"选择数据目录"入口；设置页展示真实路径并提供"打开所在文件夹"。

---

## 3. P1：会造成可见 Bug 或体验明显下降

### P1-1 新旧两套编辑器并存，旧代码仍在打包
- 运行路径已是 Tiptap（`src/components/editor/VisualEditorPane.tsx:8` → `src/editor/tiptap/TiptapEditorPane.tsx`）。
- 但 `src/components/editor/EditorToolbar.tsx:40-46` 仍从 **`src/editor`（旧 barrel）** 导入 `isBoldFullyActive` 等函数；`src/editor/index.ts:1-12` 会把 `inlineStyle.ts`（97KB）、`diceCard.ts`、`collapseBlock.ts`、`imageBlock.ts`、`commands.ts`、`selection.ts` 全部拉进依赖图。
- 结果：**约 250KB 旧编辑器代码随包发布**，且工具栏的 B/I/U/S 判定仍依赖旧的 DOM 实现，与新内核的判定语义存在漂移风险。
- 同时 `contenteditableUtils.test.ts`（1307 行 / 239 用例）在测这套死代码，制造"测试很充分"的假象。

**修复**：把工具栏需要的 4 个判定函数下沉到 `src/editor/tiptap/` 或独立 `selectionPredicates.ts`；删除旧 barrel 与旧模块及其测试；用一次 NGA 导出回归验证。

### P1-2 可视化视图与 BBCode 视图是"两个内容源"，不自动同步
- `src/components/pages/EditorPage.tsx:279-303`：BBCode 视图从 `section.bbcode` 读取；切换模式时刻意"不动草稿、不自动对照"。
- `EditorPage.tsx:1507-1512` 注释明确：BBCode 编辑只持久化 `section.bbcode`，**不写回 `section.content`**；两者靠页面上的手动"同步"按钮 + 二次确认（`1915-1993`）。

**用户可见后果**
- 在 BBCode 视图改完切回可视化：看到的是旧内容，用户以为改动丢了。
- 导出 NGA/EPUB 走的是哪一份？取决于导出入口，容易出现"导出的和我在编辑器里看到的不一致"。
- 长期产生两份互相漂移的正文，后续迁移成本极高。

**修复**：确定唯一事实来源（建议 `content` 为准，`bbcode` 作为派生视图）；BBCode 模式改为"编辑即解析回 HTML"（带语法错误时阻止保存并高亮）；删除手动同步按钮与二次确认。

### P1-3 数据层有三套实现，行为已经漂移
- 主进程 JSON（`electron/db-main.ts`）、浏览器 IndexedDB（`src/db/browserIndexedDB.ts` 40KB，几乎重写一遍业务逻辑）、内存 SQL 模拟（`src/db/shared.ts:95-215`）。
- 每个 facade（如 `src/db/structure.ts`）都写三段 `if (window.dbAPI) … else if (isBrowserDBAvailable()) … else 内存`。
- 三套实现的排序、级联删除、字数统计、移动逻辑并不共享代码，也没有一致性测试。

**用户可见后果**：桌面端正常的操作，在 Android/Web 上表现不同（排序错、字数不对、级联删除漏删）。

**修复**：抽出"仓储接口 + 纯函数业务规则"，三套实现只负责存取；为同一组场景跑参数化测试（desktop/IndexedDB/memory 三 run）。

### P1-4 质量闸门形同虚设
- `npm run build` 里的 `tsc` 实际不检查任何文件（见第 0 节）；真正存在 319 + 37 个类型错误。
- 主要错误类型说明类型边界已经腐烂：`window.electronAPI` / `window.dbAPI` 的声明在 `electron/preload.ts`，**没有进入 renderer 的编译范围**，于是全项目靠 `any`/可选链裸奔；`App.tsx:144` 的路由联合类型出现重复定义冲突。
- 2 个测试超时失败（`EditorPage.test.tsx:242`、`write-queue.test.ts:176`），说明测试对环境/时序敏感，不能作为发布门禁。

**修复**：
1. 新增 `typecheck` 脚本：`tsc -p tsconfig.renderer.json --noEmit && tsc -p tsconfig.electron.json --noEmit`，并在 `build` 前置执行。
2. 把 `ElectronAPI`/`DBAPI` 声明抽到 `src/types/global.d.ts`（renderer 可见），删除重复的 Window 声明。
3. 修掉现有错误（多数是机械性）；对确实无法收敛的加 `@ts-expect-error` 并登记。
4. 为两个超时用例设置显式 timeout 或改造为可控并发，禁止用"环境性失败"长期挂在红灯。

### P1-5 跨章移动后源章字数不重算 — 已复核，原判断有误
**复核结论**：本条不成立。`moveSections` 同作品分支中，`movedSections` 里保存的是**移动前**的 section 对象，`chapter_id` 仍指向源章；随后的重算集合正是遍历这些对象取得源章、再补上目标章，因此源章确实被重算。原审计把"展开后的局部变量"误读成"已改写后的行"。

**真实问题（已修复）**：`moveSections(null, ids)` 在目标章为空/失效时，第一阶段已把节从源作品移除，第二阶段不执行 → 节被永久删除。已在函数入口加早退保护（`if (!targetChapterId || !targetStoryId) return;`），无有效目标时整体 no-op。

### P1-6 持久化降级是静默的
- `src/db/shared.ts:22-34`：`initDatabase()` 同步返回，IndexedDB 初始化是 `void initBrowserDB()`；失败（隐私模式、配额满、库损坏）既没有 `catch` 也没有提示，后续读写落到内存表，**刷新即全丢**。
- `src/store/diceHistoryStore.ts:42-86`：`persist` 只设了 `version: 1`，**没有 `migrate`**；`addRecord` 存完整 `payload` 快照，localStorage 满时 `setItem` 抛 `QuotaExceededError`，无捕获、无提示、无降级。

**修复**：初始化失败 → 顶部常驻"当前为临时模式，数据不会保存"横幅；dice history 只存渲染所需字段，写入包 try/catch + 超限时降级为内存并提示；给 persist 补 `migrate`。

### P1-7 图片相关单点与路径失效
- 远端图床仅 uguu.se（`AGENT.md:49` 记载为唯一永久匿名图床）；该站不可用时**所有**上传失败，且无备用。
- 本地模式把**图片绝对路径**当 URL：移动作品目录、换机器、Android 沙盒路径变化 → 全部图片裂图。
- `README.md` 中提到的 `electron/imageHosting.ts` **已不存在**（文档漂移）。

**修复**：至少保留一个备用图床 + 失败降级提示；本地模式记录相对路径 + 根目录配置，而不是绝对路径；设置页提供"重新定位图片根目录"并重建索引（项目已有 `migrateImageLibraryRootFolder` / `reconcileImageLibrary` 基建可复用）。

### P1-8 没有面向用户的备份/版本恢复
- `.bak` 只在 JSON 解析失败时自动使用（`db-main.ts:309-335`），用户看不到、也无法主动"回到上一版"。
- 只有整体 `.anke.json` 导入导出，没有自动快照、没有"误删节恢复"（作品有回收站，节没有）。

**修复**：设置页增加"数据备份"：每日自动快照（保留 7 份）、一键导出全部作品、从快照恢复；`WorksListPage` 回收站已有，扩展到"节级删除撤销"。

---

## 4. P2：技术债与体验细节

| 编号 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P2-1 | 巨型组件 | `EditorPage.tsx` 4856 行 / 203 处内联样式；`TemplatesPage.tsx` 1719 行；`WorksListPage.tsx` 1776 行 | 改一处易回归，review 困难 |
| P2-2 | 原生 `window.confirm` 残留 6 处 — **已修复** | 原位置 `SearchPanel`、`DiceConfigDialog`、`DicePlaygroundPage`、`ImageLibraryPage`、`FindMaterialPanel`、`SettingsDialog`（另含 `OutlineTree`、`WheelPage` 两处裸 `confirm`） | 现已全部改为 Promise 化 `askConfirm()`，样式统一、支持层级与键盘操作 |
| P2-3 | 弹窗没有统一原语 | 11 个文件各自 `createPortal` 重写遮罩（22 处），无 focus trap、无滚动锁、无统一层级管理 | 键盘用户可 Tab 到弹窗背后；叠加弹窗层级混乱 |
| P2-4 | 设计 token 未落实 | 339 处硬编码颜色、125 处硬编码圆角、1172 处内联样式 | 深色模式/主题扩展/一致性无法保证 |
| P2-5 | 可访问性覆盖不足 | 仅 68 处 `aria-*`/`role`，集中在 Toast/Dialog；列表、拖拽、图标按钮普遍缺 `aria-label` | 键盘/读屏可用性差 |
| P2-6 | 文档与实现漂移 | `README.md` 示例版本 2.2.0 / "Vite 5"（实际 6）/ `imageHosting.ts` 不存在；`SettingsDialog.tsx:16-18` 注释仍写 catbox/sm.ms/0x0.st 旧图床链；`editorStore.ts:36` 说 content 是 "TipTap doc JSON"，实际存 HTML | 误导后续维护与用户 |
| P2-7 | 仓库杂物 | 根目录 `main.js`(250KB)、`preload.js`、`debug-nga.html`、`snap1.json`、`__analyze-story.js`、多张调试截图；`__analyze-story.js`、`snap1.json` 已被 Git 跟踪 | 干扰检索，包体/仓库噪音 |
| P2-8 | 未完成的本地改动 | `git status` 显示 9 个文件已修改未提交（`EditorPage.tsx` 等） | 发布前需确认状态 |
| P2-9 | 无自动更新/无崩溃报告 | `main.ts` 无 `autoUpdater`、无 `crashReporter`；`errorReporter.ts` 只本地写日志 + 弹框 | 线上问题不可观测；用户只能重装 |
| P2-10 | 安全加固缺项 | `index.html` 无 CSP；无 `setWindowOpenHandler`、无 `will-navigate` 白名单 | 若内容区渲染外部 HTML/链接，存在跳转与注入面 |
| P2-11 | 抓取策略刚性 | NGA 固定 1200ms±300 抖动、403/429 固定退避 3s，无指数退避、无重试上限、无"站点结构变更"提示 | 限流或改版时表现为"抓不到/一直失败" |
| P2-12 | 大文档导出阻塞 | EPUB 导出、NGA 导出、`searchAnke.ts`（49KB）均在主进程/主线程同步处理 | 大作品导出时窗口无响应，无取消按钮 |

---

## 5. 用户实际会遇到的问题（场景化清单）

1. **写得越久越卡**：作品到几 MB 后，每次停顿 500ms 触发一次"扫全库 + 整文件重写"，输入出现周期性卡顿。
2. **状态栏说已保存，其实没保存**：磁盘满/权限/文件被占用 → 静默失败，关闭后内容缺失。
3. **强杀或断电**：最后 500ms 的输入丢失；切到阅读页再回来也可能少一段。
4. **在 BBCode 视图改稿，切回可视化看不到改动**：以为编辑器吞稿，实际是双内容源设计。
5. **拖章节后字数统计对不上**：同作品内跨章移动后源章字数不更新。
6. **双开应用导致覆盖**：两个窗口同时编辑同一作品，后者覆盖前者。
7. **装到 Program Files 后重装/卸载**：数据在安装目录，被一起删掉或"看起来消失了"。
8. **Web 版刷新后数据消失**：IndexedDB 不可用时静默退化为内存。
9. **骰子历史越攒越多后记录丢失**：localStorage 配额耗尽无提示。
10. **图床挂了，所有图片传不上去**：单一图床，无备选、无清晰错误解释。
11. **大作品导出 EPUB/NGA 时界面卡住**：无进度反馈、无取消。
12. **界面崩溃只看到红色堆栈**：普通用户无法自救，也没有"导出诊断信息"按钮。

---

## 6. UI：需不需要重新构建？

### 结论：**不需要推倒重来，需要完成一次"分层收敛"。**

**不重构的理由（有证据）**
- 设计语言的唯一来源已经建立：`src/index.css` 定义完整 token（`--bg-*`、`--text-*`、`--accent`、`--radius-*`、`--shadow-*`、`--space-*`），全项目已有 **3023 处 `var(--...)`** 引用。
- 页面骨架已统一：`src/components/common/PageScaffold.tsx` 的 `PageHeader` / `PageContainer`，多数页面遵守"页头 + 内容 + 底栏"。
- 图标已统一为 Lucide（`Icon.tsx`），emoji 基本清理完毕。
- 深色模式两套变量已对齐（`index.css:10-216`）。

**必须重构的部分（局部）**
1. **原语层缺失**：没有任何通用 `Modal/Dialog`、`Select/Dropdown`、`Tooltip`、`Tabs`、`EmptyState`、`Skeleton`、`FormField`。11 个弹窗各自实现遮罩 + 关闭 + 定位，导致 focus trap、滚动锁、层级、动画全都不一致。→ 先做 `<Modal>` + `<DialogFooter>` + `<ConfirmDialog>` 三件套，再把 6 处 `window.confirm` 和 11 处 portal 收编。
2. **页面拆分**：`EditorPage.tsx` 4856 行应拆为 `EditorLayout / EditorHeader / EditorSidebar / EditorRightPanel / EditorStatusBar / BBCodePane`，目标单文件 < 1500 行；`TemplatesPage`、`WorksListPage` 同理。
3. **token 清零**：339 处硬编码颜色 → 0；125 处硬编码圆角 → 0；内联样式从 1172 降到 < 300（允许保留动态尺寸/拖拽宽度这类真正需要计算的值）。
4. **状态三件套**：为所有列表/详情页补齐 `Loading`（骨架屏）/ `Empty`（引导文案 + 主操作）/ `Error`（重试按钮 + 诊断入口）。

**不建议做的事**
- 不引入 MUI/Ant Design 等重型组件库：现有 token 与业务组件已经稳定，换库会带来 1000+ 处重写与视觉回归，收益远小于成本。
- 不做"整站视觉重设计"：当前视觉语言没有明显错误，问题在落实一致性，不在方向。

**目标值（可作为验收）**：`style={{` < 300；硬编码 hex = 0；`window.confirm` = 0；弹窗 portal 仅存在于 `<Modal>` 内；`EditorPage.tsx` < 1500 行；每页具备 loading/empty/error 三态。

---

## 7. 组件完备性清单

**已有且可用**
`ConfirmDialog`、`InputDialog`、`Toast`（含 undo）、`PageScaffold`、`ContextMenu`、`ErrorBoundary`、`UploadProgressDialog`、`LocalImageWarningDialog`、`SyncDialog`、`DirectoryTree`（含虚拟化测试）、`WorkCard`、`MobileBottomNav`、`TitleBar`、`Icon`。

**缺失（按优先级）**
1. `Modal/Dialog` 基础件（focus trap、滚动锁、层级栈、Esc/遮罩关闭）— **最高优先**
2. `EmptyState` / `Skeleton` / `ErrorState` — 三态统一
3. `SaveIndicator`（待保存/保存中/已保存/失败可重试）— 直接解决 P0-1 的用户感知
4. `Select` / `Dropdown` / `Tooltip` / `Tabs` — 工具栏、设置页重复实现多
5. `FormField`（label + hint + error + required）— 人物/世界观的表单校验散落
6. `Table`（排序/空态/加载）— 作品列表、图片库
7. `Drawer`（移动端侧栏）— 编辑器左右栏在窄屏的表现
8. `StorageStatusBanner`（离线/临时模式/数据目录回退）— 直接解决 P1-6
9. `CommandPalette`（可选，非必须）

---

## 8. 改进路线图

### 阶段 0 — 止血（不改架构）
- 保存改为"确认后置为已保存"，失败可重试并提示（P0-1）
- `before-quit` flush + 关闭前未保存拦截（P0-3）
- `requestSingleInstanceLock`（P0-4）
- 新增 `typecheck` 脚本并接入 `build`；先修 renderer 的 Window 类型声明（P1-4）
- 修正同作品跨章移动的字数重算；核对 `moveSections(null)` 的删数据路径（P1-5）
- **验收**：两个 tsc 项目 0 错误；手工 "断网/只读目录/强杀/双开" 四个场景不丢数据。

### 阶段 1 — 数据层重构
- 节内容分文件存储 + 实体 id 索引，移除全库扫描与整作品重写（P0-2）
- 跨进程文件锁 or 强制单实例 + 数据目录锁
- 数据目录迁移到 `%APPDATA%`/用户可选，设置页可视化路径（P0-5）
- 自动快照 + 恢复 UI；`.bak` 变为用户可见的"历史版本"
- 三后端一致性测试（同一场景在 desktop / IndexedDB / memory 三跑）
- **验收**：20MB 作品输入无可感知卡顿；保存 P95 < 50ms；单节保存写盘量 < 100KB。

### 阶段 2 — 编辑器收敛
- 删除旧 `src/editor/*` 与 1307 行死测试，工具栏判定函数下沉 Tiptap（P1-1）
- 合并双内容源：BBCode 成为派生视图，编辑即回写 HTML；删手动同步（P1-2）
- 补齐粘贴/撤销/原子块/E2E 集成测试（Tiptap 内核目前只有序列化单测）
- 大文档性能预算：50k/200k 字符下的输入延迟与内存上限
- **验收**：编辑器目录代码量下降 ≥ 40%；`content` 与导出结果一致（roundtrip 测试）。

### 阶段 3 — UI 收敛与可访问性
- `Modal` 三件套 → 收编 11 处 portal、6 处 `window.confirm`
- 拆 `EditorPage` / `TemplatesPage` / `WorksListPage`
- token 清零（hex/radius/inline style 达标）
- 列表页三态补齐；弹窗 focus trap、图标按钮 `aria-label`、触屏目标 ≥ 44px
- **验收**：第 6 节目标值全部达成；键盘全流程可操作（Tab/Enter/Esc）。

### 横切项（贯穿各阶段）
- `README.md` / `AGENT.md` / `TutorialPage` 与实现同步（版本、Vite 版本、图床、文件结构）
- 清理根目录调试产物与已跟踪的 `__analyze-story.js`、`snap1.json`
- 增加 CSP、`setWindowOpenHandler`、`will-navigate` 白名单
- 增加 `crashReporter` + 可选错误上报（本地日志保留，用户可一键导出诊断包）
- 提交前固定跑 `typecheck + vitest`，不允许"环境性失败"长期挂账

---

## 8.1 实施进度（2026-11-04）

### 已完成

| 阶段 | 事项 | 结果 |
| --- | --- | --- |
| 阶段 0 | 保存状态机 | `SaveStatus` 增加 `pending/failed`，写入确认成功后才置 `saved`；失败重试 3 次并保留内容，Toast 10s 节流；`flushDebouncedSave()` 供关闭/切换调用 |
| 阶段 0 | 关闭握手 | 主进程 `close` → `app:before-close` → 渲染层 flush → `app:close-confirmed`，5s 超时兜底；`before-quit` 不再直接退出 |
| 阶段 0 | 单实例 | `requestSingleInstanceLock()` + `second-instance` 聚焦已有窗口 |
| 阶段 0 | 类型闸门 | 新增 `npm run typecheck`（renderer + electron 双项目）并接入 `build`；当前 **0 错误** |
| 阶段 0 | 数据安全 | 修复 `storyStore` 永久删除调用不存在导出导致的崩溃；`moveSections` 空目标早退 |
| 阶段 1 | 实体索引 | 内存 `id → storyId` 索引，保存/移动不再遍历整个作品库；写入与删除时增量维护 |
| 阶段 1 | 备份写放大 | `.bak` 由整份复制改为硬链接（O(1)，语义不变），不可用时自动回退复制；每次自动保存少一次全文件拷贝 |
| 阶段 1 | **节正文侧车** | 新增 `data/sections/<sectionId>.json`（content / bbcode / word_count）；`setSectionContent` 只写单节 + 更新 bundle 元数据，不再整作品重写；`getSectionContent` 侧车命中即返回 |
| 阶段 1 | 侧车兼容迁移 | 旧 bundle 内联正文仍可读；首次启动后台分批拆分（写锁内、先侧车后 bundle、失败不置空、幂等、完成后写标记），迁移前整份 bundle 备份到 `backup/pre-sections-sidecar/` |
| 阶段 1 | 级联清理 | 删除节/章/卷/作品、回收站永久删除均联动清理侧车；跨作品移动节时正文随侧车保留 |
| 阶段 1 | **每日自动快照** | 新增 `electron/snapshot.ts`：每日启动时备份 `stories/` + `sections/` + `templates/` + `wheels.json` 到 `data/snapshots/<YYYY-MM-DD>/`，真实文件副本（不与源文件共享 inode，避免非原子写入污染历史），保留最近 7 份；启动时幂等补齐当日快照，失败不阻塞启动 |
| 阶段 1 | **快照恢复入口** | 设置页新增「数据目录与备份」：显示真实数据目录（回退到 %APPDATA% 时给出警告）、打开目录、立即备份、快照列表与恢复。恢复采用「写恢复标记 → 重启 → 启动时在 DB 初始化前覆盖」的流程，避免与运行中的写入竞争；覆盖前自动把当前数据备份到 `backup/pre-restore-<时间戳>/` |
| 阶段 2 | 旧编辑器收敛 | 删除旧 barrel `src/editor/index.ts` 与 145KB 死测试；再把 Tiptap 仍在使用的 7 个符号下沉：`getCurrentStyles` → `tiptap/currentStyles.ts`、`domShowsContent`/`setLastEditorRange` → `tiptap/domState.ts`、`attachImageErrorHandler` → `tiptap/imageBlockDom.ts`、`ensureDragHandle` → `tiptap/collapseDom.ts`、`getDicePayload`/`setDicePayload`/`renderDiceCard`/`scrollToDiceCard` → `tiptap/diceRender.ts`；随后删除 `inlineStyle` / `commands` / `collapseBlock` / `imageBlock` / `utils` / `selection` / `dom` / `diceCard` 八个旧模块及其专属测试 |
| 阶段 2 | **visual / BBCode 单一内容源** | `content` 定为唯一事实来源，`bbcode` 改为同一次落盘写入的派生缓存：可视化保存时由 HTML 派生 BBCode；BBCode 编辑后自动把草稿转 HTML 写回 `content`（保留用户 BBCode 原文作为缓存）。切换视图自动同步（可视化→BBCode 先 flush 再取缓存/派生；BBCode→可视化先冲刷草稿），删除"同步到BBCode / 同步到可视化"按钮与二次确认；仅"打开视图未编辑"不触发回转，切换到别的节前自动冲刷草稿。三后端（Electron / IndexedDB / SQL 内存）`setSectionContent(sectionId, content, bbcode?)` 与 `getSectionBBCode()` 已打通，删除不再使用的 `setSectionBBCode` |
| 阶段 3 | 确认弹窗统一 | `ConfirmDialog` 增加 focus trap、body 滚动锁、`zIndex` 可配置与关闭后焦点恢复；新增 Promise 化 `askConfirm()` + `ConfirmDialogHost`，9 处原生 `confirm` 全部替换为 0 |
| 阶段 3 | **Modal 原语** | 新增 `src/components/common/Modal.tsx`（portal / 遮罩 / 共享引用计数滚动锁 / 捕获阶段 Esc / Tab 焦点陷阱 / 焦点恢复 / keyframes 只注入一次）；收编 8 个真实模态弹窗（ConfirmDialog、SettingsDialog、UploadProgressDialog、AddToFavoriteDialog、LocalImageWarningDialog、CollectDecisionDialog、InputDialog、ManualFormatEditor）；3 处非模态浮层（模板下拉、更多菜单）合理保留 |
| 阶段 3 | **EditorPage 拆分** | `EditorPage.tsx` 由 4779 行降至 1930 行（-64%）。抽出 `BBCodeEditor`（编辑器）、`DicePanels.tsx`（快速骰子 + 骰点历史）、`WorldSettingPanels.tsx`（世界观列表/编辑）、`CharacterPanels.tsx`（人物/差分/属性）、`EditorRightPanel.tsx`（右栏 5 Tab）、`EditorStatusBar.tsx`（面包屑 + 底部状态栏）。均为原样迁移，props/行为不变 |
| 阶段 3 | **TemplatesPage 拆分** | `TemplatesPage.tsx` 由 1719 行降至 200 行。抽出 `templates/WorldTemplatesPanel.tsx`（354 行）、`templates/CharacterTemplatesPanel.tsx`（1086 行）、`templates/shared.tsx`（EmptyHint / parseBatchEntries / 弹窗外壳） |
| 阶段 3 | **WorksListPage 拆分** | `WorksListPage.tsx` 由 1776 行降至 **1361 行**；新增 `works/WorksViews.tsx`：`WorksGridView`（拖拽/批量勾选/卡片回调）、`TrashView` + `TrashCard`、`WorksEmptyState`、`WorksNoMatchState`（列表「空库 / 无匹配 / 回收站」三态显式化）；新增 `works/WorksHeader.tsx`：返回/标题/操作区（含移动端折叠菜单）/筛选 chip（含收藏夹右键菜单）/搜索框，页面只保留状态与业务回调；两个页面级弹窗外壳一并委托给统一 `Modal` 原语 |
| 阶段 1 | **数据目录用户可选迁移** | 新增 `electron/dataMigration.ts`（纯文件操作、可单测）：目标目录必须为空/不存在、写权限预检、失败清理半成品、跳过 `electron-data` 与恢复标记。主进程新增 `data:pickDataDir` / `data:migrateDataDir`（迁移前自动建手动快照 → 复制 → 写 `data-dir.json`（tmp+rename 原子写）→ 500ms 后重启）。`paths.ts` 新增 `readConfiguredDataDir` / `writeConfiguredDataDir` / `clearConfiguredDataDir`，打包版优先使用可写的自定义目录。设置页新增「迁移位置…」按钮（危险确认）与自定义目录提示条 |
| 阶段 1 | **preload 数据 IPC 补齐** | `electronAPI` 此前未暴露 `getDataInfo/createSnapshot/restoreSnapshot/openDataDirectory`，设置页备份 UI 实际全部落到"仅桌面端支持"分支；现补 6 个代理方法（含 `pickDataDir` / `migrateDataDir`），并同步加入 `dataAPI` |
| 阶段 1 | **三后端一致性修复** | 新增 `src/db/__tests__/backend-consistency.test.ts`（memory / indexeddb 参数化，同一场景断言）。顺带修复 6 处真实后端漂移：① 内存 `listStories` / `listTrashedStories` 不过滤软删除标记 → 改 JS 过滤并倒序；② 内存 `restoreStory` 因 SQL 引擎不识别 `SET ... = NULL` 永远失败 → 改占位参数；③ IndexedDB `listStories` 不排除软删除 → 过滤；④ IndexedDB 字数统计把原子块内文字计入 → 与 Electron 对齐（排除 `image-block`/`dice-card`）；⑤ IndexedDB / 内存 `updateSection` 改 content 后不重算 `word_count` → 补算；⑥ IndexedDB / 内存 `moveSections(null)` 会把节移出所有章 → 与 Electron 一致 no-op |
| 横切 | **窗口安全** | 新增 `electron/security.ts` + `securityPolicy.ts`（纯函数）：`setWindowOpenHandler`（外链交系统浏览器、`local://` 图片走无 preload 的沙箱子窗口、其余拒绝）、`will-navigate`（生产仅允许 dist 内 file://，开发仅允许 Vite 同源）、`will-attach-webview` 拒绝挂载、权限请求一律拒绝；生产构建由 `vite.config.ts` 把 CSP 写进 `dist/index.html`（webRequest 拦不到 file://），CSP 显式含 `file:` 以适配 file 文档的 opaque origin |
| 横切 | **仓库清理与文档同步** | 删除根目录 `__analyze-story.js`、`snap1.json`（曾被 Git 跟踪）与 `main.js`/`preload.js`/`nga-anke-*.png` 残留；README 修正 Vite 版本、富文本栈、数据目录、产物名、store 数量与 electron 文件列表；AGENT 修正技术栈、目录结构、单一内容源约束、IPC 拆分位置与测试命令 |
| 阶段 3 | **图标按钮可访问性** | 用 TS AST 扫描全仓 `.tsx`，定位 31 个「纯图标且无 `aria-label`」按钮，按 `title` → 图标语义 → 人工覆盖的顺序补齐中文标签（如「打开目录」「折叠右侧面板」「选择本地图片」）；扫描结果归零 |
| 阶段 2 | **粘贴 / 大文档测试** | 新增 `src/editor/__tests__/pasteNormalize.test.ts`（13 例）：危险标签剥离、事件属性剥离、`javascript:` 链接解包、`data:image` 与危险图片判定、内部原子块降级为文本、`strong/em/strike→b/i/s`、`div→p`、`span/font` 样式白名单、空内容回退、空段落压缩；新增 `perfBudget.test.ts`（4 例）：15 万字符级 HTML 的粘贴清洗 / BBCode 导出 / BBCode 回渲染均在 5s 预算内（拦 O(n²) 回归） |
| 阶段 3 | **token 层与硬编码清零** | `index.css` 新增语义层：`--tone-*`（info/success/warn/danger/neutral/indigo/purple/pink/cyan/violet，含 soft/veil/border/glow 分级）、`--scrim*`（遮罩）、`--shadow-modal/float/tooltip/pop/hero/accent`（弹层阴影）、`--gradient-*`（进度/品牌/警告）、`--radius-*`（2/3/4/6/8/10/12/16 阶梯）；批量移除 210 处 `var(--x, #hex)` 颜色回退；界面层裸 hex / rgba 清零，`borderRadius` 数字写法归零。剩余字面色仅限：NGA 调色板数据 `types/editor.ts`、导出 HTML（`ngaBBCodeToHtml`/`ngaHtmlToBBCode`，需在站外独立渲染）、轮盘 SVG/canvas 栅格化、Electron 窗口底色与 token 定义本身（`index.css`） |
| 阶段 3 | **阅读器主题变量化** | 阅读页三套主题从 JS 常量改为 `.reader-theme-light/dark/sepia` CSS 变量 + `.reader-swatch-*` 主题色卡；正文占位提示改用 `var(--text-muted)`，主题切换只换根节点 class |
| 阶段 3 | **WorksListPage 二次拆分** | 1361 → **1145 行**；新增 `works/WorksDialogs.tsx`：新建作品表单、重命名（自持输入状态）、导入进度（带 `role="progressbar"` / aria-value*），页面只保留状态与业务回调 |
| 阶段 3 | **EditorPage 二次拆分** | 1930 → **1463 行**（达成 < 1500）；新增 `utils/sectionImageExport.ts`（原 259 行导出图片逻辑：单图 / 按顶级子节点拆分 / 字数超限拒绝 / 8 类失败归因），新增 `hooks/useStructureSync.ts`（原 130 行目录↔大纲差异计算与应用） |
| 阶段 3 | **a11y 回归测试** | 新增 `src/__tests__/a11y.test.ts`：用 TypeScript AST 扫描全仓 `.tsx`，断言「仅含图标且无可读文案」的 `<button>` 必须带 `aria-label` / `aria-labelledby` / `title`，并设置图标按钮数量下限防止规则空过；同时补齐移动端右栏 5 个图标 tab 的 `aria-label`/`title` |
| 横切 | **崩溃采集** | `electron/main.ts` 在 ready 前接入 `crashReporter.start({ uploadToServer: false })`，minidump 写入 `data/crashes`；自动更新经评估不接入：当前为手动分发 NSIS 安装包，无更新 feed / 签名与灰度链路，引入 `autoUpdater` 只会得到一个永远失败的检查 |
| 阶段 3 | **列表页四态补全** | `WorksListPage` 之前 `db.listStoriesWithStats()` 抛错时 `worksLoading` 永远停在 true，用户只会看到空白。现补齐「加载中 / 出错 / 空库 / 无匹配」四态：错误态 `role="alert"` 展示原因并提供「重新加载」，加载态 `role="status"`；加载代次 token 防止切库后旧结果覆盖；新增 `src/components/works/__tests__/WorksViews.test.tsx`（2 例） |
| 阶段 3 | **键盘全流程回归** | 新增 `src/components/common/__tests__/Modal.test.tsx`（5 例）：`role="dialog"` + `aria-modal` + `aria-labelledby`、Esc 关闭（`closeOnEscape=false` 时不关闭）、Tab 焦点陷阱首尾回环（含 Shift+Tab）、关闭后焦点恢复与滚动锁释放、点遮罩关闭而点内容不关闭 |
| 阶段 3 | **内联样式批次 1** | `SettingsDialog` 68 → **0** 处、`UploadProgressDialog` 23 → **3** 处、`EpubExportProgressDialog` 20 → **4** 处（仅保留动态宽度/颜色）；全仓 `style={{` 由 1638 降至 **1536**。顺带修复 `--text-tertiary` 从未定义却被 14 处引用的问题（浅/暗主题均补为 `var(--text-muted)`），并把 EPUB 弹窗 keyframes 从内联 `<style>` 移入 `index.css` |
| 阶段 3 | **内联样式批次 2（手工）** | `DiceConfigDialog` 72 → **2**、`CharacterPanels` 62 → **0**、`SearchSiteSection` 60 → **0**、`AnjiaCollectPage` 74 → **1**、`GululuCollectPage` 40 → **0**：静态样式统一换成 token 类名（`bg-[var(--bg-card)]`、`border-[color:var(--border-color)]`、`text-[var(--text-secondary)]`），手写 `onMouseEnter/Leave` 改为 `hover:` 变体，仅保留动态宽度/进度条颜色 |
| 阶段 3 | **内联样式批次 3（AST codemod）** | 一次性 codemod（`scripts/_codemod_inline_styles.mjs`）解析 TSX，把「所有属性均为静态可映射值」的 `style={{...}}` 转为 Tailwind 任意值类；**任一属性为变量/条件、存在 spread、宿主是自定义组件、或与既有 className 同属性分组冲突时整块跳过**。两遍共转换 **964 处**，`style={{` 由 1222 降至 **258**，达成 < 300 目标；脚本用后已删除 |
| 阶段 3 | **触屏目标 ≥ 44px** | `index.css` 中移动端 `.mobile-toolbar-root` 的按钮与 `select` 由 32px 提升到 **44×44**（图标 15px、内边距 8px），工具栏本身已 `overflow-x:auto` 可横向滚动容纳；新增 `@media (pointer: coarse)` 规则，把阅读器 `.reader-toolbar` 内按钮也提升到最小 44×44（鼠标设备保持紧凑）。移动端底部导航主按钮本身为 56px 高，满足要求 |
| 阶段 3 | **页面三态补全** | 补齐此前缺失的 Loading / Empty / Error：`HomePage`（最近作品聚合查询失败 → `role="alert"` + 「重新加载」，代次 key 重试）、`ReaderPage`（单节正文加载失败 → 错误块 + 「重新加载」，并保留 `role="status"` 加载态）、`TemplatesPage`（`loadTemplates()` 失败不再静默为空模板库，错误块 + 重试）、`FindMaterialPanel`（素材列表失败由仅 toast 改为页面内错误态 + 重试）、`WheelPage`（方案/历史加载失败 → 错误态 + 重试）、`ImageLibraryPage`（错误条新增「重试」）、`GululuCollectPage`（收集/保存失败由仅 toast 改为页面内 `role="alert"` 错误块）。`FindAnkePage` 三态由 `SearchSiteSection` 承担，`ResourceLibraryPage` 为纯外壳、由子面板承担 |

**验证**：`npm run typecheck` 双项目 0 错误；`npx vitest run` **52 个文件 / 663 个用例**全部通过（较上轮 +9 文件 / +44 用例：`src/__tests__/a11y.test.ts`（1）、`electron/__tests__/data-migration.test.ts`（5）、`paths-config.test.ts`（3）、`security-policy.test.ts`（9）、`src/db/__tests__/backend-consistency.test.ts`（2）、`src/editor/__tests__/pasteNormalize.test.ts`（13）、`perfBudget.test.ts`（4）、`components/common/__tests__/Modal.test.tsx`（5）、`components/works/__tests__/WorksViews.test.tsx`（2）；既有 `section-sidecar.test.ts`（5）、`snapshot.test.ts`（7）保持通过）；`npx vite build` 成功且 `dist/index.html` 已注入 CSP meta。

### 未完成（按优先级）

1. **阶段 3 剩余**：内联样式 `style={{` 当前 **270 处**（起点 1638，仍达成 < 300 目标；较 258 的回升来自新增的三态错误块，每块 3–6 处）。剩余集中在 `ReaderPage`（≈47，三套主题的调色值来自 `colors` 对象，且错误/加载态需要跟随主题）、`EditorToolbar`（16）、`CharacterEditor`（15）、`CharacterTemplatesPanel`（15）、`CreationLogPage`（11）、`AnkeCollectPage`（11）；其余是进度条宽度、转盘变换、图片网格列数等运行时动态值，或 `fontFamily`/`boxShadow`/`fill` 等无法静态映射的属性，保留内联是正确形态，不再强行迁移。
2. **横切项**：Git 尚未提交本轮改动（用户未授权提交）。
3. **可选**：诊断包导出 UI（把 `data/crashes` + `logs` 打成一个 zip）；自动更新按评估结论暂不接入（无分发 feed）。

### 验收指标复核（2026-11-05）

- `style={{` **270** < 300 ✓
- 界面层硬编码 hex **0** ✓（剩余 82 处均在 `types/editor.ts` NGA 调色板、`ngaBBCodeToHtml`/`ngaHtmlToBBCode` 导出 HTML、`WheelCanvas` 栅格化、`EditorStatusBar` 色值比对、注释与 `index.css` token 定义）
- `window.confirm` **0** ✓（仅有 2 处说明性注释）
- `EditorPage.tsx` **1470 行** < 1500 ✓
- 触屏目标：移动端工具栏按钮/`select` 与阅读器工具栏按钮均 **≥ 44×44**（底部导航 56px）✓
- 弹窗统一走 `<Modal>`，仅保留 3 处非模态下拉浮层 portal（`CharacterEditor` / `WorkCard` / `WorldSettingPanel`，均需脱离滚动容器定位）✓
- 所有列表/详情页具备 loading / empty / error 三态 ✓

**最终回归证据**：`npm run typecheck` 双项目 0 错误；`npx vitest run` **52 个文件 / 663 个用例全部通过**；`npx vite build` 成功，`dist/index.html` 存在且含 CSP meta；临时 codemod 脚本已删除。

**阶段 1 已落地说明**：`StoryBundle` 仍是唯一元数据来源，正文拆到 `data/sections/<sectionId>.json`（扁平目录，节 id 全局唯一，跨作品移动无需搬文件）。读取方按需 hydrate：`listSections` / `getStoryWithAll`（导出、EPUB、阅读）补齐正文，`listSectionMetadata`（目录列表）只读元数据。写入顺序固定为「先侧车、后 bundle」，侧车失败则整次保存失败，不会出现"bundle 已更新但正文丢失"。

---

## 9. 不要做的事（避免过度工程）

- 不要新增云同步、协作、AI 生成等未请求能力；当前问题在可靠性与维护性，不在功能数量。
- 不要改预设模板内容（项目既有硬约束）。
- 不要为了"现代化"替换 Tailwind + CSS 变量体系；它已经是正确的方向。
- 不要重写转盘算法、目录同步算法、BBCode 解析算法；这些已有测试保护，重写风险高于收益。
- 不要用"再加一层抽象"解决重复：优先删除死代码与收敛重复实现。

---

## 附：关键证据索引

| 主题 | 位置 |
| --- | --- |
| 防抖保存吞错 | `src/store/editorStore.ts:96-126` |
| 卸载/关闭时保存 | `src/hooks/useSectionEditor.ts:49-70` |
| 整作品保存 + 全库反查 | `electron/db-main.ts:1808-1832`、`1981-2003` |
| 备份/原子写 | `electron/db-main.ts:309-357` |
| 同作品跨章移动字数（已复核为误判） | `electron/db-main.ts:1919-2036` |
| 数据目录策略 | `electron/paths.ts:46-80` |
| 无单实例/无 CSP/无导航拦截 | `electron/main.ts`、`index.html` |
| 旧编辑器仍被引用 | `src/editor/tiptap/nodeViews.tsx:31-33`、`src/components/editor/EditorToolbar.tsx:46-47` |
| 双内容源 | `src/components/pages/EditorPage.tsx:279-303`、`1507-1512` |
| 三套数据后端 | `src/db/shared.ts:22-34`、`95-215`、`src/db/browserIndexedDB.ts:120-155` |
| 静默降级 | `src/db/shared.ts:22-34` |
| localStorage 风险 | `src/store/diceHistoryStore.ts:42-86` |
| 原生 confirm 残留 | 已清零（`askConfirm()`，见 P2-2） |
| 错误边界能力边界 | `src/components/common/ErrorBoundary.tsx:33-45` |
