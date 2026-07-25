// ============================================================
// 玩转盘 - 导出工具
//
// 把 WheelScheme 包装成 WheelExportBundle 格式（含 format/version/exportedAt）
// 与 storyExport 风格一致，便于导入时校验
// ============================================================

import type { WheelScheme, WheelExportBundle } from '../types/wheel'

/**
 * 构造导出数据包
 *
 * @param scheme 要导出的方案
 * @returns 包装后的导出 bundle
 */
export function buildExportData(scheme: WheelScheme): WheelExportBundle {
  return {
    format: 'anke-creator-wheel-export',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    data: scheme,
  }
}

/**
 * 把方案序列化为 JSON 字符串（用于文件保存）
 *
 * @param scheme 要导出的方案
 * @returns 美化格式化的 JSON 字符串
 */
export function serializeWheelScheme(scheme: WheelScheme): string {
  return JSON.stringify(buildExportData(scheme), null, 2)
}

/**
 * 生成导出文件名（去掉非法字符）
 *
 * @param schemeName 方案名
 * @returns 形如 "角色生成器.wheel.json" 的文件名
 */
export function buildWheelFileName(schemeName: string): string {
  // 去掉 Windows 文件名非法字符：\ / : * ? " < > |
  const safe = (schemeName || '未命名方案').replace(/[\\/:*?"<>|]/g, '_').trim()
  return `${safe}.wheel.json`
}
