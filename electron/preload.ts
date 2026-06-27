import { contextBridge, ipcRenderer } from 'electron'
import type { GululuResult, NgaResult } from './searchAnke'

// ============================================================
// 通过 contextBridge 暴露给渲染进程的 API
// ============================================================

// 窗口控制（原有）
const windowAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
}

// 图片操作（sm.ms 图床上传 / 本地保存）
const imageAPI = {
  select: (): Promise<{ buffer: string; filename: string; mimeType: string } | null> =>
    ipcRenderer.invoke('image:select'),
  upload: (payload: { buffer: string; filename: string; mimeType: string }): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('image:upload', payload),
  saveLocal: (payload: { buffer: string; filename: string; mimeType: string }): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('image:saveLocal', payload),
  openImageFolder: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('image:openFolder'),
}

// NGA 安价收集
const ngaAPI = {
  collect: (payload: {
    url: string;
    startFloor: number;
    endFloor: number;
    prefix: string;
    authorid?: string;
    matchMode?: string;
    cookies?: string;
    retryPages?: number[];
  }): Promise<{
    ok: boolean;
    items: { floor: number; author: string; uid?: string; content: string }[];
    totalPages: number;
    error?: string;
    failedPages?: number[];
    actualMaxFloor?: number;
  }> => ipcRenderer.invoke('nga:collect', payload),
  cancelCollect: (taskId?: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nga:collect:cancel', taskId),
  pauseCollect: (taskId?: number, paused?: boolean): Promise<{ ok: boolean; paused: boolean }> =>
    ipcRenderer.invoke('nga:collect:pause', taskId, paused),
  onCollectProgress: (
    callback: (progress: {
      taskId: number;
      current: number;
      total: number;
      phase: 'starting' | 'fetching' | 'parsing' | 'filtering' | 'done' | 'error' | 'cancelled' | 'paused';
      message: string;
      itemsFound?: number;
    }) => void,
  ): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      progress: {
        taskId: number;
        current: number;
        total: number;
        phase: string;
        message: string;
        itemsFound?: number;
      },
    ) => {
      callback(progress as any)
    }
    ipcRenderer.on('nga:collect:progress', listener)
    return () => ipcRenderer.removeListener('nga:collect:progress', listener)
  },
  fetchThreadInfo: (
    url: string,
    cookies?: string,
  ): Promise<{
    ok: boolean;
    totalPages?: number;
    totalFloors?: number;
    error?: string;
  }> => ipcRenderer.invoke('nga:fetchThreadInfo', url, cookies),
}

