// ============================================================
// 打开外部链接 / 图片地址
//
// Android WebView 中 window.open 通常不会打开任何页面（也没有新窗口概念），
// 因此原生端改用 @capacitor/browser 调起系统浏览器；
// 桌面端 / 普通浏览器继续使用 window.open。
// ============================================================

import { isCapacitor, isElectron } from './platform';

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  // 桌面端：交给主进程用系统默认浏览器打开
  if (isElectron) {
    const api = (window as any).electronAPI;
    if (api?.openExternal) {
      void api.openExternal(url);
      return;
    }
  }
  if (isCapacitor) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch {
      // 插件不可用时降级到 window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
