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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-image-move-'))
process.env.APP_ROOT = tmpDir
const dataDir = path.join(tmpDir, 'data')
const imagesDir = path.join(dataDir, 'images')

import * as db from '../db-main'

beforeEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.mkdirSync(imagesDir, { recursive: true })
})

describe('moveImageLibraryItem 磁盘搬移', () => {
  it('拖入文件夹会真正移动磁盘文件并更新 url', () => {
    const folder = db.createImageLibraryFolder({ name: 'album', parentId: null })
    fs.writeFileSync(path.join(imagesDir, 'pic.png'), 'x')
    const item = db.addImageLibraryItem({
      folderId: null,
      url: 'local:///pic.png',
      filename: 'pic.png',
      source: 'local',
    })

    const moved = db.moveImageLibraryItem(item.id, folder.id)
    expect(moved?.folderId).toBe(folder.id)
    expect(moved?.url).toBe(`local:///album/pic.png`)
    expect(fs.existsSync(path.join(imagesDir, 'album', 'pic.png'))).toBe(true)
    expect(fs.existsSync(path.join(imagesDir, 'pic.png'))).toBe(false)
  })

  it('拖回根目录会把文件移回 images/，同名自动加后缀', () => {
    const folder = db.createImageLibraryFolder({ name: 'album', parentId: null })
    fs.writeFileSync(path.join(imagesDir, 'pic.png'), 'x')
    const item = db.addImageLibraryItem({
      folderId: folder.id,
      url: 'local:///album/pic.png',
      filename: 'pic.png',
      source: 'local',
    })
    fs.renameSync(path.join(imagesDir, 'pic.png'), path.join(imagesDir, 'album', 'pic.png'))
    fs.writeFileSync(path.join(imagesDir, 'pic.png'), 'root')

    const moved = db.moveImageLibraryItem(item.id, null)
    expect(moved?.folderId).toBe(null)
    expect(moved?.url).toBe('local:///pic (1).png')
    expect(fs.existsSync(path.join(imagesDir, 'pic (1).png'))).toBe(true)
    expect(fs.existsSync(path.join(imagesDir, 'album', 'pic.png'))).toBe(false)
  })

  it('非法 local url 只更新 DB，不抛错', () => {
    const folder = db.createImageLibraryFolder({ name: 'album', parentId: null })
    const item = db.addImageLibraryItem({
      folderId: null,
      url: 'local:///../escape.png',
      filename: 'escape.png',
      source: 'local',
    })
    expect(() => db.moveImageLibraryItem(item.id, folder.id)).not.toThrow()
  })
})
