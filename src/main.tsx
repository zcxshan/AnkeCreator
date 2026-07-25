import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { useEditorStore } from './store/editorStore'

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
