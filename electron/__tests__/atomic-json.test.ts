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
