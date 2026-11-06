# 安科创作应用重构设计（数据 · 编辑 · NGA · UI · 模块）

- 日期：2026-11-05
- 状态：待用户审阅
- 范围：数据存储与导入导出、可视化编辑器、NGA 登录与发帖联动、UI 设计系统与信息架构、模块整合
- 实施顺序：S1 → S2 → S3 → S4

## 1. 背景与目标

当前应用已完成一轮架构加固（正文侧车、快照、迁移、Tiptap 单内核、设计 token、页面三态），但仍存在以下用户可感知的问题：

1. 作品数据仍是“单文件整包 + 正文侧车”，未做到作品目录化、按实体分文件；浏览器 IndexedDB 后端与 Electron JSON 后端模型不一致。
2. 编辑器图片存在不显示/错位风险（防盗链钩子覆盖不全、旧路径格式未归一化、失败信息不足）；折叠块与引用块依赖 `data-type` 与 CSS 选择器，序列化清洗可能破坏结构。
3. NGA 仅支持手动粘贴 Cookie，缺少应用内登录、作品与帖子关联、按节发送 BBCode 的能力。
4. UI 缺少统一的设计系统：字号、控件高度、间距不一致，入口分散，“我的安科作品”不显眼。
5. 收集安科、收集安价、搜索安科三套页面重复；骰子与转盘各自独立；创作日志内容偏少。
6. 编辑器右侧的世界观、大纲、人物角色三个面板常驻占用正文空间，需要改为从编辑界面弹出的弹窗；“世界观”更名为“设定备忘录”。
7. 安科作品的导出必须是单个 JSON 文件，内部存储布局不得影响导入导出格式。
8. 收集安科生成的 JSON 与旧版本应用导出的 JSON 必须能直接导入，不能要求用户手工改格式。

本设计的目标是给出可实施、可验证、可回滚的四阶段方案。非目标：不引入云同步、不改变 NGA 站点规则、不重写阅读器内核、不在本阶段实现多用户协作。

## 2. 现状证据（调研结论）

| 领域 | 现状 | 关键位置 |
| --- | --- | --- |
| 作品存储 | `stories/<storyId>.json` 存整个 `StoryBundle`；正文侧车 `sections/<sid>.json`；写入 `.tmp → rename` + `.bak` | `electron/db-main.ts` L287-L377、L514-L524 |
| 快照/迁移 | 快照覆盖 stories/sections/templates/wheels；恢复前备份 `pre-restore-*`；迁移前快照 | `electron/snapshot.ts` L143-L240、`electron/dataMigration.ts` |
| 浏览器后端 | IndexedDB 按实体分 store 逐条读写，与 Electron 单 bundle 不同 | `src/db/browserIndexedDB.ts` L30-L59、L211-L258 |
| 图片渲染 | `local://` 特权协议 + CSP 放行；`local://` 失败走 `readAsDataUrl` 兜底；NGA 防盗链只匹配 `*.nga.178.com` | `electron/protocol.ts` L33-L117、`src/editor/tiptap/imageBlockDom.ts` L8-L48 |
| 折叠/引用 | 依赖 `div[data-type="collapse-block"]`、`blockquote[data-type="quote-block"]` 与 `index.css` 选择器 | `src/editor/tiptap/schema.ts` L118-L504 |
| NGA | 搜索、楼层抓取、BBCode 双向转换已具备；仅支持手动粘贴 Cookie；无发帖实现 | `electron/ngaCrawler.ts`、`src/utils/ngaHtmlToBBCode.ts`、`src/store/settingStore.ts` L19-L43 |
| 导航/UI | 桌面首页承担全部入口；移动端 4 Tab + 更多；字号与控件高度不统一 | `src/App.tsx` L169-L279、`src/components/common/TitleBar.tsx`、`MobileBottomNav.tsx` |

## 3. 总体架构

按职责拆为五个域，通过明确接口通信：

