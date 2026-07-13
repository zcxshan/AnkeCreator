// ============================================================
// 路径决策中心（Electron 主进程）
//
// 用途：统一决定数据存储位置，避免在多个文件里重复
//       `app.isPackaged` 判断和路径拼接。
//
// 决策规则：
//   - 打包模式（app.isPackaged === true）：<安装路径>/data/
//     安装路径 = path.dirname(process.execPath)
//   - dev 模式（npm run dev，未打包）：app.getPath('userData')
//     = C:\Users\<user>\AppData\Roaming\com.shanshian.ankecreator\
//     保持现状，避免污染安装路径
//
// v3.2+ 扁平化（#9）：所有数据统一在 <安装路径>/data/ 下，不再有 data/data/ 嵌套
//   - <installDir>/data/                     ← getDataDir()（也是 getDataRoot()）
//   - <installDir>/data/stories/             ← per-story JSON 文件
//   - <installDir>/data/stories/__trash/     ← 软删除的作品
//   - <installDir>/data/templates/           ← 跨作品共享模板
//   - <installDir>/data/images/              ← 本地保存的图片
//   - <installDir>/data/sounds/              ← 用户上传的骰子音效
//
// 一次性自动迁移（仅打包模式）：
//   首次启动打包版时，
//   1) 若 %APPDATA%\com.shanshian.ankecreator\ 存在旧数据，自动复制到 <安装路径>/data/
//   2) 若 <安装路径>/data/data/ 存在旧版本（v3.2 之前的嵌套结构），自动移动到 <安装路径>/data/
//      原位置作为备份保留，用户确认后可手动删除。
// ============================================================

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

let _dataRoot: string | null = null
let _dataRootFallback: boolean = false

/**
 * 数据根目录（#9：v3.2+ 扁平化）
 * - 打包模式：<安装路径>/data/（所有数据统一在此目录下）
 * - 如果 <安装路径> 无写权限（常见于 C:\Program Files\），
 *   自动回退到 %APPDATA%\com.shanshian.ankecreator\data\，
 *   避免数据丢失。
 * - dev 模式（未打包）：app.getPath('userData')
 *
 * 回退策略：第一次调用时尝试检测 installDir 是否可写，
 *   不可写时切换到 %APPDATA%，后续所有调用都走回退后的路径。
 */
export function getDataRoot(): string {
  if (_dataRoot) return _dataRoot
  if (app.isPackaged) {
    const installDir = path.dirname(process.execPath)
    const installDataDir = path.join(installDir, 'data')
    // 第一次调用：检测 installDir/data/ 是否可写
    if (isPathWritable(installDataDir)) {
      _dataRoot = installDataDir
      console.log('[paths] 数据目录：', _dataRoot, '(安装路径)')
    } else {
      // 回退到 %APPDATA%
      const appdata = app.getPath('appData')
      const fallbackDataDir = path.join(appdata, 'com.shanshian.ankecreator', 'data')
      _dataRoot = fallbackDataDir
      _dataRootFallback = true
      console.warn(
        '[paths] 安装路径无写权限，回退到 %APPDATA%：',
        fallbackDataDir,
      )
    }
    // 确保目录存在
    try {
      if (!fs.existsSync(_dataRoot)) {
        fs.mkdirSync(_dataRoot, { recursive: true })
      }
    } catch (e) {
      console.error('[paths] 创建数据目录失败:', e)
    }
  } else {
    _dataRoot = app.getPath('userData')
  }
  return _dataRoot
}

/**
 * 是否发生过回退（installDir 无写权限时回退到 %APPDATA%）
 * 用于在 main.ts 启动时给用户友好提示
 */
export function isDataRootFallback(): boolean {
  return _dataRootFallback
}

/**
 * 检测路径是否可写（不存在时尝试创建）
 */
function isPathWritable(p: string): boolean {
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true })
    }
    const probe = path.join(p, '.write-probe')
    fs.writeFileSync(probe, 'ok', 'utf-8')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * 数据目录（#9：v3.2+ 扁平化）。
 * 与 getDataRoot() 等价；保留函数名以避免破坏调用方。
 * 实际指向 <dataRoot>，即 <安装路径>/data/。
 */
export function getDataDir(): string {
  return getDataRoot()
}

/**
 * per-story 文件目录：<dataDir>/stories/
 */
export function getStoriesDir(): string {
  const dir = path.join(getDataDir(), 'stories')
  ensureDirWritable(dir)
  return dir
}

/**
 * 软删除作品目录：<dataDir>/stories/__trash/
 */
export function getTrashDir(): string {
  const dir = path.join(getStoriesDir(), '__trash')
  ensureDirWritable(dir)
  return dir
}

/**
 * 模板目录：<dataDir>/templates/
 */
