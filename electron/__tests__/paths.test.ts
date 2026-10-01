// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const { app } = vi.hoisted(() => ({
  app: { isPackaged: true, getPath: vi.fn(), getAppPath: vi.fn() },
}))
vi.mock('electron', () => ({ app }))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const originalExecPath = Object.getOwnPropertyDescriptor(process, 'execPath')!
let root: string
let installDir: string
let appData: string
let paths: typeof import('../paths')

beforeEach(async () => {
  vi.resetModules()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-paths-'))
  installDir = path.join(root, 'Anke.app', 'Contents', 'MacOS')
  appData = path.join(root, 'Library', 'Application Support')
  fs.mkdirSync(installDir, { recursive: true })
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'execPath', { value: path.join(installDir, 'Anke') })
  vi.stubEnv('APP_ROOT', root)
  app.isPackaged = true
  app.getPath.mockImplementation((name: string) => {
    if (name !== 'appData') throw new Error(`Unexpected path: ${name}`)
    return appData
  })
  app.getAppPath.mockReturnValue(root)
  paths = await import('../paths')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  Object.defineProperty(process, 'execPath', originalExecPath)
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('platform data storage', () => {
  it('stores packaged macOS data outside the app bundle', () => {
    const expected = path.join(appData, 'com.shanshian.ankecreator', 'data')
    expect(paths.getDataRoot()).toBe(expected)
    expect(fs.existsSync(expected)).toBe(true)
    expect(paths.getImagesDir()).toBe(path.join(expected, 'images'))
    expect(paths.getUserSoundsDir()).toBe(path.join(expected, 'sounds'))
    expect(paths.isDataRootFallback()).toBe(false)
    expect(fs.existsSync(path.join(installDir, 'data'))).toBe(false)
  })

  it('keeps saved stories when a macOS app is replaced or moved', async () => {
    const storyFile = path.join(paths.getStoriesDir(), 'test.json')
    fs.writeFileSync(storyFile, JSON.stringify({ title: 'Saved story' }))
    Object.defineProperty(process, 'execPath', {
      value: path.join(root, 'replacement', 'Anke.app', 'Contents', 'MacOS', 'Anke'),
    })
    vi.resetModules()
    const restarted = await import('../paths')
    expect(path.join(restarted.getStoriesDir(), 'test.json')).toBe(storyFile)
    restarted.migrateFromUserDataIfNeeded()
    expect(JSON.parse(fs.readFileSync(storyFile, 'utf8')).title).toBe('Saved story')
    expect(fs.existsSync(path.join(restarted.getDataDir(), '.migrated-from-appdata'))).toBe(false)
  })

  it('keeps development data in the project', () => {
    app.isPackaged = false
    expect(paths.getDataRoot()).toBe(path.join(root, 'data'))
  })

  it('preserves Windows portable storage', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect(paths.getDataRoot()).toBe(path.join(installDir, 'data'))
    expect(paths.isDataRootFallback()).toBe(false)
  })

  it('preserves the Windows fallback for an unwritable install directory', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const blocked = path.join(root, 'blocked')
    fs.writeFileSync(blocked, 'not a directory')
    Object.defineProperty(process, 'execPath', { value: path.join(blocked, 'Anke.exe') })
    expect(paths.getDataRoot()).toBe(path.join(appData, 'com.shanshian.ankecreator', 'data'))
    expect(paths.isDataRootFallback()).toBe(true)
  })
})
