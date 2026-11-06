// electron/data-core/atomicJson.ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface JsonEnvelope<T> {
  schemaVersion: 2
  generation: number
  updatedAt: string
  data: T
}

export interface ReadWithBakResult<T> {
  value: T | null
  source: 'main' | 'bak' | 'missing'
}

function replaceAtomically(filePath: string, payload: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, payload, 'utf-8')
  const fd = fs.openSync(tmp, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, filePath)
}

export function writeJsonAtomic<T>(
  filePath: string,
  data: T,
  generation: number,
  now: Date = new Date(),
): void {
  const bak = `${filePath}.bak`
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, bak)
  }
  const envelope: JsonEnvelope<T> = {
    schemaVersion: 2,
    generation,
    updatedAt: now.toISOString(),
    data,
  }
  replaceAtomically(filePath, JSON.stringify(envelope))
}

export function writeRawJsonAtomic(filePath: string, data: unknown): void {
  replaceAtomically(filePath, JSON.stringify(data))
}

export function readJsonWithBak<T>(
  filePath: string,
  expectedGeneration?: number,
): ReadWithBakResult<T> {
  const bak = `${filePath}.bak`
  for (const [candidate, source] of [
    [filePath, 'main'],
    [bak, 'bak'],
  ] as const) {
    if (!fs.existsSync(candidate)) continue
    try {
      const env = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as JsonEnvelope<T>
      if (env?.schemaVersion !== 2 || typeof env.generation !== 'number') continue
      if (expectedGeneration !== undefined && env.generation !== expectedGeneration) continue
      if (source === 'bak') {
        try {
          fs.copyFileSync(bak, filePath)
        } catch {
          // 恢复主文件失败不影响本次读取，下一次写入会重新生成 .bak
        }
      }
      return { value: env.data, source }
    } catch {
      // 当前候选损坏，继续尝试 .bak
    }
  }
  return { value: null, source: 'missing' }
}
