// 统一封装：图片上传/保存
// - 根据 useSettingStore.imageStoreMode 分发：
//     'remote' → 走 4 图床链（catbox → sm.ms → 0x0.st → telegra.ph）
//     'local'  → 走 Electron 主进程写文件 + local:// 协议；Capacitor 走 Filesystem
// - 单张：uploadImageFile()
// - 多张 + 进度回调：uploadImagesWithProgress()
// - 失败时返回 { ok: false, error }，**不**降级到 base64（用户硬约束）
// - 调用方根据 ok 判断是否使用 url；不弹 toast（让调用方决定提示策略）

import { useSettingStore } from '../store/settingStore';
import { useImageWarningStore } from '../store/imageWarningStore';
import { LOCAL_IMAGE_WARNING_DISMISSED_KEY } from '../components/common/LocalImageWarningDialog';
import { isCapacitor } from './platform';

export interface UploadedImage {
  ok: boolean;
  url?: string;
  error?: string;
  /** 上传/保存的图床或位置（catbox / sm.ms / 0x0.st / local 等） */
  host?: string;
  fileName?: string;
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
 * 本地上传前的统一警告入口（所有 4 个上传入口共用的 helper）
 * - 非本地模式：直接放行（return true）
 * - 本地模式 + 已勾选「不再提示」：放行（return true）
 * - 本地模式 + 未勾选：弹窗（全局 store 中的 LocalImageWarningDialog）
 *   - 用户确认 → return true（继续上传）
 *   - 用户取消 → return false（调用方应中止上传）
 */
export async function ensureLocalWarning(): Promise<boolean> {
  const isLocal = useSettingStore.getState().imageStoreMode === 'local';
  // 本地上传总开关关闭时，本地上传入口应直接返回 false（调用方应中止并提示）
  if (isLocal && !useSettingStore.getState().localUploadEnabled) {
    return false;
  }
  if (!isLocal) return true;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(LOCAL_IMAGE_WARNING_DISMISSED_KEY) === '1';
  } catch {
    dismissed = false;
  }
  if (dismissed) return true;
  return useImageWarningStore.getState().showImageWarning();
}

/**
 * 单张上传/保存：根据 settingStore.imageStoreMode 分发
 * - 'remote' → uploadToRemote（4 图床链）
 * - 'local'  → saveImageLocal（Electron 模式用 filePath 作为 URL）
 *
 * @param filePath Electron selectImage IPC 返回的绝对路径（仅本地模式有效）
 */
export async function uploadImageFile(
  file: File | Blob,
  filePath?: string,
): Promise<UploadedImage> {
  const mode = useSettingStore.getState().imageStoreMode;
  if (mode === 'local') {
    return saveImageLocal(file, filePath);
  }
  return uploadToRemote(file);
}

/**
 * 多张上传/保存 + 进度回调（串行）
 * - 任务开始时推送 status='uploading' progress=10
 * - 完成后推送 status='success'/'failed' progress=100
 * - 返回所有结果（按输入顺序）
 *
 * @param filePath Electron selectImage IPC 返回的绝对路径（仅本地模式有效）
 *   - 当前实现：所有 files 共享同一个 filePath（单选）
 *   - 多选场景下需调用方在传入前把每个 File 的 filePath 拆分（暂未实现）
 */
export async function uploadImagesWithProgress(
  files: File[],
  onProgress: (e: UploadProgressEvent) => void,
  filePath?: string,
): Promise<UploadedImage[]> {
  const results: UploadedImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const taskId = `${Date.now()}_${i}`;
    const fileName = file instanceof File ? file.name : `image_${i}`;
    onProgress({ taskId, fileName, status: 'pending', progress: 0 });
    onProgress({ taskId, fileName, status: 'uploading', progress: 10 });
    const res = await uploadImageFile(file, filePath);
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
 * 本地保存：Electron 模式下直接用图片的绝对路径作为 URL（不复制文件）
 * - Electron：主进程写文件 + local:// 协议
 * - Capacitor：@capacitor/filesystem 写入设备 Documents
 * - 浏览器：返回错误
 *
 * URL 存储 = 用户原图路径（如 C:\Users\foo\image.png 或 Capacitor file:// 路径）
 * NGA 导出时由 ngaHtmlToBBCode.isUnreachableImage 识别为"不可达"，替换为占位符
 */
async function saveImageLocal(
  file: File | Blob,
  filePath?: string,
): Promise<UploadedImage> {
  // 1. Electron 环境
  if (typeof window !== 'undefined' && window.electronAPI) {
    // 优先用 IPC 传过来的 filePath（selectImage 选择文件时的真实绝对路径）
    let actualPath = filePath;
    if (!actualPath) {
      // 兼容：尝试从 File 对象取 path（Electron 老版本 File.path）
      try {
        actualPath = (file as any).path;
      } catch {
        actualPath = undefined;
      }
    }
    if (!actualPath) {
      return {
        ok: false,
        error: '本地保存无法获取文件路径，请重新选择文件',
        host: 'local',
      };
    }
    // 直接用绝对路径作为 URL（不复制文件到 userData/images/）
    return {
      ok: true,
      url: actualPath,
      host: 'local',
      fileName: file instanceof File ? file.name : '',
    };
  }

  // 2. Capacitor 环境：写入设备 Documents 目录
  if (isCapacitor) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const dataUrl = await fileToDataURL(file);
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const fileName =
        file instanceof File && file.name
          ? `${Date.now()}_${file.name}`
          : `image_${Date.now()}.png`;
      try {
        const result = await Filesystem.writeFile({
          path: `images/${fileName}`,
          data: base64,
          directory: Directory.Documents,
          recursive: true,
        });
        return {
          ok: true,
          url: dataUrl,
          host: 'local',
          fileName: file instanceof File ? file.name : fileName,
        };
      } catch {
        // Fallback to base64 data URL when Filesystem.writeFile fails
        return {
          ok: true,
          url: dataUrl,
          host: 'local',
          fileName: file instanceof File ? file.name : fileName,
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: (e as Error)?.message || 'Capacitor 本地保存失败',
        host: 'local',
      };
    }
  }

  // 3. 纯浏览器：返回错误
  return {
    ok: false,
    error: '本地保存仅支持 Electron 或 Capacitor 应用，请切换到"远端图床"模式',
    host: 'local',
  };
}

/** File/Blob → data URL（用于 Capacitor 写入） */
function fileToDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
    const uploadPromise = mod.uploadImage(
      file,
      file instanceof File ? file.name : undefined,
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('图床上传超时（30s），建议改用本地上传')), 30000);
    });
    const res = await Promise.race([uploadPromise, timeoutPromise]);
    return { ok: res.ok, url: res.url, error: res.error, host: res.host };
  } catch (e) {
    const msg = (e as Error)?.message || '上传失败';
    const hint = isCapacitor ? '（图床可能 CORS 拦截或网络超时，建议改用本地上传）' : '';
    return { ok: false, error: msg + hint };
  }
}
