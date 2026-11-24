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

/**
 * 一条 NGA url 规则：正则匹配不完整地址，命中后用 prefix 补全。
 * 默认规则匹配包含 /mon_ 的附件地址。
 */
export interface NgaUrlRule {
  id: string;
  /** 正则表达式源码（对用户输入的原始地址做 test） */
  pattern: string;
  /** 补全用前缀，如 https://img.nga.cn/attachments */
  prefix: string;
  enabled: boolean;
}

export interface NgaUrlConfig {
  rules: NgaUrlRule[];
  /** 是否自动为不完整地址补前缀（仅在编辑界面生效） */
  autoPrefix: boolean;
}

export const DEFAULT_NGA_URL_RULES: NgaUrlRule[] = [
  {
    id: 'default-mon',
    pattern: 'mon_',
    prefix: DEFAULT_NGA_URL_PREFIX,
    enabled: true,
  },
];

export const DEFAULT_NGA_URL_CONFIG: NgaUrlConfig = {
  rules: DEFAULT_NGA_URL_RULES,
  autoPrefix: true,
};

let prefixProvider: () => string = () => DEFAULT_NGA_URL_PREFIX;
let configProvider: () => NgaUrlConfig = () => DEFAULT_NGA_URL_CONFIG;

/** 由渲染层入口注入「读取设置前缀」的函数（主进程保持默认值） */
export function setNgaUrlPrefixProvider(provider: () => string): void {
  prefixProvider = provider;
}

/** 由渲染层入口注入「读取完整规则配置」的函数（主进程保持默认值） */
export function setNgaUrlConfigProvider(provider: () => NgaUrlConfig): void {
  configProvider = provider;
}

/** 读取当前规则配置（未注入 provider 时回退默认值） */
export function getNgaUrlConfig(): NgaUrlConfig {
  try {
    const cfg = configProvider();
    if (!cfg || !Array.isArray(cfg.rules)) return DEFAULT_NGA_URL_CONFIG;
    return { rules: cfg.rules, autoPrefix: cfg.autoPrefix !== false };
  } catch {
    return DEFAULT_NGA_URL_CONFIG;
  }
}

/** 安全执行用户正则；非法正则视为不匹配 */
export function testNgaUrlRulePattern(pattern: string, value: string): boolean {
  const source = (pattern ?? '').trim();
  if (!source) return false;
  try {
    return new RegExp(source, 'i').test(value);
  } catch {
    return false;
  }
}

/** 是否为 NGA 附件 CDN 地址（img.nga.cn / img.nga.178.com / img4.nga.178.com…） */
function ngaCdnPath(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:img[0-9]*|pic)\.nga(?:\.cn|\.178\.com)(\/.*)?$/i);
  return m ? m[1] || '' : null;
}

/** 把 ./xxx / mon_xxx 这种不完整地址的路径部分抽出来 */
export function ngaRelativePath(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('./')) return trimmed.slice(2);
  return trimmed.replace(/^\/+/, '');
}

/**
 * 生成一组候选 URL（按优先级）。
 * - 绝对地址：返回自身 + NGA 图床镜像，供加载失败时依次重试
 * - 不完整地址：按命中规则的前缀、其余前缀依次拼接；autoPrefix 关闭时原样返回
 */
export function buildNgaUrlCandidates(raw: string): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

  if (/^(https?:)?\/\//i.test(trimmed)) {
    const abs = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const normalized = normalizeNgaUrlHost(abs);
    push(normalized);
    const path = ngaCdnPath(normalized);
    if (path !== null) {
      push(`https://img.nga.cn${path}`);
      push(`https://img.nga.178.com${path}`);
      push(`https://img4.nga.178.com${path}`);
    }
    return out;
  }

  const config = getNgaUrlConfig();
  if (!config.autoPrefix) return [trimmed];

  const rel = ngaRelativePath(trimmed);
  const enabled = config.rules.filter((rule) => rule.enabled && normalizeNgaUrlPrefix(rule.prefix));
  const matched = enabled.filter((rule) => testNgaUrlRulePattern(rule.pattern, trimmed));
  const ordered = [...matched, ...enabled.filter((rule) => !matched.includes(rule))];
  for (const rule of ordered) push(`${normalizeNgaUrlPrefix(rule.prefix)}/${rel}`);
  if (out.length === 0) push(`${DEFAULT_NGA_URL_PREFIX}/${rel}`);
  return out;
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
