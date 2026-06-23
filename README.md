# 安科作者助手 (Anke Creator)

用骰子编织故事 —— 一款专为安科创作设计的桌面编辑器。

## 功能亮点

- 🎲 **骰子系统**：数值骰子（`NdM±K` / 表达式 `2*3d100`）与选项骰子；支持 NGA 文本导入（粘贴 `1楼 用户名：内容` 自动生成选项骰子）；导出 NGA BBCode；投掷时有简洁的旋转动画
- 📖 **章节管理**：多卷 / 多章 / 多节的层级目录结构，拖拽排序，**跨卷 / 跨章拖动**
- 🌍 **世界观设定**：结构化世界观设定，支持模板导入/导出
- 👤 **人物角色**：角色属性、差分图片管理，批量上传，人物关系图
- 📝 **大纲规划**：独立的大纲系统，支持与目录双向同步
- 🖼️ **富文本编辑**：所见即所得编辑器，支持图文混排、骰子卡片插入，原子块（图片 / 骰子 / 折叠）可拖动
- 📜 **收集安价**：从 NGA 主题帖抓取匹配楼层（可留空匹配文本 = 全部），支持取消、自动检测总楼层、历史记录（10 条）、单条删除 + 撤销、NGA BBCode 复制。**反爬加固**：1200ms ±300ms 抖动间隔 + 403/429 退避 3s
- 🛡️ **NGA 防盗链绕过**：主进程 `webRequest.onBeforeSendHeaders` 自动注入 `Referer: https://nga.178.com/`
- 🖼️ **图片存储模式**（设置可切换）：
  - **远端图床**（默认）：uguu.se（永久、匿名、无 key；SHA256 一致）
  - **本地保存**：用图片的**绝对路径**作为 URL，编辑区顶部常驻黄色警告横幅，每次上传前弹窗确认
  - **base64 兜底已禁用**（确保图片 URL 一定可访问）
- ⚠️ **本地上传警告**：编辑区顶部常驻黄色横幅 + 上传前弹窗确认（4 个入口全覆盖：编辑器工具栏 / 模板库 / 角色编辑器 / 内联角色编辑）
- 📋 **NGA 导出**：一键导出当前节为 NGA BBCode 格式；颜色/字号/字体/加粗/斜体/下划线/列表/引用/折叠/代码/表格/链接/骰子全部对应 NGA 标签；自动识别 base64 / local:// / file:// / 绝对路径并替换为占位符
- 💾 **数据备份**：导出/导入 `.anke.json` 格式作品数据（章节、世界观、人物差分、大纲、关系）

## 技术栈

- **桌面框架**：Electron 33
- **前端**：React 18 + TypeScript 5.6 + Vite 5
- **样式**：TailwindCSS 3
- **状态管理**：Zustand 4
- **富文本**：contenteditable 原生编辑器
- **数据存储**：主进程 JSON 文件 + 渲染层 IndexedDB（移动端 / 浏览器降级）
- **桌面打包**：electron-builder 25（NSIS x64）
- **移动端打包**：Capacitor 6（Android）

## 平台支持矩阵

| 平台 | 状态 | 打包命令 | 产物 |
| --- | --- | --- | --- |
| **Windows** | ✅ 主推 | `npm run build:win` | `dist-release/*.exe` |
| **Android** | ✅ 移动端 | `npm run cap:build:apk` | `android/app/build/outputs/apk/*.apk` |
| **macOS** | ⏳ 暂缓 | — | — |
| **Linux** | ⏳ 暂缓 | — | — |
| **Web** | ⚠️ 实验性 | `npm run build-web` | `dist/` |

