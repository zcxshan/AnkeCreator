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
