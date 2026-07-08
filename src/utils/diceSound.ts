// ============================================================
// 掷骰音效（mp3 素材）
//
// 资源：public/sounds/*.mp3（Vite 自动暴露为 /sounds/*.mp3）
// 三端通用：Electron / Capacitor Android / 纯 Web
// 用户可在 public/sounds/ 文件夹添加 mp3，在设置中切换音效
// ============================================================

import { useSettingStore } from '../store/settingStore'

let _audioCache: Map<string, HTMLAudioElement> = new Map()

function getAudio(soundName: string): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  const cached = _audioCache.get(soundName)
  if (cached) return cached
  try {
    const src = `${import.meta.env.BASE_URL}sounds/${soundName}`
    const a = new Audio(src)
    a.preload = 'auto'
    // 监听加载失败：从 cache 中移除，下次重新创建（避免 cache 中毒）
    a.addEventListener('error', () => {
      _audioCache.delete(soundName)
    })
    _audioCache.set(soundName, a)
    return a
  } catch {
    return null
  }
}

/** 播放一次掷骰音效。失败时安全 no-op。 */
export function playDiceRollSound(): void {
  try {
    const name = useSettingStore.getState().diceSoundName || 'dice-roll.mp3'
    const base = getAudio(name)
    if (!base) return
    // 每次 clone 一份播放，避免快速连掷时被打断/重头开始
    const inst = base.cloneNode(true) as HTMLAudioElement
    inst.volume = 1
    inst.currentTime = 0
    const p = inst.play()
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        // autoplay 被阻止 / 资源未就绪：吞掉异常但留诊断日志
        console.warn('[diceSound] play failed:', name, err?.name || err)
      })
    }
  } catch (e) {
    // 任何异常都吞掉
    console.warn('[diceSound] unexpected error:', e)
  }
}

/** 预热音频（应用启动时调用，提前加载减少首次播放延迟）（#4） */
export function preloadDiceSound(): void {
  if (typeof window === 'undefined') return
  getAudio('dice-roll.mp3')
}
