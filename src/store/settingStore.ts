// 全局设置 Store
// - imageStoreMode: 'remote' = 远端图床链 (catbox/sm.ms/0x0.st/telegraph)
//                 | 'local'  = 本地保存 (Electron userData/images/ + local:// 协议)
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
    }),
    {
      name: 'anke-creator-settings',
      version: 2,
    },
  ),
)
