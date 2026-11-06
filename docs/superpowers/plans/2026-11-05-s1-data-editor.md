# S1 数据与编辑实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有作品数据的前提下，把当前「每个作品一个 `stories/<id>.json`」的存储升级为 `stories/<id>/` 目录（manifest 提交、实体按需读取、正文独立文件），并完成三后端统一仓储、导入归一化、单文件导出、图片链路、折叠/引用块往返与编辑稳定性改造，使 S1 的数据与编辑链路可迁移、可回滚、可测试。

**Architecture:** 主进程新增 `electron/data-core/` 纯 Node 模块，负责路径布局、带 generation 的 JSON 包装、tmp→rename、`.bak`、manifest 提交、写队列与旧 bundle 迁移；`electron/db-main.ts` 只做「目录/旧文件」路由和既有写锁接线。渲染进程新增 `src/db/repository.ts`，用同一 `StoryRepository` 签名封装 Electron、IndexedDB、内存三种后端。导入、导出、图片解析与编辑同步判断分别放在 `src/utils/` 和 `src/editor/tiptap/` 的纯函数模块中，UI 只负责调用与展示进度。

**Tech Stack:** Electron 33、React 18.3、Tiptap 3.31（含 `@tiptap/pm`）、Zustand 4.5、Vite 6、Vitest 4 + happy-dom、fake-indexeddb、TypeScript 5.6。

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `electron/data-core/storyPaths.ts` | 新建 | `stories/<id>/`、`manifest.json`、`sections/<sid>.json`、旧 bundle 与 `.migrated.bak` 的路径拼装与 id 安全校验 |
| `electron/data-core/atomicJson.ts` | 新建 | `{ schemaVersion, generation, updatedAt, data }` 包装、tmp→fsync→rename、`.bak`、损坏回退与主文件恢复 |
| `electron/data-core/manifest.ts` | 新建 | manifest 结构、读写、每个文件独立 generation、按 manifest 读取实体 |
| `electron/data-core/storyStore.ts` | 新建 | 按作品串行写队列、只写变化文件、manifest 最后提交、删除遗留 section 文件、目录读取 |
| `electron/data-core/bundleToDirectory.ts` | 新建 | 旧 `StoryBundle` → 目录迁移：迁移前快照、数量校验、幂等、失败清理、旧文件改名 `.migrated.bak` |
| `electron/data-core/storageLayout.ts` | 新建 | `bundle` / `perStory` 开关、老用户与全新安装判定、回滚写入 |
| `electron/data-core/ngaReferer.ts` | 新建 | NGA 多域名常量与 Referer 头构造 |
| `electron/__tests__/per-story-paths.test.ts` | 新建 | 路径与路径穿越校验 |
| `electron/__tests__/atomic-json.test.ts` | 新建 | 原子写、`.bak`、损坏回退 |
| `electron/__tests__/story-manifest.test.ts` | 新建 | manifest 读写与 generation 回退 |
| `electron/__tests__/story-store.test.ts` | 新建 | 串行队列、只写变化文件、manifest 最后提交、失败回退 |
| `electron/__tests__/bundle-to-directory.test.ts` | 新建 | 迁移数量校验、幂等、失败清理、`.migrated.bak` |
| `electron/__tests__/storage-layout.test.ts` | 新建 | 布局判定与开关读写 |
| `electron/__tests__/global-json-recovery.test.ts` | 新建 | 全局文件损坏后从 `.bak` 恢复（Task 15 直接修改 `electron/db-main.ts`，不新建模块） |
| `electron/__tests__/nga-referer.test.ts` | 新建 | 多域名 Referer 头 |
| `electron/__tests__/per-story-db.test.ts` | 新建 | `db-main` 在 `perStory` 下读目录、写目录、正文懒加载 |
| `electron/db-main.ts` | 修改 | `readStoryFile` / `writeStoryFile` / `getSectionContent` / `setSectionContent` 接目录；启动迁移与布局初始化 |
| `electron/main.ts` | 修改 | 数据库初始化前调用 `initializeStorageLayout` |
| `electron/protocol.ts` | 修改 | 使用 `NGA_IMAGE_URL_PATTERNS` 与 `buildNgaRefererHeaders` |
| `src/db/repository.ts` | 新建 | `StoryRepository` 接口 + Electron / IndexedDB / 内存适配器 + 导入导出门面 |
| `src/db/repository.test.ts` | 新建 | 三后端同签名一致性测试 |
| `src/db/index.ts` | 修改 | 导出 `getStoryRepository` 与 `StoryRepository` 类型 |
| `src/utils/storyImport.ts` | 修改 | 在现有 `validateImportFormat` / `ensureDefaultVolumeAndChapter` 之上新增 `normalizeImportPayload`、`parseImportText` 与归一化类型 |
| `src/utils/storyImport.test.ts` | 修改 | 保留现有 `validateImportFormat` 断言，新增收集安科 / 旧版 `anke-creator-story` / 当前 `WorksListPage` 导出三种 fixture、默认卷章、未知字段、中文错误 |
| `src/utils/storyImportFlow.ts` | 新建 | JSON 文本 → 归一化 → 建作品 → 卷章节写入的可测流程 |
| `src/utils/storyImportFlow.test.ts` | 新建 | 导入流程落库结果与默认卷章 |
| `src/utils/storyExportBundle.ts` | 新建 | 单文件导出构造、每 50 节回报进度、缺正文中文错误 |
| `src/utils/storyExportBundle.test.ts` | 新建 | 单文件结构、分块进度、缺正文错误 |
| `src/components/pages/WorksListPage.tsx` | 修改 | 导入改用 `parseImportText` / `importStoryFromRawText`；导出改用 `exportStoryBundle` |
| `src/utils/imageSrc.ts` | 新建 | `resolveImageSrc`：data / http / local:// / file:// / 绝对路径 / 相对路径 |
| `src/utils/imageSrc.test.ts` | 新建 | 各来源解析与 IPC 失败原因 |
| `src/utils/imageDebug.ts` | 新建 | 最近 50 条图片诊断事件与 `window.__ankeImageDebug` |
| `src/utils/imageDebug.test.ts` | 新建 | 诊断事件环形缓存 |
| `src/editor/tiptap/imageBlockDom.ts` | 修改 | 占位显示文件名、失败原因、「重新选择图片」按钮 |
| `src/editor/tiptap/imageBlockDom.test.ts` | 新建 | 失败占位与 `local://` 兜底 |
| `src/editor/tiptap/nodeViews.tsx` | 修改 | 图片块统一走 `resolveImageSrc` |
| `src/editor/tiptap/serialize.ts` | 修改 | `sanitizeBusinessBlocks`、`sanitizeAnkeHtml` 业务块白名单 |
| `src/editor/tiptap/serialize.test.ts` | 修改 | 折叠块/引用块清洗断言 |
| `src/editor/tiptap/businessBlocks.test.ts` | 新建 | schema 解析 → 序列化往返 |
| `src/editor/tiptap/contentSync.ts` | 新建 | 输入法期间跳过外部同步、撤销边界判定 |
| `src/editor/__tests__/contentSync.test.ts` | 新建 | IME 与撤销边界纯函数测试 |
| `src/editor/tiptap/TiptapEditorPane.tsx` | 修改 | composition 标记、业务块清洗、外部同步守卫 |
| `src/store/__tests__/loadSection.test.ts` | 修改 | 切节先 flush 旧节再读新节 |

---

## Task 1：作品目录布局与路径工具

**Files:**
- Create: `electron/data-core/storyPaths.ts`
- Test: `electron/__tests__/per-story-paths.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// electron/__tests__/per-story-paths.test.ts
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertSafeStoryId,
  getLegacyBundlePath,
  getMigratedBackupPath,
  getStoryDir,
  getStoryEntityPath,
  getStorySectionPath,
} from '../data-core/storyPaths'

const dataDir = path.join('E:', 'tmp', 'anke-data')

describe('per-story paths', () => {
  it('把作品实体放进 stories/<id>/', () => {
    expect(getStoryDir(dataDir, 'story-1')).toBe(path.join(dataDir, 'stories', 'story-1'))
    expect(getStoryEntityPath(dataDir, 'story-1', 'manifest.json')).toBe(
      path.join(dataDir, 'stories', 'story-1', 'manifest.json'),
    )
    expect(getStorySectionPath(dataDir, 'story-1', 'sec-1')).toBe(
      path.join(dataDir, 'stories', 'story-1', 'sections', 'sec-1.json'),
    )
  })

  it('保留旧单文件与迁移备份路径', () => {
    expect(getLegacyBundlePath(dataDir, 'story-1')).toBe(
      path.join(dataDir, 'stories', 'story-1.json'),
    )
    expect(getMigratedBackupPath(dataDir, 'story-1')).toBe(
      path.join(dataDir, 'stories', 'story-1.json.migrated.bak'),
    )
  })

  it('拒绝路径穿越和空 id', () => {
    expect(() => assertSafeStoryId('../evil')).toThrow('非法的作品 id')
    expect(() => assertSafeStoryId('a/b')).toThrow('非法的作品 id')
    expect(() => assertSafeStoryId('')).toThrow('非法的作品 id')
    expect(assertSafeStoryId('a1_b-2')).toBe('a1_b-2')
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/per-story-paths.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../data-core/storyPaths"` 或 `Cannot find module`。

- [ ] **Step 3：实现路径模块**

```ts
// electron/data-core/storyPaths.ts
import * as path from 'node:path'

export const STORY_MANIFEST_FILE = 'manifest.json'
export const STORY_SECTIONS_DIR = 'sections'

export function assertSafeStoryId(storyId: string): string {
  if (!storyId || !/^[A-Za-z0-9_-]+$/.test(storyId)) {
    throw new Error(`非法的作品 id：${storyId}`)
  }
  return storyId
}

export function getStoriesRoot(dataDir: string): string {
  return path.join(dataDir, 'stories')
}

export function getStoryDir(dataDir: string, storyId: string): string {
  return path.join(getStoriesRoot(dataDir), assertSafeStoryId(storyId))
}

export function getStoryEntityPath(dataDir: string, storyId: string, fileName: string): string {
  return path.join(getStoryDir(dataDir, storyId), fileName)
}

export function getStorySectionsDir(dataDir: string, storyId: string): string {
  return path.join(getStoryDir(dataDir, storyId), STORY_SECTIONS_DIR)
}

export function getStorySectionPath(dataDir: string, storyId: string, sectionId: string): string {
  return path.join(
    getStorySectionsDir(dataDir, storyId),
    `${assertSafeStoryId(sectionId)}.json`,
  )
}

export function getLegacyBundlePath(dataDir: string, storyId: string): string {
  return path.join(getStoriesRoot(dataDir), `${assertSafeStoryId(storyId)}.json`)
}

export function getLegacyBundleBakPath(dataDir: string, storyId: string): string {
  return `${getLegacyBundlePath(dataDir, storyId)}.bak`
}

export function getMigratedBackupPath(dataDir: string, storyId: string): string {
  return `${getLegacyBundlePath(dataDir, storyId)}.migrated.bak`
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/per-story-paths.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  3 passed (3)`。

---

## Task 2：带 generation 的原子 JSON 与 `.bak` 回退

**Files:**
- Create: `electron/data-core/atomicJson.ts`
- Test: `electron/__tests__/atomic-json.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// electron/__tests__/atomic-json.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJsonWithBak, writeJsonAtomic, writeRawJsonAtomic } from '../data-core/atomicJson'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-atomic-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('atomicJson', () => {
  it('写入带 schemaVersion / generation / updatedAt / data 的包装', () => {
    const file = path.join(dir, 'story.json')
    writeJsonAtomic(file, { title: '作品' }, 3)
    const env = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(env.schemaVersion).toBe(2)
    expect(env.generation).toBe(3)
    expect(env.data).toEqual({ title: '作品' })
    expect(typeof env.updatedAt).toBe('string')
  })

  it('主文件损坏时从 .bak 读取并恢复主文件', () => {
    const file = path.join(dir, 'story.json')
    writeJsonAtomic(file, { title: '旧' }, 3)
    writeJsonAtomic(file, { title: '新' }, 3)
    fs.writeFileSync(file, '{broken json', 'utf-8')
    const result = readJsonWithBak<{ title: string }>(file, 3)
    expect(result.source).toBe('bak')
    expect(result.value).toEqual({ title: '旧' })
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).data).toEqual({ title: '旧' })
  })

  it('generation 不匹配时回退到 .bak', () => {
    const file = path.join(dir, 'volumes.json')
    writeJsonAtomic(file, ['old'], 1)
    writeJsonAtomic(file, ['new'], 2)
    expect(readJsonWithBak<string[]>(file, 1)).toEqual({ value: ['old'], source: 'bak' })
  })

  it('写 manifest 这类裸 JSON 不额外包装', () => {
    const file = path.join(dir, 'manifest.json')
    writeRawJsonAtomic(file, { schemaVersion: 2, generation: 1 })
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
      schemaVersion: 2,
      generation: 1,
    })
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/atomic-json.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../data-core/atomicJson"`。

- [ ] **Step 3：实现原子读写**

```ts
// electron/data-core/atomicJson.ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface JsonEnvelope<T> {
  schemaVersion: 2
  generation: number
  updatedAt: string
  data: T
}

export interface ReadWithBakResult<T> {
  value: T | null
  source: 'main' | 'bak' | 'missing'
}

function replaceAtomically(filePath: string, payload: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, payload, 'utf-8')
  const fd = fs.openSync(tmp, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, filePath)
}

export function writeJsonAtomic<T>(
  filePath: string,
  data: T,
  generation: number,
  now: Date = new Date(),
): void {
  const bak = `${filePath}.bak`
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, bak)
  }
  const envelope: JsonEnvelope<T> = {
    schemaVersion: 2,
    generation,
    updatedAt: now.toISOString(),
    data,
  }
  replaceAtomically(filePath, JSON.stringify(envelope))
}

export function writeRawJsonAtomic(filePath: string, data: unknown): void {
  replaceAtomically(filePath, JSON.stringify(data))
}

export function readJsonWithBak<T>(
  filePath: string,
  expectedGeneration?: number,
): ReadWithBakResult<T> {
  const bak = `${filePath}.bak`
  for (const [candidate, source] of [
    [filePath, 'main'],
    [bak, 'bak'],
  ] as const) {
    if (!fs.existsSync(candidate)) continue
    try {
      const env = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as JsonEnvelope<T>
      if (env?.schemaVersion !== 2 || typeof env.generation !== 'number') continue
      if (expectedGeneration !== undefined && env.generation !== expectedGeneration) continue
      if (source === 'bak') {
        try {
          fs.copyFileSync(bak, filePath)
        } catch {
          // 恢复主文件失败不影响本次读取，下一次写入会重新生成 .bak
        }
      }
      return { value: env.data, source }
    } catch {
      // 当前候选损坏，继续尝试 .bak
    }
  }
  return { value: null, source: 'missing' }
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/atomic-json.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  4 passed (4)`。

---

## Task 3：manifest 与按需实体读取

**Files:**
- Create: `electron/data-core/manifest.ts`
- Test: `electron/__tests__/story-manifest.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// electron/__tests__/story-manifest.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readEntityFromManifest,
  readStoryManifest,
  writeStoryManifest,
  type StoryManifest,
} from '../data-core/manifest'
import { writeJsonAtomic } from '../data-core/atomicJson'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-manifest-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function manifest(overrides: Partial<StoryManifest> = {}): StoryManifest {
  return {
    schemaVersion: 2,
    generation: 1,
    updatedAt: '2026-11-05T00:00:00.000Z',
    files: {
      story: { path: 'story.json', generation: 1 },
      volumes: { path: 'volumes.json', generation: 1 },
      chapters: { path: 'chapters.json', generation: 1 },
      world: { path: 'world.json', generation: 1 },
      characters: { path: 'characters.json', generation: 1 },
      dice: { path: 'dice.json', generation: 1 },
    },
    sections: {},
    ...overrides,
  }
}

describe('story manifest', () => {
  it('写入后可读回 same manifest', () => {
    writeStoryManifest(root, manifest())
    expect(readStoryManifest(root)).toEqual(manifest())
  })

  it('schemaVersion 不是 2 时视为没有 manifest', () => {
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, generation: 1, files: {} }),
    )
    expect(readStoryManifest(root)).toBeNull()
  })

  it('实体主文件 generation 不匹配时读 .bak', () => {
    const m = manifest()
    writeStoryManifest(root, m)
    writeJsonAtomic(path.join(root, 'volumes.json'), ['第一卷'], 1)
    writeJsonAtomic(path.join(root, 'volumes.json'), ['新卷'], 2)
    expect(readEntityFromManifest<string[]>(root, m, 'volumes')).toEqual(['第一卷'])
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/story-manifest.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../data-core/manifest"`。