> 移动端打包代码全部受 `isElectron` / `isWeb` 检查保护（`src/utils/platform.ts`），不影响 Windows 功能。

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- Android 打包需要：JDK 17 + Android SDK + Gradle（通过 `npm run cap:open:android` 打开 Android Studio）

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev          # 启动 Vite + Electron，自动 reload
```

### 打包命令

| 命令 | 用途 |
| --- | --- |
| `npm run build:win` | **Windows 安装包**（NSIS + x64 + 桌面快捷方式 + 协议关联） |
| `npm run build` | 编译 + Vite + electron-builder 全套 |
| `npm run build:icons` | 从 PNG 生成 ICO 图标（脚本：`scripts/generate-icon.js`） |
| `npm run build:full` | 完整流程（图标生成 → 编译 → 打包 → 清缓存） |
| `npm run build-web` | 仅前端构建（用于 Capacitor） |
| `npm run cap:sync` | 同步 web 产物到 Capacitor |
| `npm run cap:open:android` | 打开 Android Studio |
| `npm run cap:build:apk` | **Android Debug APK**（`assembleDebug`） |
| `npm run cap:build:apk:release` | **Android Release APK**（`assembleRelease`） |
| `npm run preview` | Vite 预览构建产物 |

### Windows 打包产物

```
dist-release/
└── 安科作者助手-2.2.0-x64-setup.exe    # NSIS 安装包
```

## 数据存储

所有用户数据（作品、人物、世界观、模板等）存储在应用数据目录下，使用 JSON 文件格式自动保存。

- **Windows**: `%APPDATA%/AnkeCreator/AnkeCreatorData`
- **Android**: `/data/data/com.shanshian.ankecreator/`
- **Web 模式**：浏览器 IndexedDB（`anke-creator` 库）

## 项目结构

```
AnkeCreator/
├── electron/                  # Electron 主进程
│   ├── main.ts                # 入口 + window 管理 + IPC 注册（~125 行）
│   ├── preload.ts             # 预加载桥接（window.dbAPI / electronAPI）
│   ├── protocol.ts            # local:// 协议 + NGA Referer 钩子
│   ├── ngaCrawler.ts          # NGA 安价抓取（含反爬限流）
│   ├── imageUploader.ts       # 图片上传（远端 / 本地 / 选择 / 打开目录）
│   ├── db-main.ts             # 主进程 JSON 数据库
│   ├── imageHosting.ts        # 图床选择
│   └── ipc/                   # IPC handler 域拆分
│       ├── index.ts           # 统一注册入口
│       ├── story.ts           # 作品 IPC
│       ├── character.ts       # 角色 + 差分 IPC
│       ├── world.ts           # 世界观 IPC
│       ├── template.ts        # 模板 IPC
│       ├── relation.ts        # 人物关系 IPC
│       ├── outline.ts         # 大纲 IPC
│       ├── structure.ts       # 卷/章/节 IPC
│       └── system.ts          # 窗口控制 + 数据目录
│
├── src/                       # 渲染层（React 18 + TypeScript）
│   ├── components/            # UI 组件（按 feature 分组）
│   │   ├── character/         # 角色编辑器
│   │   ├── common/            # 通用组件
│   │   ├── dice/              # 骰子系统
│   │   ├── editor/            # 富文本编辑器
│   │   ├── outline/           # 大纲系统
│   │   └── pages/             # 页面组件
│   ├── db/                    # 数据库 facade
│   │   ├── index.ts           # 统一 re-export
│   │   ├── story.ts           # 作品 facade
│   │   ├── character.ts       # 角色 + 差分 facade
│   │   ├── world.ts           # 世界观 facade
│   │   ├── template.ts        # 模板 facade
│   │   ├── relation.ts        # 关系 facade
│   │   ├── outline.ts         # 大纲 facade
│   │   ├── structure.ts       # 卷/章/节 facade
│   │   ├── shared.ts          # 内部工具（uuid4 / nowISO / parseJSON / 内存 SQL）
│   │   ├── browserIndexedDB.ts# IndexedDB 移动端 / Web 实现
│   │   └── database.ts        # 旧版入口（re-export 向后兼容）
│   ├── store/                 # Zustand 状态（10 个 store）
│   ├── hooks/                 # 自定义 Hooks
│   ├── utils/                 # 工具函数
│   │   ├── platform.ts        # isElectron / isCapacitor / isWeb / isMobile
│   │   ├── uploadImage.ts     # 图片上传核心
│   │   ├── ngaCrawler.ts      # NGA 抓取核心
│   │   ├── ngaHtmlToBBCode.ts # NGA BBCode 导出
│   │   ├── htmlToNGABBCode.ts # HTML → BBCode 转换
│   │   ├── localImageWarning.ts # 本地上传警告
│   │   └── ...
│   ├── types/                 # TypeScript 类型定义
│   │   ├── index.ts           # 统一 re-export
│   │   ├── entity.ts          # Entity 基类
│   │   ├── story.ts           # Story / Volume / Chapter / Section
│   │   ├── character-world-outline.ts
│   │   ├── outline.ts         # Outline + 解析函数
│   │   ├── editor.ts          # NGA_*/WORD_* 常量
│   │   ├── dice.ts            # 骰子类型
│   │   └── anjia.ts           # NGA 导出器类型
│   ├── App.tsx
│   └── main.tsx
│
├── build/                     # 打包资源
│   ├── icon.png               # 应用图标（PNG）
│   ├── icon.ico               # Windows 图标
│   ├── installerIcon.ico      # 安装包图标
│   ├── uninstallerIcon.ico    # 卸载图标
│   └── LICENSE.txt            # MIT 协议
│
├── database/                  # 数据库 schema（保留以备 SQLite 迁移）
│   └── schema.sql
│
├── public/                    # 静态资源
│
├── capacitor.config.ts        # Capacitor 移动端配置
├── vite.config.ts             # Vite 构建配置（含 path alias）
├── tsconfig.json              # 基础 tsconfig（含 references）
├── tsconfig.renderer.json     # 渲染层（DOM lib + vite/client）
├── tsconfig.electron.json     # 主进程（Node lib）
├── tsconfig.node.json         # vite.config.ts
├── package.json
└── README.md
```

## 关键功能说明

### 1. 反爬加固（NGA 抓取）

- 限流基线 **1200ms + ±300ms 随机抖动**（避免固定间隔被识别）
- HTTP 403/429 检测到时 **退避 3 秒**（NGA 限流信号）
- 主进程 `webRequest.onBeforeSendHeaders` 钩子自动注入 `Referer: https://nga.178.com/`

