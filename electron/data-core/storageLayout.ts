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