1. **数据内核（data-core）**：作品仓储（Repository）、迁移器、快照、导入导出。渲染层只通过 `src/db/index.ts` 暴露的仓储接口访问数据。
2. **编辑器（editor）**：Tiptap schema、NodeView、序列化、图片解析与兜底、节切换与保存协调。
3. **NGA 联动（nga）**：登录会话、帖子解析、BBCode 生成、回复提交、发布日志。
4. **设计系统（ui）**：token v2 + 原语组件 + 三套主题。
5. **模块整合（modules）**：发现（搜索+收集）、创作、娱乐、作品库。

依赖方向：`modules → ui → data-core`；`editor → data-core`；`nga → data-core`。禁止页面直接读写文件系统或 IndexedDB。

## 4. S1：数据与编辑

### 4.1 作品目录结构

磁盘结构（Electron）：

```
data/
  stories/
    <storyId>/
      manifest.json        # 提交指针：schemaVersion、generation、文件清单
      story.json           # 作品元信息
      volumes.json         # 卷
      chapters.json        # 章
      world.json           # 世界书 + 角色关系 + 大纲
      characters.json      # 角色
      dice.json            # 骰子历史
      nga.json             # NGA 帖子与楼层关联（S2 新增，可选）
      sections/<sid>.json  # 每节正文（沿用侧车）
  images/                 # 全局图片目录（保持现状，避免破坏 local:// URL）
  templates/ wheels.json  # 全局模板与转盘
```

文件包装格式统一为：

```json
{ "schemaVersion": 2, "generation": 17, "updatedAt": "...", "data": { ... } }
```

`manifest.json` 记录当前 `generation` 与各文件相对路径；**最后写入**，作为提交点。

### 4.2 读写与一致性

- 读取：先读 `manifest.json`，校验 `generation` 后按需读取实体文件；任一文件缺失或 generation 不符 → 回退该文件 `.bak`；仍失败 → 回退最近快照并提示用户。
- 写入：同一作品使用串行写队列（进程内 Map<storyId, Promise>），只写发生变化的文件；每个文件 `tmp → fsync → rename`，并保留 `.bak`；全部成功后才写 `manifest.json`。manifest 未提交时，旧 generation 的数据仍然有效。
- 删除/重命名：先改实体文件，再改 manifest；失败时 manifest 保持旧状态。
- 全局文件（`favorites.json`、`story_stats.json` 等）补 `.bak` 与启动恢复。
- 内存后端（测试/演示）实现同一仓储语义，供测试复用。

### 4.3 迁移策略（双读单写 + 特性开关）

1. 新增设置 `storageLayout: 'bundle' | 'perStory'`：全新安装默认 `perStory`；已有用户迁移成功前保持 `bundle`，迁移完成后自动切换为 `perStory`。
2. 启动时若发现 `stories/<id>.json` 且无对应目录：
   - 先创建快照（沿用现有快照器）；
   - 生成 `<id>/` 下各文件（generation=1），校验 JSON 可解析、实体数量与旧 bundle 一致；
   - 写入 manifest 提交；
   - 旧文件重命名为 `<id>.json.migrated.bak`，不删除。
3. 任一步失败：清除临时目录，保留旧文件，记录 `migration.log`，应用继续以 bundle 读取。
4. 回滚：设置切回 `bundle`，读取器优先旧文件；提供“回滚迁移”按钮（仅开发设置页可见）。
5. 迁移器可重复执行（幂等），已有目录则跳过。

### 4.4 仓储接口

`src/db/index.ts` 统一导出以下能力（Electron / IndexedDB / 内存三实现同签名）：

- `getStoryWithAll(storyId)`：合并读取（不含全部正文，正文按节懒加载）
- `saveStoryMeta(storyId, patch)`、`saveStructure(storyId, { volumes?, chapters? })`
- `saveWorld(storyId, { settings?, relations?, outlines? })`、`saveCharacters(storyId, list)`
- `getSectionContent(sectionId)`、`saveSectionContent(sectionId, html)`（已有）
- `listStoriesWithStats()`、`importBundle(bundle)`、`exportBundle(storyId)`

页面不得直接调用 `window.dbAPI` 的底层文件名接口。

### 4.5 导入导出（单文件导出 + 三来源兼容导入）

