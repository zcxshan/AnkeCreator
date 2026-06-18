# AGENT.md — AI Agent 开发指南

> 本文件面向 AI Agent（Cursor / Trae / Copilot / Claude Code 等），描述项目架构、硬约束、开发约定、踩过的坑。  
> 人类开发者可参考 [README.md](./README.md)；本文件聚焦"如何修改本项目"。

## 1. 项目定位

**安科作者助手 (Anke Creator)** —— 桌面端安科写作工具。

- 桌面框架：Electron 33
- 前端：React 18 + TypeScript 5.6 + Vite 5
- 样式：TailwindCSS 3 + CSS 变量
- 状态：Zustand 4（含 persist）
- 富文本：原生 `contenteditable`（不依赖 Slate/ProseMirror）
- 数据：better-sqlite3 + JSON 文件双轨
- 打包：electron-builder 25

## 2. 目录结构

```
src/
├── components/
│   ├── character/      # CharacterEditor、CharacterCard、AttributeTable
│   ├── common/         # TitleBar、WorkCard、DirectoryTree、WorldSettingPanel、ConfirmDialog、InputDialog、UploadProgressDialog、LocalImageWarningDialog、LocalModeBanner
│   ├── dice/           # DiceConfigDialog、DiceCard、DiceNGAImportDialog
│   ├── editor/         # RichTextEditor、EditorToolbar、RelationshipPanel
│   ├── outline/        # OutlineEditor
│   └── pages/          # HomePage、EditorPage、WorksListPage、TemplatesPage、AnjiaPage、TutorialPage
├── db/                 # database.ts (better-sqlite3)
├── store/              # editorStore、diceStore、settingStore、storyStore、toastStore、metaStore、imageWarningStore
├── hooks/              # useSectionEditor 等
├── utils/              # ngaCrawler、anjiaHistory、ngaHtmlToBBCode、uploadImage、parseValueExpression、parseNgaAnjia
└── types/              # 全局 TS 类型
electron/
├── main.ts             # 主进程入口（IPC、菜单、窗口）
├── preload.ts          # 预加载（暴露 electronAPI）
├── db-main.ts          # 主进程数据库
└── imageHosting.ts     # 图床客户端
```

## 3. 硬约束（必须遵守）

### 3.1 数据 / 业务

- **角色名唯一**：创建或导入人物时不得重名
- **NGA 导出保留换行**：BBCode 转换不得把多行内容压成单行
- **图片 URL 必须可访问**：禁止 base64 兜底（不论远端还是本地模式）
- **base64 失败提示文案**：`请检查网络后重新选择`
- **远端图床**：uguu.se（单图床、永久、匿名、无 key；实测 1.8-2.5s 上传，URL 200，SHA256 一致）
- **历史失效图床**（已移除）：catbox.moe（TLS reset）、sm.ms（308→s.ee 需 key）、0x0.st（503 disabled）、telegra.ph（timeout）
- **本轮（2026-06-18）评估**（不接入）：
  - `img.remit.ee`：无公开 API（FAQ 明确"API 功能正在规划中，后续可能面向 Pro 用户开放"）
  - `imgbob.net`：访客上传可能过期 + 无公开 API
- **图片尺寸后缀**：full / `.medium.jpg` (640x?) / `.thumb.jpg` (320x240) / `.thumb_s.jpg` (130x91) / `.thumb_ss.jpg` (60x45)
- **base64 图片导出占位**：`[本地图片：name（已用占位符替换...）]`，截断到 20 字
- **local:// 图片导出占位**：`[本地图片：name（已用占位符替换）]`
- **NGA 导出不可达图片识别**（统一占位为 `[本地图片：name（已用占位符替换）]`）：
  - `data:image/...` 或含 `;base64,` 的 base64 data URL
  - `local://` 协议
  - `file://` 协议
  - Windows 绝对路径：`C:\...` / `C:/...` 等
  - Unix 绝对路径：`/...` 开头且第二字符非 `/`
- **local:// 协议**：必须做路径遍历保护（参见 `electron/main.ts` 实现）
- **NGA 匹配文本留空** = 抓取范围内全部楼层
- **安价历史** 上限 10 条，单条 items 截断到 100（防 localStorage 超限）

### 3.2 编辑器 / 富文本

