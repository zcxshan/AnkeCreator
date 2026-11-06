// electron/data-core/sectionRepair.ts
//
// 启动修复：导入后的作品目录里 section.content 可能为 null（正文只存在于全局侧车），
// 编辑器此时会显示空白。这里把侧车里真实存在的正文幂等回填到作品目录。
//
// 约束：
//   - 只处理 content 为 null / undefined 的节，绝不覆盖已有正文
//   - 写前由 writeJsonAtomic 自动生成 .bak
//   - 侧车缺失或为空时跳过
//   - 可重复执行，结果一致

import * as fs from 'node:fs'
import * as path from 'node:path'
import { readJsonWithBak, writeJsonAtomic } from './atomicJson'
import {
  readStoryManifest,
  writeStoryManifest,
  type StoryManifest,
} from './manifest'

export interface SectionRepairOptions {
  /** 数据根目录（包含 stories/ 与 sections/） */
  dataDir: string
  /** 作品目录，默认 <dataDir>/stories */
  storiesDir?: string
}

export interface SectionRepairResult {
  /** 扫描到的作品数 */
  stories: number
  /** 扫描到的节数 */
  scanned: number
  /** 实际回填的节数 */
  repaired: number
}

interface SidecarSection {
  id?: string
  content?: string | null
  bbcode?: string | null
  word_count?: number
}

function readSidecarSection(dataDir: string, sectionId: string): SidecarSection | null {
  const file = path.join(dataDir, 'sections', `${sectionId}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SidecarSection
  } catch {
    return null
  }
}

/** 修复单个作品目录；返回回填节数 */
function repairStoryDir(storyRoot: string, manifest: StoryManifest, dataDir: string): number {
  let repaired = 0
  let manifestChanged = false

  for (const [sectionId, entry] of Object.entries(manifest.sections)) {
    const file = path.join(storyRoot, entry.path)
    const current = readJsonWithBak<Record<string, unknown>>(file).value
    if (!current) continue
    // 已有正文 → 跳过（空字符串也视为有效内容，保持用户清空正文的意图）
    if (current.content !== null && current.content !== undefined) continue

    const sidecar = readSidecarSection(dataDir, sectionId)
    if (!sidecar || sidecar.content === null || sidecar.content === undefined) continue

    const merged: Record<string, unknown> = {
      ...current,
      content: sidecar.content,
      bbcode: current.bbcode ?? sidecar.bbcode ?? null,
      word_count: current.word_count || sidecar.word_count || 0,
    }
    const generation = entry.generation + 1
    writeJsonAtomic(file, merged, generation)
    manifest.sections[sectionId] = { ...entry, generation }
    manifestChanged = true
    repaired++
  }

  if (manifestChanged) {
    manifest.generation = manifest.generation + 1
    manifest.updatedAt = new Date().toISOString()
    writeStoryManifest(storyRoot, manifest)
  }
  return repaired
}

/** 扫描全部作品并回填空正文；幂等 */
export function repairEmptySectionContent(options: SectionRepairOptions): SectionRepairResult {
  const result: SectionRepairResult = { stories: 0, scanned: 0, repaired: 0 }
  const storiesDir = options.storiesDir ?? path.join(options.dataDir, 'stories')
  if (!fs.existsSync(storiesDir)) return result

  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(storiesDir, { withFileTypes: true })
  } catch {
    return result
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('__')) continue
    const storyRoot = path.join(storiesDir, entry.name)
    const manifest = readStoryManifest(storyRoot)
    if (!manifest) continue
    result.stories++
    result.scanned += Object.keys(manifest.sections).length
    try {
      result.repaired += repairStoryDir(storyRoot, manifest, options.dataDir)
    } catch (e) {
      console.warn(`[sectionRepair] 修复失败：${entry.name}`, e)
    }
  }
  return result
}
