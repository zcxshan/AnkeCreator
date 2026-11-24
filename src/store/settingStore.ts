// 全局设置 Store
// - imageStoreMode: 'remote' = 远端图床链 (catbox/sm.ms/0x0.st/telegraph)
//                 | 'local'  = 本地保存 (<dataRoot>/images/ + local:// 协议；打包模式为 <安装路径>/data/images/)
// - localUploadEnabled: 本地上传总开关（默认 false，强制用户在设置中显式开启）
//                       关闭时：4 个上传入口的本地上传选项禁用、LocalModeBanner 不显示、警告弹窗不弹
// - ngaCookies: NGA 登录态 Cookie 字符串（从浏览器 DevTools 复制）
// 持久化到 localStorage
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_NGA_URL_CONFIG,
  DEFAULT_NGA_URL_PREFIX,
  normalizeNgaUrlPrefix,
  type NgaUrlPattern,
  type NgaUrlPrefixItem,
} from '../utils/ngaUrl'

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
  /** NGA 相对 URL（./mon_xxx）补全用的头部，默认 https://img.nga.cn/attachments（= 第一条前缀） */
  ngaUrlPrefix: string
  setNgaUrlPrefix: (v: string) => void
  /** NGA url 匹配规则（正则），与前缀是多对多关系：命中任一规则即按前缀顺序补全 */
  ngaUrlPatterns: NgaUrlPattern[]
  setNgaUrlPatterns: (patterns: NgaUrlPattern[]) => void
  /** NGA url 补全前缀列表，按顺序尝试（前一条失效自动换下一个） */
  ngaUrlPrefixes: NgaUrlPrefixItem[]
  setNgaUrlPrefixes: (prefixes: NgaUrlPrefixItem[]) => void
  /** 编辑界面是否自动为不完整 url 补前缀 */
  ngaAutoPrefixEnabled: boolean
  setNgaAutoPrefixEnabled: (v: boolean) => void
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
      ngaUrlPrefix: DEFAULT_NGA_URL_PREFIX,
      setNgaUrlPrefix: (v) => set({ ngaUrlPrefix: v }),
      ngaUrlPatterns: DEFAULT_NGA_URL_CONFIG.patterns,
      setNgaUrlPatterns: (patterns) => {
        const list = patterns.length > 0 ? patterns : DEFAULT_NGA_URL_CONFIG.patterns
        set({ ngaUrlPatterns: list })
      },
      ngaUrlPrefixes: DEFAULT_NGA_URL_CONFIG.prefixes,
      setNgaUrlPrefixes: (prefixes) => {
        const list = prefixes.length > 0 ? prefixes : DEFAULT_NGA_URL_CONFIG.prefixes
        set({
          ngaUrlPrefixes: list,
          // 主前缀跟随第一条前缀，兼容旧的单前缀调用方
          ngaUrlPrefix: normalizeNgaUrlPrefix(list[0]?.prefix ?? DEFAULT_NGA_URL_PREFIX),
        })
      },
      ngaAutoPrefixEnabled: true,
      setNgaAutoPrefixEnabled: (v) => set({ ngaAutoPrefixEnabled: v }),
      soundEnabled: true,
      setSoundEnabled: (v) => set({ soundEnabled: v }),
      diceSoundName: 'dice-roll.mp3',
      setDiceSoundName: (v) => set({ diceSoundName: v }),
      availableDiceSounds: ['dice-roll.mp3'],
      setAvailableDiceSounds: (v) => set({ availableDiceSounds: v }),
    }),
    {
      name: 'anke-creator-settings',
      version: 7,
      migrate: (persisted: any, version: number) => {
        let next = persisted
        // v3 → v4：新增 diceSoundName + availableDiceSounds
        if (version < 4) {
          next = {
            ...next,
            diceSoundName: 'dice-roll.mp3',
            availableDiceSounds: ['dice-roll.mp3'],
          }
        }
        // v4 → v5：新增 NGA url 头部
        if (version < 5) {
          next = {
            ...next,
            ngaUrlPrefix: DEFAULT_NGA_URL_PREFIX,
          }
        }
        // v5 → v6：单前缀升级为「规则列表 + 自动补全开关」
        if (version < 6) {
          const legacyPrefix = normalizeNgaUrlPrefix(next?.ngaUrlPrefix)
          next = {
            ...next,
            ngaUrlPrefix: legacyPrefix,
            ngaUrlRules: [
              {
                id: 'default-mon',
                pattern: 'mon_',
                prefix: legacyPrefix,
                enabled: true,
              },
            ],
            ngaAutoPrefixEnabled: true,
          }
        }
        // v6 → v7：「规则 + 前缀」一对一行升级为多对多（规则列表 + 前缀列表）
        if (version < 7) {
          const legacyRules: any[] = Array.isArray(next?.ngaUrlRules) ? next.ngaUrlRules : []
          // 旧规则中被逐条停用的项不再迁移
          const active = legacyRules.filter((rule) => rule && rule.enabled !== false)

          const patternKeys = new Set<string>()
          const patterns: NgaUrlPattern[] = []
          for (const rule of active) {
            const source = (rule?.pattern ?? '').trim()
            if (!source || patternKeys.has(source)) continue
            patternKeys.add(source)
            patterns.push({ id: rule.id || `pattern-${patterns.length + 1}`, pattern: source })
          }

          const prefixKeys = new Set<string>()
          const prefixes: NgaUrlPrefixItem[] = []
          for (const rule of active) {
            const raw = (rule?.prefix ?? '').trim()
            if (!raw) continue
            const base = normalizeNgaUrlPrefix(raw)
            if (prefixKeys.has(base)) continue
            prefixKeys.add(base)
            prefixes.push({
              id: rule.id ? `${rule.id}-prefix` : `prefix-${prefixes.length + 1}`,
              prefix: base,
            })
          }

          if (patterns.length === 0) patterns.push(...DEFAULT_NGA_URL_CONFIG.patterns)
          if (prefixes.length === 0) {
            prefixes.push(...DEFAULT_NGA_URL_CONFIG.prefixes)
          } else if (!prefixKeys.has('https://img.nga.178.com/attachments')) {
            // 新默认前缀补充为第二条回退前缀
            prefixes.push({ id: 'prefix-nga-178', prefix: 'https://img.nga.178.com/attachments' })
          }

          next = {
            ...next,
            ngaUrlPatterns: patterns,
            ngaUrlPrefixes: prefixes,
            ngaUrlPrefix: normalizeNgaUrlPrefix(prefixes[0]?.prefix ?? DEFAULT_NGA_URL_PREFIX),
            ngaAutoPrefixEnabled: next?.ngaAutoPrefixEnabled !== false,
          }
        }
        return next
      },
    },
  ),
)