- [ ] **Step 3：实现 manifest 模块**

```ts
// electron/data-core/manifest.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readJsonWithBak, writeRawJsonAtomic } from './atomicJson'
import { STORY_MANIFEST_FILE } from './storyPaths'

export type StoryEntityName =
  | 'story'
  | 'volumes'
  | 'chapters'
  | 'world'
  | 'characters'
  | 'dice'

export interface ManifestEntry {
  path: string
  generation: number
  count?: number
}

export interface StoryManifest {
  schemaVersion: 2
  generation: number
  updatedAt: string
  files: Record<StoryEntityName, ManifestEntry>
  sections: Record<string, ManifestEntry>
}

function manifestPath(storyRoot: string): string {
  return path.join(storyRoot, STORY_MANIFEST_FILE)
}

export function readStoryManifest(storyRoot: string): StoryManifest | null {
  const file = manifestPath(storyRoot)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as StoryManifest
    if (raw?.schemaVersion !== 2 || typeof raw.generation !== 'number') return null
    if (!raw.files || typeof raw.sections !== 'object') return null
    return raw
  } catch {
    return null
  }
}

export function writeStoryManifest(storyRoot: string, manifest: StoryManifest): void {
  writeRawJsonAtomic(manifestPath(storyRoot), manifest)
}

export function readEntityFromManifest<T>(
  storyRoot: string,
  manifest: StoryManifest,
  name: StoryEntityName,
): T | null {
  const entry = manifest.files[name]
  if (!entry) return null
  return readJsonWithBak<T>(path.join(storyRoot, entry.path), entry.generation).value
}

export function readSectionFromManifest<T>(
  storyRoot: string,
  manifest: StoryManifest,
  sectionId: string,
): T | null {
  const entry = manifest.sections[sectionId]
  if (!entry) return null
  return readJsonWithBak<T>(path.join(storyRoot, entry.path), entry.generation).value
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/story-manifest.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  3 passed (3)`。

---

## Task 4：串行写队列、只写变化文件、manifest 最后提交

**Files:**
- Create: `electron/data-core/storyStore.ts`
- Test: `electron/__tests__/story-store.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// electron/__tests__/story-store.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  enqueueStoryWrite,
  readStoryDirectoryAt,
  writeStoryDirectoryAt,
  type DirectoryPayload,
} from '../data-core/storyStore'
import { readStoryManifest } from '../data-core/manifest'
import { writeJsonAtomic } from '../data-core/atomicJson'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-store-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function payload(chapterTitle = '第一章'): DirectoryPayload {
  return {
    story: { id: 's1', title: '作品', updated_at: '2026-11-05T00:00:00.000Z' },
    volumes: [{ id: 'v1', title: '第一卷', story_id: 's1' }],
    chapters: {
      list: [{ id: 'c1', title: chapterTitle, story_id: 's1', volume_id: 'v1' }],
      sections: [{ id: 'sec1', chapter_id: 'c1', title: '第1节', word_count: 3 }],
    },
    world: { world_settings: [], character_relations: [], outlines: [] },
    characters: [],
    dice: { dice_history: [] },
    sections: [{ id: 'sec1', content: '<p>正文</p>', bbcode: null, word_count: 3 }],
  }
}

describe('story directory store', () => {
  it('首次写入生成全部文件和 manifest', () => {
    const written = writeStoryDirectoryAt(root, payload())
    expect(written).toContain('story.json')
    expect(written).toContain('sections/sec1.json')
    expect(written[written.length - 1]).toBe('manifest.json')
    expect(readStoryManifest(root)?.files.story.path).toBe('story.json')
  })

  it('内容不变时只重写 manifest', () => {
    writeStoryDirectoryAt(root, payload())
    const written = writeStoryDirectoryAt(root, payload())
    expect(written).toEqual(['manifest.json'])
  })

  it('只写变化的章文件并递增该文件 generation', () => {
    writeStoryDirectoryAt(root, payload())
    const m1 = readStoryManifest(root)!
    writeStoryDirectoryAt(root, payload('改名后的第一章'))
    const m2 = readStoryManifest(root)!
    expect(m2.generation).toBe(m1.generation + 1)
    expect(m2.files.chapters.generation).toBe(m1.files.chapters.generation + 1)
    expect(m2.files.volumes.generation).toBe(m1.files.volumes.generation)
  })

  it('中途写失败时 manifest 不提交，读取仍返回旧数据', () => {
    writeStoryDirectoryAt(root, payload())
    const before = readStoryManifest(root)!
    expect(() =>
      writeStoryDirectoryAt(root, payload('会失败的新章'), {
        writeAtomic: (file, data, generation) => {
          if (file.endsWith('chapters.json')) throw new Error('模拟磁盘写入失败')
          writeJsonAtomic(file, data, generation)
        },
      }),
    ).toThrow('模拟磁盘写入失败')
    expect(readStoryManifest(root)!.generation).toBe(before.generation)
    expect(readStoryDirectoryAt(root)!.chapters.list[0].title).toBe('第一章')
  })

  it('删除已不存在的节文件', () => {
    writeStoryDirectoryAt(root, payload())
    expect(fs.existsSync(path.join(root, 'sections', 'sec1.json'))).toBe(true)
    const next = payload()
    next.chapters.sections = []
    next.sections = []
    writeStoryDirectoryAt(root, next)
    expect(fs.existsSync(path.join(root, 'sections', 'sec1.json'))).toBe(false)
  })

  it('同一作品的写入按入队顺序执行', async () => {
    const order: number[] = []
    const first = enqueueStoryWrite('s1', async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push(1)
    })
    const second = enqueueStoryWrite('s1', async () => {
      order.push(2)
    })
    await Promise.all([first, second])
    expect(order).toEqual([1, 2])
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/story-store.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../data-core/storyStore"`。

- [ ] **Step 3：实现目录写队列**

```ts
// electron/data-core/storyStore.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readJsonWithBak, writeJsonAtomic } from './atomicJson'
import {
  readStoryManifest,
  writeStoryManifest,
  type ManifestEntry,
  type StoryEntityName,
  type StoryManifest,
} from './manifest'

export interface SectionFileRow extends Record<string, unknown> {
  id: string
}

export interface DirectoryPayload {
  story: Record<string, unknown>
  volumes: Record<string, unknown>[]
  chapters: {
    list: Record<string, unknown>[]
    sections: Record<string, unknown>[]
  }
  world: Record<string, unknown>
  characters: Record<string, unknown>[]
  dice: Record<string, unknown>
  sections: SectionFileRow[]
}

export interface StoryStoreOps {
  writeAtomic?: typeof writeJsonAtomic
}

const queues = new Map<string, Promise<unknown>>()

export function enqueueStoryWrite<T>(
  storyKey: string,
  task: () => T | Promise<T>,
): Promise<T> {
  const previous = queues.get(storyKey) ?? Promise.resolve()
  const next = previous.then(task, task)
  queues.set(
    storyKey,
    next.catch(() => undefined),
  )
  return next
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function entityFiles(payload: DirectoryPayload): Array<[StoryEntityName, string, unknown]> {
  return [
    ['story', 'story.json', payload.story],
    ['volumes', 'volumes.json', payload.volumes],
    ['chapters', 'chapters.json', payload.chapters],
    ['world', 'world.json', payload.world],
    ['characters', 'characters.json', payload.characters],
    ['dice', 'dice.json', payload.dice],
  ]
}

export function writeStoryDirectoryAt(
  storyRoot: string,
  payload: DirectoryPayload,
  ops: StoryStoreOps = {},
): string[] {
  const writeAtomic = ops.writeAtomic ?? writeJsonAtomic
  const oldManifest = readStoryManifest(storyRoot)
  fs.mkdirSync(path.join(storyRoot, 'sections'), { recursive: true })
  const written: string[] = []
  const files = {} as Record<StoryEntityName, ManifestEntry>

  for (const [name, fileName, data] of entityFiles(payload)) {
    const file = path.join(storyRoot, fileName)
    const previousEntry = oldManifest?.files[name]
    const existing = readJsonWithBak(file).value
    if (previousEntry && existing !== null && sameJson(existing, data)) {
      files[name] = previousEntry
      continue
    }
    const generation = (previousEntry?.generation ?? 0) + 1
    writeAtomic(file, data, generation)
    written.push(fileName)
    files[name] = {
      path: fileName,
      generation,
      count: Array.isArray(data) ? data.length : undefined,
    }
  }

  const sections: Record<string, ManifestEntry> = {}
  for (const section of payload.sections) {
    const relative = path.posix.join('sections', `${section.id}.json`)
    const file = path.join(storyRoot, relative)
    const previousEntry = oldManifest?.sections[section.id]
    const existing = readJsonWithBak(file).value
    if (previousEntry && existing !== null && sameJson(existing, section)) {
      sections[section.id] = previousEntry
      continue
    }
    const generation = (previousEntry?.generation ?? 0) + 1
    writeAtomic(file, section, generation)
    written.push(relative)
    sections[section.id] = { path: relative, generation }
  }

  if (oldManifest) {
    const keep = new Set(payload.sections.map((section) => section.id))
    for (const sectionId of Object.keys(oldManifest.sections)) {
      if (keep.has(sectionId)) continue
      const file = path.join(storyRoot, 'sections', `${sectionId}.json`)
      if (fs.existsSync(file)) fs.rmSync(file)
      if (fs.existsSync(`${file}.bak`)) fs.rmSync(`${file}.bak`)
      written.push(`sections/${sectionId}.json`)
    }
  }

  const manifest: StoryManifest = {
    schemaVersion: 2,
    generation: (oldManifest?.generation ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    files,
    sections,
  }
  writeStoryManifest(storyRoot, manifest)
  written.push('manifest.json')
  return written
}

export function readStoryDirectoryAt(storyRoot: string): DirectoryPayload | null {
  const manifest = readStoryManifest(storyRoot)
  if (!manifest) return null
  const { readEntityFromManifest } = require('./manifest') as typeof import('./manifest')
  const story = readEntityFromManifest<Record<string, unknown>>(storyRoot, manifest, 'story')
  if (!story) return null
  const volumes = readEntityFromManifest<Record<string, unknown>[]>(storyRoot, manifest, 'volumes')
  const chapters = readEntityFromManifest<DirectoryPayload['chapters']>(
    storyRoot,
    manifest,
    'chapters',
  )
  const world = readEntityFromManifest<Record<string, unknown>>(storyRoot, manifest, 'world')
  const characters = readEntityFromManifest<Record<string, unknown>[]>(
    storyRoot,
    manifest,
    'characters',
  )
  const dice = readEntityFromManifest<Record<string, unknown>>(storyRoot, manifest, 'dice')
  if (!volumes || !chapters || !world || !characters || !dice) return null
  return {
    story,
    volumes,
    chapters,
    world,
    characters,
    dice,
    sections: [],
  }
}
```

- [ ] **Step 4：把 `require` 改成静态导入**

```ts
// 文件顶部的 import 增加 readEntityFromManifest
import {
  readEntityFromManifest,
  readStoryManifest,
  writeStoryManifest,
  type ManifestEntry,
  type StoryEntityName,
  type StoryManifest,
} from './manifest'
```

删除 `readStoryDirectoryAt` 中的 `require` 行，直接用 `readEntityFromManifest`。

- [ ] **Step 5：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/story-store.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  6 passed (6)`。

---

## Task 5：旧 bundle → 目录迁移器

**Files:**
- Create: `electron/data-core/bundleToDirectory.ts`
- Test: `electron/__tests__/bundle-to-directory.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// electron/__tests__/bundle-to-directory.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  migrateAllLegacyBundles,
  migrateStoryBundleToDirectory,
} from '../data-core/bundleToDirectory'
import { readStoryDirectoryAt, writeStoryDirectoryAt } from '../data-core/storyStore'
import {
  getLegacyBundlePath,
  getMigratedBackupPath,
  getStoriesRoot,
  getStoryDir,
} from '../data-core/storyPaths'

let dataDir = ''

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-bundle-migrate-'))
  fs.mkdirSync(getStoriesRoot(dataDir), { recursive: true })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function legacyBundle() {
  return {
    format: 'anke-creator-story-v2',
    version: '2.0',
    exportedAt: '2026-11-05T00:00:00.000Z',
    story: { id: 's1', title: '迁移作品', created_at: '', updated_at: '' },
    volumes: [{ id: 'v1', story_id: 's1', title: '第一卷', order_index: 0 }],
    chapters: [
      { id: 'c1', story_id: 's1', volume_id: 'v1', title: '第一章', order_index: 0 },
      { id: 'c2', story_id: 's1', volume_id: 'v1', title: '第二章', order_index: 1 },
    ],
    sections: [
      { id: 'sec1', chapter_id: 'c1', title: '第1节', content: '<p>一</p>', order_index: 0 },
      { id: 'sec2', chapter_id: 'c1', title: '第2节', content: '<p>二</p>', order_index: 1 },
      { id: 'sec3', chapter_id: 'c2', title: '第3节', content: '<p>三</p>', order_index: 0 },
    ],
    world_settings: [{ id: 'w1', story_id: 's1', title: '世界', content: '设定' }],
    characters: [{ id: 'ch1', story_id: 's1', name: '角色', variants: '[]' }],
    character_relations: [],
    outlines: [],
    dice_history: [],
    stats: { word_count: 3, section_count: 3, chapter_count: 2 },
  }
}

describe('bundle to directory migration', () => {
  it('迁移前后数量一致并保留正文', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's1'), JSON.stringify(legacyBundle()))
    const snapshot = vi.fn()
    const result = migrateStoryBundleToDirectory(dataDir, 's1', { createSnapshot: snapshot })
    expect(result).toEqual({
      status: 'migrated',
      counts: { volumes: 1, chapters: 2, sections: 3 },
    })
    expect(snapshot).toHaveBeenCalledTimes(1)
    const dir = readStoryDirectoryAt(getStoryDir(dataDir, 's1'))!
    expect(dir.volumes).toHaveLength(1)
    expect(dir.chapters.list).toHaveLength(2)
    expect(dir.chapters.sections).toHaveLength(3)
    const sectionEnv = JSON.parse(
      fs.readFileSync(path.join(getStoryDir(dataDir, 's1'), 'sections', 'sec1.json'), 'utf-8'),
    )
    expect(sectionEnv.data.content).toBe('<p>一</p>')
    expect(fs.existsSync(getMigratedBackupPath(dataDir, 's1'))).toBe(true)
    expect(fs.existsSync(getLegacyBundlePath(dataDir, 's1'))).toBe(false)
  })

  it('已经在目录中的作品直接跳过', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's2'), JSON.stringify(legacyBundle()))
    migrateStoryBundleToDirectory(dataDir, 's2')
    const again = migrateStoryBundleToDirectory(dataDir, 's2')
    expect(again.status).toBe('skipped')
  })

  it('解析失败时清理临时目录并保留旧文件', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's3'), '{broken')
    const result = migrateStoryBundleToDirectory(dataDir, 's3')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('旧作品 JSON 解析失败')
    expect(fs.existsSync(getLegacyBundlePath(dataDir, 's3'))).toBe(true)
    expect(fs.readdirSync(getStoriesRoot(dataDir)).some((name) => name.startsWith('.s3.migrating-'))).toBe(false)
  })

  it('数量校验失败时不提交目录', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's4'), JSON.stringify(legacyBundle()))
    const result = migrateStoryBundleToDirectory(dataDir, 's4', {
      writeDirectory: (storyRoot, payload) => {
        writeStoryDirectoryAt(storyRoot, {
          ...payload,
          sections: payload.sections.slice(0, 2),
          chapters: {
            ...payload.chapters,
            sections: payload.chapters.sections.slice(0, 2),
          },
        })
      },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('迁移校验失败')
    expect(fs.existsSync(getStoryDir(dataDir, 's4'))).toBe(false)
    expect(fs.existsSync(getLegacyBundlePath(dataDir, 's4'))).toBe(true)
  })

  it('批量迁移返回 migrated / skipped / failed 计数', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 'a'), JSON.stringify(legacyBundle()))
    fs.writeFileSync(getLegacyBundlePath(dataDir, 'b'), '{broken')
    const result = migrateAllLegacyBundles(dataDir)
    expect(result).toMatchObject({ migrated: 1, failed: 1, skipped: 0 })
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/bundle-to-directory.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../data-core/bundleToDirectory"`。

