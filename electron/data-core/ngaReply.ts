// ============================================================
// NGA 回帖：请求构造与响应解析（纯函数，便于单测）
//
// 2025 之后的 NGA 回复页已不提供 Discuz 的 formhash，改为
//   post.php?action=reply&fid=<fid>&tid=<tid>
// 页内 `var __U={"action":"reply","fid":...,"auth":...,"tid":...}`
// 提交由 js_postfunc_v2.js 的 commonui.newPost → __NUKE.doRequest 完成，
// 实际表单字段为：
//   action=reply / fid / tid / post_content / step=2 / lite=htmljs
//   nojump=1 / post_opt=0 / __inchst=UTF-8
// 响应是 `script_muti_get_var_store({data:{__MESSAGE:[...]}})`：
//   __MESSAGE[0] 为空 → 成功；非空 → __MESSAGE[1] 为失败原因；__MESSAGE[6] 为跳转地址。
// ============================================================

export interface ThreadIdentity {
  fid?: string
  /** 新版回复页的 auth（仅附件上传使用；普通回帖走 Cookie 鉴权，无需提交） */
  auth?: string
}

/** 从主题帖 / 回复页 HTML 提取版块 id 与 auth */
export function extractThreadIdentity(html: string): ThreadIdentity {
  const fid =
    html.match(/"fid"\s*:\s*(\d+)/i)?.[1] ??
    html.match(/name="fid"\s+value="([0-9]+)"/i)?.[1] ??
    html.match(/[?&]fid=([0-9]+)/)?.[1]
  const auth = html.match(/"auth"\s*:\s*"([0-9a-zA-Z]+)"/i)?.[1]
  return { fid, auth }
}

export interface ReplyParams {
  tid: string
  fid?: string
  content: string
}

/**
 * 构造 /post.php 的表单请求体，字段与新回复页的 commonui.newPost 对齐。
 * 注意：新版接口字段是 `post_content`（旧 Discuz 的 `content` 已失效）。
 */
export function buildReplyBody(params: ReplyParams): string {
  const body = new URLSearchParams()
  body.set('action', 'reply')
  if (params.fid) body.set('fid', params.fid)
  body.set('tid', params.tid)
  body.set('post_content', params.content)
  body.set('step', '2')
  body.set('lite', 'htmljs')
  body.set('nojump', '1')
  body.set('post_opt', '0')
  // 请求正文按 UTF-8 发送，显式告诉服务端编码
  body.set('__inchst', 'UTF-8')
  return body.toString()
}

export interface ReplyDiagnostics {
  status: number
  location?: string
  /** 响应正文的纯文本片段（最多 200 字，便于定位失败原因） */
  snippet?: string
}

export interface ReplyResult {
  ok: boolean
  error?: string
  pid?: string
  diagnostics?: ReplyDiagnostics
}

/** 把 HTML 响应压成一小段纯文本，供错误提示与诊断使用 */
function textSnippet(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function extractPid(html: string, location?: string): string | undefined {
  // NGA 跳转地址有两种形态：read.php?pid=123 与 read.php?...&page=e#pid123Anchor
  const pattern = /pid[=#]?([0-9]+)/i
  return location?.match(pattern)?.[1] ?? html.match(pattern)?.[1] ?? undefined
}

/**
 * 从 `script_muti_get_var_store({...})` 里取出 JSON。
 * NGA 的 doRequest 用 iframe + 全局函数回调，响应不是纯 JSON，需要手工截取花括号区间。
 */
function parseApiPayload(html: string): unknown {
  const marker = html.indexOf('script_muti_get_var_store')
  const trimmed = html.trim()
  if (marker < 0) {
    if (trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return null
      }
    }
    return null
  }

  const start = html.indexOf('{', marker)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** __MESSAGE 既可能是数组，也可能是 {"0":..,"1":..} 形式的对象 */
type MessageBag = Record<string, unknown>

function readMessages(payload: unknown): MessageBag | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as { data?: { __MESSAGE?: unknown }; __MESSAGE?: unknown }
  const bag = obj.data?.__MESSAGE ?? obj.__MESSAGE
  if (Array.isArray(bag)) {
    // 数组形态按索引映射成 "0"/"1"/"3"/"6" 键，与对象形态统一
    const out: MessageBag = {}
    bag.forEach((value, index) => {
      out[String(index)] = value
    })
    return out
  }
  if (bag && typeof bag === 'object') return bag as MessageBag
  return null
}

/**
 * 解析 NGA 回帖响应，区分登录失效 / 频率限制 / 权限不足 / 主题锁定 / 成功。
 */
export function interpretReplyResponse(
  status: number,
  html: string,
  location?: string,
): ReplyResult {
  if (status === 401 || status === 403) {
    return { ok: false, error: 'NGA 登录态已失效，请重新登录后再发送' }
  }

  // 新版接口：script_muti_get_var_store({data:{__MESSAGE:[...]}})
  const payload = parseApiPayload(html)
  const messages = readMessages(payload)
  if (messages) {
    if (!messages[0]) {
      const jump = typeof messages[6] === 'string' ? messages[6] : undefined
      return {
        ok: true,
        pid: (jump ? extractPid(jump) : undefined) ?? extractPid(html, location),
      }
    }
    return {
      ok: false,
      error: String(messages[1] || messages[0] || '发帖失败'),
      diagnostics: { status, location, snippet: textSnippet(html) },
    }
  }

  const errorPayload = (payload as { error?: unknown } | null)?.error
  if (typeof errorPayload === 'string' && errorPayload.trim()) {
    return {
      ok: false,
      error: errorPayload,
      diagnostics: { status, location, snippet: textSnippet(html) },
    }
  }

  // 3xx：Discuz 回帖成功的标准行为是重定向到带 pid 的楼层
  if (status >= 300 && status < 400) {
    const loc = location || ''
    if (/login|passport|nukaga/i.test(loc)) {
      return { ok: false, error: 'NGA 登录态已失效，请重新登录后再发送' }
    }
    const pid = extractPid(html, loc)
    if (loc.includes('read.php') || loc.includes('pid=') || pid) {
      return { ok: true, pid }
    }
  }

  if (/需要登录|请先登录|您需要登录|未登录/.test(html)) {
    return { ok: false, error: 'NGA 登录态已失效，请重新登录后再发送' }
  }
  if (/发帖间隔|时间间隔|间隔过短|发帖过快|操作过于频繁|秒内不能发帖|请稍后再试/.test(html)) {
    return { ok: false, error: '发帖过于频繁，请稍后再试' }
  }
  if (/主题已被锁定|主题已锁定|锁帖|主题已关闭|禁止回复|无权回复|不能回复/.test(html)) {
    return { ok: false, error: '该主题已被锁定或禁止回复' }
  }
  if (/用户组|权限不足|无权发帖|无法发帖/.test(html)) {
    return { ok: false, error: '当前账号无发帖权限' }
  }
  if (/操作成功|回复成功|发表成功/.test(html)) {
    return { ok: true, pid: extractPid(html, location) }
  }
  if (status >= 500) {
    return { ok: false, error: `NGA 服务异常（HTTP ${status}）` }
  }

  const snippet = textSnippet(html)
  const detail = [
    `HTTP ${status}`,
    location ? `跳转 ${location}` : '',
    snippet ? `响应「${snippet}」` : '',
  ]
    .filter(Boolean)
    .join('，')
  return {
    ok: false,
    error: `回复失败：未能识别 NGA 返回内容（${detail}）`,
    diagnostics: { status, location, snippet },
  }
}
