// © 点点星辰 | 生成 Android release keystore + keystore.properties
//
// 用途：
//   团队成员首次 clone 后，本地生成自己的 release 签名密钥
//   文件位置：android/app/anke-release.jks（不入仓，.gitignore 已忽略）
//             android/keystore.properties（不入仓，.gitignore 已忽略）
//
// 用法：
//   npm run keystore:gen
//
// 前置：JDK keytool（在 PATH 中，或 JAVA_HOME 已设）

const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const readline = require('readline')

const ROOT = path.join(__dirname, '..')
const KEYSTORE_DIR = path.join(ROOT, 'android', 'app')
const KEYSTORE_FILE = path.join(KEYSTORE_DIR, 'anke-release.jks')
const PROPS_FILE = path.join(ROOT, 'android', 'keystore.properties')

/** 检查 keytool 是否可用 */
function checkKeytool() {
  try {
    const r = spawnSync('keytool', ['-help'], { stdio: 'pipe' })
    return r.status === 0 || (r.stdout && r.stdout.toString().includes('keytool'))
  } catch {
    return false
  }
}

/** 简单的 readline prompt */
function ask(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const q = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `
    rl.question(q, (answer) => {
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

/** 主函数 */
async function main() {
  console.log('===== Android release keystore 生成器 =====\n')

  // 检查 keytool
  if (!checkKeytool()) {
    console.error('✗ 找不到 keytool 命令。请安装 JDK 并确保 java/bin 在 PATH 中。')
    console.error('  下载：https://adoptium.net/')
    process.exit(1)
  }

  // 检查 keystore 是否已存在
  if (fs.existsSync(KEYSTORE_FILE)) {
    console.log(`⚠ keystore 已存在: ${KEYSTORE_FILE}`)
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const overwrite = await ask(rl, '是否覆盖？(yes/no)', 'no')
    rl.close()
    if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
      console.log('已取消。')
      return
    }
    fs.unlinkSync(KEYSTORE_FILE)
    console.log('已删除旧 keystore。')
  }

  // 收集参数
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log('请输入 keystore 信息（直接回车使用默认值）：\n')

  const storePassword = await ask(rl, '密钥库密码 (storePassword)', 'anke-dev-2026')
  const keyPassword = await ask(rl, '密钥密码 (keyPassword)', storePassword)
  const alias = await ask(rl, '别名 (keyAlias)', 'anke')
  const validity = await ask(rl, '有效期（年）', '25')
  const dname = await ask(rl, 'DN (姓名/组织/城市)', 'CN=AnkeCreator, O=Shanshian, C=CN')
  rl.close()

  // 生成 keystore
  const validityDays = parseInt(validity, 10) * 365
  console.log('\n正在生成 keystore...')
  try {
    execSync(
      `keytool -genkey -v ` +
        `-keystore "${KEYSTORE_FILE}" ` +
        `-storepass "${storePassword}" ` +
        `-keypass "${keyPassword}" ` +
        `-alias "${alias}" ` +
        `-keyalg RSA -keysize 2048 ` +
        `-validity ${validityDays} ` +
        `-dname "${dname}"`,
      { stdio: 'inherit' },
    )
  } catch (e) {
    console.error('✗ keystore 生成失败:', e.message)
    process.exit(1)
  }

  if (!fs.existsSync(KEYSTORE_FILE)) {
    console.error('✗ keystore 生成失败：未找到输出文件')
    process.exit(1)
  }
  console.log(`✓ keystore 已生成: ${KEYSTORE_FILE}`)

  // 写入 keystore.properties
  const propsContent =
    `storeFile=anke-release.jks\n` +
    `storePassword=${storePassword}\n` +
    `keyAlias=${alias}\n` +
    `keyPassword=${keyPassword}\n`
  fs.writeFileSync(PROPS_FILE, propsContent, 'utf-8')
  console.log(`✓ keystore.properties 已写入: ${PROPS_FILE}`)

  // 提示
  console.log('\n===== 完成 =====')
  console.log('下一步：')
  console.log('  1. 备份 keystore 文件！丢了就装不上，也无法升级')
  console.log('     推荐位置：云盘 / 密码管理器 / 加密 USB')
  console.log('  2. 验证签名：cd android && ./gradlew assembleRelease')
  console.log('  3. 验证 APK：apksigner verify --verbose app/build/outputs/apk/release/app-release.apk')
  console.log('\n⚠ 重要：keystore 文件和密码不入版本控制（已配置 .gitignore）')
}

main().catch((e) => {
  console.error('✗ 失败:', e)
  process.exit(1)
})