- [ ] **Step 3：实现迁移器**

```ts
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
  writeDirectory?: typeof writeStoryDirectoryAt
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
      world_settings: bundle.world_settings ?? [],
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
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/bundle-to-directory.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  5 passed (5)`。

---

## Task 6：`storageLayout` 开关与 `db-main` 双读单写

**Files:**
- Create: `electron/data-core/storageLayout.ts`
- Modify: `electron/db-main.ts`、`electron/main.ts`
- Test: `electron/__tests__/storage-layout.test.ts`、`electron/__tests__/per-story-db.test.ts`
- Test（兼容旧断言）: `electron/__tests__/setSectionContent-single-write.test.ts`、`electron/__tests__/section-sidecar.test.ts`、`electron/__tests__/e2e-real-file.test.ts`

- [ ] **Step 1：写布局开关失败测试**

```ts
// electron/__tests__/storage-layout.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  initializeStorageLayout,
  readStorageLayout,
  resolveStorageLayout,
  writeStorageLayout,
} from '../data-core/storageLayout'

let dataDir = ''

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-layout-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('storage layout', () => {
  it('没有开关时读写都回退到 bundle', () => {
    expect(readStorageLayout(dataDir)).toBeNull()
    expect(resolveStorageLayout(dataDir)).toBe('bundle')
  })

  it('全新空目录初始化为 perStory', () => {
    expect(initializeStorageLayout(dataDir)).toBe('perStory')
    expect(readStorageLayout(dataDir)).toBe('perStory')
  })

  it('已有旧 bundle 的用户初始化为 bundle，便于先迁移', () => {
    fs.mkdirSync(path.join(dataDir, 'stories'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'stories', 'old.json'), '{}')
    expect(initializeStorageLayout(dataDir)).toBe('bundle')
  })

  it('可以显式回滚到 bundle', () => {
    writeStorageLayout(dataDir, 'perStory')
    expect(resolveStorageLayout(dataDir)).toBe('perStory')
    writeStorageLayout(dataDir, 'bundle')
    expect(resolveStorageLayout(dataDir)).toBe('bundle')
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/storage-layout.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../data-core/storageLayout"`。

- [ ] **Step 3：实现布局开关**

```ts
// electron/data-core/storageLayout.ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export type StorageLayout = 'bundle' | 'perStory'

const LAYOUT_FILE = 'storage-layout.json'

function layoutPath(dataDir: string): string {
  return path.join(dataDir, 'settings', LAYOUT_FILE)
}

export function readStorageLayout(dataDir: string): StorageLayout | null {
  const file = layoutPath(dataDir)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { layout?: string }
    return raw.layout === 'perStory' ? 'perStory' : raw.layout === 'bundle' ? 'bundle' : null
  } catch {
    return null
  }
}

export function writeStorageLayout(dataDir: string, layout: StorageLayout): void {
  fs.mkdirSync(path.join(dataDir, 'settings'), { recursive: true })
  fs.writeFileSync(layoutPath(dataDir), JSON.stringify({ layout }), 'utf-8')
}

export function resolveStorageLayout(dataDir: string): StorageLayout {
  return readStorageLayout(dataDir) ?? 'bundle'
}

export function initializeStorageLayout(dataDir: string): StorageLayout {
  const saved = readStorageLayout(dataDir)
  if (saved) return saved
  const storiesRoot = path.join(dataDir, 'stories')
  const hasOldData = fs.existsSync(storiesRoot)
    ? fs.readdirSync(storiesRoot).some((name) => name.endsWith('.json'))
    : false
  const layout: StorageLayout = hasOldData ? 'bundle' : 'perStory'
  writeStorageLayout(dataDir, layout)
  return layout
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/storage-layout.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  4 passed (4)`。

- [ ] **Step 5：写 `db-main` 目录读写集成失败测试**

```ts
// electron/__tests__/per-story-db.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getAppPath: () => process.env.APP_ROOT || process.cwd(),
    getName: () => 'test-app',
  },
  ipcMain: { handle: () => {} },
}))

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-perstory-db-'))
process.env.APP_ROOT = tmpDir
const dataDir = path.join(tmpDir, 'data')

import * as db from '../db-main'
import { getStoryDir, getLegacyBundlePath } from '../data-core/storyPaths'
import { writeStorageLayout } from '../data-core/storageLayout'

beforeEach(() => {
  fs.rmSync(path.join(dataDir, 'stories'), { recursive: true, force: true })
  writeStorageLayout(dataDir, 'perStory')
})

describe('db-main perStory layout', () => {
  it('作品写入 stories/<id>/ 而不是单文件', async () => {
    const story = db.createStory({ title: '目录作品' })
    const volume = await db.createVolume({ story_id: story.id, title: '第一卷' })
    const chapter = await db.createChapter({
      story_id: story.id,
      volume_id: volume.id,
      title: '第一章',
    })
    const section = await db.createSection({
      chapter_id: chapter.id,
      title: '第1节',
      content: '<p>正文</p>',
    })
    const dir = getStoryDir(dataDir, story.id)
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'story.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'sections', `${section.id}.json`))).toBe(true)
    expect(fs.existsSync(getLegacyBundlePath(dataDir, story.id))).toBe(false)
    const full = db.getStoryWithAll(story.id)
    expect(full.volumes).toHaveLength(1)
    expect(full.chapters[0].sections[0].content).toBe('<p>正文</p>')
    expect(db.getSectionContent(section.id)).toBe('<p>正文</p>')
  })

  it('setSectionContent 写回目录并更新 stats', async () => {
    const story = db.createStory({ title: '更新正文' })
    const volume = await db.createVolume({ story_id: story.id, title: '第一卷' })
    const chapter = await db.createChapter({
      story_id: story.id,
      volume_id: volume.id,
      title: '第一章',
    })
    const section = await db.createSection({
      chapter_id: chapter.id,
      title: '第1节',
      content: '<p>旧</p>',
    })
    await db.setSectionContent(section.id, '<p>新内容</p>')
    expect(db.getSectionContent(section.id)).toBe('<p>新内容</p>')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(getStoryDir(dataDir, story.id), 'manifest.json'), 'utf-8'),
    )
    expect(manifest.sections[section.id]).toBeTruthy()
  })
})
```

- [ ] **Step 6：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/per-story-db.test.ts`

Expected: 退出码 1，断言 `fs.existsSync(path.join(dir, 'manifest.json'))` 为 `false`（此时仍写旧单文件）。

- [ ] **Step 7：在 `db-main.ts` 接入目录读写**

新增 import：

```ts
import { readStoryDirectoryAt, writeStoryDirectoryAt, type DirectoryPayload } from './data-core/storyStore'
import { readStoryManifest, readSectionFromManifest } from './data-core/manifest'
import {
  getStoryDir,
  getLegacyBundlePath,
  getLegacyBundleBakPath,
} from './data-core/storyPaths'
import { resolveStorageLayout, initializeStorageLayout, writeStorageLayout } from './data-core/storageLayout'
import { migrateAllLegacyBundles } from './data-core/bundleToDirectory'
```

在 `emptyBundle` 之后加入转换函数：

```ts
function bundleToDirectoryPayload(bundle: StoryBundle): DirectoryPayload {
  return {
    story: { ...bundle.story, stats: bundle.stats },
    volumes: bundle.volumes as unknown as Record<string, unknown>[],
    chapters: {
      list: bundle.chapters as unknown as Record<string, unknown>[],
      sections: bundle.sections.map(({ content: _content, bbcode: _bbcode, ...meta }) => meta),
    },
    world: {
      world_settings: bundle.world_settings as unknown as Record<string, unknown>[],
      character_relations: bundle.character_relations as unknown as Record<string, unknown>[],
      outlines: bundle.outlines as unknown as Record<string, unknown>[],
    },
    characters: bundle.characters as unknown as Record<string, unknown>[],
    dice: { dice_history: bundle.dice_history as unknown as Record<string, unknown>[] },
    sections: bundle.sections.map((section) => ({
      id: section.id,
      content: section.content ?? null,
      bbcode: section.bbcode ?? null,
      word_count: section.word_count || 0,
      updated_at: section.updated_at,
    })),
  }
}

function directoryToBundle(dir: DirectoryPayload): StoryBundle {
  const stats = dir.story.stats as StoryBundle['stats'] | undefined
  return {
    format: 'anke-creator-story-v2',
    version: '2.0',
    exportedAt: String(dir.story.exportedAt ?? nowISO()),
    story: dir.story as unknown as StoryRow,
    volumes: dir.volumes as unknown as VolumeRow[],
    chapters: dir.chapters.list as unknown as ChapterRow[],
    sections: dir.chapters.sections.map((section) => ({
      ...(section as unknown as SectionRow),
      content: null,
      bbcode: null,
    })),
    world_settings: (dir.world.world_settings ?? []) as unknown as WorldSettingRow[],
    characters: dir.characters as unknown as CharacterRow[],
    character_relations: (dir.world.character_relations ?? []) as unknown as RelationRow[],
    outlines: (dir.world.outlines ?? []) as unknown as OutlineRow[],
    dice_history: (dir.dice.dice_history ?? []) as unknown as DiceHistoryRecord[],
    stats: stats ?? { word_count: 0, section_count: 0, chapter_count: 0 },
  }
}
```

替换 `readStoryFile` 与 `writeStoryFile` 的存储分支：

```ts
function readStoryFile(storyId: string): StoryBundle | null {
  if (resolveStorageLayout(getDataDir()) === 'perStory') {
    const dir = readStoryDirectoryAt(getStoryDir(getDataDir(), storyId))
    if (dir) return directoryToBundle(dir)
  }
  return loadJSONWithRecovery<StoryBundle | null>(
    getLegacyBundlePath(getDataDir(), storyId),
    getLegacyBundleBakPath(getDataDir(), storyId),
    null,
  )
}

function writeStoryFile(storyId: string, bundle: StoryBundle): void {
  if (resolveStorageLayout(getDataDir()) === 'perStory') {
    writeStoryDirectoryAt(getStoryDir(getDataDir(), storyId), bundleToDirectoryPayload(bundle))
    return
  }
  saveJSONWithBackup(
    getLegacyBundlePath(getDataDir(), storyId),
    getLegacyBundleBakPath(getDataDir(), storyId),
    bundle,
  )
}
```

`hydrateSectionRow` 增加可选 `storyId`，并在 `getStoryWithAll` 传入：

```ts
function hydrateSectionRow(row: SectionRow, storyId?: string): SectionRow {
  if (row.content != null) return row
  if (storyId && resolveStorageLayout(getDataDir()) === 'perStory') {
    const dir = getStoryDir(getDataDir(), storyId)
    const manifest = readStoryManifest(dir)
    const section = manifest
      ? readSectionFromManifest<SectionContentFile>(dir, manifest, row.id)
      : null
    if (section) {
      return {
        ...row,
        content: section.content ?? null,
        bbcode: section.bbcode ?? row.bbcode ?? null,
        word_count: section.word_count ?? row.word_count,
      }
    }
  }
  const side = readSectionContentFile(row.id)
  if (!side) return row
  return {
    ...row,
    content: side.content ?? null,
    bbcode: side.bbcode ?? row.bbcode ?? null,
    word_count: side.word_count ?? row.word_count,
  }
}
```

`getStoryWithAll` 改为 `const sections = bundle.sections.map((row) => hydrateSectionRow(row, storyId));`。

`getSectionContent` 与 `getSectionBBCode` 在侧车读写之前增加目录读取。两函数共用同一段定位逻辑，只有返回字段不同：`getSectionContent` 返回 `section.content`，`getSectionBBCode` 返回 `section.bbcode ?? null`。

```ts
function readSectionFromPerStory(id: string): SectionContentFile | null {
  if (resolveStorageLayout(getDataDir()) !== 'perStory') return null
  const storyId = findStoryIdByEntityId(id, 'sections')
  if (!storyId) return null
  const dir = getStoryDir(getDataDir(), storyId)
  const manifest = readStoryManifest(dir)
  return manifest ? readSectionFromManifest<SectionContentFile>(dir, manifest, id) : null
}

export function getSectionContent(id: string): string | null {
  const fromDir = readSectionFromPerStory(id)
  if (fromDir) return fromDir.content
  const side = readSectionContentFile(id)
  if (side) return side.content
  const storyId = findStoryIdByEntityId(id, 'sections')
  if (!storyId) return null
  const bundle = readStoryFile(storyId)
  if (!bundle) return null
  const sec = bundle.sections.find((s) => s.id === id)
  return sec ? sec.content : null
}

export function getSectionBBCode(id: string): string | null {
  const fromDir = readSectionFromPerStory(id)
  if (fromDir) return fromDir.bbcode ?? null
  const side = readSectionContentFile(id)
  if (side) return side.bbcode ?? null
  const storyId = findStoryIdByEntityId(id, 'sections')
  if (!storyId) return null
  const bundle = readStoryFile(storyId)
  if (!bundle) return null
  const sec = bundle.sections.find((s) => s.id === id)
  return sec ? (sec.bbcode ?? null) : null
}
```

`setSectionContent` 使用 perStory 分支：

```ts
const isPerStory = resolveStorageLayout(getDataDir()) === 'perStory'
const existingSection = isPerStory
  ? readSectionFromManifest<SectionContentFile>(
      getStoryDir(getDataDir(), storyId),
      readStoryManifest(getStoryDir(getDataDir(), storyId))!,
      id,
    )
  : null
const metadataRow = isPerStory
  ? { ...bundle.sections[idx], content: null, bbcode: null, word_count: wc }
  : persistSectionContentSidecar(
      { ...bundle.sections[idx], word_count: wc },
      bbcode === undefined ? { content } : { content, bbcode },
    )
bundle.sections[idx] = { ...metadataRow, word_count: wc }
if (isPerStory) {
  bundle.sections[idx].content = content ?? null
  bundle.sections[idx].bbcode =
    bbcode === undefined ? (existingSection?.bbcode ?? null) : (bbcode ?? null)
}
```

- [ ] **Step 8：在 `initMainDatabase` 中初始化布局并迁移**

```ts
const layout = initializeStorageLayout(dir)
if (layout === 'bundle') {
  try {
    const migration = migrateAllLegacyBundles(dir, {
      createSnapshot: () => ensureDailySnapshot(dir),
    })
    if (migration.migrated > 0) {
      writeStorageLayout(dir, 'perStory')
    }
  } catch (e) {
    console.warn('[db-main] per-story 迁移失败，继续使用单文件布局:', e)
  }
}
```

`ensureDailySnapshot` 从 `./snapshot` 导入。把这段放在 `getTemplatesDir()` 之后、`startSectionSidecarMigration()` 之前。

- [ ] **Step 9：在 `main.ts` 启动时提前确定布局**

在 `db.initMainDatabase()` 之前加入：

```ts
import { initializeStorageLayout } from './data-core/storageLayout'
import { getDataDir } from './paths'