**导出始终是单个 JSON 文件。** 内部“作品目录 + 分实体文件”只影响磁盘存储；导出时合并为一份 `StoryBundle`，文件名 `<作品名>-<日期>.json`，不产生文件夹、压缩包或多文件。

导出内容包含：`format/version/schemaVersion/exportedAt/appVersion`、`story`、`volumes`、`chapters`、`sections`（正文内嵌 `content`）、`world_settings`、`characters`、`character_relations`、`outlines`、`dice_history`、`stats`。导出前逐节校验正文可读，失败则中止并给出具体节名；大作品分块读取并通过 IPC 回报进度。

导入必须自动识别并兼容以下来源：

| 来源 | 顶层特征 | 处理方式 |
| --- | --- | --- |
| 当前应用导出 | `format: 'anke-creator-export'`、`version: '1.1'`，实体在 `data` 下，章节内嵌 `sections[].content` | 解包 `data`，沿用现有 `ensureDefaultVolumeAndChapter` |
| 收集安科输出 | 与当前导出相同（`anke-creator-export`，`data.volumes/chapters/sections`，正文在 `content`） | 与上一行共用同一条路径，补 fixture 回归 |
| 旧版导出 | `format: 'anke-creator-story'`，实体在 `data` 下，可能缺少 `volumes` 或使用顶层 `data.sections` | 解包 `data`，自动补默认卷/章，顶层节挂到默认章 |
| 内部 StoryBundle | `format: 'anke-creator-story-v2'`，实体在根层 | 直接按 StoryBundle 校验（仅用于内部/调试导入） |
| 无包装旧文件 | 无 `format`，根层即 `story/volumes/chapters/sections` | 结构嗅探后按 StoryBundle 处理 |

统一入口 `normalizeImportPayload(raw, fileName)`：

1. 识别包装层：优先 `format`，其次是否存在 `data` 且 `data.story` 有效；
2. 归一化字段：实体数组缺省为空；`sections` 的 `content` 与 `bbcode` 二选一取正文；无卷/章时创建默认“第一卷 / 第一章”；`order_index` 缺失按数组顺序补齐；
3. 保留未知字段到 `extras`，避免二次导出丢信息；
4. 校验作品标题、节正文可解析；失败返回可直接展示的中文原因（如“文件不是有效的安科作品 JSON”“第 3 节缺少正文”）；
5. 图片：远端 URL 保持；`data:` 内嵌图写入全局 `images/` 并改写为 `local://`；`local://` 路径原样保留。

测试 fixture 至少覆盖：当前导出、收集安科生成文件、旧版 `anke-creator-export`、无包装旧文件、损坏 JSON、缺正文的节；往返测试要求 `导出 → 导入 → 再导出` 后实体数量、正文哈希、图片引用、折叠/引用结构一致。

### 4.6 编辑器修复

1. **图片链路**
   - 新增 `src/utils/imageSrc.ts` 的 `resolveImageSrc(src, ctx)`：去空白、解码 HTML 实体、识别 `data:` / `local://`（含 `local:///`）/ `file://` / Windows 绝对路径 / 相对路径 / http(s)。相对路径与绝对路径在 Electron 下经 IPC 转为 dataURL。
   - 扩展防盗链钩子为多域名：`*://*.nga.178.com/*`、`*://*.nga.cn/*`、`*://*.ngabbs.com/*`；仅对缺省 Referer 的图片请求补 `https://nga.178.com/`。
   - NodeView 失败兜底链：`local:// → readAsDataUrl → 占位块`；占位块展示文件名、失败原因与“重新选择图片”入口，不再静默空白。
   - 开发态诊断：`window.__ankeImageDebug` 返回最近 20 条解析/加载记录，便于用户反馈。
2. **折叠块**
   - 规范字段：`data-type="collapse-block"`、`data-title`、`data-collapsed`；序列化清洗加入白名单，禁止剥离。
   - 展开状态只在 DOM 上体现，不写入未提交的临时编辑状态；切换节时先 flush。
   - 标题输入只在 blur/Enter 回写，避免每次按键重排。
3. **引用块**
   - `blockquote[data-type="quote-block"]` 结构固定；阅读端与编辑端共用同一 CSS 变量选择器。
   - 嵌套块级内容保持不拆散；禁止把引用降级为普通段落。
