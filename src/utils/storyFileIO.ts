// ============================================================
// 作品文件导入导出 - Web / Capacitor 实现
//
// 桌面端使用 Electron IPC（saveStoryAsFile / openStoryFile）。
// 浏览器和 Capacitor 环境下走纯 Web API：
//   - 导出：Blob + <a download> 触发下载
//   - 导入：<input type="file"> + FileReader 读取文本
//
// 调用方根据 isElectron 分流：
//   if (isElectron) return await window.dbAPI.saveStoryAsFile(data, name);
//   return webSaveStoryAsFile(data, name);
// ============================================================

export interface WebSaveResult {
  ok: boolean;
  canceled?: boolean;
  fileName?: string;
  error?: string;
}

/**
 * Web 端保存作品为 .anke.json 文件
 * - 通过 Blob + a[download] 触发浏览器下载
 * - Capacitor WebView 中会调用系统分享/保存对话框
 */
export async function webSaveStoryAsFile(
  data: unknown,
  suggestedName?: string,
): Promise<WebSaveResult> {
  try {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fileName = (suggestedName || 'untitled').replace(/[\\/:*?"<>|]/g, '_') + '.anke.json';

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 延迟清理，给浏览器一点时间开始下载
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);

    return { ok: true, fileName };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '保存失败' };
  }
}