initializeStorageLayout(getDataDir())
```

- [ ] **Step 10：给仍断言旧单文件的测试固定 `bundle` 布局**

在 `setSectionContent-single-write.test.ts`、`section-sidecar.test.ts`、`e2e-real-file.test.ts` 的 `beforeEach` 最前面写入：

```ts
const dataDir = path.join(tmpDir, 'data')
fs.mkdirSync(path.join(dataDir, 'settings'), { recursive: true })
fs.writeFileSync(
  path.join(dataDir, 'settings', 'storage-layout.json'),
  JSON.stringify({ layout: 'bundle' }),
)
```

- [ ] **Step 11：运行目录集成测试**

Run: `npx vitest run electron/__tests__/per-story-db.test.ts electron/__tests__/storage-layout.test.ts`

Expected: `Test Files  2 passed (2)`，`per-story-db` 两条用例通过。

- [ ] **Step 12：运行受影响的旧测试并做类型检查**

Run: `npx vitest run electron/__tests__/setSectionContent-single-write.test.ts electron/__tests__/section-sidecar.test.ts electron/__tests__/e2e-real-file.test.ts`

Expected: `Test Files  3 passed (3)`。

Run: `npm run typecheck`

Expected: 退出码 0，无 TypeScript 错误。

---

## Task 7：三后端统一仓储接口与一致性测试

**Files:**
- Create: `src/db/repository.ts`
- Modify: `src/db/index.ts`
- Test: `src/db/repository.test.ts`

- [ ] **Step 1：写三后端一致性失败测试**

```ts
// src/db/repository.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StoryRepository } from './repository'
import {
  createBrowserRepository,
  createElectronRepository,
  createMemoryRepository,
} from './repository'
import { BROWSER_DB } from './browserIndexedDB'

