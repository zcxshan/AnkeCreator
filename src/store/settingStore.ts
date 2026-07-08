// 全局设置 Store
// - imageStoreMode: 'remote' = 远端图床链 (catbox/sm.ms/0x0.st/telegraph)
//                 | 'local'  = 本地保存 (<dataRoot>/images/ + local:// 协议；打包模式为 <安装路径>/data/images/)
// - localUploadEnabled: 本地上传总开关（默认 false，强制用户在设置中显式开启）
//                       关闭时：4 个上传入口的本地上传选项禁用、LocalModeBanner 不显示、警告弹窗不弹
// - ngaCookies: NGA 登录态 Cookie 字符串（从浏览器 DevTools 复制）
// 持久化到 localStorage
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ImageStoreMode = 'remote' | 'local'

interface SettingState {
  imageStoreMode: ImageStoreMode
  setImageStoreMode: (m: ImageStoreMode) => void
  /** 本地上传总开关（默认 false）。关闭时所有本地上传入口不可用 */
  localUploadEnabled: boolean
  setLocalUploadEnabled: (v: boolean) => void
  /** NGA 登录态 Cookie 字符串（从浏览器 DevTools 复制） */
  ngaCookies: string
  setNgaCookies: (c: string) => void
  clearNgaCookies: () => void
  /** 掷骰音效开关（默认 true） */
  soundEnabled: boolean
  setSoundEnabled: (v: boolean) => void
  /** 当前选中的骰子音效文件名（默认 'dice-roll.mp3'） */
  diceSoundName: string
  setDiceSoundName: (v: string) => void
  /** 可用音效列表（Electron 启动时扫描填充） */
  availableDiceSounds: string[]
  setAvailableDiceSounds: (v: string[]) => void
}

export const useSettingStore = create<SettingState>()(
  persist(
    (set) => ({
      imageStoreMode: 'remote', // 默认远端图床
      setImageStoreMode: (m) => set({ imageStoreMode: m }),
      localUploadEnabled: false, // 默认禁用本地上传（用户在 Settings 显式开启）
      setLocalUploadEnabled: (v) => set({ localUploadEnabled: v }),
      ngaCookies: '',
      setNgaCookies: (c) => set({ ngaCookies: c }),
      clearNgaCookies: () => set({ ngaCookies: '' }),
      soundEnabled: true,
      setSoundEnabled: (v) => set({ soundEnabled: v }),
      diceSoundName: 'dice-roll.mp3',
      setDiceSoundName: (v) => set({ diceSoundName: v }),
      availableDiceSounds: ['dice-roll.mp3'],
      setAvailableDiceSounds: (v) => set({ availableDiceSounds: v }),
    }),
    {
      name: 'anke-creator-settings',
      version: 4,
      migrate: (persisted: any, version: number) => {
        // v3 → v4：新增 diceSoundName + availableDiceSounds
        if (version < 4) {
          return {
            ...persisted,
            diceSoundName: 'dice-roll.mp3',
            availableDiceSounds: ['dice-roll.mp3'],
          }
        }
        return persisted
      },
    },
  ),
)
