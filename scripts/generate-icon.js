// © 点点星辰 | 生成 build/icon.ico 用于 NSIS installer 图标
// 从 build/icon.png 生成多尺寸 .ico（16/24/32/48/64/128/256 px）
// 同步覆盖 release/.icon-ico/icon.ico（避免 electron-builder 用旧缓存）
// 用法：node scripts/generate-icon.js

const fs = require('fs')
const path = require('path')
const toIco = require('to-ico')

const ROOT = path.join(__dirname, '..')
const SRC_PNG = path.join(ROOT, 'build', 'icon.png')
const OUT_ICO = path.join(ROOT, 'build', 'icon.ico')
const CACHE_ICO = path.join(ROOT, 'release', '.icon-ico', 'icon.ico')

async function main() {
  console.log('[generate-icon] 读取源 PNG:', SRC_PNG)
  if (!fs.existsSync(SRC_PNG)) {
    console.error(`[generate-icon] ✗ 源文件不存在: ${SRC_PNG}`)
    process.exit(1)
  }

  const pngBuffer = fs.readFileSync(SRC_PNG)
  console.log(`[generate-icon] ✓ 源 PNG 读取成功 (${pngBuffer.length} bytes)`)

  // 生成多尺寸 .ico
  console.log('[generate-icon] 转换 PNG → ICO（多尺寸 16/24/32/48/64/128/256）...')
  const icoBuffer = await toIco([pngBuffer], {
    resize: true,
    sizes: [16, 24, 32, 48, 64, 128, 256],
  })
  console.log(`[generate-icon] ✓ ICO 生成成功 (${icoBuffer.length} bytes)`)

  // 写入 build/icon.ico
  fs.mkdirSync(path.dirname(OUT_ICO), { recursive: true })
  fs.writeFileSync(OUT_ICO, icoBuffer)
  console.log(`[generate-icon] ✓ 写入: ${OUT_ICO}`)

  // 同步覆盖 electron-builder 缓存的 .ico（如果存在）
  if (fs.existsSync(path.dirname(CACHE_ICO))) {
    try {
      fs.writeFileSync(CACHE_ICO, icoBuffer)
      console.log(`[generate-icon] ✓ 同步覆盖缓存: ${CACHE_ICO}`)
    } catch (e) {
      console.warn(`[generate-icon] ⚠ 覆盖缓存失败（可忽略）: ${e.message}`)
    }
  }

  console.log('[generate-icon] 完成 ✓')
}

main().catch((err) => {
  console.error('[generate-icon] ✗ 失败:', err)
  process.exit(1)
})
