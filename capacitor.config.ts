// ============================================================
// Capacitor 移动端打包配置（Android）
//
// - appId: 与 electron-builder 对齐（com.shanshian.ankecreator）
// - Android backgroundColor: 与项目暗色 UI 一致（#1e293b slate-800）
// - webContentsDebuggingEnabled: 仅开发模式开启
// - SplashScreen: 完善 spinner / 资源名 / 缩放
// - StatusBar: 暗色样式 + 暗色背景
// ============================================================

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shanshian.ankecreator',
  appName: '安科作者助手',
  webDir: 'dist',
  android: {
    // 与项目暗色 UI 一致（#1e293b slate-800）
    backgroundColor: '#1e293b',
    // 仅开发模式开启（NODE_ENV !== production）
    webContentsDebuggingEnabled: process.env.NODE_ENV !== 'production',
    // 安全策略：允许 http/https 混排（兜底，让边界场景图片可加载）
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1e293b',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1e293b',
    },
    Keyboard: {
      resize: 'native',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
