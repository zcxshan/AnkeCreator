# 安科作者助手 (Anke Creator)

用骰子编织故事 —— 一款专为安科创作设计的桌面编辑器。

## 功能亮点

- 🎲 **骰子系统**：数值骰子（`NdM±K` / 表达式 `2*3d100`）与选项骰子；支持 NGA 文本导入（粘贴 `1楼 用户名：内容` 自动生成选项骰子）；导出 NGA BBCode
- 📖 **章节管理**：多卷 / 多章 / 多节的层级目录结构，拖拽排序
- 🌍 **世界观设定**：结构化世界观设定，支持模板导入/导出
- 👤 **人物角色**：角色属性、差分图片管理，批量上传，人物关系图
- 📝 **大纲规划**：独立的大纲系统，支持与目录双向同步
- 🖼️ **富文本编辑**：所见即所得编辑器，支持图文混排、骰子卡片插入，原子块可拖动
- 📜 **收集安价**：从 NGA 主题帖抓取匹配楼层（可留空匹配文本 = 全部），支持取消、自动检测总楼层、历史记录（10 条）、单条删除 + 撤销、NGA BBCode 复制
- 🖼️ **图片存储模式**（设置可切换）：
  - **远端图床**（默认）：catbox.moe → sm.ms → 0x0.st → telegra.ph 自动回退
  - **本地保存**：保存到 `userData/images/`，使用 `local://` 协议（带路径遍历保护）
  - **base64 兜底已禁用**（确保图片 URL 一定可访问）
- 📋 **NGA 导出**：一键导出当前节为 NGA BBCode 格式；颜色/字号/字体/加粗/斜体/下划线/列表/引用/折叠/代码/表格/链接/骰子全部对应 NGA 标签
- 💾 **数据备份**：导出/导入 `.anke.json` 格式作品数据（章节、世界观、人物差分、大纲）

## 技术栈

- **桌面框架**：Electron 33
- **前端**：React 18 + TypeScript 5.6 + Vite 5
- **样式**：TailwindCSS 3
- **状态管理**：Zustand 4
- **富文本**：contenteditable 原生编辑器
- **打包**：electron-builder 25

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 打包发布

```bash
npm run build
```

打包产物位于 `release/` 目录。

## 数据存储

所有用户数据（作品、人物、世界观、模板等）存储在应用数据目录下的 `AnkeCreatorData` 文件夹中，使用 JSON 文件格式自动保存。

- **Windows**: `%APPDATA%/AnkeCreator/AnkeCreatorData`
- **macOS**: `~/Library/Application Support/AnkeCreator/AnkeCreatorData`
- **Linux**: `~/.config/AnkeCreator/AnkeCreatorData`

## 项目结构

```
src/
├── components/       # UI 组件
│   ├── character/    # 角色编辑器
│   ├── common/       # 通用组件（目录树、弹窗等）
│   ├── dice/         # 骰子系统
│   ├── editor/       # 富文本编辑器
│   ├── outline/      # 大纲系统
│   └── pages/        # 页面组件
├── db/               # 数据库操作层
├── store/            # Zustand 状态管理
├── hooks/            # 自定义 Hooks
├── utils/            # 工具函数
└── types/            # TypeScript 类型定义
electron/
├── main.ts           # Electron 主进程
├── preload.ts        # 预加载脚本
└── db-main.ts        # 主进程数据库（JSON 文件存储）
```

## License

MIT