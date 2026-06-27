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

export interface WebOpenResult<T = unknown> {
  ok: boolean;
  canceled?: boolean;
  fileName?: string;
  data?: T;
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

/**
 * Web 端打开 .anke.json 文件
 * - 通过 <input type="file"> 选择文件并读取
 * - 解析为 JSON 返回
 */
export function webOpenStoryFile<T = unknown>(): Promise<WebOpenResult<T>> {
  return new Promise((resolve) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.anke.json,application/json';
      input.style.display = 'none';

      let resolved = false;
      const cleanup = () => {
        if (input.parentNode) input.parentNode.removeChild(input);
      };

      input.onchange = async () => {
        if (resolved) return;
        const file = input.files?.[0];
        if (!file) {
          resolved = true;
          cleanup();
          resolve({ ok: false, canceled: true });
          return;
        }
        try {
          const text = await file.text();
          const data = JSON.parse(text) as T;
          resolved = true;
          cleanup();
          resolve({ ok: true, fileName: file.name, data });
        } catch (e) {
          resolved = true;
          cleanup();
          resolve({ ok: false, error: (e as Error)?.message || '解析失败', fileName: file.name });
        }
      };

      // 某些浏览器/环境下 cancel 不会触发任何事件；监听 window focus 兜底
      const onFocusBack = () => {
        setTimeout(() => {
          if (!resolved && (!input.files || input.files.length === 0)) {
            resolved = true;
            cleanup();
            window.removeEventListener('focus', onFocusBack);
            resolve({ ok: false, canceled: true });
          }
        }, 500);
        window.removeEventListener('focus', onFocusBack);
      };
      window.addEventListener('focus', onFocusBack);

      document.body.appendChild(input);
      input.click();
    } catch (e) {
      resolve({ ok: false, error: (e as Error)?.message || '打开失败' });
    }
  });
}
