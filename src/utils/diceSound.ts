// ============================================================
// 掷骰音效（mp3 素材）
//
// 资源：public/sounds/dice-roll.mp3（Vite 自动暴露为 /sounds/dice-roll.mp3）
// 三端通用：Electron / Capacitor Android / 纯 Web
// ============================================================

const SRC = '/sounds/dice-roll.mp3';

let _audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!_audio) {
    try {
      const a = new Audio(SRC);
      a.preload = 'auto';
      _audio = a;
    } catch {
      return null;
    }
  }
  return _audio;
}

/** 播放一次掷骰音效。失败时安全 no-op。 */
export function playDiceRollSound(): void {
  try {
    const base = getAudio();
    if (!base) return;
    // 每次 clone 一份播放，避免快速连掷时被打断/重头开始
    const inst = base.cloneNode(true) as HTMLAudioElement;
    inst.volume = 1;
    inst.currentTime = 0;
    const p = inst.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // autoplay 被阻止 / 资源未就绪：吞掉异常
      });
    }
  } catch {
    // 任何异常都吞掉
  }
}