### 2. 本地图片保存

- 用图片的 **绝对路径** 作为 URL
- 编辑区顶部常驻黄色警告横幅（4 个入口全覆盖：编辑器工具栏 / 模板库 / 角色编辑器 / 内联角色编辑）
- 上传前弹窗确认（可"不再提醒"）

### 3. 跨卷 / 跨章拖动

- 卷与章之间：拖动章到另一个卷（`db:move-chapters`）
- 章与节之间：拖动节到另一个章（`db:move-sections`）
- 顺序持久化（`order_index` 字段）

### 4. NGA BBCode 导出

支持所有常用标签：
- 文本格式：`[b]` / `[i]` / `[u]` / `[s]` / `[color=*]` / `[size=*%]` / `[font=*]`
- 段落：`[list]` / `[list=1]` / `[*]` / `[quote]` / `[code]` / `[collapse=标题]`
- 媒体：`[img]` / `[url=链接]文本[/url]` / `[table]` / `[tr]` / `[td]`
- 骰子：数值骰 `[b]标题 ROLL 1d100=52[/b]` / 选项骰 ≤10 个 `[quote]…[/quote]` / >10 个 `[collapse=…]…[/collapse]`
- 自动识别 base64 / local:// / file:// / 绝对路径 → 占位符

### 5. 数据导入导出

- 导出 `.anke.json`（含 metadata `format/version/exportedAt/appVersion` + 完整数据 story → volumes → chapters → sections → world_settings → characters + variants → relations → outlines）
- 导入时按依赖顺序处理（先生成新 ID 避免冲突）

## 路径别名（path alias）

- `@/...` → `src/...`
- `@electron/...` → `electron/...`

> path alias 是基础设施，**不强制改 import**。现有 import 路径保持不变。

## License

MIT