export function getTemplatesDir(): string {
  const dir = path.join(getDataDir(), 'templates')
  ensureDirWritable(dir)
  return dir
}

/**
 * 本地图片目录：<dataDir>/images/
 * （自动创建目录 + 写入权限预检）
 */
export function getImagesDir(): string {
  const dir = path.join(getDataDir(), 'images')
  ensureDirWritable(dir)
  return dir
}

/**
 * 骰子音效目录
 * - 打包模式：<app.asar>/dist/sounds/（Vite 把 public/ 内容拷到 dist/）
 * - dev 模式：<projectRoot>/public/sounds/
 *
 * 音效为项目内置资源（用户提前放入 public/sounds/），只读扫描，不需要写入。
 */
export function getSoundsDir(): string {
  if (app.isPackaged) {
    // __dirname = <app.asar>/dist-electron/
    // Vite 构建把 public/sounds/ 拷贝到 dist/sounds/
    return path.join(__dirname, '..', 'dist', 'sounds')
  }
  return path.join(process.cwd(), 'public', 'sounds')
}

/**
 * 用户自定义骰子音效目录（可写）。
 * #9：与 images/ 同样在 data/ 目录下。
 */
export function getUserSoundsDir(): string {
  const dir = path.join(getDataDir(), 'sounds')
  ensureDirWritable(dir)
  return dir
}

/**
 * 写入权限预检：确保目录存在且可写
 * 失败时抛带可读提示的 Error（外层 try/catch 可弹错误框）
 */
function ensureDirWritable(dir: string): void {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (e) {
      throw new Error(
        `无法创建数据目录：${dir}\n` +
          `原因：${(e as any)?.message || e}\n\n` +
          `如安装路径无写权限，请重新安装到「文档」「D盘」等有写权限的位置。`,
      )
    }
  }
  // 写权限测试（用临时 .write-probe 文件）
  try {
    const probe = path.join(dir, '.write-probe')
    fs.writeFileSync(probe, 'ok', 'utf-8')
    fs.unlinkSync(probe)
  } catch (e) {
    throw new Error(
      `数据目录无写权限：${dir}\n` +
        `原因：${(e as any)?.message || e}\n\n` +
        `请检查目录权限或重新安装到有写权限的位置。`,
    )
  }
}

/**
 * 一次性自动迁移：打包模式下，把 %APPDATA%\com.shanshian.ankecreator\ 下的
 * data + images + sounds 复制到 <安装路径>/data/ 下。
 *
 * 触发条件（必须同时满足）：
 *   1. app.isPackaged（仅打包模式迁移，dev 模式不迁移）
 *   2. 新位置 <installPath>/data/ 下 stories 目录为空
 *   3. 旧位置 %APPDATA%\com.shanshian.ankecreator\ 存在数据
 */
export function migrateFromUserDataIfNeeded(): void {
  console.log('[paths] 检查是否需要迁移...')
  if (!app.isPackaged) {
    console.log('[paths] dev 模式，跳过迁移')
    return
  }

  const newDataDir = getDataDir() // #9 扁平化后就是 <installDir>/data/
  const migrationFlag = path.join(newDataDir, '.migrated-from-appdata')

  // 已迁移过（标记文件存在）→ 跳过
  if (fs.existsSync(migrationFlag)) {
    console.log('[paths] 已迁移过 userData，跳过')
    return
  }

  // 新位置已有 per-story 数据 → 不覆盖
  try {
    if (
      fs.existsSync(newDataDir) &&
      fs.existsSync(path.join(newDataDir, 'stories')) &&
      fs.readdirSync(path.join(newDataDir, 'stories')).filter((f) => f.endsWith('.json')).length > 0
    ) {
      console.log('[paths] 新位置已有 per-story 数据，跳过迁移:', newDataDir)
      return
    }
  } catch {
    /* 目录读取失败则继续尝试迁移 */
  }

  // 计算旧位置：%APPDATA%\<appId>\
  const oldRoot = path.join(app.getPath('appData'), 'com.shanshian.ankecreator')
  const oldDataDirNew = path.join(oldRoot, 'data')
  const oldDataDirLegacy = path.join(oldRoot, 'AnkeCreatorData')
  const oldImagesDir = path.join(oldRoot, 'images')
  const oldSoundsDir = path.join(oldRoot, 'sounds')

  const oldDataDir = fs.existsSync(oldDataDirNew) ? oldDataDirNew : (fs.existsSync(oldDataDirLegacy) ? oldDataDirLegacy : null)

  if (!oldDataDir && !fs.existsSync(oldImagesDir) && !fs.existsSync(oldSoundsDir)) {
    console.log('[paths] 旧位置无数据，无需迁移')
    return
  }

  const startMs = Date.now()
  try {
    console.log('[paths] 开始复制 userData → <installDir>/data/')

    // 确保新位置父目录存在
    if (!fs.existsSync(newDataDir)) {
      fs.mkdirSync(newDataDir, { recursive: true })
    }

    // 递归复制 data（可能不存在）
    if (oldDataDir) {
      console.log('[paths] 复制:', oldDataDir, '→', newDataDir)
      fs.cpSync(oldDataDir, newDataDir, { recursive: true })
    }
    if (fs.existsSync(oldImagesDir)) {
      const newImagesDir = getImagesDir()
      console.log('[paths] 复制 images:', oldImagesDir, '→', newImagesDir)
      fs.cpSync(oldImagesDir, newImagesDir, { recursive: true })
    }
    if (fs.existsSync(oldSoundsDir)) {
      const newSoundsDir = getUserSoundsDir()
      console.log('[paths] 复制 sounds:', oldSoundsDir, '→', newSoundsDir)
      fs.cpSync(oldSoundsDir, newSoundsDir, { recursive: true })
    }

    // 写标记
    fs.writeFileSync(
      migrationFlag,
      JSON.stringify(
        {
          migratedAt: new Date().toISOString(),
          from: oldRoot,
          to: newDataDir,
          oldDataDir,
          oldImagesDir,
          oldSoundsDir,
          note: '删除此文件可重新触发迁移检查',
        },
        null,
        2,
      ),
      'utf-8',
    )

    const elapsed = Date.now() - startMs
    console.log(`[paths] userData 迁移完成，耗时 ${elapsed}ms`)
    console.log(`[paths] 迁移标记: ${migrationFlag}`)
    console.log('[paths] 旧数据保留在原位置作为备份，可在确认新位置正常后手动删除')
  } catch (e) {
    console.error('[paths] 复制失败（不写标记，下次启动重试）:', e)
  }
}

