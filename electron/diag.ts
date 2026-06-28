// ============================================================
// 命令行诊断模式
//
// 用途：让用户在不开窗的情况下诊断数据目录、迁移状态、文件权限。
//       解决「双击后无任何反应」时无任何反馈的问题。
//
// 用法：
//   - 打包：<安装路径>\安科作者助手.exe --diag --enable-logging
//   - 开发：npm run dev -- --diag
//
// 输出：控制台打印诊断信息，3 秒后自动退出（让 stdout 来得及刷新）
// 返回：true 表示是诊断模式（主入口应跳过 app.whenReady 后续步骤）
// ============================================================

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDataRoot, getDataDir, getImagesDir } from './paths'

export function runDiag(): boolean {
  if (!process.argv.includes('--diag')) return false

  console.log('========== AnkeCreator 诊断模式 ==========')
  console.log('时间:', new Date().toISOString())
  console.log('isPackaged:', app.isPackaged)
  console.log('process.execPath:', process.execPath)
  console.log('process.platform:', process.platform)
  console.log('process.arch:', process.arch)
  console.log('process.versions.node:', process.versions.node)
  console.log('process.versions.electron:', process.versions.electron)
  console.log('process.versions.chrome:', process.versions.chrome)
  console.log('')

  let root = '<未获取>'
  let dataDir = '<未获取>'
  let imagesDir = '<未获取>'

  try {
    root = getDataRoot()
    console.log('✓ 数据根目录:', root)
  } catch (e) {
    console.log('✗ 获取数据根目录失败:', (e as any)?.message || e)
  }

  try {
    dataDir = getDataDir()
    console.log('✓ JSON 数据库:', dataDir)
  } catch (e) {
    console.log('✗ 获取 JSON 目录失败:', (e as any)?.message || e)
  }

  try {
    imagesDir = getImagesDir()
    console.log('✓ 本地图片:', imagesDir)
  } catch (e) {
    console.log('✗ 获取图片目录失败:', (e as any)?.message || e)
  }

  console.log('')
  console.log('========== 路径检查 ==========')

  const checks: Array<{ name: string; path: string }> = [
    { name: '数据根目录', path: root },
    { name: 'JSON 目录', path: dataDir },
    { name: '图片目录', path: imagesDir },
    { name: '迁移标记', path: path.join(root, '.migrated-from-appdata') },
    {
      name: '老数据 stories.json（C 盘）',
      path: path.join(app.getPath('appData'), 'com.shanshian.ankecreator', 'AnkeCreatorData', 'stories.json'),
    },
    {
      name: '老数据 images/（C 盘）',
      path: path.join(app.getPath('appData'), 'com.shanshian.ankecreator', 'images'),
    },
    {
      name: 'dev 模式 userData',
      path: app.getPath('userData'),
    },
  ]

  for (const c of checks) {
    let exists = false
    let writable = false
    let readable = false
    try {
      exists = fs.existsSync(c.path)
    } catch {
      /* noop */
    }
    if (exists) {
      try {
        fs.accessSync(c.path, fs.constants.R_OK)
        readable = true
      } catch {
        /* noop */
      }
      try {
        fs.accessSync(c.path, fs.constants.W_OK)
        writable = true
      } catch {
        /* noop */
      }
    }
    const status = exists ? '✓' : '✗'
    const flags: string[] = []
    if (exists) flags.push(readable ? '可读' : '不可读')
    if (exists) flags.push(writable ? '可写' : '不可写')
    console.log(`  ${status} ${c.name}: ${c.path}${flags.length ? ' (' + flags.join(', ') + ')' : ''}`)
  }

  console.log('')
  console.log('========== 磁盘空间 ==========')
  try {
    // 用 statfs（Node 18.15+）检查可用空间
    // fallback 到 statsv 不准确，简单输出即可
    const stat = fs.statfsSync ? fs.statfsSync(root === '<未获取>' ? process.cwd() : root) : null
    if (stat) {
      const freeGB = (stat.bavail * stat.bsize) / 1024 / 1024 / 1024
      const totalGB = (stat.blocks * stat.bsize) / 1024 / 1024 / 1024
      console.log(`  根目录所在盘: 剩余 ${freeGB.toFixed(2)} GB / 总计 ${totalGB.toFixed(2)} GB`)
    }
  } catch (e) {
    console.log('  (无法获取磁盘空间):', (e as any)?.message || e)
  }

  console.log('')
  console.log('========== JSON 文件检查 ==========')
  const jsonFiles = ['stories.json', 'world_settings.json', 'characters.json', 'sections.json']
  for (const f of jsonFiles) {
    const p = path.join(dataDir, f)
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8')
        JSON.parse(content)
        console.log(`  ✓ ${f}: 有效 JSON (${content.length} 字节)`)
      } catch (e) {
        console.log(`  ✗ ${f}: JSON 解析失败 - ${(e as any)?.message || e}`)
      }
    } else {
      console.log(`  · ${f}: 不存在（首次启动会创建）`)
    }
  }

  console.log('')
  console.log('========== 诊断完成，3 秒后退出 ==========')
  console.log('💡 提示：如果数据根目录显示在 C 盘 userData 而不是安装路径，')
  console.log('   说明应用运行在开发模式（npm run dev）。要测试新路径请用打包版。')

  setTimeout(() => app.exit(0), 3000)
  return true
}