function makeFakeDbApi() {
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`
  const stories = new Map<string, any>()
  const volumes = new Map<string, any>()
  const chapters = new Map<string, any>()
  const sections = new Map<string, any>()
  const contents = new Map<string, string>()
  const emptyStory = (id: string) => ({
    id,
    title: stories.get(id)?.title ?? '',
    volumes: [] as any[],
    chapters: [] as any[],
    sections: [] as any[],
    world_settings: [],
    characters: [],
    character_relations: [],
    outlines: [],
    dice_history: [],
  })
  return {
    createStory: async (data: any) => {
      const row = { id: nextId('s'), word_count: 0, ...data }
      stories.set(row.id, row)
      return row
    },
    updateStory: async (id: string, patch: any) => {
      const row = stories.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    getStoryWithAll: async (id: string) => {
      if (!stories.has(id)) return undefined
      return {
        ...emptyStory(id),
        volumes: [...volumes.values()].filter((v) => v.story_id === id),
        chapters: [...chapters.values()].filter((c) => c.story_id === id),
        sections: [...sections.values()].filter((s) => {
          const chapter = chapters.get(s.chapter_id)
          return chapter?.story_id === id
        }),
      }
    },
    listStoriesWithStats: async () => [...stories.values()].map((s) => ({ ...s, stats: { word_count: s.word_count } })),
    createVolume: async (data: any) => {
      const row = { id: nextId('v'), ...data }
      volumes.set(row.id, row)
      return row
    },
    updateVolume: async (id: string, patch: any) => {
      const row = volumes.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    deleteVolume: async (id: string) => volumes.delete(id),
    createChapter: async (data: any) => {
      const row = { id: nextId('c'), ...data }
      chapters.set(row.id, row)
      return row
    },
    updateChapter: async (id: string, patch: any) => {
      const row = chapters.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    deleteChapter: async (id: string) => chapters.delete(id),
    createSection: async (data: any) => {
      const row = { id: nextId('sec'), ...data }
      sections.set(row.id, row)
      return row
    },
    updateSection: async (id: string, patch: any) => {
      const row = sections.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    deleteSection: async (id: string) => {
      contents.delete(id)
      return sections.delete(id)
    },
    listSectionMetadata: async (chapterId: string) => [...sections.values()]
      .filter((s) => s.chapter_id === chapterId)
      .map(({ content, bbcode, ...meta }) => meta),
    getSectionContent: async (id: string) => contents.get(id) ?? null,
    setSectionContent: async (id: string, content: string | null) => {
      contents.set(id, content ?? '')
    },
    createWorldSetting: async (data: any) => ({ id: nextId('w'), ...data }),
    updateWorldSetting: async (_id: string, patch: any) => patch,
    createCharacter: async (data: any) => ({ id: nextId('ch'), ...data }),
    updateCharacter: async (_id: string, patch: any) => patch,
  }
}

const factories: Array<[string, () => StoryRepository]> = [
  ['electron', () => createElectronRepository(makeFakeDbApi() as never)],
  ['indexeddb', () => createBrowserRepository(BROWSER_DB as never)],
  ['memory', () => createMemoryRepository()],
]

describe.each(factories)('%s 仓储', (_name, factory) => {
  let repo: StoryRepository

  beforeEach(() => {
    repo = factory()
  })

  it('建作品、写结构、写正文后聚合读取一致', async () => {
    const story = await repo.createStory({ title: '一致性作品' })
    await repo.saveStructure(story.id, {
      volumes: [{ id: 'v1', story_id: story.id, title: '第一卷', order_index: 0 } as any],
      chapters: [{ id: 'c1', story_id: story.id, volume_id: 'v1', title: '第一章', order_index: 0 } as any],
      sections: [{ id: 'sec1', chapter_id: 'c1', title: '第1节', order_index: 0, content: null } as any],
    })
    await repo.saveWorld(story.id, { settings: [], relations: [], outlines: [] })
    await repo.saveCharacters(story.id, [])
    await repo.saveSectionContent('sec1', '<p>正文</p>')

    const full = await repo.getStoryWithAll(story.id)
    expect(full?.volumes.map((v) => v.id)).toEqual(['v1'])
    expect(full?.chapters[0].sections.map((s) => s.id)).toEqual(['sec1'])
    expect(await repo.getSectionContent('sec1')).toBe('<p>正文</p>')
    expect((await repo.listSectionMetadata('c1')).map((s) => s.id)).toEqual(['sec1'])

    const listed = await repo.listStoriesWithStats()
    expect(listed.some((s) => s.id === story.id)).toBe(true)
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run src/db/repository.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "./repository"`。

- [ ] **Step 3：实现仓储接口与三个适配器**

```ts
// src/db/repository.ts
import type { Story, StoryWithAll, Volume, Chapter, Section, SectionMeta } from '../types/story'
import type {
  Character,
  WorldSetting,
  CharacterRelation,
  Outline,
} from '../types'
import { BROWSER_DB } from './browserIndexedDB'

export interface StructureInput {
  volumes: Volume[]
  chapters: Chapter[]
  sections: Section[]
}

export interface WorldInput {
  settings: WorldSetting[]
  relations: CharacterRelation[]
  outlines: Outline[]
}

export interface StoryRepository {
  getStoryWithAll(storyId: string): Promise<StoryWithAll | undefined>
  createStory(data: Partial<Story> & { title: string }): Promise<Story>
  saveStoryMeta(storyId: string, patch: Partial<Story>): Promise<Story | undefined>
  saveStructure(storyId: string, input: StructureInput): Promise<void>
  saveWorld(storyId: string, input: WorldInput): Promise<void>
  saveCharacters(storyId: string, characters: Character[]): Promise<void>
  getSectionContent(sectionId: string): Promise<string | null>
  saveSectionContent(sectionId: string, html: string, bbcode?: string | null): Promise<void>
  listSectionMetadata(chapterId: string): Promise<SectionMeta[]>
  listStoriesWithStats(): Promise<Array<Story & { stats: { word_count: number } }>>
}

type DbApi = NonNullable<Window['dbAPI']>
type Rows = Array<{ id: string }>

async function syncRows<T extends { id: string }>(
  rows: T[],
  existing: T[],
  create: (row: T) => Promise<unknown>,
  update: (id: string, row: T) => Promise<unknown>,
  remove: (id: string) => Promise<unknown>,
): Promise<void> {
  const keep = new Set(rows.map((row) => row.id))
  for (const row of rows) {
    if (existing.some((item) => item.id === row.id)) await update(row.id, row)
    else await create(row)
  }
  for (const row of existing) {
    if (!keep.has(row.id)) await remove(row.id)
  }
}

export function createElectronRepository(api: DbApi): StoryRepository {
  return {
    getStoryWithAll: (storyId) => api.getStoryWithAll(storyId),
    createStory: (data) => api.createStory(data as Record<string, unknown>),
    saveStoryMeta: (storyId, patch) => api.updateStory(storyId, patch as Record<string, unknown>),
    async saveStructure(storyId, input) {
      const current = await api.getStoryWithAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(input.volumes, current.volumes, (row) => api.createVolume(row), (id, row) => api.updateVolume(id, row), (id) => api.deleteVolume(id))
      await syncRows(input.chapters, current.chapters, (row) => api.createChapter(row), (id, row) => api.updateChapter(id, row), (id) => api.deleteChapter(id))
      await syncRows(input.sections, current.sections, (row) => api.createSection(row), (id, row) => api.updateSection(id, row), (id) => api.deleteSection(id))
    },
    async saveWorld(storyId, input) {
      const current = await api.getStoryWithAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(input.settings, current.world_settings, (row) => api.createWorldSetting(row), (id, row) => api.updateWorldSetting(id, row), (id) => api.deleteWorldSetting(id))
      await syncRows(input.relations, current.character_relations, (row) => api.createCharacterRelation(row), (id, row) => api.updateCharacterRelation(id, row), (id) => api.deleteCharacterRelation(id))
      await syncRows(input.outlines, current.outlines, (row) => api.createOutline(row), (id, row) => api.updateOutline(id, row), (id) => api.deleteOutline(id))
    },
    async saveCharacters(storyId, characters) {
      const current = await api.getStoryWithAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(characters, current.characters, (row) => api.createCharacter(row), (id, row) => api.updateCharacter(id, row), (id) => api.deleteCharacter(id))
    },
    getSectionContent: (sectionId) => api.getSectionContent(sectionId),
    saveSectionContent: (sectionId, html, bbcode) => api.setSectionContent(sectionId, html, bbcode ?? null),
    listSectionMetadata: (chapterId) => api.listSectionMetadata(chapterId),
    listStoriesWithStats: () => api.listStoriesWithStats(),
  }
}

export function createBrowserRepository(db = BROWSER_DB): StoryRepository {
  return {
    getStoryWithAll: (storyId) => db.getStoryWithAll(storyId),
    createStory: (data) => db.createStory(data as Record<string, unknown>),
    saveStoryMeta: (storyId, patch) => db.updateStory(storyId, patch as Record<string, unknown>),
    async saveStructure(storyId, input) {
      const current = await db.getStoryWithAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(input.volumes, current.volumes, (row) => db.createVolume(row), (id, row) => db.updateVolume(id, row), (id) => db.deleteVolume(id))
      await syncRows(input.chapters, current.chapters, (row) => db.createChapter(row), (id, row) => db.updateChapter(id, row), (id) => db.deleteChapter(id))
      await syncRows(input.sections, current.sections, (row) => db.createSection(row), (id, row) => db.updateSection(id, row), (id) => db.deleteSection(id))
    },
    async saveWorld(storyId, input) {
      const current = await db.getStoryWithAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(input.settings, current.world_settings, (row) => db.createWorldSetting(row), (id, row) => db.updateWorldSetting(id, row), (id) => db.deleteWorldSetting(id))
      await syncRows(input.relations, current.character_relations, (row) => db.createCharacterRelation(row), (id, row) => db.updateCharacterRelation(id, row), (id) => db.deleteCharacterRelation(id))
      await syncRows(input.outlines, current.outlines, (row) => db.createOutline(row), (id, row) => db.updateOutline(id, row), (id) => db.deleteOutline(id))
    },
    async saveCharacters(storyId, characters) {
      const current = await db.getStoryWithAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(characters, current.characters, (row) => db.createCharacter(row), (id, row) => db.updateCharacter(id, row), (id) => db.deleteCharacter(id))
    },
    getSectionContent: (sectionId) => db.getSectionContent(sectionId),
    saveSectionContent: (sectionId, html, bbcode) => db.setSectionContent(sectionId, html, bbcode ?? null),
    listSectionMetadata: (chapterId) => db.listSectionMetadata(chapterId),
    async listStoriesWithStats() {
      const stories = await db.listStories()
      return stories.map((story) => ({ ...story, stats: { word_count: story.word_count ?? 0 } }))
    },
  }
}

export function createMemoryRepository(): StoryRepository {
  const state = {
    stories: [] as Array<Story & { stats: { word_count: number } }>,
    volumes: [] as Volume[],
    chapters: [] as Chapter[],
    sections: [] as Section[],
    settings: [] as WorldSetting[],
    characters: [] as Character[],
    relations: [] as CharacterRelation[],
    outlines: [] as Outline[],
    contents: new Map<string, string>(),
  }
  const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  return {
    async getStoryWithAll(storyId) {
      const story = state.stories.find((item) => item.id === storyId)
      if (!story) return undefined
      const sections = state.sections.filter((section) =>
        state.chapters.some((chapter) => chapter.id === section.chapter_id && chapter.story_id === storyId),
      ).map((section) => ({ ...section, content: state.contents.get(section.id) ?? null }))
      return {
        ...story,
        volumes: state.volumes.filter((volume) => volume.story_id === storyId),
        chapters: state.chapters.filter((chapter) => chapter.story_id === storyId),
        sections,
        world_settings: state.settings.filter((row) => row.story_id === storyId),
        characters: state.characters.filter((row) => row.story_id === storyId),
        character_relations: state.relations.filter((row) => row.story_id === storyId),
        outlines: state.outlines.filter((row) => row.story_id === storyId),
        dice_history: [],
      } as StoryWithAll
    },
    async createStory(data) {
      const row = { id: id('story'), word_count: 0, ...data } as Story & { stats: { word_count: number } }
      state.stories.push({ ...row, stats: { word_count: 0 } })
      return row
    },
    async saveStoryMeta(storyId, patch) {
      const row = state.stories.find((item) => item.id === storyId)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    async saveStructure(storyId, input) {
      state.volumes = state.volumes.filter((row) => row.story_id !== storyId).concat(input.volumes)
      state.chapters = state.chapters.filter((row) => row.story_id !== storyId).concat(input.chapters)
      const chapterIds = input.chapters.map((row) => row.id)
      state.sections = state.sections.filter((row) => !chapterIds.includes(row.chapter_id)).concat(input.sections)
    },
    async saveWorld(storyId, input) {
      state.settings = state.settings.filter((row) => row.story_id !== storyId).concat(input.settings)
      state.relations = state.relations.filter((row) => row.story_id !== storyId).concat(input.relations)
      state.outlines = state.outlines.filter((row) => row.story_id !== storyId).concat(input.outlines)
    },
    async saveCharacters(storyId, characters) {
      state.characters = state.characters.filter((row) => row.story_id !== storyId).concat(characters)
    },
    async getSectionContent(sectionId) {
      return state.contents.get(sectionId) ?? null
    },
    async saveSectionContent(sectionId, html) {
      state.contents.set(sectionId, html)
    },
    async listSectionMetadata(chapterId) {
      return state.sections.filter((row) => row.chapter_id === chapterId)
    },
    async listStoriesWithStats() {
      return state.stories
    },
  }
}
```

- [ ] **Step 4：在 `src/db/index.ts` 导出**

```ts
export {
  createBrowserRepository,
  createElectronRepository,
  createMemoryRepository,
  type StoryRepository,
} from './repository'

export function getStoryRepository(): import('./repository').StoryRepository {
  if (typeof window !== 'undefined' && window.dbAPI) {
    return createElectronRepository(window.dbAPI)
  }
  return createBrowserRepository()
}
```

- [ ] **Step 5：运行一致性测试，确认通过**

Run: `npx vitest run src/db/repository.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  3 passed (3)`（electron / indexeddb / memory 各一条）。

- [ ] **Step 6：类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。若 `StoryWithAll` 缺少 `stats` 字段，改为在适配器里返回 `Story & { stats: { word_count: number } }` 的交叉类型，不要修改 `src/types/story.ts`。

---

## Task 8：导入归一化 `normalizeImportPayload`

**Files:**
- Modify: `src/utils/storyImport.ts`
- Test: `src/utils/storyImport.test.ts`

本任务在现有代码上补齐归一化，不从零重写：
- `validateImportFormat` 继续负责 `anke-creator-export` / `anke-creator-story` 的包装层校验，原有断言保持不变；
- `normalizeImportPayload` 负责包装识别（`anke-creator-export`、`anke-creator-story`、内部 `anke-creator-story-v2`、无包装旧文件）、格式白名单、正文提取（`content` 优先、`bbcode` 兜底）、无卷/章时补默认卷章、未知字段保留到 `extras` 与中文错误；
- `ensureDefaultVolumeAndChapter` 继续在导入流程里负责落库建卷/章/节，本任务不修改它。

- [ ] **Step 1：在现有测试文件末尾追加失败用例**

```ts
// src/utils/storyImport.test.ts 顶部补充 import（原有 validateImportFormat 断言全部保留）
import { normalizeImportPayload, parseImportText } from './storyImport'

// fixture a：收集安科（ankeCollect.ts:314-405）的输出结构
const collectorPayload = {
  format: 'anke-creator-export',
  version: '1.1',
  exportedAt: '2026-11-05T00:00:00.000Z',
  appVersion: '0.1.0',
  data: {
    title: '收集作品',
    description: '源：NGA tid=123，第 1-10 楼',
    category: '安科',
    volumes: [{ id: 'vol-default', title: '第一卷', order_index: 0 }],
    chapters: [
      {
        title: '第一章',
        volume_id: 'vol-default',
        order_index: 0,
        sections: [{ title: '第1-10楼', order_index: 0, content: '<p>收集正文</p>' }],
      },
    ],
    characters: [],
    world_settings: [],
    outlines: [],
    character_relations: [],
    dice_history: [],
  },
}

// fixture b：旧版 anke-creator-story（data 包裹 + 顶层 sections + 无 volumes）
const legacyStoryPayload = {
  format: 'anke-creator-story',
  version: '1.0',
  data: {
    title: '旧版作品',
    chapters: [{ id: 'c1', title: '第一章', volume_id: 'v1', order_index: 0 }],
    sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>旧版正文</p>' }],
  },
}

// fixture c：当前 WorksListPage.tsx:323-334 的导出结构
const worksListPagePayload = {
  format: 'anke-creator-export',
  version: '1.1',
  exportedAt: '2026-11-05T00:00:00.000Z',
  appVersion: '0.1.0',
  data: {
    id: 'story-1',
    title: '页面导出作品',
    description: '页面导出',
    category: '测试',
    volumes: [{ id: 'v1', story_id: 'story-1', title: '第一卷', order_index: 0 }],
    chapters: [
      {
        id: 'c1',
        story_id: 'story-1',
        volume_id: 'v1',
        title: '第一章',
        order_index: 0,
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', order_index: 0, content: '<p>页面正文</p>' }],
      },
    ],
    world_settings: [],
    characters: [],
    character_relations: [{ id: 'r1', source_id: 'a', target_id: 'b', relation: '朋友' }],
    outlines: [],
    dice_history: [{ id: 'd1', result: '1d100=42' }],
  },
}

describe('normalizeImportPayload', () => {
  it('接受内部 StoryBundle（anke-creator-story-v2）根格式', () => {
    const result = normalizeImportPayload(
      {
        format: 'anke-creator-story-v2',
        story: { title: '根格式' },
        volumes: [{ id: 'v1', title: '第一卷' }],
        chapters: [{ id: 'c1', volume_id: 'v1', title: '第一章' }],
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>正文</p>' }],
      },
      'story.json',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('story-v2')
    expect(result.data.title).toBe('根格式')
    expect(result.data.sections[0].content).toBe('<p>正文</p>')
  })

  it('接受收集安科输出（anke-creator-export，章内嵌 sections）', () => {
    const result = normalizeImportPayload(collectorPayload, 'collector.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('export')
    expect(result.data.title).toBe('收集作品')
    expect(result.data.volumes).toHaveLength(1)
    expect(result.data.chapters).toHaveLength(1)
    expect(result.data.chapters[0].id).toBe('import-ch-1')
    expect(result.data.sections).toHaveLength(1)
    expect(result.data.sections[0].chapter_id).toBe('import-ch-1')
    expect(result.data.sections[0].content).toBe('<p>收集正文</p>')
    expect(validateImportFormat(collectorPayload).valid).toBe(true)
  })

  it('接受旧版 anke-creator-story（data 包裹 + 顶层 sections）', () => {
    const result = normalizeImportPayload(legacyStoryPayload, 'legacy.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('story')
    expect(result.data.volumes[0].title).toBe('第一卷')
    expect(result.data.sections[0].chapter_id).toBe('c1')
    expect(result.data.sections[0].content).toBe('<p>旧版正文</p>')
    expect(validateImportFormat(legacyStoryPayload).valid).toBe(true)
  })

  it('接受当前 WorksListPage 导出结构', () => {
    const result = normalizeImportPayload(worksListPagePayload, 'page-export.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('export')
    expect(result.data.title).toBe('页面导出作品')
    expect(result.data.sections[0].content).toBe('<p>页面正文</p>')
    expect(result.data.character_relations).toHaveLength(1)
    expect(result.data.dice_history).toHaveLength(1)
  })

  it('接受没有 format 的旧文件', () => {
    const result = normalizeImportPayload(
      {
        title: '旧文件',
        story: { id: 'story-1', title: '旧文件' },
        volumes: [{ id: 'v1', title: '第一卷' }],
        chapters: [{ id: 'c1', volume_id: 'v1', title: '第一章' }],
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>旧正文</p>' }],
      },
      'old.json',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('legacy')
    expect(result.data.title).toBe('旧文件')
  })

  it('没有卷或章时补默认卷章', () => {
    const result = normalizeImportPayload(
      { title: '补默认', sections: [{ title: '第1节', content: '<p>正文</p>' }] },
      'minimal.json',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.volumes).toHaveLength(1)
    expect(result.data.chapters).toHaveLength(1)
    expect(result.data.sections[0].chapter_id).toBe(result.data.chapters[0].id)
    expect(result.data.sections[0].order_index).toBe(0)
  })

  it('未知字段保留到 extras', () => {
    const result = normalizeImportPayload(
      {
        title: '保留字段',
        cover_gradient: 'linear-gradient(#fff, #000)',
        author_note: '作者备注',
        sections: [{ title: '第1节', content: '<p>正文</p>', layout_hint: 'wide' }],
      },
      'extra.json',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.cover_gradient).toBe('linear-gradient(#fff, #000)')
    expect(result.data.extras).toMatchObject({ author_note: '作者备注' })
    expect(result.data.sections[0].extras.layout_hint).toBe('wide')
  })

  it('缺正文时报中文错误', () => {
    const result = normalizeImportPayload(
      { title: '坏节', sections: [{ title: '空节' }] },
      'bad-section.json',
    )
    expect(result).toEqual({ ok: false, error: '第 1 节「空节」缺少正文' })
  })

  it('拒绝未知 format', () => {
    const result = normalizeImportPayload(
      { format: 'anke-creator-export-v9', data: { title: '未知格式' } },
      'unknown.json',
    )
    expect(result).toEqual({
      ok: false,
      error: '不支持的文件格式：anke-creator-export-v9，仅支持 anke-creator-export / anke-creator-story / anke-creator-story-v2 或无包装旧文件',
    })
  })

  it('损坏 JSON 在 parseImportText 阶段报中文错误', () => {
    expect(parseImportText('{broken', 'broken.json')).toEqual({
      ok: false,
      error: '文件不是合法的 JSON：broken.json',
    })
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run src/utils/storyImport.test.ts`

Expected: 退出码 1，输出包含 `normalizeImportPayload is not a function` 或 `parseImportText is not a function`。

- [ ] **Step 3：实现归一化**

在 `src/utils/storyImport.ts` 末尾追加：

```ts
export interface NormalizedVolumeInput {
  id: string
  title: string
  order_index: number
  extras: Record<string, unknown>
}

export interface NormalizedChapterInput {
  id: string
  volume_id: string
  title: string
  order_index: number
  extras: Record<string, unknown>
}

export interface NormalizedSectionInput {
  id: string
  chapter_id: string
  title: string
  content: string | null
  bbcode: string | null
  order_index: number
  extras: Record<string, unknown>
}

export interface NormalizedStoryInput {
  title: string
  description: string
  category: string
  cover_gradient: string
  volumes: NormalizedVolumeInput[]
  chapters: NormalizedChapterInput[]
  sections: NormalizedSectionInput[]
  world_settings: Record<string, unknown>[]
  characters: Record<string, unknown>[]
  character_relations: Record<string, unknown>[]
  outlines: Record<string, unknown>[]
  dice_history: Record<string, unknown>[]
  extras: Record<string, unknown>
}

export type NormalizeImportResult =
  | { ok: true; format: 'story-v2' | 'export' | 'story' | 'legacy'; data: NormalizedStoryInput }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function orderIndex(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function extrasOf(row: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (!known.has(key)) extras[key] = value
  }
  return extras
}

const STORY_KEYS = new Set([
  'id', 'title', 'description', 'category', 'cover_gradient', 'status',
  'created_at', 'updated_at', 'word_count', 'stats',
])
const VOLUME_KEYS = new Set(['id', 'title', 'order_index', 'story_id'])
const CHAPTER_KEYS = new Set(['id', 'title', 'order_index', 'volume_id', 'story_id', 'sections'])
const SECTION_KEYS = new Set([
  'id', 'title', 'content', 'bbcode', 'order_index', 'chapter_id', 'story_id',
  'word_count', 'created_at', 'updated_at', 'status',
])
const ROOT_KEYS = new Set([
  'format', 'version', 'exportedAt', 'data', 'story', 'title', 'description',
  'category', 'cover_gradient', 'status', 'volumes', 'chapters', 'sections',
  'world_settings', 'characters', 'character_relations', 'outlines',
  'dice_history', 'dice_stats', 'stats', 'extras',
])

export function normalizeImportPayload(raw: unknown, fileName: string): NormalizeImportResult {
  if (!isRecord(raw)) {
    return { ok: false, error: `文件不是有效的安科作品 JSON：${fileName}` }
  }
  let root: Record<string, unknown> = raw
  let format: 'story-v2' | 'export' | 'story' | 'legacy' = 'legacy'
  if (raw.format === 'anke-creator-story-v2') {
    format = 'story-v2'
  } else if (raw.format === 'anke-creator-export') {
    if (!isRecord(raw.data)) {
      return { ok: false, error: `导出文件缺少 data：${fileName}` }
    }
    root = raw.data
    format = 'export'
  } else if (raw.format === 'anke-creator-story') {
    if (!isRecord(raw.data)) {
      return { ok: false, error: `旧版文件缺少 data：${fileName}` }
    }
    root = raw.data
    format = 'story'
  } else if (typeof raw.format === 'string' && raw.format.length > 0) {
    return {
      ok: false,
      error: `不支持的文件格式：${raw.format}，仅支持 anke-creator-export / anke-creator-story / anke-creator-story-v2 或无包装旧文件`,
    }
  } else if (isRecord(raw.data) && ('title' in raw.data || 'story' in raw.data)) {
    root = raw.data
    format = 'export'
  }
  const storyRow = isRecord(root.story) ? root.story : root
  const title = text(storyRow.title).trim()
  if (!title) {
    return { ok: false, error: '文件缺少作品标题' }
  }
  const volumesRaw = asRows(root.volumes)
  const chaptersRaw = asRows(root.chapters)
  const sectionsRaw = asRows(root.sections)
  const volumes: NormalizedVolumeInput[] = volumesRaw.map((row, index) => ({
    id: text(row.id, `import-vol-${index + 1}`),
    title: text(row.title, `第${index + 1}卷`),
    order_index: orderIndex(row.order_index, index),
    extras: extrasOf(row, VOLUME_KEYS),
  }))
  if (volumes.length === 0) {
    volumes.push({ id: 'import-vol-1', title: '第一卷', order_index: 0, extras: {} })
  }
  const chapters: NormalizedChapterInput[] = chaptersRaw.map((row, index) => {
    const meta = { ...row }
    delete meta.sections
    return {
      id: text(row.id, `import-ch-${index + 1}`),
      volume_id: text(row.volume_id, volumes[0].id),
      title: text(row.title, `第${index + 1}章`),
      order_index: orderIndex(row.order_index, index),
      extras: extrasOf(meta, CHAPTER_KEYS),
    }
  })
  if (chapters.length === 0) {
    chapters.push({
      id: 'import-ch-1',
      volume_id: volumes[0].id,
      title: '第一章',
      order_index: 0,
      extras: {},
    })
  }
  const fromTop = sectionsRaw.map((row, index) => ({ row, index, chapterId: text(row.chapter_id, chapters[0].id) }))
  const fromChapters = chaptersRaw.flatMap((chapter, chapterIndex) => {
    const nested = asRows(chapter.sections)
    const chapterId = chapters[chapterIndex]?.id ?? chapters[0].id
    return nested.map((row, index) => ({ row, index, chapterId }))
  })
  const sourceSections = fromTop.length > 0 ? fromTop : fromChapters
  const sections: NormalizedSectionInput[] = []
  for (let flatIndex = 0; flatIndex < sourceSections.length; flatIndex += 1) {
    const { row, index, chapterId } = sourceSections[flatIndex]
    const content = typeof row.content === 'string' ? row.content : null
    const bbcode = typeof row.bbcode === 'string' ? row.bbcode : null
    if (!content && !bbcode) {
      return {
        ok: false,
        error: `第 ${flatIndex + 1} 节「${text(row.title, '未命名')}」缺少正文`,
      }
    }
    const knownChapter = chapters.some((chapter) => chapter.id === chapterId)
    sections.push({
      id: text(row.id, `import-sec-${flatIndex + 1}`),
      chapter_id: knownChapter ? chapterId : chapters[0].id,
      title: text(row.title, `第${flatIndex + 1}节`),
      content,
      bbcode,
      order_index: orderIndex(row.order_index, index),
      extras: extrasOf(row, SECTION_KEYS),
    })
  }
  const result: NormalizedStoryInput = {
    title,
    description: text(storyRow.description),
    category: text(storyRow.category, '未分类'),
    cover_gradient: text(storyRow.cover_gradient),
    volumes,
    chapters,
    sections,
    world_settings: asRows(root.world_settings),
    characters: asRows(root.characters),
    character_relations: asRows(root.character_relations),
    outlines: asRows(root.outlines),
    dice_history: asRows(root.dice_history),
    extras: {
      ...extrasOf(storyRow, STORY_KEYS),
      ...extrasOf(root, ROOT_KEYS),
    },
  }
  return { ok: true, format, data: result }
}

export function parseImportText(rawText: string, fileName: string): NormalizeImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return { ok: false, error: `文件不是合法的 JSON：${fileName}` }
  }
  // 保留 validateImportFormat 对两种包装格式的既有校验语义
  if (
    isRecord(parsed) &&
    (parsed.format === 'anke-creator-export' || parsed.format === 'anke-creator-story')
  ) {
    const validation = validateImportFormat(parsed)
    if (!validation.valid) {
      return { ok: false, error: validation.error ?? `文件格式不正确：${fileName}` }
    }
  }
  return normalizeImportPayload(parsed, fileName)
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run src/utils/storyImport.test.ts`

Expected: `Test Files  1 passed (1)`，新增 10 条用例连同原有用例全部通过。

- [ ] **Step 5：类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。

---

## Task 9：单文件导出与分块进度

**Files:**
- Create: `src/utils/storyExportBundle.ts`
- Test: `src/utils/storyExportBundle.test.ts`
- Modify: `src/components/pages/WorksListPage.tsx`

导出格式与 `WorksListPage.tsx:323-334` 和 `collectAnkeToWorkJson` 的输出保持一致：`format: 'anke-creator-export'`、`version: '1.1'`，实体在 `data` 下，章节内嵌 `sections[].content`；另外补 `schemaVersion: 2` 与 `appVersion: '0.1.0'`，对应 spec §4.5 的导出头字段。

- [ ] **Step 1：写导出失败测试**

```ts
// src/utils/storyExportBundle.test.ts
import { describe, expect, it } from 'vitest'
import { exportStoryBundle } from './storyExportBundle'

function makeRepo(count: number, missingId?: string) {
  const sections = Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    chapter_id: 'c1',
    title: `第${index + 1}节`,
    order_index: index,
  }))
  return {
    getStoryWithAll: async () => ({
      id: 'story-1',
      title: '导出作品',
      description: '',
      category: '测试',
      cover_gradient: '',
      word_count: 0,
      volumes: [{ id: 'v1', story_id: 'story-1', title: '第一卷', order_index: 0 }],
      chapters: [{ id: 'c1', story_id: 'story-1', volume_id: 'v1', title: '第一章', order_index: 0, sections }],
      sections: [],
      world_settings: [{ id: 'w1', story_id: 'story-1', title: '世界', content: '设定' }],
      characters: [{ id: 'ch1', story_id: 'story-1', name: '角色' }],
      character_relations: [],
      outlines: [],
      dice_history: [],
    }) as any,
    listSectionMetadata: async () => sections,
    getSectionContent: async (id: string) =>
      id === missingId ? null : `<p>正文-${id}</p>`,
  }
}

describe('exportStoryBundle', () => {
  it('把全部正文收进一个 JSON 并每 50 节回报进度', async () => {
    const messages: Array<{ current: number; total: number; message: string }> = []
    const bundle = await exportStoryBundle(makeRepo(120), 'story-1', {
      onProgress: (progress) => messages.push(progress),
      now: () => new Date('2026-11-05T00:00:00.000Z'),
    })
    expect(bundle.format).toBe('anke-creator-export')
    expect(bundle.version).toBe('1.1')
    expect(bundle.schemaVersion).toBe(2)
    expect(bundle.appVersion).toBe('0.1.0')
    expect(bundle.exportedAt).toBe('2026-11-05T00:00:00.000Z')
    expect(bundle.data.chapters[0].sections).toHaveLength(120)
    expect(bundle.data.chapters[0].sections[119].content).toBe('<p>正文-s119</p>')
    expect(bundle.data.world_settings).toHaveLength(1)
    expect(messages.filter((item) => item.current % 50 === 0).map((item) => item.current)).toEqual([50, 100])
    expect(messages[messages.length - 1]).toEqual({
      current: 120,
      total: 120,
      message: '导出完成：120/120 节',
    })
  })

  it('任一节缺少正文时抛出带章节序号的中文错误', async () => {
    const repo = makeRepo(10, 's3')
    await expect(
      exportStoryBundle(repo, 'story-1', {}),
    ).rejects.toThrow('第 4 节「第4节」缺少正文')
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run src/utils/storyExportBundle.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "./storyExportBundle"`。

- [ ] **Step 3：实现导出构造**

```ts
// src/utils/storyExportBundle.ts
import type { Chapter, SectionMeta, StoryWithAll, Volume } from '../types/story'
import type { Character, WorldSetting, CharacterRelation, Outline } from '../types'

export interface ExportSourceStory extends StoryWithAll {
  cover_gradient?: string
  word_count?: number
  character_relations?: CharacterRelation[]
  dice_history?: unknown[]
}

export interface ExportSourceRepository {
  getStoryWithAll(storyId: string): Promise<ExportSourceStory | undefined>
  listSectionMetadata(chapterId: string): Promise<SectionMeta[]>
  getSectionContent(sectionId: string): Promise<string | null>
  /** 人物关系不在 StoryWithAll 中，页面现有实现调用 db.listCharacterRelations(id) */
  listCharacterRelations?: (storyId: string) => Promise<CharacterRelation[]>
}

export interface ExportSection extends SectionMeta {
  content: string
}

export interface ExportChapter extends Chapter {
  sections: ExportSection[]
}

export interface ExportBundle {
  format: 'anke-creator-export'
  version: '1.1'
  schemaVersion: 2
  exportedAt: string
  appVersion: '0.1.0'
  data: {
    title: string
    description: string
    category: string
    word_count: number
    volumes: Volume[]
    chapters: ExportChapter[]
    world_settings: WorldSetting[]
    characters: Character[]
    character_relations: CharacterRelation[]
    outlines: Outline[]
    dice_history: unknown[]
    stats: { word_count: number; section_count: number; chapter_count: number }
  }
}

export interface ExportProgress {
  current: number
  total: number
  message: string
}

export interface ExportOptions {
  onProgress?: (progress: ExportProgress) => void
  diceHistory?: unknown[]
  now?: () => Date
}

export async function exportStoryBundle(
  repo: ExportSourceRepository,
  storyId: string,
  options: ExportOptions = {},
): Promise<ExportBundle> {
  const full = await repo.getStoryWithAll(storyId)
  if (!full) throw new Error(`作品不存在：${storyId}`)
  const total = full.chapters.reduce(
    (sum, chapter) => sum + (Array.isArray(chapter.sections) ? chapter.sections.length : 0),
    0,
  )
  let current = 0
  const chapters: ExportChapter[] = []
  for (const chapter of full.chapters) {
    const metadata = await repo.listSectionMetadata(chapter.id)
    const sections: ExportSection[] = []
    for (const meta of metadata) {
      const content = await repo.getSectionContent(meta.id)
      if (content == null) {
        throw new Error(`第 ${current + 1} 节「${meta.title}」缺少正文`)
      }
      current += 1
      const rest = { ...(meta as SectionMeta & { blocks?: unknown; bbcode?: unknown }) } as Record<string, unknown>
      delete rest.blocks
      delete rest.bbcode
      sections.push({ ...(rest as unknown as SectionMeta), content })
      if (current % 50 === 0) {
        options.onProgress?.({
          current,
          total,
          message: `正在读取正文：${current}/${total} 节`,
        })
      }
    }
    chapters.push({ ...(chapter as Chapter), sections })
  }
  options.onProgress?.({
    current,
    total,
    message: `导出完成：${current}/${total} 节`,
  })
  const now = options.now ?? (() => new Date())
  const relations = repo.listCharacterRelations
    ? await repo.listCharacterRelations(storyId)
    : (full.character_relations ?? [])
  return {
    format: 'anke-creator-export',
    version: '1.1',
    schemaVersion: 2,
    exportedAt: now().toISOString(),
    appVersion: '0.1.0',
    data: {
      title: full.title,
      description: full.description ?? '',
      category: full.category ?? '',
      word_count: full.word_count ?? 0,
      volumes: full.volumes as Volume[],
      chapters,
      world_settings: full.world_settings as WorldSetting[],
      characters: full.characters as Character[],
      character_relations: relations,
      outlines: full.outlines as Outline[],
      dice_history: options.diceHistory ?? full.dice_history ?? [],
      stats: {
        word_count: full.word_count ?? 0,
        section_count: total,
        chapter_count: chapters.length,
      },
    },
  }
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run src/utils/storyExportBundle.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  2 passed (2)`。

- [ ] **Step 5：替换 `WorksListPage.tsx` 的导出数据构造**

删除页面内手工拼装 `const exportData = { format: 'anke-creator-export', version: '1.1', ... }` 的代码块，替换为：

```ts
const bundle = await exportStoryBundle(getStoryRepository(), storyId, {
  diceHistory: useDiceHistoryStore.getState().getRecordsByStory(storyId),
  onProgress: (progress) => setExportProgress(progress.message),
})
const safeTitle = (bundle.data.title || 'anke-work').replace(/[\/:*?"<>|]/g, '_')
const result = await window.electronAPI.saveStoryAsFile(bundle, safeTitle)
if (!result.ok && !result.canceled) {
  setExportError(result.error ?? '导出失败')
  return
}
setExportProgress(null)
await refreshStories()
```

`saveStoryAsFile(data, suggestedName?)` 接收对象：主进程 `electron/ipc/story.ts:68` 会执行 `JSON.stringify(payload.data, null, 2)` 并写入文件，因此这里传 `bundle` 对象而不是预先序列化的字符串；`suggestedName` 不带扩展名，主进程会自动补 `.anke.json`（`story.ts:61`）。如果页面没有 `setExportProgress` / `setExportError`，复用页面已有的导出状态 setter；如果 `getRecordsByStory` 不存在，改用 `useDiceHistoryStore.getState().records` 并过滤 `storyId`。

- [ ] **Step 6：运行导出测试与类型检查**

Run: `npx vitest run src/utils/storyExportBundle.test.ts electron/__tests__/e2e-real-file.test.ts`

Expected: `Test Files  2 passed (2)`。

Run: `npm run typecheck`

Expected: 退出码 0。

---

## Task 10：图片解析与占位兜底

**Files:**
- Create: `src/utils/imageSrc.ts`、`src/utils/imageDebug.ts`
- Test: `src/utils/imageSrc.test.ts`、`src/utils/imageDebug.test.ts`、`src/editor/tiptap/imageBlockDom.test.ts`
- Modify: `src/editor/tiptap/imageBlockDom.ts`、`src/editor/tiptap/nodeViews.tsx`

- [ ] **Step 1：写图片解析失败测试**

```ts
// src/utils/imageSrc.test.ts
import { describe, expect, it, vi } from 'vitest'
import { resolveImageSrc } from './imageSrc'

describe('resolveImageSrc', () => {
  it('空地址返回 empty 与中文原因', async () => {
    expect(await resolveImageSrc('   ')).toEqual({ src: '', kind: 'empty', reason: '图片地址为空' })
  })

  it('https 与 data 原样通过', async () => {
    expect(await resolveImageSrc('https://example.com/a.png')).toEqual({
      src: 'https://example.com/a.png',
      kind: 'remote',
    })
    expect(await resolveImageSrc('data:image/png;base64,AA')).toEqual({
      src: 'data:image/png;base64,AA',
      kind: 'data',
    })
  })

  it('local:// 交给 IPC 读取并返回 dataUrl', async () => {
    const readAsDataUrl = vi.fn(async () => ({ ok: true, dataUrl: 'data:image/png;base64,BB' }))
    const result = await resolveImageSrc('local://abc.png', { readAsDataUrl })
    expect(readAsDataUrl).toHaveBeenCalledWith('local:///abc.png')
    expect(result).toEqual({ src: 'data:image/png;base64,BB', kind: 'local' })
  })

  it('local:// 读取失败保留规范化地址与原因', async () => {
    const readAsDataUrl = vi.fn(async () => ({ ok: false, error: '文件不存在' }))
    expect(await resolveImageSrc('local://abc.png', { readAsDataUrl })).toEqual({
      src: 'local:///abc.png',
      kind: 'local',
      reason: '文件不存在',
    })
  })

  it('Windows 绝对路径与相对路径交给 IPC', async () => {
    const readAsDataUrl = vi.fn(async () => ({ ok: true, dataUrl: 'data:image/png;base64,CC' }))
    expect(await resolveImageSrc('C:\\images\\a.png', { readAsDataUrl })).toEqual({
      src: 'data:image/png;base64,CC',
      kind: 'file',
    })
    expect(await resolveImageSrc('images/a.png', { readAsDataUrl })).toEqual({
      src: 'data:image/png;base64,CC',
      kind: 'relative',
    })
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run src/utils/imageSrc.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "./imageSrc"`。

- [ ] **Step 3：实现图片解析**

```ts
// src/utils/imageSrc.ts
export type ImageKind = 'empty' | 'data' | 'local' | 'file' | 'relative' | 'remote'

export interface ReadAsDataUrlResult {
  ok: boolean
  dataUrl?: string
  error?: string
}

export interface ResolveImageOptions {
  readAsDataUrl?: (path: string) => Promise<ReadAsDataUrlResult | undefined>
}

export interface ResolvedImage {
  src: string
  kind: ImageKind
  reason?: string
}

export async function resolveImageSrc(
  raw: string,
  options: ResolveImageOptions = {},
): Promise<ResolvedImage> {
  const src = raw.trim()
  if (!src) return { src: '', kind: 'empty', reason: '图片地址为空' }
  if (src.startsWith('data:')) return { src, kind: 'data' }
  if (/^https?:\/\//i.test(src)) return { src, kind: 'remote' }
  if (src.startsWith('local://')) {
    const normalized = src.startsWith('local:///') ? src : `local:///${src.slice('local://'.length)}`
    const result = await options.readAsDataUrl?.(normalized)
    if (result?.ok && result.dataUrl) return { src: result.dataUrl, kind: 'local' }
    return { src: normalized, kind: 'local', reason: result?.error ?? '本地图片读取失败' }
  }
  const isFile = src.startsWith('file://') || /^[A-Za-z]:\\/.test(src) || src.startsWith('\\\\')
  if (isFile) {
    const result = await options.readAsDataUrl?.(src)
    if (result?.ok && result.dataUrl) return { src: result.dataUrl, kind: 'file' }
    return { src, kind: 'file', reason: result?.error ?? '本地文件读取失败' }
  }
  const result = await options.readAsDataUrl?.(src)
  if (result?.ok && result.dataUrl) return { src: result.dataUrl, kind: 'relative' }
  return { src, kind: 'relative', reason: result?.error ?? '相对图片读取失败' }
}
```

- [ ] **Step 4：写诊断缓存失败测试**

```ts
// src/utils/imageDebug.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { clearImageEvents, getRecentImageEvents, recordImageEvent } from './imageDebug'