4. **编辑稳定性**
   - 每节独立的撤销边界；切节前 flush 并清空历史栈。
   - Ctrl+Shift+V 纯文本粘贴清洗；粘贴后光标位置固定在内容末尾。
   - 输入法组合期间不触发外部内容同步。

### 4.7 S1 测试与验收

- 迁移：旧 bundle fixture → 目录结构、数量一致、幂等、失败回滚、快照回退。
- 仓储：三后端同签名一致性（同一 fixture 的读写结果快照比对）。
- 导入导出：字段/正文/图片/折叠/引用往返一致；低版本升级。
- 图片：`resolveImageSrc` 全路径形态单测；`local://` 失败兜底；多域名 Referer 钩子单测。
- 编辑器：折叠/引用 schema 往返、切节 flush、撤销边界、输入法不中断。
- 验收：`npm run typecheck` 0 错误；`npx vitest run` 全绿；迁移前后作品数、节数、正文哈希一致。

## 5. S2：NGA 登录与发帖联动

### 5.1 登录

- 入口：设置页“NGA 账号”卡片 + 首次使用发帖时的登录引导。
- 流程：主进程创建模态 `BrowserWindow`，`partition: 'persist:nga'`，打开 `https://bbs.nga.cn/`；轮询 `session.cookies` 检测 `ngaPassportUid`/`ngaPassportCid`；成功后读取全部 NGA Cookie。
- 存储：使用 Electron `safeStorage` 加密后写入 `data/settings/nga-session.bin`；渲染层只拿到“已登录/昵称/过期”状态，不持有明文 Cookie。
- 失效处理：发帖返回未登录/登录过期时，清除会话并提示重新登录；保留手动 Cookie 作为兜底入口。
- 退出登录：关闭窗口、清空 `persist:nga` session 与本地加密文件。

### 5.2 数据模型

作品新增：

```ts
interface NgaThreadLink {
  fid: number
  tid: number
  url: string
  title: string
  linkedAt: string
}
```

节新增：

```ts
interface NgaPostLink {
  tid: number
  pid: number
  floor: number
  postedAt: string
  contentHash: string // 用于判断本节是否已发送/已修改
}
```

随 per-story 目录写入 `nga.json`（与 story.json 同级），并在导入导出时可选携带（默认携带，便于换机恢复关联）。

### 5.3 发帖流程

1. 编辑器工具栏新增“发送至 NGA”，仅当作品已关联帖子时可用；未关联时引导选择帖子。
2. 点击弹出确认框：显示帖子标题、楼层、内容字数、是否已发送过。
3. 主进程执行：
   - 带 Cookie 请求 `read.php?tid=<tid>`，正则提取 `formhash`；
   - `POST /post.php?action=reply&tid=<tid>&fid=<fid>`，表单含 `subject`、`message`（BBCode）、`formhash`、`usesig=1`；
   - 解析响应：成功记录 `pid/floor`；失败按“未登录 / 权限不足 / 需要验证码 / 频率限制 / 网络错误”分类。
4. 成功后写 `nga.json` 与发布日志 `data/nga-post-log.json`，节列表显示“已发布”徽标。
5. 失败时保留“复制 BBCode”按钮作为兜底；同帖两次发送间隔不少于 10 秒。
6. 内容哈希变化时提示“本节已修改，是否重新发送”，不自动覆盖原楼层。

### 5.4 S2 测试与验收

- 离线 fixture：登录页 Cookie 检测、帖子页 formhash 解析、回复表单编码、错误关键词映射。
- 真实网络仅在手动验证：登录成功、发送一条测试回复、失效后重新登录。
- 验收：作品可关联帖子；已关联作品的每节可发送；发送失败有明确原因且可复制兜底；Cookie 加密存储不落明文。

## 6. S3：UI 设计系统与信息架构

### 6.1 视觉方向

