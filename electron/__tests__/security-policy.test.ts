// ============================================================
// 窗口安全策略测试（纯函数）
// 覆盖：
//   1. CSP 指令齐全且不含 unsafe-eval
//   2. 外链协议识别（http/https/mailto 允许，其余拒绝）
//   3. local:// 资源识别
//   4. 内部页面判定（生产 dist / 开发 Vite 同源 / 非法协议）
// ============================================================

import { describe, it, expect } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  buildCsp,
  isExternalUrl,
  isInternalUrl,
  isLocalAssetUrl,
} from '../securityPolicy'

const DIST = path.resolve('C:/apps/anke/dist')

describe('buildCsp', () => {
  const csp = buildCsp()

  it('锁定脚本来源且禁止 eval', () => {
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('禁止 object / 表单提交 / iframe 嵌套', () => {
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('图片允许 http/https（图床）与 local://', () => {
    expect(csp).toContain('https:')
    expect(csp).toContain('http:')
    expect(csp).toContain('local:')
  })
})

describe('isExternalUrl', () => {
  it('http / https / mailto 视为外链', () => {
    expect(isExternalUrl('https://nga.178.com/read.php?tid=1')).toBe(true)
    expect(isExternalUrl('http://example.com')).toBe(true)
    expect(isExternalUrl('mailto:a@b.com')).toBe(true)
  })

  it('内部协议与危险协议不视为外链', () => {
    expect(isExternalUrl('local://abc.png')).toBe(false)
    expect(isExternalUrl('file:///C:/apps/anke/dist/index.html')).toBe(false)
    expect(isExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isExternalUrl('not a url')).toBe(false)
  })
})

describe('isLocalAssetUrl', () => {
  it('只认 local://', () => {
    expect(isLocalAssetUrl('local://abc.png')).toBe(true)
    expect(isLocalAssetUrl('https://nga.178.com/a.png')).toBe(false)
    expect(isLocalAssetUrl('file:///C:/a.png')).toBe(false)
  })
})

describe('isInternalUrl', () => {
  const ctx = { rendererDist: DIST }

  it('生产模式只允许 dist 目录内的文件', () => {
    const inside = pathToFileURL(path.join(DIST, 'index.html')).toString()
    const nested = pathToFileURL(path.join(DIST, 'assets', 'index.js')).toString()
    const outside = pathToFileURL(path.resolve('C:/Users/dell/secret.txt')).toString()
    expect(isInternalUrl(inside, ctx)).toBe(true)
    expect(isInternalUrl(nested, ctx)).toBe(true)
    expect(isInternalUrl(outside, ctx)).toBe(false)
  })

  it('生产模式拒绝外部网页与危险协议', () => {
    expect(isInternalUrl('https://evil.example.com/', ctx)).toBe(false)
    expect(isInternalUrl('javascript:alert(1)', ctx)).toBe(false)
    expect(isInternalUrl('about:blank', ctx)).toBe(false)
    expect(isInternalUrl('not a url', ctx)).toBe(false)
  })

  it('开发模式允许 Vite 服务器同源，拒绝其它源', () => {
    const dev = { rendererDist: DIST, devServerOrigin: 'http://localhost:5173' }
    expect(isInternalUrl('http://localhost:5173/index.html', dev)).toBe(true)
    expect(isInternalUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isInternalUrl('http://localhost:5174/index.html', dev)).toBe(false)
    expect(isInternalUrl('https://evil.example.com/', dev)).toBe(false)
  })
})
