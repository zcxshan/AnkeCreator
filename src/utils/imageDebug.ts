import type { ImageKind } from './imageSrc'

export interface ImageDebugEvent {
  src: string
  kind: ImageKind
  ok: boolean
  reason?: string
  time?: string
}

declare global {
  interface Window {
    __ankeImageDebug?: {
      getRecent: () => ImageDebugEvent[]
      clear: () => void
    }
  }
}

const MAX_EVENTS = 50
const events: ImageDebugEvent[] = []

export function recordImageEvent(event: ImageDebugEvent): void {
  events.push({ time: new Date().toISOString(), ...event })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

export function getRecentImageEvents(): ImageDebugEvent[] {
  return events.slice()
}

export function clearImageEvents(): void {
  events.length = 0
}

if (typeof window !== 'undefined') {
  window.__ankeImageDebug = { getRecent: getRecentImageEvents, clear: clearImageEvents }
}
