// 统一封装：图片上传/保存
// - 根据 useSettingStore.imageStoreMode 分发：
//     'remote' → 走 4 图床链（catbox → sm.ms → 0x0.st → telegra.ph）
//     'local'  → 走 Electron 主进程写文件 + local:// 协议
// - 单张：uploadImageFile()
// - 多张 + 进度回调：uploadImagesWithProgress()
// - 失败时返回 { ok: false, error }，**不**降级到 base64（用户硬约束）
// - 调用方根据 ok 判断是否使用 url；不弹 toast（让调用方决定提示策略）

import { useSettingStore } from '../store/settingStore';

export interface UploadedImage {
  ok: boolean;
  url?: string;
  error?: string;
  /** 上传/保存的图床或位置（catbox / sm.ms / 0x0.st / local 等） */
  host?: string;
}

export interface UploadProgressEvent {
  taskId: string;
  fileName: string;
  status: 'pending' | 'uploading' | 'success' | 'failed';
  /** 0-100 */
  progress: number;
  url?: string;
  error?: string;
  host?: string;
}

/** File → 纯 base64（无 data: 前缀），用于 IPC buffer 传输 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const idx = s.indexOf('base64,');
      resolve(idx >= 0 ? s.slice(idx + 7) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 单张上传/保存：根据 settingStore.imageStoreMode 分发
 * - 'remote' → uploadToRemote（4 图床链）
 * - 'local'  → saveImageLocal（Electron 主进程写文件 + local:// 协议）
 */
export async function uploadImageFile(file: File | Blob): Promise<UploadedImage> {
  const mode = useSettingStore.getState().imageStoreMode;
  if (mode === 'local') {
    return saveImageLocal(file);
  }
  return uploadToRemote(file);
}

/**
 * 多张上传/保存 + 进度回调（串行）
 * - 任务开始时推送 status='uploading' progress=10
 * - 完成后推送 status='success'/'failed' progress=100
 * - 返回所有结果（按输入顺序）
 */
export async function uploadImagesWithProgress(
  files: File[],
  onProgress: (e: UploadProgressEvent) => void,
): Promise<UploadedImage[]> {
  const results: UploadedImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const taskId = `${Date.now()}_${i}`;
    const fileName = file instanceof File ? file.name : `image_${i}`;
    onProgress({ taskId, fileName, status: 'pending', progress: 0 });
    onProgress({ taskId, fileName, status: 'uploading', progress: 10 });
    const res = await uploadImageFile(file);
    if (res.ok && res.url) {
      onProgress({
        taskId,
        fileName,
        status: 'success',
        progress: 100,
        url: res.url,
        host: res.host,
      });
    } else {
      onProgress({
        taskId,
        fileName,
        status: 'failed',
        progress: 100,
        error: res.error,
      });
    }
    results.push(res);
  }
  return results;
}

/**
 * 本地保存：Electron 主进程写文件，返回 local://xxx 协议 URL
 * 非 Electron 环境（vite dev / 普通浏览器）→ 失败并提示
 * **不**使用 base64 内嵌（用户明确禁止"千万不要使用base64把图片链接整超长"）
 */
async function saveImageLocal(file: File | Blob): Promise<UploadedImage> {
  if (typeof window === 'undefined' || !window.electronAPI?.saveImageLocal) {
    return {
      ok: false,
      error: '本地保存仅支持 Electron 应用，请切换到"远端图床"模式',
      host: 'local',
    };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: '本地保存仅支持 File 类型', host: 'local' };
  }
  try {
    // 这里使用 base64 仅作为 IPC 缓冲区传输方式（主进程会解码并写文件），
    // **不**作为图片 url 持久化保存到编辑器或导出
    const buf = await fileToBase64(file);
    const res = await window.electronAPI.saveImageLocal({
      buffer: buf,
      filename: file.name,
      mimeType: file.type || 'image/png',
    });
    if (res.ok && res.url) {
      return { ok: true, url: res.url, host: 'local' };
    }
    return { ok: false, error: res.error || '本地保存失败', host: 'local' };
  } catch (e) {
    return { ok: false, error: (e as Error).message || '本地保存失败', host: 'local' };
  }
}

/**
 * 远端图床：Electron IPC 或浏览器 fetch
 * - Electron：主进程走 4 图床链，避开 CORS
 * - 浏览器：直接 fetch 走 4 图床链
 * - **不**降级到 base64；全部失败时返回 ok:false
 */
async function uploadToRemote(file: File | Blob): Promise<UploadedImage> {
  // Electron：主进程上传
  if (
    typeof window !== 'undefined' &&
    window.electronAPI?.uploadImage &&
    file instanceof File
  ) {
    try {
      const buf = await fileToBase64(file);
      const res = await window.electronAPI.uploadImage({
        buffer: buf,
        filename: file.name,
        mimeType: file.type || 'image/png',
      });
      return {
        ok: res.ok,
        url: res.url,
        error: res.error,
        host: (res as any).host,
      };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message || '上传失败' };
    }
  }
  // 浏览器：直接 fetch
  try {
    const mod = await import('./imageHosting');
    const res = await mod.uploadImage(
      file,
      file instanceof File ? file.name : undefined,
    );
    return { ok: res.ok, url: res.url, error: res.error, host: res.host };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '上传失败' };
  }
}
