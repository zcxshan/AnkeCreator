// electron/data-core/storyStore.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readJsonWithBak, writeJsonAtomic } from './atomicJson'
import {
  readEntityFromManifest,
  readStoryManifest,
  writeStoryManifest,
  type ManifestEntry,
  type StoryEntityName,
  type StoryManifest,
} from './manifest'

export interface SectionFileRow extends Record<string, unknown> {
  id: string
}

export interface DirectoryPayload {
  story: Record<string, unknown>
  volumes: Record<string, unknown>[]
  chapters: {
    list: Record<string, unknown>[]
    sections: Record<string, unknown>[]
  }
  world: Record<string, unknown>
  characters: Record<string, unknown>[]
  dice: Record<string, unknown>
  sections: SectionFileRow[]
}

export interface StoryStoreOps {
  writeAtomic?: typeof writeJsonAtomic
}

const queues = new Map<string, Promise<unknown>>()

export function enqueueStoryWrite<T>(
  storyKey: string,
  task: () => T | Promise<T>,
): Promise<T> {
  const previous = queues.get(storyKey) ?? Promise.resolve()
  const next = previous.then(task, task)
  queues.set(
    storyKey,
    next.catch(() => undefined),
  )
  return next
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function entityFiles(payload: DirectoryPayload): Array<[StoryEntityName, string, unknown]> {
  return [
    ['story', 'story.json', payload.story],
    ['volumes', 'volumes.json', payload.volumes],
    ['chapters', 'chapters.json', payload.chapters],
    ['world', 'world.json', payload.world],
    ['characters', 'characters.json', payload.characters],
    ['dice', 'dice.json', payload.dice],
  ]
}

export function writeStoryDirectoryAt(
  storyRoot: string,
  payload: DirectoryPayload,
  ops: StoryStoreOps = {},
): string[] {
  const writeAtomic = ops.writeAtomic ?? writeJsonAtomic
  const oldManifest = readStoryManifest(storyRoot)
  fs.mkdirSync(path.join(storyRoot, 'sections'), { recursive: true })
  const written: string[] = []
  const files = {} as Record<StoryEntityName, ManifestEntry>

  for (const [name, fileName, data] of entityFiles(payload)) {
    const file = path.join(storyRoot, fileName)
    const previousEntry = oldManifest?.files[name]
    const existing = readJsonWithBak(file).value
    if (previousEntry && existing !== null && sameJson(existing, data)) {
      files[name] = previousEntry
      continue
    }
    const generation = (previousEntry?.generation ?? 0) + 1
    writeAtomic(file, data, generation)
    written.push(fileName)
    files[name] = {
      path: fileName,
      generation,
      count: Array.isArray(data) ? data.length : undefined,
    }
  }

  const sections: Record<string, ManifestEntry> = {}
  for (const section of payload.sections) {
    const relative = path.posix.join('sections', `${section.id}.json`)
    const file = path.join(storyRoot, relative)
    const previousEntry = oldManifest?.sections[section.id]
    const existing = readJsonWithBak(file).value
    if (previousEntry && existing !== null && sameJson(existing, section)) {
      sections[section.id] = previousEntry
      continue
    }
    const generation = (previousEntry?.generation ?? 0) + 1
    writeAtomic(file, section, generation)
    written.push(relative)
    sections[section.id] = { path: relative, generation }
  }

  if (oldManifest) {
    const keep = new Set(payload.sections.map((section) => section.id))
    for (const sectionId of Object.keys(oldManifest.sections)) {
      if (keep.has(sectionId)) continue
      const file = path.join(storyRoot, 'sections', `${sectionId}.json`)
      if (fs.existsSync(file)) fs.rmSync(file)
      if (fs.existsSync(`${file}.bak`)) fs.rmSync(`${file}.bak`)
      written.push(`sections/${sectionId}.json`)
    }
  }

  const manifest: StoryManifest = {
    schemaVersion: 2,
    generation: (oldManifest?.generation ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    files,
    sections,
  }
  writeStoryManifest(storyRoot, manifest)
  written.push('manifest.json')
  return written
}

export function readStoryDirectoryAt(storyRoot: string): DirectoryPayload | null {
  const manifest = readStoryManifest(storyRoot)
  if (!manifest) return null
  const story = readEntityFromManifest<Record<string, unknown>>(storyRoot, manifest, 'story')
  if (!story) return null
  const volumes = readEntityFromManifest<Record<string, unknown>[]>(storyRoot, manifest, 'volumes')
  const chapters = readEntityFromManifest<DirectoryPayload['chapters']>(
    storyRoot,
    manifest,
    'chapters',
  )
  const world = readEntityFromManifest<Record<string, unknown>>(storyRoot, manifest, 'world')
  const characters = readEntityFromManifest<Record<string, unknown>[]>(
    storyRoot,
    manifest,
    'characters',
  )
  const dice = readEntityFromManifest<Record<string, unknown>>(storyRoot, manifest, 'dice')
  if (!volumes || !chapters || !world || !characters || !dice) return null
  return {
    story,
    volumes,
    chapters,
    world,
    characters,
    dice,
    sections: [],
  }
}
