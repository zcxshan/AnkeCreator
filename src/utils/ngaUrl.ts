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
 * 一条匹配规则：正则匹配不完整地址，命中后用任一前缀补全。
 * 规则与前缀是多对多关系：命中任意规则即按前缀列表顺序尝试补全。
 */
export interface NgaUrlPattern {
  id: string;
  /** 正则表达式源码（对用户输入的原始地址做 test） */
  pattern: string;
}

/** 一个补全前缀，如 https://img.nga.cn/attachments */
export interface NgaUrlPrefixItem {
  id: string;
  prefix: string;
}

export interface NgaUrlConfig {
  patterns: NgaUrlPattern[];
  prefixes: NgaUrlPrefixItem[];
  /** 是否自动为不完整地址补前缀（仅在编辑界面生效） */
  autoPrefix: boolean;
}

export const DEFAULT_NGA_URL_PATTERNS: NgaUrlPattern[] = [
  {
    id: 'default-mon',
    // 默认匹配以 ./mon_ 开头的附件地址（补全时用前缀替换开头的 .）
    pattern: '^\\./mon_',
  },
];

export const DEFAULT_NGA_URL_PREFIXES: NgaUrlPrefixItem[] = [
  { id: 'prefix-nga-cn', prefix: DEFAULT_NGA_URL_PREFIX },
  { id: 'prefix-nga-178', prefix: 'https://img.nga.178.com/attachments' },
];

export const DEFAULT_NGA_URL_CONFIG: NgaUrlConfig = {
  patterns: DEFAULT_NGA_URL_PATTERNS,
  prefixes: DEFAULT_NGA_URL_PREFIXES,
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
    if (!cfg || !Array.isArray(cfg.patterns) || !Array.isArray(cfg.prefixes)) {
      return DEFAULT_NGA_URL_CONFIG;
    }
    return {
      patterns: cfg.patterns,
      prefixes: cfg.prefixes,
      autoPrefix: cfg.autoPrefix !== false,
    };
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

/** 去掉前缀里与相对路径重复的目录段（如 prefix 带 /attachments，相对路径也以 attachments/ 开头） */
function pathAfterPrefix(rel: string, prefix: string): string {
  const prefixPath = prefix
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!prefixPath) return rel;
  if (rel === prefixPath) return '';
  return rel.startsWith(`${prefixPath}/`) ? rel.slice(prefixPath.length + 1) : rel;
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
      // 自定义前缀也作为绝对地址的回退候选（例如主前缀失效、第二个前缀是别的域名）
      const rel = path.replace(/^\/+/, '');
      for (const item of getNgaUrlConfig().prefixes) {
        const base = normalizeNgaUrlPrefix(item.prefix);
        if (!base) continue;
        push(`${base}/${pathAfterPrefix(rel, base)}`);
      }
    }
    return out;
  }

  const config = getNgaUrlConfig();
  if (!config.autoPrefix) return [trimmed];

  // 只有命中至少一条匹配规则的不完整地址才自动补全；否则原样返回
  const matched = config.patterns.some((item) => testNgaUrlRulePattern(item.pattern, trimmed));
  if (!matched) return [trimmed];

  // 「前缀替换掉前面的 .」：./mon_xxx → 前缀/mon_xxx
  const rel = ngaRelativePath(trimmed);
  for (const item of config.prefixes) push(`${normalizeNgaUrlPrefix(item.prefix)}/${rel}`);
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
