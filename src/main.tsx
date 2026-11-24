import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useEditorStore } from './store/editorStore'
import { useSettingStore } from './store/settingStore'
import { setNgaUrlPrefixProvider } from './utils/ngaUrl'

// 注入「NGA url 头部」读取器：BBCode→HTML 展开相对图片/BGM 地址时使用
setNgaUrlPrefixProvider(() => useSettingStore.getState().ngaUrlPrefix)

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
