// sm.ms 图床匿名上传（v2 API）—— 浏览器版
// 当 Electron 主进程不可用时（如开发模式 vite dev），渲染进程直接用 fetch 调用
// 多图床兜底链：catbox.moe → sm.ms → 0x0.st → telegra.ph
// 任一图床成功即返回；全部失败时返回 { ok: false, error }，**不**写 base64

export interface SmmsUploadResult {
  ok: boolean;
  url?: string;
  error?: string;
  raw?: any;
  /** 成功上传的图床名（catbox / sm.ms / 0x0.st / telegra.ph） */
  host?: string;
}

const SMMS_V2_UPLOAD = 'https://sm.ms/api/v2/upload';
const CATBOX_UPLOAD = 'https://catbox.moe/user/api.php';
const ZERO_X_ZERO_UPLOAD = 'https://0x0.st';
const TELEGRAPH_UPLOAD = 'https://telegra.ph/upload';

/**
 * 浏览器环境：直接用 fetch 上传到 sm.ms
 * - 成功：{ ok: true, url, raw }
 * - 失败：{ ok: false, error } —— 不本地兜底
 */
export async function uploadToSmms(
  file: File | Blob,
  filename?: string,
): Promise<SmmsUploadResult> {
  try {
    const form = new FormData();
    const name =
      filename ||
      (file instanceof File ? file.name : undefined) ||
      'image.png';
    form.append('smfile', file, name);

    const res = await fetch(SMMS_V2_UPLOAD, {
      method: 'POST',
      body: form,
    });
    const json: any = await res.json().catch(() => null);
    if (json?.success && json?.data?.url) {
      return { ok: true, url: String(json.data.url), raw: json, host: 'sm.ms' };
    }
    const msg =
      json?.message ||
      (res.ok ? 'sm.ms 返回数据格式异常' : `HTTP ${res.status}`);
    return { ok: false, error: msg, raw: json, host: 'sm.ms' };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err?.message || '网络错误', host: 'sm.ms' };
  }
}

/**
 * 浏览器环境：直接用 fetch 上传到 catbox.moe
 * - 接口：POST https://catbox.moe/user/api.php
 * - 表单字段：reqtype=fileupload + fileToUpload
 * - 成功：响应体直接是图片 URL
 * - 失败：返回 { ok: false, error } —— 不本地兜底
 */
export async function uploadToCatbox(
  file: File | Blob,
  filename?: string,
): Promise<SmmsUploadResult> {
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    const name =
      filename ||
      (file instanceof File ? file.name : undefined) ||
      'image.png';
    form.append('fileToUpload', file, name);

    const res = await fetch(CATBOX_UPLOAD, {
      method: 'POST',
      body: form,
    });
    const text = await res.text();
    if (res.ok && /^https?:\/\//i.test(text.trim())) {
      return { ok: true, url: text.trim(), raw: text, host: 'catbox' };
    }
    const msg = text || (res.ok ? 'catbox 返回数据格式异常' : `HTTP ${res.status}`);
    return { ok: false, error: msg.slice(0, 200), raw: text, host: 'catbox' };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err?.message || '网络错误', host: 'catbox' };
  }
}

/**
 * 浏览器环境：上传到 0x0.st
 * - 接口：POST https://0x0.st
 * - 表单字段：file
 * - 成功：响应体直接是 URL
 * - 失败：返回 { ok: false, error }
 */
export async function uploadToZeroXZero(
  file: File | Blob,
  filename?: string,
): Promise<SmmsUploadResult> {
  try {
    const form = new FormData();
    const name =
      filename ||
      (file instanceof File ? file.name : undefined) ||
      'image.png';
    form.append('file', file, name);
    const res = await fetch(ZERO_X_ZERO_UPLOAD, {
      method: 'POST',
      body: form,
    });
    const text = await res.text();
    if (res.ok && /^https?:\/\//i.test(text.trim())) {
      return { ok: true, url: text.trim(), raw: text, host: '0x0.st' };
    }
    return {
      ok: false,
      error: text || `HTTP ${res.status}`,
      raw: text,
      host: '0x0.st',
    };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err?.message || '网络错误', host: '0x0.st' };
  }
}

/**
 * 浏览器环境：上传到 telegra.ph
 * - 接口：POST https://telegra.ph/upload
 * - 表单字段：file
 * - 成功：JSON 数组 [{ "src": "/file/xxx.jpg" }]，需补全为完整 URL
 * - 失败：返回 { ok: false, error }
 */
export async function uploadToTelegraph(
  file: File | Blob,
  filename?: string,
): Promise<SmmsUploadResult> {
  try {
    const form = new FormData();
    const name =
      filename ||
      (file instanceof File ? file.name : undefined) ||
      'image.png';
    form.append('file', file, name);
    const res = await fetch(TELEGRAPH_UPLOAD, {
      method: 'POST',
      body: form,
    });
    const json: any = await res.json().catch(() => null);
    if (Array.isArray(json) && json[0]?.src) {
      const src = String(json[0].src);
      const fullUrl = src.startsWith('http')
        ? src
        : `https://telegra.ph${src.startsWith('/') ? '' : '/'}${src}`;
      return { ok: true, url: fullUrl, raw: json, host: 'telegra.ph' };
    }
    return {
      ok: false,
      error: (json && json.error) || `HTTP ${res.status}`,
      raw: json,
      host: 'telegra.ph',
    };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err?.message || '网络错误', host: 'telegra.ph' };
  }
}

/**
 * 默认图床链：catbox → sm.ms → 0x0.st → telegra.ph
 * 任一成功即返回；全部失败时返回 { ok: false, error }
 * **不**写本地、**不**写 base64
 */
export async function uploadImage(
  file: File | Blob,
  filename?: string,
): Promise<SmmsUploadResult> {
  const tries: Array<{
    name: string;
    fn: () => Promise<SmmsUploadResult>;
  }> = [
    { name: 'catbox', fn: () => uploadToCatbox(file, filename) },
    { name: 'sm.ms', fn: () => uploadToSmms(file, filename) },
    { name: '0x0.st', fn: () => uploadToZeroXZero(file, filename) },
    { name: 'telegra.ph', fn: () => uploadToTelegraph(file, filename) },
  ];
  for (const t of tries) {
    try {
      const res = await t.fn();
      if (res.ok) return res;
      console.warn(`[uploadImage] ${t.name} 失败，尝试下一个:`, res.error);
    } catch (e) {
      console.warn(`[uploadImage] ${t.name} 抛异常:`, e);
    }
  }
  return {
    ok: false,
    error: '所有图床均失败（catbox / sm.ms / 0x0.st / telegra.ph）',
  };
}
