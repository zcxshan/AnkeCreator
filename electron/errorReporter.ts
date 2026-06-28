// ============================================================
// 全局错误捕获（Electron 主进程）
//
// 目的：把主进程中的所有未捕获异常 / Promise 拒绝 / 子进程崩溃
//       转发到「系统对话框 + 错误日志文件」，让用户在启动失败时
//       至少能看到「出错了 + 错误信息 + 日志路径」。
//
// 解决之前的问题：
//   - migrateFromUserDataIfNeeded 内部 try/catch 静默吞错
//   - fs.mkdirSync 抛出后 app.whenReady().then() 内部抛出
//   - Electron 默认不显示未捕获异常对话框
//   - 用户唯一能看到的现象 = "什么都没发生"
//
// 调用时机：必须在所有 app.on('xxx') 之前注册
//           建议放在 main.ts 顶部（最早期）
// ============================================================

import { app, dialog } from 'electron'
import fs from 'fs'
import path from 'path'

let initialized = false
let logFilePath: string | null = null

/**
 * 获取错误日志文件路径
 * - dev 模式：<项目根>/.dev-logs/main-error.log
 * - 打包模式：<安装路径>/data/main-error.log
 */
function getLogFile(): string {
  if (logFilePath) return logFilePath
  let base: string
  if (app.isPackaged) {
    base = path.join(path.dirname(process.execPath), 'data')
  } else {
    base = path.join(process.cwd(), '.dev-logs')
  }
  try {
    fs.mkdirSync(base, { recursive: true })
  } catch {
    /* 目录创建失败时用系统临时目录兜底 */
    base = require('os').tmpdir()
  }
  logFilePath = path.join(base, 'main-error.log')
  return logFilePath
}

/** 把错误追加写入日志文件 */
function logErrorToFile(prefix: string, err: unknown): void {
  try {
    const ts = new Date().toISOString()
    const stack = (err as any)?.stack || String(err)
    const line = `[${ts}] ${prefix}: ${stack}\n`
    fs.appendFileSync(getLogFile(), line, 'utf-8')
  } catch {
    /* 写日志失败也不抛（避免连环错误） */
  }
}

/** 安全地弹错误框（dialog 自身可能失败） */
function safeShowError(title: string, body: string): void {
  try {
    dialog.showErrorBox(title, body)
  } catch (e) {
    // 兜底：再写一次日志
    try {
      console.error(`[errorReporter] 无法弹错误框: ${title}: ${body}: ${e}`)
      fs.appendFileSync(
        getLogFile(),
        `[${new Date().toISOString()}] safeShowError failed: ${title}: ${e}\n`,
        'utf-8',
      )
    } catch {
      /* noop */
    }
  }
}

/**
 * 注册主进程全局错误处理
 * 必须在 app.whenReady() 之前调用，且只调用一次
 */
export function registerGlobalErrorHandlers(): void {
  if (initialized) return
  initialized = true

  // 1) 同步异常
  process.on('uncaughtException', (err) => {
    logErrorToFile('uncaughtException', err)
    const msg = (err as any)?.message || String(err)
    safeShowError(
      '主进程异常',
      `应用遇到未处理的错误：\n\n${msg}\n\n详细信息：${getLogFile()}`,
    )
  })

  // 2) 未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason) => {
    logErrorToFile('unhandledRejection', reason)
    const msg = (reason as any)?.message || String(reason)
    safeShowError(
      '异步操作失败',
      `应用遇到未处理的异步错误：\n\n${msg}\n\n详细信息：${getLogFile()}`,
    )
  })

  // 3) 渲染进程崩溃
  app.on('render-process-gone', (_event, _webContents, details) => {
    logErrorToFile('render-process-gone', details)
    console.error('[errorReporter] 渲染进程崩溃:', details)
  })

  // 4) 子进程崩溃
  app.on('child-process-gone', (_event, details) => {
    logErrorToFile('child-process-gone', details)
    console.error('[errorReporter] 子进程崩溃:', details)
  })

  // 5) 主进程即将退出（兜底写日志）
  process.on('exit', (code) => {
    try {
      fs.appendFileSync(
        getLogFile(),
        `[${new Date().toISOString()}] process exit with code ${code}\n`,
        'utf-8',
      )
    } catch {
      /* noop */
    }
  })
}
