# 本地打包指南（Windows + Android）

本文档面向需要从源代码本地打包出可分发安装包 / APK 的开发者。

> 日常开发用 `npm run dev`（HMR）即可，不需要打包。打包只在以下情况需要：
> - 发布新版本（Windows 安装包 / Android APK）
> - 测试完整构建流程
> - 自定义签名

## 目录

- [环境要求](#环境要求)
- [Windows 打包](#windows-打包)
- [Android 打包](#android-打包)
- [签名密钥管理](#签名密钥管理)
- [常见问题](#常见问题)

---

## 环境要求

### 基础
- **Node.js** >= 18（推荐 LTS）
- **npm** >= 9
- **Git**（克隆项目）

### Windows 打包
- Windows 10/11 操作系统
- 约 2GB 磁盘空间（构建产物）
- 已自带所有依赖（electron-builder 是 npm 依赖）

### Android 打包
- **JDK 17**（推荐 Adoptium Temurin）
- **Android Studio Hedgehog (2023.1.1)** 或更新
- **Android SDK**：compileSdk 34 / minSdk 22 / targetSdk 34
- **Gradle**（Android Studio 自带）
- 约 5GB 磁盘空间（首次会下载 Gradle 依赖）

环境变量：
```
JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.x.x-hotspot\
ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
```

---

## Windows 打包

### 快速打包

```bash
npm install                  # 装依赖
npm run build:win            # 一键打包
```

### 产物位置

```
release/
└── 安科作者助手-2.2.0-x64-setup.exe   # NSIS 安装包
```

### 验证

1. 双击 exe 安装
2. 启动应用
3. 检查：作品列表、编辑器、图片上传、NGA 抓取全部正常

### 数据存储位置

应用数据存放在 **安装路径下的 `data/` 文件夹**（不是 C 盘的 `%APPDATA%`）：

```
<安装路径>/
├── 安科作者助手.exe
├── resources/
└── data/                       ← 数据目录
    ├── AnkeCreatorData/        ← JSON 数据库（作品、世界观、人物、章节等）
    │   ├── stories.json
    │   ├── world_settings.json
    │   ├── characters.json
    │   ├── sections.json
    │   └── ... (其他 JSON)
    ├── images/                 ← 本地保存的图片（local:// 协议）
    └── .migrated-from-appdata  ← 迁移标记（v3.0 之前从 %APPDATA% 迁移后生成）
```

> 💡 首次启动 v3.0+ 时，会自动把 v3.0 之前位于 `%APPDATA%\com.shanshian.ankecreator\` 下的旧数据复制到新位置，**原数据保留**作为备份，确认新位置正常后可手动删除。
> 💡 `npm run dev`（开发模式）下数据仍走 `%APPDATA%`，与生产数据隔离。

### 卸载行为

应用使用 NSIS 自定义卸载脚本（`build/installer.nsh`），卸载时行为如下：

- **默认询问**：弹出 MessageBox「是否同时删除所有个人数据？」（默认按钮 = 「是」）
- **选「是」**：
  - 递归删除 `<安装路径>\data\`（主清理目标）
  - 兜底递归删除 `%APPDATA%\com.shanshian.ankecreator\`（兼容 v3.0 之前未迁移的老数据）
  - 兜底递归删除 `%APPDATA%\安科作者助手\`（历史命名兼容）
  - 兜底递归删除 `%LOCALAPPDATA%\com.shanshian.ankecreator\` 和 `%LOCALAPPDATA%\安科作者助手\`
  - 覆盖 Electron 全部 IndexedDB / Cache / Cookie
- **选「否」**：保留 `<安装路径>\data\`，下次重装自动恢复

> 💡 应用内也提供「设置 → 数据管理 → 清空所有本地数据」按钮，可在卸载前主动清理。
> 💡 「了解卸载行为」按钮弹出系统对话框，展示完整说明（含当前模式下的具体路径）。

### 自定义图标

```bash
# 替换 build/icon.png 后
npm run build:icons          # 重新生成 build/icon.ico
npm run build:win
```

---

## Android 打包

### 首次打包（团队成员）

```bash
# 1. 装依赖
npm install

# 2. 生成 release 签名 keystore
#    提示输入密码、DN 等信息（直接回车使用默认值）
npm run keystore:gen

# 3. 同步 web 产物到 Android 工程
npm run cap:sync

# 4. 打开 Android Studio 编辑 / 调试
npm run cap:open:android
#    或直接命令行打 debug APK
npm run cap:build:apk
```

### 发布版 APK

```bash
# 必须先生成 keystore
npm run keystore:gen

# 构建签名 release APK
npm run cap:build:apk:release
```

### 产物位置

```
android/app/build/outputs/apk/
├── debug/app-debug.apk              # 调试包
└── release/app-release.apk          # 发布包（已签名）
```

### 卸载行为

Android 卸载时行为：

- **系统卸载**：自动清空 app 私有目录（`/data/data/<package>/`），包括：
  - WebView 缓存（图片缓存、JS 缓存等）
  - WebView IndexedDB（包含 zustand persist 持久化的设置）
  - WebView localStorage（主题、安价历史等）
  - 所有用户保存的作品数据
- **云备份已禁用**：`android:allowBackup="false"` + `android:dataExtractionRules="@xml/data_extraction_rules"`
  - 不备份到 Google Drive，避免卸载重装后从云端恢复旧数据
  - 设备转移（device-transfer）保留：换机迁移时数据仍跟随

> 💡 卸载时无需额外操作，Android 系统会自动清理所有应用数据。
> 💡 如需在卸载前主动清空数据，可使用应用内「设置 → 数据管理 → 清空所有本地数据」（仅 Windows 端有效，Android 通过系统卸载即可）。

### 验证签名

```bash
# 验证 APK 签名
apksigner verify --verbose android/app/build/outputs/apk/release/app-release.apk

# 查看 APK 元信息（包名 / 版本 / 图标）
aapt dump badging android/app/build/outputs/apk/release/app-release.apk
```

应该看到：
- `package: name='com.shanshian.ankecreator'`
- `application-label:'安科作者助手'`
- `application: icon='...'`

---

## 签名密钥管理

### 文件位置

| 文件 | 路径 | 入仓 |
|---|---|---|
| **keystore** | `android/app/anke-release.jks` | ❌ 不入仓 |
| **密码配置** | `android/keystore.properties` | ❌ 不入仓 |

### ⚠ 关键提醒

- **keystore 文件丢了 = 用户无法升级你的应用**（必须用同 keystore 重新签名）
- 备份建议：云盘（加密）/ 密码管理器 / 加密 USB
- 团队每个成员可以生成自己的 keystore（同一应用不同 keystore 签名的 APK 不能相互升级）
- 主开发者的 keystore 必须妥善保管

### 重新生成 keystore

```bash
# 删除旧 keystore 后重新生成
del android\app\anke-release.jks
del android\keystore.properties
npm run keystore:gen
```

> ⚠ 警告：删 keystore 前确认已有应用**未上架**或**已下架**，否则用户无法升级。

### 给团队成员的 keystore

每个开发者本地生成自己的 keystore 即可，不需要共享：
```bash
git clone <repo>
cd AnkeCreator
npm install
npm run keystore:gen
```

---

## 常见问题

### Q: `npm run cap:build:apk:release` 失败：找不到 keystore

**A**: 还没生成 keystore。跑：
```bash
npm run keystore:gen
```

### Q: `cap sync` 失败

**A**: 先跑前端构建：
```bash
npm run build-web
npm run cap:sync
```

### Q: Android 第一次打包很慢

**A**: 正常。需要下载 Gradle wrapper + Android Gradle Plugin + 各种依赖（~500MB）。后续会快很多。

### Q: Windows 安装包被 Windows Defender 报警

**A**: 当前项目**未做代码签名**（EV 证书约 3000 美元/年）。Defender 提示"未知发布者"是正常的，用户点"仍要运行"即可。商业发布前建议申请代码签名证书。

### Q: 怎样自动递增版本号？

**A**: 手动改 `package.json` 的 `"version"`。Capacitor 会自动从 `package.json` 同步到 `android/app/build.gradle` 的 `versionName`（cap sync 之后）。`versionCode` 需要手动改（每次发布 +1）。

### Q: 怎样打 Windows 便携版（不需安装）？

**A**: `npm run build:win` 会在 `release/win-unpacked/` 生成可执行文件 + DLL 依赖，可直接打包成 zip 分发。

### Q: 怎样给不同渠道打包（多 APK）？

**A**: 需要用 Gradle product flavors 或 build variants，超出本文档范围。

---

## 详细命令清单

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发模式（Vite + Electron HMR） |
| `npm run build:win` | Windows 安装包 |
| `npm run build-web` | 仅前端构建（用于 Capacitor） |
| `npm run cap:sync` | 同步前端产物到 Android |
| `npm run cap:open:android` | 打开 Android Studio |
| `npm run cap:build:apk` | Android Debug APK |
| `npm run cap:build:apk:release` | Android Release APK（已签名） |
| `npm run keystore:gen` | 生成 Android release keystore |
| `npm run build:icons` | 从 PNG 重新生成 Windows 图标 |
| `npm run build` | 编译 + 打包（完整） |
| `npm run build:full` | 含图标生成的完整打包流程 |

---

## 进阶

### 同时打 Windows + Android

```bash
# Windows
npm run build:win

# Android
npm run cap:build:apk:release
```

### 修改应用版本

1. 改 `package.json`：
   ```json
   "version": "2.3.0"
   ```
2. Android：`android/app/build.gradle` 的 `versionCode` +1、`versionName` 同步
3. 重新打包
