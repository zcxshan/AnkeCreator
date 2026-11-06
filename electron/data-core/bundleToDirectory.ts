// electron/data-core/bundleToDirectory.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  getLegacyBundlePath,
  getMigratedBackupPath,
  getStoriesRoot,
  getStoryDir,
  assertSafeStoryId,
} from './storyPaths'
import { readStoryManifest } from './manifest'
import {
  readStoryDirectoryAt,
  writeStoryDirectoryAt,
  type DirectoryPayload,
} from './storyStore'

type JsonRow = Record<string, unknown>

export interface LegacyBundle {
  story?: JsonRow & { id?: string }
  volumes?: JsonRow[]
  chapters?: JsonRow[]
  sections?: JsonRow[]
  world_settings?: JsonRow[]
  characters?: JsonRow[]
  character_relations?: JsonRow[]
  outlines?: JsonRow[]
  dice_history?: JsonRow[]
}

export interface MigrationResult {
  status: 'migrated' | 'skipped' | 'failed'
  error?: string
  counts?: { volumes: number; chapters: number; sections: number }
}

export interface MigrationOptions {
  createSnapshot?: () => void
  writeDirectory?: (storyRoot: string, payload: DirectoryPayload) => unknown
}

export interface BatchMigrationResult {
  migrated: number
  skipped: number
  failed: number
  errors: Array<{ storyId: string; error: string }>
}

interface LegacySectionContent {
  content?: string | null
  bbcode?: string | null
  word_count?: number
}

function readLegacySectionContent(dataDir: string, sectionId: string): LegacySectionContent {
  const file = path.join(dataDir, 'sections', `${sectionId}.json`)
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as LegacySectionContent
  } catch {
    return {}
  }
}

function bundleToPayload(bundle: LegacyBundle, dataDir: string): DirectoryPayload {
  const story = bundle.story ?? {}
  const volumes = bundle.volumes ?? []
  const chapters = bundle.chapters ?? []
  const sections = bundle.sections ?? []
  const sectionRows = sections.map((section) => {
    const id = String(section.id)
    const side = readLegacySectionContent(dataDir, id)
    return {
      ...section,
      id,
      content: (section.content as string | null | undefined) ?? side.content ?? null,
      bbcode: (section.bbcode as string | null | undefined) ?? side.bbcode ?? null,
      word_count: (section.word_count as number | undefined) ?? side.word_count ?? 0,
    }
  })
  const sectionMeta = sectionRows.map(({ content: _content, bbcode: _bbcode, ...meta }) => meta)
  return {
    story,
    volumes,
    chapters: { list: chapters, sections: sectionMeta },
    world: {
      character_relations: bundle.character_relations ?? [],
      outlines: bundle.outlines ?? [],
    },
    characters: bundle.characters ?? [],
    dice: { dice_history: bundle.dice_history ?? [] },
    sections: sectionRows,
  }
}

export function migrateStoryBundleToDirectory(
  dataDir: string,
  storyId: string,
  options: MigrationOptions = {},
): MigrationResult {
  assertSafeStoryId(storyId)
  const targetDir = getStoryDir(dataDir, storyId)
  if (readStoryManifest(targetDir)) return { status: 'skipped' }
  const legacyPath = getLegacyBundlePath(dataDir, storyId)
  if (!fs.existsSync(legacyPath)) {
    return { status: 'failed', error: '旧作品文件不存在' }
  }
  let bundle: LegacyBundle
  try {
    bundle = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as LegacyBundle
  } catch {
    return { status: 'failed', error: '旧作品 JSON 解析失败' }
  }
  if (!bundle.story || typeof bundle.story.id !== 'string') {
    return { status: 'failed', error: '旧作品缺少 story.id' }
  }
  const expected = {
    volumes: (bundle.volumes ?? []).length,
    chapters: (bundle.chapters ?? []).length,
    sections: (bundle.sections ?? []).length,
  }
  const tempDir = path.join(
    getStoriesRoot(dataDir),
    `.${storyId}.migrating-${process.pid}`,
  )
  options.createSnapshot?.()
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.mkdirSync(tempDir, { recursive: true })
    const payload = bundleToPayload(bundle, dataDir)
    const writeDirectory = options.writeDirectory ?? writeStoryDirectoryAt
    writeDirectory(tempDir, payload)
    const after = readStoryDirectoryAt(tempDir)
    if (
      !after ||
      after.volumes.length !== expected.volumes ||
      after.chapters.list.length !== expected.chapters ||
      after.chapters.sections.length !== expected.sections
    ) {
      throw new Error('迁移校验失败：迁移前后数量不一致')
    }
    fs.renameSync(tempDir, targetDir)
    const backupPath = getMigratedBackupPath(dataDir, storyId)
    fs.rmSync(backupPath, { force: true })
    fs.renameSync(legacyPath, backupPath)
    return { status: 'migrated', counts: expected }
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    return { status: 'failed', error: (error as Error).message }
  }
}

export function migrateAllLegacyBundles(
  dataDir: string,
  options: MigrationOptions = {},
): BatchMigrationResult {
  const result: BatchMigrationResult = { migrated: 0, skipped: 0, failed: 0, errors: [] }
  const storiesRoot = getStoriesRoot(dataDir)
  if (!fs.existsSync(storiesRoot)) return result
  const ids = fs
    .readdirSync(storiesRoot)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.bak'))
    .map((name) => name.slice(0, -5))
  for (const storyId of ids) {
    const one = migrateStoryBundleToDirectory(dataDir, storyId, options)
    if (one.status === 'migrated') result.migrated += 1
    else if (one.status === 'skipped') result.skipped += 1
    else {
      result.failed += 1
      result.errors.push({ storyId, error: one.error ?? '未知错误' })
    }
  }
  return result
}