/**
 * v3.2+ 数据扁平化迁移：把旧的 <installDir>/data/data/ 下的内容
 * 移动到 <installDir>/data/（即新位置），并删除空的 data/data/ 子目录。
 *
 * 触发条件（仅打包模式）：
 *   1. <installDir>/data/data/ 存在
 *   2. <installDir>/data/.migrated-data-flatten 标记文件不存在
 *   3. <installDir>/data/stories/ 下没有 per-story JSON（避免覆盖）
 *
 * 行为：
 *   - 把 <installDir>/data/data/* 整体合并到 <installDir>/data/
 *   - 合并完成后删除空的 data/data/
 *   - 写标记文件 <installDir>/data/.migrated-data-flatten
 *   - 失败时 console.error，下次启动重试
 */
export function migrateFlattenDataIfNeeded(): void {
  if (!app.isPackaged) return

  const newDataDir = getDataDir() // <installDir>/data/
  const oldNestedDir = path.join(newDataDir, 'data')
  const migrationFlag = path.join(newDataDir, '.migrated-data-flatten')

  if (fs.existsSync(migrationFlag)) return
  if (!fs.existsSync(oldNestedDir)) return

  // 安全检查：避免覆盖已有数据
  const storiesDir = path.join(newDataDir, 'stories')
  try {
    if (
      fs.existsSync(storiesDir) &&
      fs.readdirSync(storiesDir).filter((f) => f.endsWith('.json')).length > 0
    ) {
      console.log('[paths] 新位置已有 stories，跳过扁平化迁移')
      fs.writeFileSync(migrationFlag, JSON.stringify({ skipped: true, at: new Date().toISOString() }), 'utf-8')
      return
    }
  } catch {
    /* 继续尝试 */
  }

  console.log('[paths] 扁平化迁移开始:', oldNestedDir, '→', newDataDir)
  try {
    // 把 oldNestedDir 下的内容移动到 newDataDir
    const entries = fs.readdirSync(oldNestedDir, { withFileTypes: true })
    for (const entry of entries) {
      const from = path.join(oldNestedDir, entry.name)
      const to = path.join(newDataDir, entry.name)
      if (fs.existsSync(to)) {
        console.log('[paths] 已存在，跳过:', entry.name)
        continue
      }
      fs.cpSync(from, to, { recursive: true })
    }
    // 删除空 oldNestedDir
    try {
      fs.rmdirSync(oldNestedDir)
    } catch (e) {
      console.warn('[paths] 删除旧嵌套目录失败（可能是非空）:', e)
    }
    fs.writeFileSync(
      migrationFlag,
      JSON.stringify({ at: new Date().toISOString(), from: oldNestedDir, to: newDataDir }, null, 2),
      'utf-8',
    )
    console.log('[paths] 扁平化迁移完成')
  } catch (e) {
    console.error('[paths] 扁平化迁移失败（不写标记，下次启动重试）:', e)
  }
}
