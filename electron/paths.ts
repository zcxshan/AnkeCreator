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
// 子目录（扁平化结构）：
//   - <dataRoot>/data/                → 数据根目录
//   - <dataRoot>/data/stories/        → per-story JSON 文件
//   - <dataRoot>/data/stories/__trash/ → 软删除的作品
//   - <dataRoot>/data/templates/      → 跨作品共享模板
//   - <dataRoot>/images/              → 本地保存的图片（local:// 协议）
//
// 一次性自动迁移（仅打包模式）：
//   首次启动打包版时，若 %APPDATA%\com.shanshian.ankecreator\
//   下存在旧数据，自动复制到 <安装路径>/data/。原数据保留作
//   为备份，用户确认新位置正常后可手动删除。
// ============================================================

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

let _dataRoot: string | null = null

/**
 * 数据根目录
 * - 打包模式：<安装路径>/data/
 * - dev 模式（未打包）：app.getPath('userData')
 */
export function getDataRoot(): string {
  if (_dataRoot) return _dataRoot
  if (app.isPackaged) {
    const installDir = path.dirname(process.execPath)
    _dataRoot = path.join(installDir, 'data')
  } else {
    _dataRoot = app.getPath('userData')
  }
  return _dataRoot
}

/**
 * 数据目录：<dataRoot>/data/
 * （自动创建目录 + 写入权限预检）
 */
export function getDataDir(): string {
  const dir = path.join(getDataRoot(), 'data')
  ensureDirWritable(dir)
  return dir
}

/**
 * per-story 文件目录：<dataRoot>/data/stories/
 */
export function getStoriesDir(): string {
  const dir = path.join(getDataDir(), 'stories')
  ensureDirWritable(dir)
  return dir
}

/**
 * 软删除作品目录：<dataRoot>/data/stories/__trash/
 */
export function getTrashDir(): string {
  const dir = path.join(getStoriesDir(), '__trash')
  ensureDirWritable(dir)
  return dir
}

/**
 * 模板目录：<dataRoot>/data/templates/
 */
export function getTemplatesDir(): string {
  const dir = path.join(getDataDir(), 'templates')
  ensureDirWritable(dir)
  return dir
}

/**
 * 本地图片目录：<dataRoot>/images/
 * （自动创建目录 + 写入权限预检）
 */
export function getImagesDir(): string {
  const dir = path.join(getDataRoot(), 'images')
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
 * data + images 复制到 <安装路径>/data\ 下。
 *
 * 触发条件（必须同时满足）：
 *   1. app.isPackaged（仅打包模式迁移，dev 模式不迁移）
 *   2. 新位置 <installPath>/data/ 下 data 目录不存在
 *   3. 旧位置 %APPDATA%\com.shanshian.ankecreator\data 存在（新扁平结构）
 *      或 %APPDATA%\com.shanshian.ankecreator\AnkeCreatorData 存在（旧嵌套结构）
 *
 * 行为：
 *   - 用 fs.cpSync（递归）复制整个 data + images 到新位置
 *   - 复制成功后不删旧数据（用户可在确认新位置正常后手动删除）
 *   - 在新位置 <installPath>/data/.migrated-from-appdata 写个标记文件
 *     （删除此文件可重新触发迁移检查）
 *   - 失败时 console.error，不抛错（最坏情况 = 新位置空数据，按新作品处理）
 */
export function migrateFromUserDataIfNeeded(): void {
  console.log('[paths] 检查是否需要迁移...')
  if (!app.isPackaged) {
    console.log('[paths] dev 模式，跳过迁移')
    return
  }

  const newRoot = getDataRoot()
  const newDataDir = path.join(newRoot, 'data')
  const newImagesDir = path.join(newRoot, 'images')
  const migrationFlag = path.join(newRoot, '.migrated-from-appdata')

  // 已迁移过（标记文件存在）→ 跳过
  if (fs.existsSync(migrationFlag)) {
    console.log('[paths] 已迁移过 userData，跳过')
    return
  }

  // 新位置已有数据 → 不覆盖（用户可能从别处恢复的）
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
  // app.getPath('appData') = C:\Users\<user>\AppData\Roaming
  const oldRoot = app.getPath('appData')
  const oldDataDirNew = path.join(oldRoot, 'com.shanshian.ankecreator', 'data')
  const oldDataDirLegacy = path.join(oldRoot, 'com.shanshian.ankecreator', 'AnkeCreatorData')
  const oldImagesDir = path.join(oldRoot, 'com.shanshian.ankecreator', 'images')

  // 优先匹配新扁平结构，回退到旧嵌套结构
  const oldDataDir = fs.existsSync(oldDataDirNew) ? oldDataDirNew : (fs.existsSync(oldDataDirLegacy) ? oldDataDirLegacy : null)

  if (!oldDataDir) {
    console.log('[paths] 旧位置无数据，无需迁移')
    return
  }

  const startMs = Date.now()
  try {
    console.log('[paths] 开始复制:', oldDataDir, '→', newDataDir)

    // 确保新位置父目录存在
    if (!fs.existsSync(newRoot)) {
      fs.mkdirSync(newRoot, { recursive: true })
    }

    // 递归复制
    fs.cpSync(oldDataDir, newDataDir, { recursive: true })
    if (fs.existsSync(oldImagesDir)) {
      fs.cpSync(oldImagesDir, newImagesDir, { recursive: true })
    }

    // 写标记
    fs.writeFileSync(
      migrationFlag,
      JSON.stringify(
        {
          migratedAt: new Date().toISOString(),
          from: oldRoot,
          to: newRoot,
          oldDataDir,
          oldImagesDir,
          note: '删除此文件可重新触发迁移检查',
        },
        null,
        2,
      ),
      'utf-8',
    )

    const elapsed = Date.now() - startMs
    console.log(`[paths] 复制完成，耗时 ${elapsed}ms`)
    console.log(`[paths] 迁移标记: ${migrationFlag}`)
    console.log('[paths] 旧数据保留在原位置作为备份，可在确认新位置正常后手动删除')
  } catch (e) {
    console.error('[paths] 复制失败（不写标记，下次启动重试）:', e)
    // 不抛错：让应用继续启动（新位置为空数据即可）
  }
}
