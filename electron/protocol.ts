// ============================================================
// Electron 协议处理
//
// - local:// 协议：渲染层 <img src="local://xxx.png"> 时拦截，
//   返回 <dataRoot>/images/ 下的文件（由 ./paths 决定）
// - NGA Referer 钩子：渲染层加载 img.nga.178.com 图片时自动加 Referer
// ============================================================

import { protocol, session } from 'electron'
import path from 'path'
import fs from 'fs'
import { getImagesDir } from './paths'
import { parseLocalUrlToFileName } from '../src/utils/parseLocalUrl'

// 本地图片存储目录（用于"本地保存"模式）
// 路径：<dataRoot>/images/（打包 = <安装路径>/data/images/，dev = <项目根>/data/images/）
// 文件名 = sha256(buffer)[:16] + ext
// （getImagesDir() 内部已确保目录存在）

/** 根据扩展名推断 MIME */
export function getMimeByExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

/** 注册 local:// 为特权协议，使其支持 fetch / <img src="local://..."> */
export function registerSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'local',
      privileges: {
        standard: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])
}

/** 注册 local:// 协议：把 local://<hash>.<ext> 映射到 <dataRoot>/images/ 下的文件
 *
 * URL 解析见 src/utils/parseLocalUrl.ts（支持嵌套 URL v14 修复）
 */
export function registerLocalProtocol(): void {
  protocol.handle('local', async (request) => {
    console.log('[local://] 收到请求:', request.url)
    try {
      const imagesDir = getImagesDir()
      const fileName = parseLocalUrlToFileName(request.url)
      const filePath = path.join(imagesDir, fileName)
      const normalized = path.normalize(filePath)
      // v19 诊断：记录 URL 解析详情
      try {
        const parsed = new URL(request.url)
        console.log('[local://] URL 分解:', { hostname: parsed.hostname, pathname: parsed.pathname, fileName })
      } catch {}
      console.log('[local://] 解析:', {
        requestUrl: request.url,
        fileName,
        imagesDir,
        filePath: normalized,
        exists: fs.existsSync(normalized),
        size: fs.existsSync(normalized) ? fs.statSync(normalized).size : 0,
      })
      if (
        !normalized.startsWith(path.normalize(imagesDir) + path.sep) &&
        normalized !== path.normalize(imagesDir)
      ) {
        console.warn('[local://] 路径穿越拒绝:', normalized)
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.promises.readFile(normalized)
      console.log('[local://] 读取成功:', normalized, '大小:', data.length, 'bytes')
      // v18 修复：直接传 Buffer(放弃 Uint8Array / Readable stream)
      // v15-v17 走 stream 路径都失败,v18 回到最简方案
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': getMimeByExt(normalized),
          'Cache-Control': 'no-cache',
          'Content-Length': String(data.length),
        },
      })
    } catch (e) {
      console.error('[local://] 处理失败:', request.url, e)
      return new Response('Not found', { status: 404 })
    }
  })
}

/** NGA 防盗链绕过：渲染进程加载 img.nga.178.com 图片时自动加 Referer
 *
 * 根因：NGA 图床检查 Referer 头，Electron 渲染层默认不携带 nga.178.com referer，
 *       导致编辑器内插入的 NGA 图片加载失败
 * 主进程 ngaCrawler 已经在抓取时手动加过 Referer，
 * 但只覆盖 Node.js fetch，不覆盖渲染层 <img> 请求
 */
export function setupNgaRefererHook(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.nga.178.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      // 模拟从 NGA 论坛页面访问图片的 referer
      if (!headers['Referer'] || headers['Referer'] === '') {
        headers['Referer'] = 'https://nga.178.com/'
      }
      callback({ requestHeaders: headers })
    },
  )
}

// getImagesDir 已从 ./paths 导入并 re-export，无需在此重复定义
// 调用方（imageUploader 等）应直接 import { getImagesDir } from './paths'