- **图片 / 骰子 / 折叠都是原子块**：`display: inline-block`，可拖动
- **拖动图片**：`mousedown` 不能 preventDefault，否则会阻断 `dragstart`（仅 resize 句柄需要 preventDefault）
- **折叠块插入**：使用 `range.insertNode(DocumentFragment)` 而非 `execCommand('insertHTML')`（后者会导致标题溢出）
- **折叠块标题可编辑**：直接点击标题文字可改
- **代码块多行**：不压缩为单行
- **Word 模式**：
  - 折叠选区时按 style 按钮：应用样式（不 toggle）
  - 折叠选区 + 后续输入：activeStyles 翻转
  - B/I/U/S 同步 `activeStyles.{bold|italic|underline|strike}`
  - sup/sub 互斥
  - `handleBeforeInput` 支持 `insertText` / `insertReplacementText`，跳过 `insertCompositionText`（避免干扰 IME）
- **NGA 导出**：
  - 解析 `<span style="color|font-size|font-family|font-weight|font-style|text-decoration">` → NGA BBCode
  - 默认值（black/100%/simsun）不输出冗余标签
  - 嵌套标签智能合并（`collapseBbCode`）

### 3.3 状态 / 数据流

- **Works 列表**：pinned > starred > order_index > 更新时间
- **Works 拖拽排序**：持久化到 `order_index` 字段
- **图片存储模式**：通过 zustand persist 持久化到 localStorage（key: `anke-creator-settings`）
- **Works 导入**：按依赖顺序处理（story → volumes → chapters → sections → world_settings → characters + variants → relations → outlines），生成新 ID 避免冲突
- **Works 导出格式**：`.anke.json`，包含 `format/version/exportedAt/appVersion` 元数据

### 3.4 用户偏好（来自 user_profile.md）

- 通信语言：中文
- 优化项目代码时主动删除未用代码 / 文件
- 功能实现参考 NGA 编辑器
- 禁止添加未请求的功能
- 禁止跳过用户指定的需求
- 修改后必须做完整功能测试
- 禁止未经允许修改用户预设模板

## 4. 开发约定

### 4.1 IPC 模式

- **主进程**（`electron/main.ts`）：用 `ipcMain.handle('channel', async (_e, payload) => {...})`
- **preload**（`electron/preload.ts`）：包装为 `channelXxx: (args) => ipcRenderer.invoke('channel', args)`
- **expose**：`contextBridge.exposeInMainWorld('electronAPI', {...})`
- **类型**：在 `preload.ts` 内同时维护 `ElectronAPI` 接口

### 4.2 命名

- **组件**：`PascalCase.tsx`（如 `AnjiaPage.tsx`）
- **工具**：`camelCase.ts`（如 `ngaCrawler.ts`）
- **store**：`xxxStore.ts`（如 `diceStore.ts`）
- **类型**：导出 `interface` / `type` 用 `PascalCase`
- **常量**：`UPPER_SNAKE_CASE`

### 4.3 样式

- **统一使用 CSS 变量**：`var(--bg-base)` / `var(--text-primary)` / `var(--accent)` 等
- **禁止在工具栏 tab label 使用 emoji**（如已发现）
- **行内 hover 样式**：`onMouseEnter` / `onMouseLeave` 切换 CSS 变量

### 4.4 错误处理

- **Toast**：`useToastStore.showToast(msg, 'success' | 'error' | 'info' | 'warning', { undo?: fn })`
- **Toast 撤销**：`undo` 回调在 5s 内可点击
- **弹窗确认**：`ConfirmDialog`（二级确认）
- **弹窗输入**：`InputDialog`（替代 window.prompt）

## 5. 关键模式参考

### 5.1 NGA 抓取（主进程）

```ts
// electron/main.ts
ipcMain.handle('nga:collect', async (_e, payload) => {
  currentCollectingTaskId++;
  const taskId = currentCollectingTaskId;
  try {
    for (let page = startPage; page <= endPage; page++) {
      if (cancelledTaskIds.has(taskId)) break; // 取消检查
      // fetch + parse
    }
    return { ok: true, items, totalPages };
  } finally {
    cancelledTaskIds.delete(taskId); // 清理
  }
});
```

### 5.2 Toast 撤销模式

```tsx
showToast('已删除', 'info', {
  undo: () => {
    // 复原逻辑
  },
});
```

