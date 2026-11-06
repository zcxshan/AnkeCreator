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
