// © 点点星辰 | 清理 Windows 资源管理器图标缓存
// 解决"替换 build/icon.png 后，Setup.exe / win-unpacked/.exe 仍显示旧图标"的问题
// 策略：
//   1. 删 IconCache.db + iconcache_*.db + thumbcache_*.db
//   2. 用 ie4uinit.exe -show 触发图标缓存重建（首选，无需重启 explorer）
//   3. 兜底：taskkill explorer.exe + start explorer.exe
// 用法：node scripts/clear-icon-cache.js
// 仅在 Windows 平台执行，其他平台直接跳过

const { execSync } = require('child_process')
const os = require('os')
const path = require('path')

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function color(c, s) {
  return `${COLORS[c]}${s}${COLORS.reset}`
}

function runCmd(cmd, opts = {}) {
  try {
    return { ok: true, output: execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', ...opts }) }
  } catch (e) {
    return { ok: false, output: (e.stdout || '') + (e.stderr || e.message || '') }
  }
}

function main() {
  console.log(color('cyan', '[icon-cache] 平台:'), process.platform)

  if (process.platform !== 'win32') {
    console.log(color('yellow', '[icon-cache] 非 Windows 平台，跳过（缓存机制仅 Windows 有效）'))
    return
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const explorerDir = path.join(localAppData, 'Microsoft', 'Windows', 'Explorer')
  const iconCacheDb = path.join(localAppData, 'IconCache.db')

  // ========== Step 1: 删 IconCache.db ==========
  console.log(color('cyan', '[icon-cache] Step 1/4: 删 IconCache.db'))
  const r1 = runCmd(`cmd /c del /f /q "${iconCacheDb}" 2>nul`)
  if (r1.ok) {
    console.log(color('green', '  ✓ IconCache.db 已删除（不存在则也视为成功）'))
  } else {
    console.log(color('yellow', '  ⚠ IconCache.db 删除失败（可能文件不存在，不影响）'))
  }

  // ========== Step 2: 删 iconcache_*.db ==========
  console.log(color('cyan', '[icon-cache] Step 2/4: 删 iconcache_*.db'))
  const r2 = runCmd(`cmd /c del /f /q "${path.join(explorerDir, 'iconcache_*.db')}" 2>nul`)
  if (r2.ok) {
    console.log(color('green', '  ✓ iconcache_*.db 已清理'))
  } else {
    console.log(color('yellow', '  ⚠ iconcache_*.db 清理失败（可能不存在）'))
  }

  // ========== Step 3: 删 thumbcache_*.db ==========
  console.log(color('cyan', '[icon-cache] Step 3/4: 删 thumbcache_*.db'))
  const r3 = runCmd(`cmd /c del /f /q "${path.join(explorerDir, 'thumbcache_*.db')}" 2>nul`)
  if (r3.ok) {
    console.log(color('green', '  ✓ thumbcache_*.db 已清理'))
  } else {
    console.log(color('yellow', '  ⚠ thumbcache_*.db 清理失败（可能不存在）'))
  }

  // ========== Step 4: 触发图标缓存重建 ==========
  console.log(color('cyan', '[icon-cache] Step 4/4: 触发图标缓存重建（ie4uinit.exe）'))
  const r4 = runCmd('cmd /c ie4uinit.exe -show')
  if (r4.ok) {
    console.log(color('green', '  ✓ ie4uinit.exe -show 成功，图标缓存已重建'))
  } else {
    // 兜底：重启 explorer.exe
    console.log(color('yellow', '  ⚠ ie4uinit.exe 不可用，兜底重启 explorer.exe...'))
    const r4a = runCmd('cmd /c taskkill /f /im explorer.exe')
    if (r4a.ok) {
      console.log(color('green', '  ✓ explorer.exe 已终止'))
    } else {
      console.log(color('yellow', '  ⚠ explorer.exe 终止失败（可能已在重启）'))
    }
    // 延迟 1s 后启动 explorer
    setTimeout(() => {
      const r4b = runCmd('cmd /c start explorer.exe')
      if (r4b.ok) {
        console.log(color('green', '  ✓ explorer.exe 已重启'))
      } else {
        console.log(color('red', '  ✗ explorer.exe 重启失败，请手动重启'))
      }
    }, 1000)
  }

  console.log(color('cyan', '[icon-cache] 完成 ✓'))
  console.log(color('gray', '  提示：现在打开 release/ 目录应能看到新图标。'))
  console.log(color('gray', '  若仍显示旧图标，请按 F5 刷新资源管理器或重启电脑。'))
}

main()