二次元/安科氛围，但遵循“单一强调色 + 少量渐变 + 插画式空态”的克制原则：
- 主色：紫罗兰 `#7C5CFF`（亮色）/ `#A28CFF`（暗色）
- 辅助：青蓝 `#4EC9E1`、樱粉 `#FF8FB1`，仅用于标签与图表
- 中性色沿用现有 `--bg-*` / `--text-*` token，避免重新定义造成大面积回归
- 渐变仅用于首页 Hero、空态插画背景、选中态描边；正文与表单区不使用渐变

### 6.2 Token v2

- 字号阶：12 / 13 / 14 / 16 / 20 / 28 / 36；正文默认 14，阅读器 16–18；标题使用 `clamp()` 响应式
- 间距：4px 栅格，常用 4/8/12/16/20/24/32
- 控件高度：桌面 28（紧凑）/32（默认）/36（表单）；触屏最小 44
- 圆角：8（控件）/12（卡片）/16（弹窗与容器）
- 阴影：3 级（card / pop / modal），暗色主题用描边替代重阴影
- 动效：150ms `ease-out`，仅用于 hover、抽屉、弹窗；禁止列表大范围动画

### 6.3 组件原语

`AppShell`（桌面侧栏 / 移动 Tab）、`PageHeader`、`SectionHeader`、`Card`、`ListRow`、`Button`（primary/secondary/ghost/danger × sm/md/lg）、`Input`、`Textarea`、`Select`、`Tabs`、`Sheet`、`Modal`、`Badge`、`StatCard`、`LoadingState`、`EmptyState`、`ErrorState`。

所有原语满足：受控尺寸来自 token、支持键盘焦点环、纯图标按钮必须带 `aria-label`、触屏最小 44。

### 6.4 信息架构

一级导航：

| 区域 | 内容 | 原入口迁移 |
| --- | --- | --- |
| 作品 | 作品列表、最近作品、导入、收藏夹、EPUB 导出 | WorksListPage + 首页最近作品 |
| 发现 | 搜索安科、收集安科、收集安价 | FindAnkePage + AnkeCollectPage + AnjiaCollectPage |
| 创作 | 创作日志、资源库、模板、教程 | CreationLogPage + ResourceLibraryPage + TemplatesPage + TutorialPage |
| 娱乐 | 骰子、转盘 | DicePlaygroundPage + WheelPage |

桌面左侧栏宽 240px，底部固定设置与关于；移动端底部四 Tab（作品/发现/创作/娱乐），首页保留为“作品”仪表盘。首页 Hero 区放“继续创作”大卡片（最近编辑作品直入编辑器）。

### 6.5 迁移顺序

1. 建立 token v2 与原语（不改页面）
2. 作品区（WorksListPage / WorksViews / HomePage）
3. 编辑器与阅读器外壳（含三面板弹窗化，见 6.7）
4. 发现、创作、娱乐
5. 清理旧样式类与未使用组件

每步完成即跑 typecheck + vitest，并用桌面 1440/1280 与移动 390 截图核对。

### 6.6 S3 验收

- 全站使用原语组件，页面不再出现自定义按钮/输入框样式
- 字号仅使用 token 阶；控件高度符合 6.2
- 移动端可点击控件 ≥ 44×44
- 主导航可在一层内到达所有模块；“我的安科作品”在侧栏第一项且首页有一级入口
- 亮/暗/护眼三主题无对比度异常

### 6.7 编辑器面板弹窗化与“设定备忘录”改名

现状：世界观与人物角色常驻在 `EditorRightPanel` 的 Tab 中（`world`/`character`），大纲使用 `src/components/outline/OutlineTree.tsx` 与 `OutlineEditor.tsx` 内嵌展示，三者都挤占正文宽度。

改造后：

- 编辑器顶部工具栏右侧新增三个入口按钮：**设定备忘录**、**大纲**、**人物角色**，点击各自打开弹窗；右侧常驻面板只保留正文相关信息（如节属性/统计）。
- 三个弹窗统一使用 `Modal`：桌面宽 880px、高 80vh，移动端全屏 Sheet；支持 Esc 与遮罩关闭、焦点陷阱、打开时聚焦搜索/标题输入。
- 面板组件复用现有 `WorldSettingPanels`、`OutlineTree/OutlineEditor`、`CharacterPanels`，只改挂载位置，不改数据读写逻辑；弹窗关闭不丢失未保存草稿（草稿状态提升到 EditorPage）。
- **“世界观”统一更名为“设定备忘录”**：所有按钮、标题、空态、教程与测试文案同步修改。数据字段继续使用 `world_settings`，导出 JSON 字段名保持不变，确保旧文件与收集 JSON 可导入；仅在 UI 层使用新名称。
- 移动端入口收纳进工具栏“更多”，弹窗全屏显示，底部保留保存/关闭操作。

