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

  it('作品目录 content 为 null 时回退全局侧车（导入正文空白修复）', async () => {
    const story = db.createStory({ title: '侧车回退' })
    const volume = await db.createVolume({ story_id: story.id, title: '第一卷' })
    const chapter = await db.createChapter({
      story_id: story.id,
      volume_id: volume.id,
      title: '第一章',
    })
    const section = await db.createSection({ chapter_id: chapter.id, title: '第1节' })
    // 模拟导入链路：正文只写进全局侧车，作品目录里是 null
    fs.mkdirSync(path.join(dataDir, 'sections'), { recursive: true })
    fs.writeFileSync(
      path.join(dataDir, 'sections', `${section.id}.json`),
      JSON.stringify({
        id: section.id,
        content: '<p>来自侧车的正文</p>',
        bbcode: '[b]侧车[/b]',
        word_count: 10,
      }),
      'utf-8',
    )

    expect(db.getSectionContent(section.id)).toBe('<p>来自侧车的正文</p>')
    expect(db.getSectionBBCode(section.id)).toBe('[b]侧车[/b]')
  })
})
