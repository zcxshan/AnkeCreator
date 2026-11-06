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
