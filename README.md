# 安科作者助手 (Anke Creator)

用骰子编织故事 —— 一款专为安科创作设计的桌面编辑器。

## 功能亮点

- 🎲 **骰子系统**：内置多种骰子类型（1d2、1d10、1d100），支持自定义范围
- 📖 **章节管理**：多卷、多章、多节的层级目录结构，拖拽排序
- 🌍 **世界观设定**：结构化世界观设定，支持模板导入/导出
- 👤 **人物角色**：角色属性、差分图片管理，人物关系图
- 📝 **大纲规划**：独立的大纲系统，支持与目录双向同步
- 🖼️ **富文本编辑**：所见即所得编辑器，支持图文混排、骰子卡片插入
- 📋 **NGA 导出**：一键导出当前节为 NGA BBCode 格式

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