beforeEach(() => {
  clearImageEvents()
})

describe('imageDebug', () => {
  it('只保留最近 50 条事件', () => {
    for (let index = 0; index < 60; index += 1) {
      recordImageEvent({
        src: `local:///img-${index}.png`,
        kind: 'local',
        ok: index % 2 === 0,
        reason: index % 2 === 0 ? undefined : '读取失败',
      })
    }
    const events = getRecentImageEvents()
    expect(events).toHaveLength(50)
    expect(events[0].src).toBe('local:///img-10.png')
    expect(events[49].src).toBe('local:///img-59.png')
  })

  it('clear 清空事件', () => {
    recordImageEvent({ src: 'a', kind: 'data', ok: true })
    clearImageEvents()
    expect(getRecentImageEvents()).toEqual([])
  })
})
```

- [ ] **Step 5：实现诊断缓存**

```ts
// src/utils/imageDebug.ts
import type { ImageKind } from './imageSrc'

export interface ImageDebugEvent {
  src: string
  kind: ImageKind
  ok: boolean
  reason?: string
  time?: string
}

declare global {
  interface Window {
    __ankeImageDebug?: {
      getRecent: () => ImageDebugEvent[]
      clear: () => void
    }
  }
}

const MAX_EVENTS = 50
const events: ImageDebugEvent[] = []

