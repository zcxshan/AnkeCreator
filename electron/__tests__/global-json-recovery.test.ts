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
    expect(target).toBeTruthy()
    expect(target?.sectionCount).toBeGreaterThan(0)
    expect(target?.wordCount).toBeGreaterThan(0)
    expect(() => JSON.parse(fs.readFileSync(statsPath, 'utf-8'))).not.toThrow()
  })
})
