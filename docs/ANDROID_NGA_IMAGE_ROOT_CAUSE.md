# Android 端 NGA 图片显示根因分析

> 本文档记录 Android 端浏览/导入 NGA 帖子时部分图片无法显示的根因，以及当前已采取的缓解措施和后续可能的解决方案。
> 本文档仅作记录用途，不包含代码改动。

## 一、现象

在 Android 端（Capacitor WebView）使用安科作者助手时：

- 浏览 NGA 安科帖子的图片（如 `img.nga.178.com`、`img.nga.cn` 等域名下的图片）无法显示，仅显示破图占位
- 桌面端（Electron）访问同一帖子时图片正常显示
- 通过"收集安科"功能导入的 NGA 帖子，其 BBCode 中的 NGA 图片链接在 Android 端预览/编辑时同样无法显示

## 二、根因分析

### 1. NGA 论坛对图片请求做 Referer 校验

NGA 论坛的图片服务器（`img.nga.178.com`、`img.nga.cn` 等）会对 HTTP 请求的 `Referer` 头进行校验：
- 缺失 `Referer` 或 `Referer` 不是 NGA 站点（如 `https://ngabbs.com/`、`https://nga.178.com/`）的请求会被服务器拒绝（返回 403 Forbidden）
- 这是一种常见的"防盗链"机制，用于防止其他网站直接引用 NGA 的图片资源

### 2. 桌面端 vs Android 端的实现差异

**桌面端（Electron）**：
- Electron 主进程可以通过 `session.defaultSession.webRequest.onBeforeSendHeaders` 钩子拦截并修改所有 HTTP 请求头
- 已在 `electron/protocol.ts` 的 `setupNgaRefererHook()` 中实现：对 `*://*.nga.178.com/*` 的请求自动注入 `Referer: https://nga.178.com/`
- 因此桌面端图片显示正常

**Android 端（Capacitor WebView）**：
- Capacitor 在 Android 平台上使用 Android System WebView 加载页面
- WebView 默认不会为 `<img>` 标签的图片请求携带 `Referer` 头（或携带的 Referer 是 `capacitor://` 之类的自定义 scheme，不被 NGA 服务器接受）
- Capacitor 的 WebView **不暴露**类似 Electron 的 `webRequest.onBeforeSendHeaders` 钩子，前端 JS 无法拦截或修改图片请求头
- Android 原生的 `WebView.setWebViewClient` + `shouldInterceptRequest` 可以拦截请求，但 Capacitor 框架内部已封装 WebView，无法直接介入

### 3. CORS 与前端代理的限制

理论上可以通过前端 JS 拉取图片二进制后转 Blob URL 显示，但：
- NGA 图片服务器不返回 CORS 头（`Access-Control-Allow-Origin`），前端 `fetch` 请求会因 CORS 失败
- Capacitor 的 `CapacitorHttp` 插件可以绕过 CORS（在原生层发起请求），但需要为每张图片手动调用，无法拦截 `<img>` 标签的原生图片加载
- 即使拉取到二进制，也需要为每张图片生成 Blob URL 并替换 `<img src>`，性能开销大且与 contenteditable 编辑器集成困难

### 4. NGA 图片域名多样性

NGA 的图片分布在多个域名：
- `img.nga.178.com`
- `img.nga.cn`
- `pic.nga.178.com`
- 部分用户上传的图片走第三方图床（如 `imgur.com`、`catbox.moe` 等），这些图床的防盗链策略各不相同

每个域名都需要单独处理 Referer，增加了实现复杂度。

## 三、当前缓解措施

### 桌面端

✅ 已实现：`electron/protocol.ts` 的 `setupNgaRefererHook()` 在主进程注入 `Referer: https://nga.178.com/`，覆盖 `*://*.nga.178.com/*` 的请求。

### Android 端

⚠️ **暂无完美方案**。当前建议用户：

1. **复制图片链接到系统浏览器查看**：长按图片 → 复制链接地址 → 在 Chrome/Firefox 中打开
2. **导入帖子后替换图片链接**：用"收集安科"导入帖子后，在 BBCode 视图中将 NGA 图片 URL 替换为图床直链（如上传到 catbox/sm.ms 后替换）
3. **优先使用 BBCode 视图**：BBCode 视图不渲染图片，仅显示 `[img]url[/img]` 文本，不会触发图片加载，避免破图干扰编辑

## 四、后续可能的解决方案

以下方案均**不在本轮实现**，仅作记录供未来参考：

### 方案 A：Capacitor 本地 HTTP 代理插件

使用 `@capacitor-community/http` 或自定义 Capacitor 插件，在原生层（Java/Kotlin）发起图片请求并注入 Referer，返回二进制数据给前端，前端再生成 Blob URL 替换 `<img src>`。

**优点**：可以精确控制每个请求的头信息
**缺点**：
- 需要为每张图片手动调用，无法自动拦截 `<img>` 加载
- 性能开销大（每张图片都要 JS ↔ 原生通信 + Blob URL 生成）
- 与 contenteditable 编辑器集成复杂（需在渲染前预处理所有 img src）

### 方案 B：Android 原生 WebView 拦截

修改 Capacitor 的 Android 工程源码（`android/app/src/main/java/.../MainActivity.java`），覆写 `shouldInterceptRequest`，对 NGA 图片域名注入 Referer。

**优点**：自动拦截所有图片请求，对前端透明
**缺点**：
- 修改 Capacitor 框架行为，升级 Capacitor 版本时可能冲突
- 需要维护 Java/Kotlin 代码
- 仅 Android 端有效，iOS 端需另外实现

### 方案 C：服务端图片代理

部署一个轻量服务端代理（如 Cloudflare Worker、Vercel Edge Function），前端将 NGA 图片 URL 转换为代理 URL（如 `https://my-proxy.workers.dev/?url=https://img.nga.178.com/xxx.jpg`），代理服务端注入 Referer 后转发图片。

**优点**：跨平台（Android/iOS/Web 都可用），不依赖原生代码
**缺点**：
- 需要维护服务端，有运行成本
- 代理服务可能被滥用（需加鉴权或速率限制）
- 增加图片加载延迟（多一跳）

### 方案 D（推荐）：BBCode 预处理 + 用户引导

不试图在 Android 端实时显示 NGA 图片，而是：
- 在导入 NGA 帖子时，自动将 BBCode 中的 NGA 图片链接替换为占位符（如 `[图片加载失败，点击复制链接查看：xxx]`）
- 在设置中提供"批量替换 NGA 图片为图床直链"的工具（用户上传到 catbox 后一键替换）

**优点**：实现简单，无原生代码依赖，用户体验明确
**缺点**：用户需要手动操作，无法在 Android 端直接预览 NGA 图片

## 五、结论

Android 端 NGA 图片显示问题是平台限制导致的，并非应用 Bug。当前桌面端已通过 Electron 主进程钩子解决，Android 端建议用户使用替代方案（系统浏览器查看 / 替换图床链接）。若未来用户反馈强烈，可考虑实现方案 C（服务端代理）或方案 D（BBCode 预处理）。
