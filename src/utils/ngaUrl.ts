// ============================================================
// NGA 相对 URL 工具
//
// NGA 帖子里图片/BGM 常用相对路径（./mon_xxx、mon_xxx），需要拼接
// 「NGA url 头部」才能访问。头部可在设置中自定义（默认 img.nga.cn/attachments），
// 因此所有补全/反解都集中在这里，避免各模块硬编码。
//
// 注意：本文件会被主进程（electron/ngaCrawler）间接引用，不能直接 import
// 渲染层 store。前缀通过 setNgaUrlPrefixProvider 注入，默认值兜底。
// ============================================================

export const DEFAULT_NGA_URL_PREFIX = 'https://img.nga.cn/attachments';

let prefixProvider: () => string = () => DEFAULT_NGA_URL_PREFIX;

/** 由渲染层入口注入「读取设置前缀」的函数（主进程保持默认值） */
export function setNgaUrlPrefixProvider(provider: () => string): void {
  prefixProvider = provider;
}

/** 规范化用户填写的前缀：去首尾空白与末尾斜杠，空值回退默认 */
export function normalizeNgaUrlPrefix(prefix: string | null | undefined): string {
  const value = (prefix ?? '').trim().replace(/\/+$/, '');
  return value || DEFAULT_NGA_URL_PREFIX;
}

/** 读取当前前缀（未注入 provider 时回退默认值） */
export function getNgaUrlPrefix(): string {
  try {
    return normalizeNgaUrlPrefix(prefixProvider());
  } catch {
    return DEFAULT_NGA_URL_PREFIX;
  }
}

/** NGA 图片镜像域名归一化（img.nga.178.com → img.nga.cn） */
export function normalizeNgaUrlHost(url: string): string {
  if (!url) return url;
  return url.replace(
    /^(https?:)?\/\/(?:img[0-9]*|pic)\.nga\.178\.com/i,
    (_m, scheme?: string) => `${scheme ?? 'https:'}//img.nga.cn`,
  );
}

/**
 * 把 NGA 相对路径补全为可访问 URL：
 * - http(s):// 或 // 开头 → 域名归一化后返回
 * - ./mon_xxx / mon_xxx → 拼接设置中的「NGA url 头部」
 * - 其余原样返回
 */
export function expandNgaUrl(url: string, prefix?: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    return normalizeNgaUrlHost(trimmed);
  }
  const base = normalizeNgaUrlPrefix(prefix ?? getNgaUrlPrefix());
  if (trimmed.startsWith('./')) return `${base}/${trimmed.slice(2)}`;
  if (trimmed.startsWith('mon_')) return `${base}/${trimmed}`;
  return trimmed;
}

/**
 * expandNgaUrl 的逆操作：把完整 URL 反解为 ./ 相对路径（用于导出 BBCode）。
 * 兼容同一路径下的镜像域名；无法反解时原样返回。
 */
export function toNgaRelativeUrl(url: string, prefix?: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  const base = normalizeNgaUrlPrefix(prefix ?? getNgaUrlPrefix());
  if (trimmed.startsWith(`${base}/`)) return `./${trimmed.slice(base.length + 1)}`;
  const urlPath = trimmed.match(/^https?:\/\/[^/]+\/(.+)$/i);
  const basePath = base.match(/^https?:\/\/[^/]+\/(.+)$/i);
  if (urlPath && basePath && urlPath[1].startsWith(`${basePath[1]}/`)) {
    return `./${urlPath[1].slice(basePath[1].length + 1)}`;
  }
  return trimmed;
}
