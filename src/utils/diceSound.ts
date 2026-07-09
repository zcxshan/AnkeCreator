// ============================================================
// 掷骰音效（mp3 素材）
//
// 数据源优先级（运行时解析）：
//   1. 用户上传的 mp3（仅 Electron）：从 <dataRoot>/sounds/ 通过 IPC 读取为 data URL
//   2. 内置 mp3（public/sounds/）：Vite 自动暴露为 /sounds/*.mp3
//
// 选择规则：
//   - diceSoundName 命中的文件如果在用户目录存在 → 用 data URL 播放
//   - 否则回退到内置 ${BASE_URL}sounds/${name}
// ============================================================

import { useSettingStore } from '../store/settingStore'
import { isElectron } from './platform'

let _audioCache: Map<string, HTMLAudioElement> = new Map()

/**
 * 解析音频源 URL：优先用 IPC 读取用户上传的文件，回退到内置静态路径
 */
async function resolveAudioSrc(soundName: string): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (isElectron) {
    try {
      const res = await window.electronAPI.getDiceSoundDataUrl(soundName)
      if (res?.ok && res.dataUrl) return res.dataUrl
    } catch {
      // IPC 失败时回退到内置
    }
  }
  // 回退到内置（Vite 静态资源）
  return `${import.meta.env.BASE_URL}sounds/${soundName}`
}

function getAudio(soundName: string, src: string): HTMLAudioElement {
  const cached = _audioCache.get(soundName)
  if (cached && cached.src === src) return cached
  try {
    const a = new Audio(src)
    a.preload = 'auto'
    // 监听加载失败：从 cache 中移除，下次重新创建（避免 cache 中毒）
    a.addEventListener('error', () => {
      _audioCache.delete(soundName)
    })
    _audioCache.set(soundName, a)
    return a
  } catch {
    // 失败时返回静音 audio 兜底
    return new Audio()
  }
}

/** 播放一次掷骰音效。失败时安全 no-op。 */
export async function playDiceRollSound(): Promise<void> {
  try {
    const name = useSettingStore.getState().diceSoundName || 'dice-roll.mp3'
    const src = await resolveAudioSrc(name)
    if (!src) return
    const base = getAudio(name, src)
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
export async function preloadDiceSound(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const name = useSettingStore.getState().diceSoundName || 'dice-roll.mp3'
    const src = await resolveAudioSrc(name)
    if (src) getAudio(name, src)
  } catch {
    // 预热失败不报错
  }
}
