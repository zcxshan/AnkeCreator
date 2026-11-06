import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { repairEmptySectionContent } from '../data-core/sectionRepair'

let dataDir = ''
let storyDir = ''

function writeSection(sectionId: string, content: string | null, generation = 1) {
  fs.mkdirSync(path.join(storyDir, 'sections'), { recursive: true })
  fs.writeFileSync(
    path.join(storyDir, 'sections', `${sectionId}.json`),
    JSON.stringify({
      schemaVersion: 2,
      generation,
      updatedAt: new Date().toISOString(),
      data: { id: sectionId, content, bbcode: null, word_count: 100, updated_at: '2026-01-01' },
    }),
    'utf-8',
  )
  const manifestPath = path.join(storyDir, 'manifest.json')
  const manifest = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, any>)
    : {
        schemaVersion: 2,
        generation: 1,
        updatedAt: new Date().toISOString(),
        files: {},
        sections: {},
      }
  manifest.sections[sectionId] = { path: `sections/${sectionId}.json`, generation }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8')
}

function writeSidecar(sectionId: string, content: string | null, bbcode: string | null = null) {
  fs.mkdirSync(path.join(dataDir, 'sections'), { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, 'sections', `${sectionId}.json`),
    JSON.stringify({ id: sectionId, content, bbcode, word_count: 100 }),
    'utf-8',
  )
}

function readSection(sectionId: string) {
  const file = path.join(storyDir, 'sections', `${sectionId}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    generation: number
    data: { content: string | null; bbcode: string | null; word_count: number }
  }
}

describe('repairEmptySectionContent', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-section-repair-'))
    storyDir = path.join(dataDir, 'stories', 'story-1')
  })

  afterEach(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* noop */
    }
  })

  it('把侧车的正文回填到作品目录，并保留 .bak', () => {
    writeSection('sec-1', null)
    writeSidecar('sec-1', '<p>完整正文</p>', '[b]正文[/b]')

    const result = repairEmptySectionContent({ dataDir })
    expect(result.repaired).toBe(1)

    const after = readSection('sec-1')
    expect(after.data.content).toBe('<p>完整正文</p>')
    expect(after.data.bbcode).toBe('[b]正文[/b]')
    expect(after.generation).toBe(2)
    expect(fs.existsSync(path.join(storyDir, 'sections', 'sec-1.json.bak'))).toBe(true)
  })

  it('幂等：第二次运行不再修改', () => {
    writeSection('sec-1', null)
    writeSidecar('sec-1', '<p>x</p>')

    expect(repairEmptySectionContent({ dataDir }).repaired).toBe(1)
    const second = repairEmptySectionContent({ dataDir })
    expect(second.repaired).toBe(0)
    expect(readSection('sec-1').generation).toBe(2)
  })

  it('不覆盖已有正文；侧车缺失时跳过', () => {
    writeSection('sec-1', '<p>已有</p>')
    writeSection('sec-2', null)

    const result = repairEmptySectionContent({ dataDir })
    expect(result.repaired).toBe(0)
    expect(readSection('sec-1').data.content).toBe('<p>已有</p>')
  })
})
