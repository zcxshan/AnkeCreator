// v14：把 local:// URL 解析为文件名（支持嵌套 URL）
//
// 支持格式：
// - local://1.png            → '1.png'                (旧格式,单段)
// - local:///1.png           → '1.png'                (三斜杠)
// - local://001/4.png        → '001/4.png'            (子目录)
// - local://001/002/5.png    → '001/002/5.png'        (嵌套子目录)
// - local://根目录/1.png     → '根目录/1.png'          (中文目录,不再被破坏)
//
// 旧版只取 URL 的 hostname，丢失 pathname，导致嵌套 URL 拿不到文件
// 详见 electron/protocol.ts 中 registerLocalProtocol 的注释

/**
 * 把 local:// URL 解析为相对文件名（相对 imagesDir）
 *
 * @param rawUrl - local:// 协议的 URL
 * @returns 相对文件名（不带前导 /，不带尾随 /）
 */
export function parseLocalUrlToFileName(rawUrl: string): string {
  const url = new URL(rawUrl)
  // 合并 hostname + pathname,去掉首尾 /
  let fileName = (url.hostname + url.pathname).replace(/^\/+/, '').replace(/\/+$/, '')
  // URL 解码（防止扩展名含特殊字符）
  try {
    fileName = decodeURIComponent(fileName)
  } catch {
    // ignore
  }
  return fileName
}

// v25：把 local:// URL 解析为相对路径，并做协议检查 + 路径安全检查
// 用于主进程 IPC handler (image:deleteLocal / image:renameLocal) 的输入验证
//
// 返回：
// - { ok: true, relPath }    relPath 相对 imagesDir 的相对路径（不带前导 /）
// - { ok: false, error }     验证失败（包含：非 local:// 协议、URL 解析失败、含 .. 路径穿越）
export function validateLocalUrlForFileOp(
  rawUrl: string,
): { ok: true; relPath: string } | { ok: false; error: string } {
  if (!rawUrl || !rawUrl.startsWith('local://')) {
    return { ok: false, error: '非本地 URL，跳过' }
  }
  let relPath: string
  try {
    relPath = parseLocalUrlToFileName(rawUrl)
  } catch {
    return { ok: false, error: 'URL 解析失败' }
  }
  if (!relPath) {
    return { ok: false, error: 'URL 解析为空' }
  }
  // 安全检查：禁止 ../ 路径穿越、绝对路径、Windows 分隔符
  if (relPath.includes('..') || relPath.startsWith('/') || relPath.startsWith('\\')) {
    return { ok: false, error: '非法路径' }
  }
  return { ok: true, relPath }
}
