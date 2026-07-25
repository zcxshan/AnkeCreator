// ============================================================
// URL 上传图片记录存储（pure logic）
//
// 行为：把 URL 上传图片的记录追加到 <dir>/.urls.json
// - 同一 URL 不重复
// - 损坏的 .urls.json 自动重置（不抛错）
// - 多级子目录各自独立维护（001/.urls.json 不影响 002/.urls.json）
//
// 设计为 pure logic 函数，可在 src/ 和 electron/ 共享。
// - src/ 端通过 vitest 单元测试验证
// - electron/ 端的 IPC handler (image:appendUrlRecord) 调用此函数
// ============================================================

import fs from 'fs';
import path from 'path';

export interface UrlRecord {
  url: string;
  filename: string;
  created_at: string;
}

export interface AppendUrlRecordOptions {
  /** 目标目录（绝对路径）。例如 <dataRoot>/images 或 <dataRoot>/images/001 */
  dir: string;
  /** 要追加的 URL 记录 */
  record: UrlRecord;
}

export interface AppendUrlRecordResult {
  ok: boolean;
  /** 当前 .urls.json 中的记录数 */
  count?: number;
  error?: string;
  /** 是否实际写入了新记录（false = URL 已存在，跳过） */
  inserted?: boolean;
}

/**
 * 把 URL 记录追加到 <dir>/.urls.json。
 *
 * 行为：
 * - 目录不存在自动创建（recursive）
 * - .urls.json 不存在 → 初始化为空数组
 * - .urls.json 存在但内容损坏 → 重置为空数组（不抛错）
 * - 同一 URL 已存在 → 跳过（不重复）
 *
 * @param opts.dir    目标目录（绝对路径）
 * @param opts.record URL 记录
 * @returns { ok, count, inserted }
 */
export function appendUrlRecord(opts: AppendUrlRecordOptions): AppendUrlRecordResult {
  try {
    if (!opts?.record?.url) {
      return { ok: false, error: 'URL 不能为空' };
    }
    const dir = opts.dir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const file = path.join(dir, '.urls.json');
    let arr: UrlRecord[] = [];
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          arr = parsed;
        }
      } catch {
        // 损坏的 .urls.json 自动重置（不抛错，覆盖写入）
        arr = [];
      }
    }
    // 同一 URL 不重复
    if (arr.some((r) => r.url === opts.record.url)) {
      return { ok: true, count: arr.length, inserted: false };
    }
    arr.push({
      url: opts.record.url,
      filename: opts.record.filename,
      created_at: opts.record.created_at,
    });
    fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf-8');
    return { ok: true, count: arr.length, inserted: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || '写入失败' };
  }
}

/**
 * 读取 <dir>/.urls.json 中的所有 URL 记录。
 * 不存在或损坏返回空数组。
 */
export function readUrlRecords(dir: string): UrlRecord[] {
  const file = path.join(dir, '.urls.json');
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 从 <dir>/.urls.json 中移除指定 URL 的记录。
 * v7 新增：用于 URL 图片拖到其他文件夹时从源文件夹移除记录。
 * 不存在或损坏返回 { ok: true, removed: false }（不抛错）。
 */
export function removeUrlRecord(
  dir: string,
  url: string,
): { ok: boolean; removed: boolean; error?: string } {
  try {
    const file = path.join(dir, '.urls.json');
    if (!fs.existsSync(file)) return { ok: true, removed: false };
    const raw = fs.readFileSync(file, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // v8: JSON 损坏时返回 ok: true（不抛错），与注释约定一致
      return { ok: true, removed: false };
    }
    if (!Array.isArray(parsed)) return { ok: true, removed: false };
    const before = parsed.length;
    const filtered = parsed.filter((r: UrlRecord) => r.url !== url);
    if (filtered.length === before) return { ok: true, removed: false };
    fs.writeFileSync(file, JSON.stringify(filtered, null, 2), 'utf-8');
    return { ok: true, removed: true };
  } catch (e) {
    return { ok: false, removed: false, error: (e as Error).message };
  }
}
