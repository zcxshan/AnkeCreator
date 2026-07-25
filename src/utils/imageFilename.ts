// ============================================================
// 图片文件名工具（renderer side）
//
// 与 electron/imageUploader.ts 内的剥离逻辑保持一致：
// 重命名时扩展名由磁盘文件决定，用户输入中的 ".xxx" 自动剥掉。
// ============================================================

/**
 * 剥离文件名末尾的扩展名（最后一段 ".xxx"）。
 *
 * 规则：
 * - 找到最后一个 '.'（lastIndexOf）
 * - 位置 > 0（避免 ".bashrc" 这种以点开头的隐藏文件被误判）
 * - 末尾点（dotIdx === length-1）会被剥掉，返回可能为空串（调用方需检查空）
 *
 * @example
 * stripImageFilenameExtension('newname.png')   // → 'newname'
 * stripImageFilenameExtension('newname')      // → 'newname'
 * stripImageFilenameExtension('a.tar.gz')      // → 'a.tar' （只剥最后一段）
 * stripImageFilenameExtension('.bashrc')       // → '.bashrc' （隐藏文件不动）
 * stripImageFilenameExtension('a.')            // → 'a' （末尾点被剥）
 * stripImageFilenameExtension('a..b.png')      // → 'a..b'
 */
export function stripImageFilenameExtension(name: string): string {
  if (!name) return name
  const dotIdx = name.lastIndexOf('.')
  // dotIdx > 0 避免 ".bashrc" 被误判（点开头是隐藏文件，无扩展名）
  if (dotIdx > 0) {
    return name.slice(0, dotIdx)
  }
  return name
}
