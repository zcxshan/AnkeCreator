// uguu.se 图床匿名上传 —— Electron 主进程版（v1）
// 通过 IPC 暴露给渲染进程
// 失败时返回 { ok: false, error }，**不**本地兜底，**不**写 base64
// 单图床：uguu.se（永久、匿名、无 key）

export interface SmmsUploadInput {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}

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
 * 上传一张图片到 uguu.se
 * - 端点：POST https://uguu.se/upload.php
 * - 字段：files[]
 * - 成功：{ ok: true, url: 'https://o.uguu.se/xxx.png', raw }
 * - 失败：{ ok: false, error: '...' } —— **不**本地兜底
 */
export async function uploadToUguu(input: SmmsUploadInput): Promise<SmmsUploadResult> {
  try {
    const form = new FormData();
    // Node 18+ 自带 Blob，FormData 直接支持
    // 用 Uint8Array 包装 Buffer 绕过 ArrayBuffer/SharedArrayBuffer 类型冲突
    const ab = new Uint8Array(
      input.buffer.buffer,
      input.buffer.byteOffset,
      input.buffer.byteLength,
    );
    const blob = new Blob([ab as BlobPart], {
      type: input.mimeType || 'image/png',
    });
    form.append('files[]', blob, input.filename);

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
 * 成功即返回；失败时返回 { ok: false, error }
 * **不**写本地、**不**写 base64
 */
export async function uploadImage(input: SmmsUploadInput): Promise<SmmsUploadResult> {
  try {
    const res = await uploadToUguu(input);
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
