// uguu.se 图床匿名上传 —— 浏览器版（v1）
// 当 Electron 主进程不可用时（如开发模式 vite dev），渲染进程直接用 fetch 调用
// 单图床：uguu.se（永久、匿名、无 key；实测 1.8-2.5s 上传，URL 200，SHA256 一致）
// 失败时返回 { ok: false, error }，**不**写 base64

export interface SmmsUploadResult {
  ok: boolean;
  url?: string;
  error?: string;
  raw?: any;
  /** 成功上传的图床名（uguu.se） */
  host?: string;
}

const UGUU_UPLOAD = 'https://uguu.se/upload.php';

/**
 * 浏览器环境：直接用 fetch 上传到 uguu.se
 * - 端点：POST https://uguu.se/upload.php
 * - 字段：files[]（支持多文件）
 * - 成功：{ ok: true, url, raw }
 * - 失败：{ ok: false, error } —— 不本地兜底
 */
export async function uploadToUguu(
  file: File | Blob,
  filename?: string,
): Promise<SmmsUploadResult> {
  try {
    const form = new FormData();
    const name =
      filename ||
      (file instanceof File ? file.name : undefined) ||
      'image.png';
    form.append('files[]', file, name);

    const res = await fetch(UGUU_UPLOAD, {
      method: 'POST',
      body: form,
    });
    const json: any = await res.json().catch(() => null);
    if (json?.success && json?.files?.[0]?.url) {
      return {
        ok: true,
        url: String(json.files[0].url),
        raw: json,
        host: 'uguu.se',
      };
    }
    const msg =
      (Array.isArray(json?.errors) && json.errors[0]) ||
      (res.ok ? 'uguu.se 返回数据格式异常' : `HTTP ${res.status}`);
    return { ok: false, error: msg, raw: json, host: 'uguu.se' };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err?.message || '网络错误', host: 'uguu.se' };
  }
}

/**
 * 单图床上传：uguu.se
 * 成功即返回；失败时返回 { ok: false, error }，**不**写本地、**不**写 base64
 */
export async function uploadImage(
  file: File | Blob,
  filename?: string,
): Promise<SmmsUploadResult> {
  try {
    const res = await uploadToUguu(file, filename);
    if (res.ok) return res;
    console.warn(`[uploadImage] uguu.se 失败:`, res.error);
  } catch (e) {
    console.warn(`[uploadImage] uguu.se 抛异常:`, e);
  }
  return {
    ok: false,
    error: '图床失败（uguu.se）',
  };
}
