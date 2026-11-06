import { describe, expect, it } from 'vitest'
import {
  buildReplyBody,
  extractThreadIdentity,
  interpretReplyResponse,
} from '../data-core/ngaReply'

describe('nga reply helpers', () => {
  it('从新版回复页的 __U 提取 fid 与 auth', () => {
    const html =
      '<script>var __U={"action":"reply","pid":"","fid":784,"auth":"040203ca6aee19a6","tid":47008305,"subject":"..."}</script>'
    expect(extractThreadIdentity(html)).toEqual({
      fid: '784',
      auth: '040203ca6aee19a6',
    })
  })

  it('回退到 URL 形式提取 fid', () => {
    expect(extractThreadIdentity('<a href="forumdisplay.php?fid=784">版块</a>')).toEqual({
      fid: '784',
      auth: undefined,
    })
  })

  it('构造新版 /post.php 表单请求体', () => {
    const body = buildReplyBody({
      tid: '123',
      fid: '784',
      content: '正文 & 符号',
    })
    const parsed = new URLSearchParams(body)
    expect(parsed.get('action')).toBe('reply')
    expect(parsed.get('tid')).toBe('123')
    expect(parsed.get('fid')).toBe('784')
    expect(parsed.get('post_content')).toBe('正文 & 符号')
    expect(parsed.get('step')).toBe('2')
    expect(parsed.get('lite')).toBe('htmljs')
    expect(parsed.get('nojump')).toBe('1')
    expect(parsed.get('post_opt')).toBe('0')
    expect(parsed.get('__inchst')).toBe('UTF-8')
    // 旧 Discuz 字段已不再使用
    expect(parsed.get('content')).toBeNull()
    expect(parsed.get('formhash')).toBeNull()
    expect(parsed.get('replysubmit')).toBeNull()
  })

  it('新版 script_muti_get_var_store 成功响应（__MESSAGE 为对象）', () => {
    const html =
      '<html><body><script>window.script_muti_get_var_store={"error":{"0":":发贴完毕 ...","1":"","2":0},"data":{"__MESSAGE":{"0":"","1":"发贴完毕 ...","2":"","3":200,"4":"","5":0,"6":"/read.php?tid=47008305&_ff=784&page=e#pid887151601Anchor"}},"encode":"gbk"}</script></body></html>'
    expect(interpretReplyResponse(200, html)).toEqual({
      ok: true,
      pid: '887151601',
    })
  })

  it('新版 script_muti_get_var_store 成功响应（__MESSAGE 为数组）', () => {
    const html =
      '<script>script_muti_get_var_store({"data":{"__MESSAGE":["","发布成功","","","","","https://bbs.nga.cn/read.php?tid=123&pid=987654"]}})</script>'
    expect(interpretReplyResponse(200, html)).toEqual({
      ok: true,
      pid: '987654',
    })
  })

  it('新版 script_muti_get_var_store 失败响应返回 __MESSAGE[1]', () => {
    const html =
      '<script>script_muti_get_var_store({"data":{"__MESSAGE":["error","您两次发帖时间间隔过短，请稍后再试"]}})</script>'
    const result = interpretReplyResponse(200, html)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('您两次发帖时间间隔过短，请稍后再试')
  })

  it('3xx 重定向到楼层视为成功（旧版响应兜底）', () => {
    expect(
      interpretReplyResponse(302, '', 'https://bbs.nga.cn/read.php?tid=123&pid=987654'),
    ).toEqual({ ok: true, pid: '987654' })
    expect(interpretReplyResponse(303, '', 'https://bbs.nga.cn/read.php?tid=123')).toEqual({
      ok: true,
      pid: undefined,
    })
  })

  it('3xx 重定向到登录页视为登录失效', () => {
    expect(interpretReplyResponse(302, '', 'https://bbs.nga.cn/nukaga_login.php').error).toContain(
      '登录态已失效',
    )
  })

  it('无法识别时返回诊断信息', () => {
    const result = interpretReplyResponse(200, '<html><body><div>未知页面</div></body></html>')
    expect(result.ok).toBe(false)
    expect(result.diagnostics?.status).toBe(200)
    expect(result.diagnostics?.snippet).toContain('未知页面')
    expect(result.error).toContain('HTTP 200')
  })

  it('解析登录失效 / 频率限制 / 权限不足 / 成功', () => {
    expect(interpretReplyResponse(403, '').error).toContain('登录态已失效')
    expect(interpretReplyResponse(200, '您需要登录后才能回复').error).toContain('登录态已失效')
    expect(interpretReplyResponse(200, '您两次发帖时间间隔过短').error).toContain('频繁')
    expect(interpretReplyResponse(200, '您所在的用户组无法发帖').error).toContain('无发帖权限')
    expect(interpretReplyResponse(200, '操作成功 <a href="read.php?pid=987654">查看</a>')).toEqual({
      ok: true,
      pid: '987654',
    })
    expect(interpretReplyResponse(500, '').ok).toBe(false)
  })
})