验收：编辑页不再出现三个常驻面板；三个入口均可从编辑界面直接打开；关闭弹窗后正文编辑状态不丢失；全库检索无残留“世界观”文案（数据字段与兼容层除外）。

## 7. S4：模块整合与增强

### 7.1 发现模块

- 单一页面 `DiscoverPage`，三个 Tab：搜索安科 / 收集安科 / 收集安价
- 共用：结果卡、筛选栏、站点选择、历史记录、错误与空态
- 数据来源：现有 `searchAnke`、`collectAnke`、`anjia` IPC 保持不变，仅收敛 UI 与状态

### 7.2 娱乐模块

- 单一 `FunPage`，两个 Tab：骰子 / 转盘
- 共用历史面板与结果展示；两套计算逻辑保持独立

### 7.3 创作日志增强

- 新增连续创作天数（由 `creationLogStats` 的日统计推导）
- 新增近一年热力图（53 周 × 7 天，色阶 4 档，使用强调色透明度）
- 新增目标：每日/每周字数目标存于设置；展示完成度、超欠与连续达标天数
- 保留现有统计卡与两张趋势图

### 7.4 作品入口强化

- 侧栏第一项 + 首页 Hero “继续创作”
- 作品卡片增加“最近编辑时间 / 节数 / 字数”与快捷操作（继续编辑、阅读、导出）

## 8. 测试与验证矩阵

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 数据内核 | Vitest + 临时目录 fixture | 迁移、原子写、恢复、三后端一致性、导入导出往返 |
| 编辑器 | Vitest + happy-dom | 图片解析/兜底、折叠/引用往返、切节、撤销、粘贴 |
| NGA | Vitest + HTML fixture | Cookie 检测、formhash、回复载荷、错误映射 |
| UI | 渲染测试 + 截图 | 原语行为、三主题、桌面/移动布局 |
| 回归 | typecheck + vitest + build | 每阶段完成必跑 |

不引入真实 NGA 网络测试，避免不稳定与账号风险；真实发帖仅手动验证。

## 9. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 迁移导致数据丢失 | 迁移前快照、逐文件校验、manifest 提交点、旧文件保留、可回滚开关 |
| 多文件部分写入 | 串行队列 + manifest 最后提交 + `.bak` 回退 |
| NGA 发帖被风控/验证码 | 发送前确认、10s 间隔、错误分类提示、复制 BBCode 兜底 |
| Cookie 泄露 | `safeStorage` 加密、渲染层不接触明文、退出即清除 |
| UI 重构范围过大 | 原语先行、逐页迁移、旧组件保留至替换完成 |
| 图片路径兼容 | 统一 `resolveImageSrc` + 保留全局 `images/` + 兜底占位 |

## 10. 阶段验收清单

- **S1**：作品目录化存储生效且旧数据完成迁移；导出始终为单个 JSON 文件；当前导出、收集安科 JSON、旧版导出 JSON 均可直接导入且往返一致；图片/折叠/引用在编辑区与阅读区正常显示；编辑无已知阻塞问题；全部测试通过。
- **S2**：应用内可登录 NGA；作品可关联帖子；每节可发送 BBCode 并回写楼层；失败有明确提示与复制兜底。
- **S3**：侧栏四区导航上线；“我的作品”成为首屏一级入口；组件尺寸/字号统一；三主题正常；设定备忘录/大纲/人物角色三个面板均由编辑界面弹窗打开，编辑区不再常驻侧栏面板。
- **S4**：发现模块三合一、娱乐模块二合一、创作日志含连续天数/热力图/目标进度；旧入口全部迁移且无死链。