### 5.3 骰子预填选项

```ts
// diceStore.openDialog 支持 initialOptions
useDiceStore.getState().openDialog({
  initialKind: 'option',
  initialOptions: [{ displayValue: '1', content: '选项一' }, ...],
});
```

### 5.4 本地上传警告（统一 helper）

任何上传入口（EditorToolbar / TemplatesPage / CharacterEditor / CharacterEditorInline）开头都先调用：

```ts
const confirmed = await ensureLocalWarning();
if (!confirmed) return;  // 用户取消，中止上传
```

实现位置：`src/utils/uploadImage.ts`（同文件包含 `uploadImageFile` / `uploadImagesWithProgress`）。
Dialog 实现：`src/components/common/LocalImageWarningDialog.tsx`，订阅 `useImageWarningStore`。
编辑区常驻横幅：`src/components/common/LocalModeBanner.tsx`，订阅 `useSettingStore.imageStoreMode`。

设计要点：
- 全局 Zustand store（`useImageWarningStore`）管理 dialog 状态，避免 props drilling
- Dialog 在 `App.tsx` 顶层挂一次即可，所有入口都触发同一个 dialog
- 横幅是"被动提醒"（常驻），弹窗是"主动确认"（每次上传前）；两者文案一致
- 「不再提示」用 `localStorage` 持久化，跨会话免打扰；用户在「设置」可重置

## 6. 踩过的坑（必须避免）

1. **用属性名作为 input field key** → focus 丢失，必须用稳定唯一 ID
2. **Ctrl+A + Delete 删除图片/骰子** → 需手动 `remove()` 原子块
3. **`execCommand('insertHTML')` 插入折叠块** → 标题溢出，改用 `range.insertNode(DocumentFragment)`
4. **图片 mousedown preventDefault** → 阻断 dragstart，仅 resize 句柄需要
5. **SCHEMA_SQL 直接 schema_version=3** → 跳过 `seedPresetTemplates()`，改用 `is_preset` 记录存在性判断
6. **React.StrictMode 重复初始化数据库** → 用 `dbInitialized` flag 防重入
7. **sm.ms 国内不稳** → 透传错误让用户决定重试
8. **0x0.st 较稳**（CF CDN, 512MB），telegra.ph 最后兜底（5MB）
9. **toggle 与 apply 共存**：toggle 用于选区切换，apply 用于 Word 模式 set 行为
10. **koa-connect wrapper 导致 ctx 泄露** → 必须用原生 Koa middleware
11. **本地保存必须用真实绝对路径**（`filePath`），不能 `local://<hash>.<ext>` → 用户要求"图片链接就是图片的目录路径"，且避免用户跨设备/重新组织文件后失效
12. **警告弹窗必须覆盖所有上传入口**（EditorToolbar / TemplatesPage / CharacterEditor / CharacterEditorInline）→ 用全局 Zustand store（`useImageWarningStore`）集中管理，避免 props drilling；dialog 在 App 顶层挂一次，订阅 `open` 状态

## 7. 测试

```bash
npx tsc --noEmit          # 0 错误
npx vite build            # 0 错误
cd electron && npx tsc --noEmit   # 0 错误
```

## 8. 修改前自检清单

- [ ] 改动是否触达 3.1 / 3.2 / 3.3 的硬约束？
- [ ] 是否需要同步更新 `TutorialPage.tsx`（用户面向的教程）？
- [ ] 是否需要同步更新 `README.md`（功能亮点）？
- [ ] 是否需要同步更新本 `AGENT.md`（如果新增了硬约束或关键模式）？
- [ ] 是否引入了新的 IPC 通道？→ 同时改 `electron/main.ts` + `electron/preload.ts` + `ElectronAPI` 类型
- [ ] 是否添加了新的 zustand store？→ 考虑是否需要 persist
- [ ] 是否修改了样式？→ 优先使用现有 CSS 变量，避免新增硬编码颜色
- [ ] 是否需要本地运行 `npm run dev` 做烟测？

## 9. 常用命令

```bash
# 开发
npm run dev

# 打包
npm run build

# 类型检查
npx tsc --noEmit

# 单独构建
npx vite build
```

## 10. 联系 / 反馈

- Issues：项目 GitHub Issues
- 内部对话：参考 `.trae/documents/` 下的轮次计划文件
