// ============================================================
// Capacitor 配置 - 安科作者助手 移动端打包
//
// webDir: 'dist' - Vite 构建产物
// appId:  Android 包名（与现有 Electron appId 区分）
// ============================================================
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ankecreator.app',
  appName: '安科作者助手',
  webDir: 'dist',
  android: {
    // 允许 https/http 混排（开发期方便；生产期应去除）
    allowMixedContent: false,
    // 用户数据目录
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#1e1e1e',
    },
  },
};

export default config;
