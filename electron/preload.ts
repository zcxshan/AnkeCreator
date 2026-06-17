import { contextBridge, ipcRenderer } from 'electron'

// ============================================================
// 通过 contextBridge 暴露给渲染进程的 API
// ============================================================

// 窗口控制（原有）
const windowAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
}

// 图片操作（原有）
const imageAPI = {
  select: () => ipcRenderer.invoke('image:select'),
  save: (dataUrl: string) => ipcRenderer.invoke('image:save', dataUrl),
}

// ============================================================
// 数据库 API
// 所有方法均为 Promise，对应主进程中 db-main.ts 的同步函数
// 数据保存到 userData/AnkeCreatorData
// ============================================================
const dbAPI = {
  // Story
  listStories: (): Promise<any[]> => ipcRenderer.invoke('db:list-stories'),
  getStory: (id: string): Promise<any> => ipcRenderer.invoke('db:get-story', id),
  createStory: (data: { title: string; description?: string; category?: string }): Promise<any> =>
    ipcRenderer.invoke('db:create-story', data),
  updateStory: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-story', id, patch),
  deleteStory: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-story', id),

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

  // Sections
  listSections: (chapterId: string): Promise<any[]> => ipcRenderer.invoke('db:list-sections', chapterId),
  createSection: (data: any): Promise<any> => ipcRenderer.invoke('db:create-section', data),
  updateSection: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-section', id, patch),
  deleteSection: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-section', id),
  reorderSections: (chapterId: string, orderedIds: string[]): Promise<boolean> => ipcRenderer.invoke('db:reorder-sections', chapterId, orderedIds),

  // Section content
  getSectionContent: (id: string): Promise<string | null> => ipcRenderer.invoke('db:get-section-content', id),
  setSectionContent: (id: string, content: string | null): Promise<boolean> => ipcRenderer.invoke('db:set-section-content', id, content),

  // Content blocks
  listBlocks: (sectionId: string): Promise<any[]> => ipcRenderer.invoke('db:list-blocks', sectionId),
  createTextBlock: (sectionId: string, payload: any, orderIndex?: number): Promise<any> => ipcRenderer.invoke('db:create-text-block', sectionId, payload, orderIndex),
  createImageBlock: (sectionId: string, payload: any, orderIndex?: number): Promise<any> => ipcRenderer.invoke('db:create-image-block', sectionId, payload, orderIndex),
  createDiceBlock: (sectionId: string, payload: any, orderIndex?: number): Promise<any> => ipcRenderer.invoke('db:create-dice-block', sectionId, payload, orderIndex),
  updateBlockPayload: (id: string, payload: any): Promise<any> => ipcRenderer.invoke('db:update-block-payload', id, payload),
  reorderBlocks: (sectionId: string, orderedIds: string[]): Promise<boolean> => ipcRenderer.invoke('db:reorder-blocks', sectionId, orderedIds),
  deleteBlock: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-block', id),

  // World Templates
  listWorldSettingTemplates: (): Promise<any[]> => ipcRenderer.invoke('db:list-world-setting-templates'),
  createWorldSettingTemplate: (data: any): Promise<any> => ipcRenderer.invoke('db:create-world-setting-template', data),
  updateWorldSettingTemplate: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-world-setting-template', id, patch),
  deleteWorldSettingTemplate: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-world-setting-template', id),

  // Character Templates
  listCharacterTemplates: (): Promise<any[]> => ipcRenderer.invoke('db:list-character-templates'),
  createCharacterTemplate: (data: any): Promise<any> => ipcRenderer.invoke('db:create-character-template', data),
  updateCharacterTemplate: (id: string, patch: any): Promise<any> => ipcRenderer.invoke('db:update-character-template', id, patch),
  deleteCharacterTemplate: (id: string): Promise<boolean> => ipcRenderer.invoke('db:delete-character-template', id),

  // Aggregate
  getStoryWithAll: (storyId: string): Promise<any> => ipcRenderer.invoke('db:get-story-with-all', storyId),

  // Utilities
  getDataDirectory: (): Promise<string> => ipcRenderer.invoke('db:get-data-directory'),
}

// 应用工具
const appAPI = {
  platform: process.platform,
  openDataDirectory: (): Promise<boolean> => ipcRenderer.invoke('app:open-data-directory'),
}

contextBridge.exposeInMainWorld('windowAPI', windowAPI)
contextBridge.exposeInMainWorld('electronAPI', {
  // 保留原有的接口
  minimize: windowAPI.minimize,
  toggleMaximize: windowAPI.toggleMaximize,
  close: windowAPI.close,
  selectImage: imageAPI.select,
  saveImage: imageAPI.save,
  platform: process.platform,
})
contextBridge.exposeInMainWorld('dbAPI', dbAPI)
contextBridge.exposeInMainWorld('appAPI', appAPI)

// 类型声明（供 TypeScript 渲染进程使用）
export type ElectronAPI = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  selectImage: () => Promise<string | null>
  saveImage: (dataUrl: string) => Promise<string | null>
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    windowAPI: typeof windowAPI
    electronAPI: ElectronAPI
    dbAPI: typeof dbAPI
    appAPI: typeof appAPI
  }
}

export {}