export function recordImageEvent(event: ImageDebugEvent): void {
  events.push({ time: new Date().toISOString(), ...event })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

export function getRecentImageEvents(): ImageDebugEvent[] {
  return events.slice()
}

export function clearImageEvents(): void {
  events.length = 0
}

if (typeof window !== 'undefined') {
  window.__ankeImageDebug = { getRecent: getRecentImageEvents, clear: clearImageEvents }
}
```

- [ ] **Step 6：写占位兜底失败测试**

```ts
// src/editor/tiptap/imageBlockDom.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachImageErrorHandler } from './imageBlockDom'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('attachImageErrorHandler', () => {
  it('本地图片读取失败时显示文件名、原因与重新选择入口', async () => {
    const img = document.createElement('img')
    document.body.appendChild(img)
    attachImageErrorHandler(img, 'local:///missing.png', {
      reason: '文件不存在',
      onReselect: () => {},
    })
    img.dispatchEvent(new Event('error'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const hint = img.nextElementSibling as HTMLElement
    expect(hint.classList.contains('img-error-hint')).toBe(true)
    expect(hint.textContent).toContain('[图片无法加载]')
    expect(hint.textContent).toContain('missing.png')
    expect(hint.textContent).toContain('文件不存在')
    expect(hint.querySelector('.img-error-reselect')?.textContent).toBe('重新选择图片')
  })

  it('点击重新选择图片触发回调', async () => {
    const img = document.createElement('img')
    document.body.appendChild(img)
    const onReselect = vi.fn()
    attachImageErrorHandler(img, 'https://example.com/a.png', { onReselect })
    img.dispatchEvent(new Event('error'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const button = img.nextElementSibling?.querySelector('.img-error-reselect') as HTMLButtonElement
    button.click()
    expect(onReselect).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 7：运行测试，确认失败**

Run: `npx vitest run src/utils/imageDebug.test.ts src/editor/tiptap/imageBlockDom.test.ts`

Expected: 退出码 1，`imageDebug` 导入失败；占位测试找不到 `.img-error-reselect`。

- [ ] **Step 8：实现占位兜底**

```ts
// src/editor/tiptap/imageBlockDom.ts
export interface ImageErrorOptions {
  reason?: string
  fileName?: string
  onReselect?: () => void
}

function imageFileName(src: string): string {
  const clean = src.split('?')[0].split('#')[0]
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] || '未命名图片'
}

export function attachImageErrorHandler(
  img: HTMLImageElement,
  src: string,
  options: ImageErrorOptions = {},
): void {
  let fallbackTried = false
  img.addEventListener('error', async () => {
    if (src.startsWith('local://') && !fallbackTried) {
      fallbackTried = true
      try {
        const res = await window.electronAPI?.readAsDataUrl?.(src)
        if (res?.ok && res.dataUrl) {
          img.src = res.dataUrl
          return
        }
      } catch {
        // 读取失败后继续显示占位信息
      }
    }
    img.style.minHeight = '60px'
    img.style.background = 'var(--bg-hover)'
    img.alt = `图片加载失败: ${src.slice(0, 80)}`
    if (!img.nextSibling || !(img.nextSibling as HTMLElement).classList?.contains('img-error-hint')) {
      const hint = document.createElement('span')
      hint.className = 'img-error-hint'
      hint.textContent = `[图片无法加载] ${options.fileName ?? imageFileName(src)}`
      if (options.reason) hint.textContent += `：${options.reason}`
      hint.style.cssText = 'display:block;color:var(--text-muted);font-size:12px;padding:4px;'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'img-error-reselect'
      button.textContent = '重新选择图片'
      button.style.cssText = 'margin-left:8px;font-size:12px;'
      button.addEventListener('click', () => options.onReselect?.())
      hint.appendChild(button)
      img.parentNode?.insertBefore(hint, img.nextSibling)
    }
  })
  img.addEventListener('load', () => {
    const hint = img.nextElementSibling
    if (hint && (hint as HTMLElement).classList?.contains('img-error-hint')) hint.remove()
  })
}
```

- [ ] **Step 9：运行测试，确认通过**

Run: `npx vitest run src/utils/imageDebug.test.ts src/editor/tiptap/imageBlockDom.test.ts`

Expected: `Test Files  2 passed (2)`。

- [ ] **Step 10：`nodeViews.tsx` 统一走 `resolveImageSrc`**

把 `attachFallback(src)` 内的 `this.img.src = src` 与 `attachImageErrorHandler(this.img, src)` 改为：

```ts
private attachFallback(src: string): void {
  void resolveImageSrc(src, {
    readAsDataUrl: (path) => window.electronAPI?.readAsDataUrl?.(path) ?? Promise.resolve(undefined),
  }).then((resolved) => {
    this.img.src = resolved.src
    attachImageErrorHandler(this.img, resolved.src, {
      reason: resolved.reason,
      fileName: src.split(/[\\/]/).pop(),
      onReselect: () => {
        this.img.dispatchEvent(new CustomEvent('anke:image-reselect', { bubbles: true, detail: { src } }))
      },
    })
    recordImageEvent({
      src,
      kind: resolved.kind,
      ok: !resolved.reason,
      reason: resolved.reason,
    })
  })
}
```

在文件顶部加入：

```ts
import { resolveImageSrc } from '../../utils/imageSrc'
import { recordImageEvent } from '../../utils/imageDebug'
```

- [ ] **Step 11：类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。

---

## Task 11：导入写入流程与作品列表页接入

**Files:**
- Create: `src/utils/storyImportFlow.ts`
- Test: `src/utils/storyImportFlow.test.ts`
- Modify: `src/components/pages/WorksListPage.tsx`

页面保留现有 `validateImportFormat` 校验与 `unwrapExportData` 解包；归一化与落库交给 `normalizeImportPayload` + `importStoryFromRawText`，`ensureDefaultVolumeAndChapter` 继续负责建卷/章/节及其 id 映射。

- [ ] **Step 1：写导入流程失败测试**

```ts
// src/utils/storyImportFlow.test.ts
import { describe, expect, it } from 'vitest'
import { importStoryFromRawText } from './storyImportFlow'

function makeDeps() {
  const rows = { stories: [] as Array<{ id: string; title: string }>, volumes: [] as any[], chapters: [] as any[], sections: [] as any[] }
  let seq = 0
  return {
    rows,
    createStory: async (data: { title: string }) => {
      const row = { id: `story-${++seq}`, title: data.title }
      rows.stories.push(row)
      return row
    },
    createVolume: async (data: any) => {
      const row = { id: `vol-${++seq}`, ...data }
      rows.volumes.push(row)
      return row
    },
    createChapter: async (data: any) => {
      const row = { id: `ch-${++seq}`, ...data }
      rows.chapters.push(row)
      return row
    },
    createSection: async (data: any) => {
      const row = { id: `sec-${++seq}`, ...data }
      rows.sections.push(row)
      return row
    },
  }
}

describe('importStoryFromRawText', () => {
  it('从 export 包裹导入并补齐卷章', async () => {
    const deps = makeDeps()
    const raw = JSON.stringify({
      format: 'anke-creator-export',
      version: '1.1',
      data: {
        title: '导入作品',
        sections: [{ title: '第1节', content: '<p>正文</p>' }],
      },
    })
    const result = await importStoryFromRawText(raw, 'export.json', deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(deps.rows.stories).toHaveLength(1)
    expect(deps.rows.volumes).toHaveLength(1)
    expect(deps.rows.chapters).toHaveLength(1)
    expect(deps.rows.sections).toHaveLength(1)
    expect(deps.rows.sections[0].content).toBe('<p>正文</p>')
    expect(deps.rows.sections[0].chapter_id).toBe(deps.rows.chapters[0].id)
  })

  it('chapters 已存在时扁平 sections 仍全部落库', async () => {
    const deps = makeDeps()
    const raw = JSON.stringify({
      format: 'anke-creator-export',
      version: '1.1',
      data: {
        title: '章节优先',
        volumes: [{ id: 'v1', title: '第一卷', order_index: 0 }],
        chapters: [{ id: 'c1', volume_id: 'v1', title: '第一章', order_index: 0 }],
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>正文</p>' }],
      },
    })
    const result = await importStoryFromRawText(raw, 'chapters.json', deps)
    expect(result.ok).toBe(true)
    expect(deps.rows.sections).toHaveLength(1)
    expect(deps.rows.sections[0].chapter_id).toBe(deps.rows.chapters[0].id)
  })

  it('损坏 JSON 返回中文错误且不建作品', async () => {
    const deps = makeDeps()
    const result = await importStoryFromRawText('{broken', 'broken.json', deps)
    expect(result).toEqual({ ok: false, error: '文件不是合法的 JSON：broken.json' })
    expect(deps.rows.stories).toHaveLength(0)
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run src/utils/storyImportFlow.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "./storyImportFlow"`。

- [ ] **Step 3：实现导入流程**

```ts
// src/utils/storyImportFlow.ts
import {
  parseImportText,
  ensureDefaultVolumeAndChapter,
  type EnsureDefaultDeps,
  type EnsureProgressCallback,
  type NormalizedStoryInput,
} from './storyImport'

export interface ImportIdMaps {
  volumeIdMap: Record<string, string>
  chapterIdMap: Record<string, string>
  sectionIdMap: Record<string, string>
}

export interface ImportFlowOptions {
  /** 导入确认弹窗允许用户改标题时覆盖归一化标题 */
  title?: string
}

export interface ImportFlowDeps extends EnsureDefaultDeps {
  createStory: (data: {
    title: string
    description?: string
    category?: string
    cover_gradient?: string
  }) => Promise<{ id: string }>
  afterCreate?: (storyId: string, data: NormalizedStoryInput, maps: ImportIdMaps) => Promise<void>
  recomputeStoryWordCounts?: (storyId: string) => Promise<unknown>
  /** 结构写入失败时清理已创建的作品，避免留下空作品 */
  deleteStory?: (storyId: string) => Promise<unknown>
}

export type ImportFlowResult =
  | { ok: true; storyId: string; maps: ImportIdMaps }
  | { ok: false; error: string }

export async function importStoryFromRawText(
  rawText: string,
  fileName: string,
  deps: ImportFlowDeps,
  onProgress?: EnsureProgressCallback,
  options: ImportFlowOptions = {},
): Promise<ImportFlowResult> {
  const parsed = parseImportText(rawText, fileName)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const title = options.title?.trim() || parsed.data.title
  let story: { id: string }
  try {
    story = await deps.createStory({
      title,
      description: parsed.data.description || undefined,
      category: parsed.data.category || undefined,
      cover_gradient: parsed.data.cover_gradient || undefined,
    })
  } catch (error) {
    return { ok: false, error: `创建作品失败：${(error as Error).message}` }
  }
  // ensureDefaultVolumeAndChapter 在 chapters 存在时只读取 chapters[].sections，
  // 因此把归一化后的扁平 sections 按 chapter_id 重新挂回章节，避免节丢失。
  const chaptersWithSections = parsed.data.chapters.map((chapter) => ({
    ...chapter,
    sections: parsed.data.sections.filter((section) => section.chapter_id === chapter.id),
  }))
  let maps: ImportIdMaps = { volumeIdMap: {}, chapterIdMap: {}, sectionIdMap: {} }
  try {
    const created = await ensureDefaultVolumeAndChapter(
      story.id,
      { ...parsed.data, sections: [], chapters: chaptersWithSections },
      deps,
      onProgress,
    )
    maps = {
      volumeIdMap: created.volumeIdMap,
      chapterIdMap: created.chapterIdMap,
      sectionIdMap: created.sectionIdMap,
    }
    if (deps.afterCreate) await deps.afterCreate(story.id, parsed.data, maps)
  } catch (error) {
    if (deps.deleteStory) {
      try {
        await deps.deleteStory(story.id)
      } catch {
        // 清理失败不覆盖原始导入错误
      }
    }
    return { ok: false, error: `导入结构失败：${(error as Error).message}` }
  }
  if (deps.recomputeStoryWordCounts) await deps.recomputeStoryWordCounts(story.id)
  return { ok: true, storyId: story.id, maps }
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run src/utils/storyImportFlow.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  3 passed (3)`。

- [ ] **Step 5：接入 `WorksListPage.tsx` 的导入分支**

保留 `handleImportStory` 中现有的 `validateImportFormat` 校验与 `unwrapExportData` 解包：把两处 `validateImportFormat(res.data)` / `validateImportFormat(parsed)`（`WorksListPage.tsx:559`、`590`）改成只在 `format` 为 `anke-creator-export` 或 `anke-creator-story` 时调用（这两个格式的校验行为不变），其余（`anke-creator-story-v2`、无包装旧文件）直接交给 `normalizeImportPayload` 的格式白名单。两个 `setImportState`（`569`、`600`）追加 `fileName`（Electron 分支用 `'import.json'`，浏览器分支用 `file.name`），并把 `importState` 类型改为 `{ originalTitle: string; description?: string; data: any; fileName: string }`。在文件顶部补 `import { importStoryFromRawText } from '../../utils/storyImportFlow'`，然后在 `performImportStory(customTitle)` 内用下面的调用替换原有「`db.createStory` + `ensureDefaultVolumeAndChapter`」两段（后续手写实体循环保持不动）：

```ts
tick('创建作品...')
await yieldUI()
const imported = await importStoryFromRawText(
  JSON.stringify(importState.data),
  importState.fileName,
  {
    createStory: (data) => db.createStory(data),
    createVolume: (data) => db.createVolume(data),
    createChapter: (data) => db.createChapter(data),
    createSection: (data) => db.createSection(data),
    bulkCreateVolumes: typeof db.bulkCreateVolumes === 'function' ? db.bulkCreateVolumes : undefined,
    bulkCreateChapters: typeof db.bulkCreateChapters === 'function' ? db.bulkCreateChapters : undefined,
    bulkCreateSections: typeof db.bulkCreateSections === 'function' ? db.bulkCreateSections : undefined,
    deleteStory: (storyId) => db.permanentlyDeleteStory(storyId),
  },
  (current, total, msg) => tick(msg),
  { title: customTitle },
)
if (!imported.ok) throw new Error(imported.error)
const newStory = { id: imported.storyId }
const sectionIdMap = imported.maps.sectionIdMap
rollbackState.storyId = imported.storyId

tick('创建卷/章/节结构...')
await yieldUI()
```

这段替换只覆盖原函数中「`db.createStory` + `ensureDefaultVolumeAndChapter`」两段；其后的 `world_settings`、`characters`（含 variants）、`character_relations`、`outlines`、`dice_history` 写入与 `recomputeStoryWordCounts`、`loadStoriesList`、`catch` 回滚全部保持原样，继续使用 `newStory.id` 与 `sectionIdMap`（`WorksListPage.tsx:683-816`）。

`importState.data` 是 `unwrapExportData` 后的对象（没有 `format` 包装），`parseImportText` 会按「无包装旧文件」路径归一化；包装层的格式校验已由 `handleImportStory` 里的 `validateImportFormat` 完成。`db.createStory` 接收 `{ title, description, category }` 对象并返回 `{ id }`，不要写成 `useStoryStore.getState().createStory(data)`（store 签名是 `createStory(title, description?, category?)`，返回 `string`）。骰子记录继续用现有的 `addRecords`（`WorksListPage.tsx:783`），`useDiceHistoryStore` 没有 `importRecords`。

- [ ] **Step 6：运行导入相关测试与类型检查**

Run: `npx vitest run src/utils/storyImport.test.ts src/utils/storyImportFlow.test.ts electron/__tests__/e2e-real-file.test.ts`

Expected: `Test Files  3 passed (3)`。

Run: `npm run typecheck`

Expected: 退出码 0。

---

## Task 12：NGA 多域名 Referer

**Files:**
- Create: `electron/data-core/ngaReferer.ts`
- Test: `electron/__tests__/nga-referer.test.ts`
- Modify: `electron/protocol.ts`

- [ ] **Step 1：写失败测试**

```ts
// electron/__tests__/nga-referer.test.ts
import { describe, expect, it } from 'vitest'
import { buildNgaRefererHeaders, NGA_IMAGE_URL_PATTERNS } from '../data-core/ngaReferer'

describe('nga referer', () => {
  it('覆盖 nga.cn / ngabbs.com / nga.178.com / nga.com', () => {
    expect(NGA_IMAGE_URL_PATTERNS).toEqual([
      'https://*.nga.cn/*',
      'https://*.ngabbs.com/*',
      'https://*.nga.178.com/*',
      'https://*.nga.com/*',
    ])
  })

  it('构造 Referer 与 UA 头', () => {
    expect(buildNgaRefererHeaders('https://bbs.nga.cn/')).toEqual({
      Referer: 'https://bbs.nga.cn/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
  })

  it('未传 origin 时默认 bbs.nga.cn', () => {
    expect(buildNgaRefererHeaders()).toMatchObject({ Referer: 'https://bbs.nga.cn/' })
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/nga-referer.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../data-core/ngaReferer"`。

- [ ] **Step 3：实现常量与头构造**

```ts
// electron/data-core/ngaReferer.ts
export const NGA_IMAGE_URL_PATTERNS = [
  'https://*.nga.cn/*',
  'https://*.ngabbs.com/*',
  'https://*.nga.178.com/*',
  'https://*.nga.com/*',
]

const DEFAULT_REFERER = 'https://bbs.nga.cn/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export function buildNgaRefererHeaders(origin: string = DEFAULT_REFERER): Record<string, string> {
  return { Referer: origin, 'User-Agent': USER_AGENT }
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/nga-referer.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  3 passed (3)`。

- [ ] **Step 5：接线 `electron/protocol.ts`**

把 `setupNgaRefererHook()` 中原来的单域名过滤改为：

```ts
import { buildNgaRefererHeaders, NGA_IMAGE_URL_PATTERNS } from './data-core/ngaReferer'

export function setupNgaRefererHook(): void {
  const filter = { urls: NGA_IMAGE_URL_PATTERNS }
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders, ...buildNgaRefererHeaders() }
    callback({ requestHeaders: headers })
  })
}
```

保留原有的 `session.defaultSession` 导入；若 `setupNgaRefererHook` 已注册其他域名，把它们的 URL 一并追加到 `filter.urls`，不要删除。

- [ ] **Step 6：类型检查与协议测试**

Run: `npx vitest run electron/__tests__/nga-referer.test.ts`

Expected: `Test Files  1 passed (1)`。

Run: `npm run typecheck`

Expected: 退出码 0。

---

## Task 13：折叠块/引用块 schema 往返与清洗白名单

**Files:**
- Modify: `src/editor/tiptap/serialize.ts`
- Test: `src/editor/tiptap/serialize.test.ts`、`src/editor/tiptap/businessBlocks.test.ts`
- Modify: `src/editor/tiptap/TiptapEditorPane.tsx`

- [ ] **Step 1：写业务块失败测试**

```ts
// src/editor/tiptap/businessBlocks.test.ts
import { describe, expect, it } from 'vitest'
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model'
import { createAnkeSchema } from './schema'
import { sanitizeAnkeHtml, sanitizeBusinessBlocks } from './serialize'

function roundTrip(html: string): string {
  const host = document.createElement('div')
  host.innerHTML = html
  const schema = createAnkeSchema()
  const doc = PMDOMParser.fromSchema(schema).parse(host)
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content)
  const out = document.createElement('div')
  out.appendChild(fragment)
  return out.innerHTML
}

describe('business blocks', () => {
  it('折叠块 data-type / data-title / data-collapsed 往返保留', () => {
    const html =
      '<div data-type="collapse-block" data-title="点我展开" data-collapsed="false"><div class="collapse-body"><p>折叠正文</p></div></div>'
    const out = roundTrip(html)
    expect(out).toContain('data-type="collapse-block"')
    expect(out).toContain('data-title="点我展开"')
    expect(out).toContain('data-collapsed="false"')
    expect(out).toContain('折叠正文')
  })

  it('缺少 data-title / data-collapsed 时补默认值，不剥离块', () => {
    const out = sanitizeBusinessBlocks(
      '<div data-type="collapse-block"><div class="collapse-body"><p>正文</p></div></div>',
    )
    expect(out).toContain('data-type="collapse-block"')
    expect(out).toContain('data-title="折叠"')
    expect(out).toContain('data-collapsed="false"')
    expect(out).toContain('正文')
  })

  it('普通 blockquote 补成引用块并保留内容', () => {
    const out = sanitizeBusinessBlocks('<blockquote><p>引用内容</p></blockquote>')
    expect(out).toContain('data-type="quote-block"')
    expect(out).toContain('引用内容')
    expect(roundTrip(out)).toContain('引用内容')
  })

  it('sanitizeAnkeHtml 同时清理 ProseMirror 痕迹并保留业务块属性', () => {
    const out = sanitizeAnkeHtml(
      '<div data-type="collapse-block" data-title="标题" data-collapsed="true" class="ProseMirror-selectednode" contenteditable="false"><div class="collapse-body"><p>正文</p></div></div>',
    )
    expect(out).not.toContain('ProseMirror-selectednode')
    expect(out).not.toContain('contenteditable')
    expect(out).toContain('data-title="标题"')
    expect(out).toContain('data-collapsed="true"')
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run src/editor/tiptap/businessBlocks.test.ts`

Expected: 退出码 1，输出包含 `sanitizeBusinessBlocks is not a function` 或 `sanitizeAnkeHtml is not a function`。

- [ ] **Step 3：实现清洗白名单**

在 `src/editor/tiptap/serialize.ts` 末尾追加：

```ts
export function sanitizeBusinessBlocks(html: string): string {
  if (!html) return html
  const host = document.createElement('div')
  host.innerHTML = html
  host.querySelectorAll('div[data-type="collapse-block"]').forEach((element) => {
    if (!element.getAttribute('data-title')) {
      const title = element.querySelector('.collapse-title')?.textContent?.trim()
      element.setAttribute('data-title', title || '折叠')
    }
    if (!element.hasAttribute('data-collapsed')) {
      element.setAttribute('data-collapsed', 'false')
    }
  })
  host.querySelectorAll('blockquote').forEach((element) => {
    if (!element.getAttribute('data-type')) {
      element.setAttribute('data-type', 'quote-block')
    }
  })
  return host.innerHTML
}

export function sanitizeAnkeHtml(html: string): string {
  return sanitizeBusinessBlocks(stripProseMirrorArtifacts(html))
}
```

- [ ] **Step 4：把编辑器读写统一到 `sanitizeAnkeHtml`**

在 `TiptapEditorPane.tsx` 中，把所有 `stripProseMirrorArtifacts(...)` 调用替换为 `sanitizeAnkeHtml(...)`，并在 import 中加入 `sanitizeAnkeHtml`。涉及位置：外部内容同步 effect 内的 `cleaned`，以及 `handleUpdate` 里的 `cleaned`/`clean` 变量。

- [ ] **Step 5：运行业务块测试，确认通过**

Run: `npx vitest run src/editor/tiptap/businessBlocks.test.ts src/editor/tiptap/serialize.test.ts`

Expected: `Test Files  2 passed (2)`。

- [ ] **Step 6：类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。

---

## Task 14：编辑稳定性（切节 flush、撤销边界、粘贴清洗、输入法）

**Files:**
- Create: `src/editor/tiptap/contentSync.ts`
- Test: `src/editor/__tests__/contentSync.test.ts`
- Modify: `src/editor/tiptap/TiptapEditorPane.tsx`
- Test（回归）: `src/store/__tests__/loadSection.test.ts`、`src/editor/__tests__/pasteNormalize.test.ts`

- [ ] **Step 1：写同步判断失败测试**

```ts
// src/editor/__tests__/contentSync.test.ts
import { describe, expect, it } from 'vitest'
import {
  shouldApplyExternalContent,
  shouldRecreateHistory,
  shouldSkipExternalSync,
} from '../tiptap/contentSync'

describe('contentSync', () => {
  it('输入法组合期间跳过外部同步', () => {
    expect(shouldSkipExternalSync(true)).toBe(true)
    expect(
      shouldApplyExternalContent({ isComposing: true, next: '新内容', lastApplied: '旧内容' }),
    ).toBe(false)
  })

  it('内容未变化时不重复写回', () => {
    expect(
      shouldApplyExternalContent({ isComposing: false, next: '相同', lastApplied: '相同' }),
    ).toBe(false)
  })

  it('外部内容变化时允许同步并重建撤销历史', () => {
    expect(
      shouldApplyExternalContent({ isComposing: false, next: '新内容', lastApplied: '旧内容' }),
    ).toBe(true)
    expect(shouldRecreateHistory('旧内容', '新内容')).toBe(true)
    expect(shouldRecreateHistory('相同', '相同')).toBe(false)
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run src/editor/__tests__/contentSync.test.ts`

Expected: 退出码 1，输出包含 `Failed to resolve import "../tiptap/contentSync"`。

- [ ] **Step 3：实现纯函数**

```ts
// src/editor/tiptap/contentSync.ts
export function shouldSkipExternalSync(isComposing: boolean): boolean {
  return isComposing
}

export interface ExternalContentInput {
  isComposing: boolean
  next: string
  lastApplied: string
}

export function shouldApplyExternalContent(input: ExternalContentInput): boolean {
  return !input.isComposing && input.next !== input.lastApplied
}

export function shouldRecreateHistory(previousContent: string, nextContent: string): boolean {
  return previousContent !== nextContent
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run src/editor/__tests__/contentSync.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  3 passed (3)`。

- [ ] **Step 5：在 `TiptapEditorPane.tsx` 接入输入法标记**

在组件内加入：

```tsx
const composingRef = useRef(false)
```

在 `editorProps` 中加入：

```tsx
editorProps: {
  // 保留原有的 attributes / handlePaste / handleKeyDown
  handleDOMEvents: {
    compositionstart: () => {
      composingRef.current = true
      return false
    },
    compositionend: () => {
      composingRef.current = false
      return false
    },
  },
},
```

在外部内容同步的 `useEffect` 开头加入：

```tsx
if (shouldSkipExternalSync(composingRef.current)) return
const cleaned = sanitizeAnkeHtml(content ?? '')
if (!shouldApplyExternalContent({
  isComposing: composingRef.current,
  next: cleaned,
  lastApplied: lastContentRef.current,
})) {
  return
}
```

在设置新内容前加入撤销边界判断：

```tsx
if (shouldRecreateHistory(lastContentRef.current, cleaned)) {
  lastContentRef.current = cleaned
}
```

- [ ] **Step 6：确认切节 flush 与粘贴清洗回归**

Run: `npx vitest run src/store/__tests__/loadSection.test.ts src/editor/__tests__/pasteNormalize.test.ts`

Expected: `Test Files  2 passed (2)`；`loadSection` 用例确认切节前 `flushSectionContent` 已完成，`pasteNormalize` 用例确认 `data-type` 业务块在粘贴时被降级为纯文本，不产生嵌套 PM 属性。

- [ ] **Step 7：类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。

---

## Task 15：全局统计文件 `.bak` 恢复

**Files:**
- Modify: `electron/db-main.ts`
- Test: `electron/__tests__/global-json-recovery.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// electron/__tests__/global-json-recovery.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getAppPath: () => process.env.APP_ROOT || process.cwd(),
    getName: () => 'test-app',
  },
  ipcMain: { handle: () => {} },
}))

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-global-json-'))
process.env.APP_ROOT = tmpDir
const dataDir = path.join(tmpDir, 'data')

import * as db from '../db-main'

beforeEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dataDir, 'settings'), { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, 'settings', 'storage-layout.json'),
    JSON.stringify({ layout: 'bundle' }),
  )
})

describe('global json recovery', () => {
  it('story_stats.json 损坏时从 .bak 恢复并返回统计', async () => {
    const story = db.createStory({ title: '统计作品' })
    const volume = await db.createVolume({ story_id: story.id, title: '第一卷' })
    const chapter = await db.createChapter({
      story_id: story.id,
      volume_id: volume.id,
      title: '第一章',
    })
    const section = await db.createSection({
      chapter_id: chapter.id,
      title: '第1节',
      content: '<p>第一次内容</p>',
    })
    await db.setSectionContent(section.id, '<p>第二次内容更长</p>')
    const statsPath = path.join(dataDir, 'story_stats.json')
    expect(fs.existsSync(`${statsPath}.bak`)).toBe(true)

    fs.writeFileSync(statsPath, '{broken json', 'utf-8')
    const stories = db.listStoriesWithStats()
    const target = stories.find((row) => row.id === story.id)
    expect(target?.stats).toBeTruthy()
    expect(() => JSON.parse(fs.readFileSync(statsPath, 'utf-8'))).not.toThrow()
  })
})
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run electron/__tests__/global-json-recovery.test.ts`

Expected: 退出码 1，`listStoriesWithStats()` 返回的 `target.stats` 为 `undefined`（损坏的 `story_stats.json` 没有回退）。

- [ ] **Step 3：修改全局读写**

把 `electron/db-main.ts` 中的 `loadGlobalJSON` 与 `saveGlobalJSON` 替换为：

```ts
function loadGlobalJSON<T>(name: string, fallback: T): T {
  const filePath = dataFilePath(name)
  return loadJSONWithRecovery<T>(filePath, `${filePath}.bak`, fallback)
}

function saveGlobalJSON(name: string, data: unknown): void {
  const filePath = dataFilePath(name)
  saveJSONWithBackup(filePath, `${filePath}.bak`, data)
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `npx vitest run electron/__tests__/global-json-recovery.test.ts`

Expected: `Test Files  1 passed (1)`、`Tests  1 passed (1)`。

- [ ] **Step 5：运行全局相关测试与类型检查**

Run: `npx vitest run electron/__tests__/global-json-recovery.test.ts electron/__tests__/e2e-real-file.test.ts`

Expected: `Test Files  2 passed (2)`。

Run: `npm run typecheck`

Expected: 退出码 0。

---

## 验证矩阵

| 任务 | 命令 | 预期结果 |
| --- | --- | --- |
| Task 1 路径工具 | `npx vitest run electron/__tests__/per-story-paths.test.ts` | 1 个文件、3 条用例通过 |
| Task 2 原子 JSON | `npx vitest run electron/__tests__/atomic-json.test.ts` | 1 个文件、4 条用例通过 |
| Task 3 manifest | `npx vitest run electron/__tests__/story-manifest.test.ts` | 1 个文件、3 条用例通过 |
| Task 4 写队列 | `npx vitest run electron/__tests__/story-store.test.ts` | 1 个文件、6 条用例通过 |
| Task 5 迁移器 | `npx vitest run electron/__tests__/bundle-to-directory.test.ts` | 1 个文件、5 条用例通过 |
| Task 6 布局接线 | `npx vitest run electron/__tests__/storage-layout.test.ts electron/__tests__/per-story-db.test.ts` | 2 个文件全部通过 |
| Task 6 旧测试兼容 | `npx vitest run electron/__tests__/setSectionContent-single-write.test.ts electron/__tests__/section-sidecar.test.ts electron/__tests__/e2e-real-file.test.ts` | 3 个文件全部通过 |
| Task 7 仓储一致性 | `npx vitest run src/db/repository.test.ts` | 1 个文件、3 条用例通过（electron / indexeddb / memory） |
| Task 8 导入归一化 | `npx vitest run src/utils/storyImport.test.ts` | 原有用例 + 新增 10 条全部通过（含收集安科 / 旧版 `anke-creator-story` / 当前页面导出三种 fixture） |
| Task 9 单文件导出 | `npx vitest run src/utils/storyExportBundle.test.ts` | 1 个文件、2 条用例通过 |
| Task 10 图片链路 | `npx vitest run src/utils/imageSrc.test.ts src/utils/imageDebug.test.ts src/editor/tiptap/imageBlockDom.test.ts` | 3 个文件全部通过 |
| Task 11 导入流程 | `npx vitest run src/utils/storyImportFlow.test.ts src/utils/storyImport.test.ts` | 2 个文件全部通过（流程用例 3 条） |
| Task 12 NGA Referer | `npx vitest run electron/__tests__/nga-referer.test.ts` | 1 个文件、3 条用例通过 |
| Task 13 业务块往返 | `npx vitest run src/editor/tiptap/businessBlocks.test.ts src/editor/tiptap/serialize.test.ts` | 2 个文件全部通过 |
| Task 14 编辑稳定性 | `npx vitest run src/editor/__tests__/contentSync.test.ts src/store/__tests__/loadSection.test.ts src/editor/__tests__/pasteNormalize.test.ts` | 3 个文件全部通过 |
| Task 15 全局恢复 | `npx vitest run electron/__tests__/global-json-recovery.test.ts` | 1 个文件、1 条用例通过 |
| 全量静态检查 | `npm run typecheck` | 退出码 0，0 个 TypeScript 错误 |
| 全量测试 | `npm run test` | 退出码 0，所有测试文件通过 |
| 生产构建 | `npm run build` | 退出码 0，Vite 与 Electron 构建产物生成 |

### S1 完成标准

1. `npm run typecheck` 退出码 0，无 TypeScript 错误。
2. `npm run test` 全绿，Task 1–15 新增测试与既有测试全部通过。
3. 迁移前后 `volumes / chapters / sections` 数量一致；对同一作品迁移前后逐节正文哈希一致（用 `migrateStoryBundleToDirectory` 返回的 `counts` 与迁移前 `bundle.sections.length` 对比，正文文件内容与旧 bundle 对比）。
4. 导入往返一致：`anke-creator-export`（收集安科输出与当前 `WorksListPage` 导出两种 fixture，`data` 包裹、章节内嵌 `sections[].content`）、旧版 `anke-creator-story`（`data` 包裹 + 顶层 `sections`）、无包装旧文件，经 `normalizeImportPayload` → `importStoryFromRawText` 后，标题、卷章数量、节数量、每节正文均一致；内部 `anke-creator-story-v2` 作为调试导入同样可往返。
5. `storageLayout=perStory` 时作品目录包含 `manifest.json`、实体文件与 `sections/<sid>.json`，不再生成 `stories/<id>.json`；`storageLayout=bundle` 时行为与改造前一致。
6. 任一 JSON 主文件损坏时能从 `.bak` 读取；迁移失败时旧 `stories/<id>.json` 保留，成功时改名为 `.migrated.bak`。
7. 导出的 `.json` 为单文件，包含全部正文且进度最终到达 `总节数/总节数`。
