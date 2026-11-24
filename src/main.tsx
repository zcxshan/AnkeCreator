import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useEditorStore } from './store/editorStore'
import { useSettingStore } from './store/settingStore'
import { setNgaUrlConfigProvider, setNgaUrlPrefixProvider } from './utils/ngaUrl'
import { isCapacitor } from './utils/platform'

// 注入「NGA url 头部」读取器：BBCode→HTML 展开相对图片/BGM 地址时使用
setNgaUrlPrefixProvider(() => useSettingStore.getState().ngaUrlPrefix)
// 注入完整规则配置：编辑界面拼接候选前缀 / 失效自动切换下一个前缀
setNgaUrlConfigProvider(() => ({
  patterns: useSettingStore.getState().ngaUrlPatterns,
  prefixes: useSettingStore.getState().ngaUrlPrefixes,
  autoPrefix: useSettingStore.getState().ngaAutoPrefixEnabled,
}))

// 给 <html> 打上 Capacitor 平台 class（capacitor-platform-android / -ios）。
// index.css 里针对安全区、键盘隐藏底栏、触摸/选中优化的选择器都依赖它，
// 缺失会导致这些移动端样式整体失效。
if (isCapacitor) {
  const platform = window.Capacitor?.getPlatform?.() || 'android'
  document.documentElement.classList.add(`capacitor-platform-${platform}`)
}

// v42 Fix 4: DEV 环境下暴露 editorStore 到 window,供 E2E 测试重置状态
// 生产环境不暴露,避免污染全局
if (import.meta.env.DEV) {
  (window as any).__editorStore = useEditorStore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
