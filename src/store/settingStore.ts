// 全局设置 Store
// - imageStoreMode: 'remote' = 远端图床链 (catbox/sm.ms/0x0.st/telegraph)
//                 | 'local'  = 本地保存 (Electron userData/images/ + local:// 协议)
// - ngaCookies: NGA 登录态 Cookie 字符串（从浏览器 DevTools 复制）
// 持久化到 localStorage
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ImageStoreMode = 'remote' | 'local'

interface SettingState {
  imageStoreMode: ImageStoreMode
  setImageStoreMode: (m: ImageStoreMode) => void
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
