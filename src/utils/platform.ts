// ============================================================
// 平台检测工具
//
// 集中判断当前运行环境，避免到处写 `window.electronAPI` /
// `(window as any).Capacitor`。使用方式：
//   import { isElectron, isCapacitor, isWeb, isMobile } from '../utils/platform';
//
// - isElectron:   桌面端（vite-plugin-electron 注入 window.electronAPI）
// - isCapacitor:  原生 App（@capacitor/core 注入 window.Capacitor）
// - isWeb:        浏览器（既不是 Electron 也不是 Capacitor 原生）
// - isMobile:     移动端（当前等同于 isCapacitor）
// ============================================================

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

export const isElectron: boolean =
  typeof window !== 'undefined' && !!window.electronAPI;

export const isCapacitor: boolean =
  typeof window !== 'undefined' &&
  typeof window.Capacitor !== 'undefined' &&
  window.Capacitor?.isNativePlatform?.() === true;

export const isWeb: boolean = !isElectron && !isCapacitor;

export const isMobile: boolean = isCapacitor;