// ============================================================
// 数据库 API
// 所有方法均为 Promise，对应主进程中 db-main.ts 的同步函数
// 数据保存到 userData/AnkeCreatorData
// ============================================================
const dbAPI = {
  // Story
  listStories: (): Promise<any[]> => ipcRenderer.invoke('db:list-stories'),
  listStoriesWithStats: (): Promise<any[]> => ipcRenderer.invoke('db:list-stories-with-stats'),
  getStory: (id: string): Promise<any> => ipcRenderer.invoke('db:get-story', id),
  createStory: (data: { title: string; description?: string; category?: string }): Promise<any> =>
    ipcRenderer.invoke('db:create-story', data),
  updateStory: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-story', id, patch),
  deleteStory: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-story', id),

  // Trash / Recycle Bin
  softDeleteStory: (id: string): Promise<boolean> => ipcRenderer.invoke('db:soft-delete-story', id),
  restoreStory: (id: string): Promise<boolean> => ipcRenderer.invoke('db:restore-story', id),
  permanentlyDeleteStory: (id: string): Promise<boolean> => ipcRenderer.invoke('db:permanently-delete-story', id),
  listTrashedStories: (): Promise<any[]> => ipcRenderer.invoke('db:list-trashed-stories'),
  cleanupOldTrashed: (days: number): Promise<number> => ipcRenderer.invoke('db:cleanup-old-trashed', days),

  // WorldSettings
  listWorldSettings: (storyId: string): Promise<any[]> => ipcRenderer.invoke('db:list-world-settings', storyId),
  createWorldSetting: (data: any): Promise<any> => ipcRenderer.invoke('db:create-world-setting', data),
  updateWorldSetting: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-world-setting', id, patch),
  deleteWorldSetting: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-world-setting', id),

  // Characters
  listCharacters: (storyId: string): Promise<any[]> => ipcRenderer.invoke('db:list-characters', storyId),
  createCharacter: (data: any): Promise<any> => ipcRenderer.invoke('db:create-character', data),
  updateCharacter: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-character', id, patch),
  deleteCharacter: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-character', id),

  // Character Variants
  listCharacterVariants: (characterId: string): Promise<any[]> => ipcRenderer.invoke('db:list-character-variants', characterId),
  createCharacterVariant: (data: any): Promise<any> => ipcRenderer.invoke('db:create-character-variant', data),
  createCharacterVariantsBatch: (characterId: string, items: { name?: string; url: string }[]): Promise<any[]> =>
    ipcRenderer.invoke('db:create-character-variants-batch', characterId, items),
  updateCharacterVariant: (id: string, patch: any): Promise<boolean> => ipcRenderer.invoke('db:update-character-variant', id, patch),
  deleteCharacterVariant: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-character-variant', id),
  reorderCharacterVariants: (characterId: string, orderedIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke('db:reorder-character-variants', characterId, orderedIds),
  reorderWorldSettings: (storyId: string, orderedIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke('db:reorder-world-settings', storyId, orderedIds),
  reorderCharacters: (storyId: string, orderedIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke('db:reorder-characters', storyId, orderedIds),

  // Character Relations
  listCharacterRelations: (storyId: string): Promise<any[]> => ipcRenderer.invoke('db:list-character-relations', storyId),
  createCharacterRelation: (data: any): Promise<any> => ipcRenderer.invoke('db:create-character-relation', data),
  updateCharacterRelation: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-character-relation', id, patch),
  deleteCharacterRelation: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-character-relation', id),

  // Outlines
  listOutlines: (storyId: string): Promise<any[]> => ipcRenderer.invoke('db:list-outlines', storyId),
  createOutline: (data: any): Promise<any> => ipcRenderer.invoke('db:create-outline', data),
  updateOutline: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-outline', id, patch),
  deleteOutline: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-outline', id),

  // Volumes
  listVolumes: (storyId: string): Promise<any[]> => ipcRenderer.invoke('db:list-volumes', storyId),
  createVolume: (data: any): Promise<any> => ipcRenderer.invoke('db:create-volume', data),
  updateVolume: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-volume', id, patch),
  deleteVolume: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-volume', id),
  reorderVolumes: (storyId: string, orderedIds: string[]): Promise<boolean> => ipcRenderer.invoke('db:reorder-volumes', storyId, orderedIds),

  // Chapters
  listChapters: (storyId: string): Promise<any[]> => ipcRenderer.invoke('db:list-chapters', storyId),
  listChaptersByVolume: (volumeId: string): Promise<any[]> => ipcRenderer.invoke('db:list-chapters-by-volume', volumeId),
  createChapter: (data: any): Promise<any> => ipcRenderer.invoke('db:create-chapter', data),
  updateChapter: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-chapter', id, patch),
  deleteChapter: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-chapter', id),
  reorderChapters: (storyId: string, orderedIds: string[]): Promise<boolean> => ipcRenderer.invoke('db:reorder-chapters', storyId, orderedIds),
  moveChapters: (storyId: string, targetVolumeId: string | null, orderedIds: string[]): Promise<boolean> => ipcRenderer.invoke('db:move-chapters', storyId, targetVolumeId, orderedIds),

  // Sections
  listSections: (chapterId: string): Promise<any[]> => ipcRenderer.invoke('db:list-sections', chapterId),
  listSectionMetadata: (chapterId: string): Promise<any[]> => ipcRenderer.invoke('db:list-section-metadata', chapterId),
  createSection: (data: any): Promise<any> => ipcRenderer.invoke('db:create-section', data),
  updateSection: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-section', id, patch),
  deleteSection: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-section', id),
  reorderSections: (chapterId: string, orderedIds: string[]): Promise<boolean> => ipcRenderer.invoke('db:reorder-sections', chapterId, orderedIds),
  moveSections: (targetChapterId: string | null, orderedIds: string[]): Promise<boolean> => ipcRenderer.invoke('db:move-sections', targetChapterId, orderedIds),

  // Bulk Create (导入加速)
  bulkCreateVolumes: (rows: any[]): Promise<any[]> => ipcRenderer.invoke('db:bulk-create-volumes', rows),
  bulkCreateChapters: (rows: any[]): Promise<any[]> => ipcRenderer.invoke('db:bulk-create-chapters', rows),
  bulkCreateSections: (rows: any[]): Promise<any[]> => ipcRenderer.invoke('db:bulk-create-sections', rows),

  // Section content
  getSectionContent: (id: string): Promise<string | null> => ipcRenderer.invoke('db:get-section-content', id),
  setSectionContent: (id: string, content: string | null): Promise<boolean> => ipcRenderer.invoke('db:set-section-content', id, content),
  setSectionBBCode: (id: string, bbcode: string | null): Promise<boolean> => ipcRenderer.invoke('db:set-section-bbcode', id, bbcode),

  // World Templates
  listWorldSettingTemplates: (): Promise<any[]> => ipcRenderer.invoke('db:list-world-setting-templates'),
  createWorldSettingTemplate: (data: any): Promise<any> => ipcRenderer.invoke('db:create-world-setting-template', data),
  updateWorldSettingTemplate: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-world-setting-template', id, patch),
  deleteWorldSettingTemplate: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-world-setting-template', id),
  reorderWorldSettingTemplates: (orderedIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke('db:reorder-world-setting-templates', orderedIds),

  // Character Templates
  listCharacterTemplates: (): Promise<any[]> => ipcRenderer.invoke('db:list-character-templates'),
  createCharacterTemplate: (data: any): Promise<any> => ipcRenderer.invoke('db:create-character-template', data),
  updateCharacterTemplate: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-character-template', id, patch),
  deleteCharacterTemplate: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-character-template', id),
  reorderCharacterTemplates: (orderedIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke('db:reorder-character-templates', orderedIds),

  // Aggregate
  getStoryWithAll: (storyId: string): Promise<any> => ipcRenderer.invoke('db:get-story-with-all', storyId),

  // 整作品另存为 + 导入（弹系统对话框）
  saveStoryAsFile: (data: any, suggestedName?: string): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('story:export-to-file', { data, suggestedName }),
  openStoryFile: (): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; data?: any; error?: string }> =>
    ipcRenderer.invoke('story:import-from-file'),

  // Utilities
  getDataDirectory: (): Promise<string> => ipcRenderer.invoke('db:get-data-directory'),
}

// 应用工具
const appAPI = {
  platform: process.platform,
  openDataDirectory: (): Promise<boolean> => ipcRenderer.invoke('app:open-data-directory'),
}

// 数据清理（应用内"清空所有数据"入口）
const dataAPI = {
  clearAll: (): Promise<{ ok: boolean; error?: string; cleared: string[] }> =>
    ipcRenderer.invoke('data:clearAll'),
  openUninstallGuide: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('data:openUninstallGuide'),
  openDataDirectory: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('data:openDataDirectory'),
}

contextBridge.exposeInMainWorld('windowAPI', windowAPI)
contextBridge.exposeInMainWorld('electronAPI', {
  // 保留原有的接口
  minimize: windowAPI.minimize,
  toggleMaximize: windowAPI.toggleMaximize,
  close: windowAPI.close,
  selectImage: imageAPI.select,
  uploadImage: imageAPI.upload,
  platform: process.platform,
  collectNga: ngaAPI.collect,
  cancelNgaCollect: ngaAPI.cancelCollect,
  pauseNgaCollect: ngaAPI.pauseCollect,
  onNgaCollectProgress: ngaAPI.onCollectProgress,
  fetchNgaThreadInfo: ngaAPI.fetchThreadInfo,
  // 整作品另存为 + 导入（代理 dbAPI）
  saveStoryAsFile: dbAPI.saveStoryAsFile,
  openStoryFile: dbAPI.openStoryFile,
  // 寻找安科：搜索骨碌碌 / NGA 安科版块
  searchAnke: {
    gululu: (keyword: string): Promise<{ ok: boolean; data?: any[]; error?: string }> =>
      ipcRenderer.invoke('search:gululu', keyword),
    ngaAnke: (keyword: string): Promise<{ ok: boolean; data?: any[]; error?: string }> =>
      ipcRenderer.invoke('search:nga-anke', keyword),
  },
  // 在系统浏览器打开外链
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  // 导出为 EPUB 电子书（仅桌面端，含图片离线化 + 进度推送）
  exportEpub: (storyId: string, suggestedName?: string): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('story:export-epub', { storyId, suggestedName }),
  onEpubExportProgress: (cb: (p: any) => void): (() => void) => {
    const listener = (_e: any, p: any) => cb(p)
    ipcRenderer.on('epub:export:progress', listener)
    return () => ipcRenderer.removeListener('epub:export:progress', listener)
  },
})
contextBridge.exposeInMainWorld('dbAPI', dbAPI)
contextBridge.exposeInMainWorld('appAPI', appAPI)

// 类型声明（供 TypeScript 渲染进程使用）
export type ElectronAPI = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  selectImage: () => Promise<{ buffer: string; filename: string; mimeType: string; filePath?: string } | null>
  uploadImage: (payload: { buffer: string; filename: string; mimeType: string }) => Promise<{ ok: boolean; url?: string; error?: string }>
  saveImageLocal: (payload: { buffer: string; filename: string; mimeType: string }) => Promise<{ ok: boolean; url?: string; error?: string }>
  openImageFolder: () => Promise<{ ok: boolean; error?: string }>
  platform: NodeJS.Platform
  collectNga: (payload: {
    url: string;
    startFloor: number;
    endFloor: number;
    prefix: string;
    authorid?: string;
    matchMode?: string;
    cookies?: string;
  }) => Promise<{
    ok: boolean;
    items: { floor: number; author: string; uid?: string; content: string }[];
    totalPages: number;
    error?: string;
  }>
  cancelNgaCollect: (taskId?: number) => Promise<{ ok: boolean }>
  pauseNgaCollect: (taskId?: number, paused?: boolean) => Promise<{ ok: boolean; paused: boolean }>
  onNgaCollectProgress: (callback: (progress: {
    taskId: number;
    current: number;
    total: number;
    phase: 'starting' | 'fetching' | 'parsing' | 'filtering' | 'done' | 'error' | 'cancelled' | 'paused';
    message: string;
    itemsFound?: number;
  }) => void) => () => void
  fetchNgaThreadInfo: (url: string, cookies?: string) => Promise<{
    ok: boolean;
    totalPages?: number;
    totalFloors?: number;
    error?: string;
  }>
  saveStoryAsFile: (data: any, suggestedName?: string) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>
  openStoryFile: () => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; data?: any; error?: string }>
  clearAllData: () => Promise<{ ok: boolean; error?: string; cleared: string[] }>
  openUninstallGuide: () => Promise<{ ok: boolean }>
  openDataDirectory: () => Promise<{ ok: boolean; error?: string }>
  searchAnke: {
    gululu: (keyword: string) => Promise<{ ok: boolean; data?: GululuResult[]; error?: string }>
    ngaAnke: (keyword: string) => Promise<{ ok: boolean; data?: NgaResult[]; error?: string }>
  }
  openExternal: (url: string) => Promise<void>
  exportEpub: (storyId: string, suggestedName?: string) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>
  onEpubExportProgress: (cb: (p: any) => void) => () => void
}

declare global {
  interface Window {
    windowAPI: typeof windowAPI
    electronAPI: ElectronAPI
    dbAPI: typeof dbAPI
    appAPI: typeof appAPI
    dataAPI: typeof dataAPI
  }
}

export {}
