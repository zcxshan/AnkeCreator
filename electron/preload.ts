import { contextBridge, ipcRenderer } from 'electron'
import type { GululuResult, NgaResult } from './searchAnke'
import type { WheelScheme, DrawHistory } from '../src/types/wheel'

// ============================================================
// 通过 contextBridge 暴露给渲染进程的 API
// ============================================================

// 窗口控制（原有）
const windowAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  /** 订阅窗口最大化/还原状态变化（修复拖动取消最大化时图标不更新的 bug） */
  onMaximizeStateChange: (cb: (isMaximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, isMax: boolean) => cb(isMax)
    ipcRenderer.on('window:maximize-state', listener)
    return () => {
      ipcRenderer.removeListener('window:maximize-state', listener)
    }
  },
}

// 图片操作（本地保存 / 磁盘扫描）
const imageAPI = {
  select: (payload?: { multiple?: boolean }): Promise<
    | { buffer: string; filename: string; mimeType: string; filePath?: string }
    | Array<{ buffer: string; filename: string; mimeType: string; filePath?: string }>
    | null
  > => ipcRenderer.invoke('image:select', payload),
  saveLocal: (payload: {
    buffer: string;
    filename: string;
    mimeType: string;
    folderId?: string | null;
    folderName?: string;
  }): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('image:saveLocal', payload),
  scanFiles: (payload?: { folderId?: string; folderName?: string }): Promise<{
    files: Array<{ path: string; filename: string; url: string; mtime: number; size: number; folder?: string }>;
  }> => ipcRenderer.invoke('image:scanFiles', payload),
  openImageFolder: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('image:openFolder'),
  deleteLocal: (payload: { url: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('image:deleteLocal', payload),
  // 改动 v3：资源库图片重命名时同步改磁盘（仅 local:// 图片）
  renameLocal: (payload: { oldUrl: string; newFilename: string }): Promise<{ ok: boolean; newUrl?: string; error?: string }> =>
    ipcRenderer.invoke('image:renameLocal', payload),
  // v11：URL 上传时同步写 .urls.json 到对应文件夹
  // - folderId 优先（精确解析嵌套目录）
  // - folderName fallback（旧版兼容）
  appendUrlRecord: (payload: {
    folderId?: string | null
    folderName?: string
    record: { url: string; filename: string; created_at: string }
  }): Promise<{ ok: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke('image:appendUrlRecord', payload),
  // v13：资源库 reconcile，修复 DB 与磁盘不一致
  reconcileLibrary: (): Promise<{
    ok: boolean
    changes: Array<{ id: string; newFolderId: string | null; reason: string }>
    error?: string
  }> => ipcRenderer.invoke('image:reconcile'),
  // 全量同步磁盘 data/images → DB（folders + items 一次性完成）
  // - 磁盘子目录递归识别为 DB folder（同名同父级复用）
  // - 磁盘有但 DB 没有 → 新增 local item
  // - DB 有但磁盘没有且 source='local' → 删除（source='url' 不动）
  syncDiskToDb: (): Promise<{
    ok: boolean
    foldersCreated: number
    foldersReused: number
    itemsAdded: number
    itemsDeleted: number
    error?: string
  }> => ipcRenderer.invoke('image:syncDiskToDb'),
  // v19：IPC 兜底 — local:// 协议失败时读取图片为 data URL
  readAsDataUrl: (url: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> =>
    ipcRenderer.invoke('image:readAsDataUrl', { url }),
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
  decideCollect: (taskId: number, decision: 'continue' | 'stop' | 'skip'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('nga:collect:decide', taskId, decision),
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
// 数据保存到 data/ 目录下（打包 = <安装路径>/data/，dev = <项目根>/data/）
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

  // 导入完成后校准所有 word_count
  recomputeStoryWordCounts: (storyId: string): Promise<boolean> => ipcRenderer.invoke('db:recompute-story-word-counts', storyId),

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

  // Favorites
  listFavorites: (): Promise<any[]> => ipcRenderer.invoke('db:list-favorites'),
  createFavorite: (data: { name: string }): Promise<any> => ipcRenderer.invoke('db:create-favorite', data),
  renameFavorite: (id: string, name: string): Promise<any> => ipcRenderer.invoke('db:rename-favorite', id, name),
  deleteFavoriteIfEmpty: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('db:delete-favorite-if-empty', id),
  getFavoriteStoryCount: (id: string): Promise<number> =>
    ipcRenderer.invoke('db:get-favorite-story-count', id),
  addStoryToFavorite: (storyId: string, favoriteId: string): Promise<boolean> =>
    ipcRenderer.invoke('db:add-story-to-favorite', storyId, favoriteId),
  removeStoryFromFavorite: (storyId: string, favoriteId: string): Promise<boolean> =>
    ipcRenderer.invoke('db:remove-story-from-favorite', storyId, favoriteId),
  getFavoritesForStory: (storyId: string): Promise<any[]> =>
    ipcRenderer.invoke('db:get-favorites-for-story', storyId),
  getStoryIdsInFavorite: (favoriteId: string): Promise<string[]> =>
    ipcRenderer.invoke('db:get-story-ids-in-favorite', favoriteId),

  // Image Library
  listImageLibraryFolders: (parentId?: string | null): Promise<any[]> =>
    ipcRenderer.invoke('db:list-image-library-folders', parentId),
  // v36: 列出所有文件夹(不过滤 parentId),用于子目录删除时的统计
  listAllImageLibraryFolders: (): Promise<any[]> =>
    ipcRenderer.invoke('db:list-all-image-library-folders'),
  // v36: 列出所有图片项(不过滤 folderId),用于子目录删除时的统计
  listAllImageLibraryItems: (): Promise<any[]> =>
    ipcRenderer.invoke('db:list-all-image-library-items'),
  createImageLibraryFolder: (data: { name: string; parentId: string | null }): Promise<any> =>
    ipcRenderer.invoke('db:create-image-library-folder', data),
  renameImageLibraryFolder: (id: string, name: string): Promise<any> =>
    ipcRenderer.invoke('db:rename-image-library-folder', id, name),
  deleteImageLibraryFolder: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('db:delete-image-library-folder', id),
  listImageLibraryItems: (folderId?: string | null): Promise<any[]> =>
    ipcRenderer.invoke('db:list-image-library-items', folderId),
  addImageLibraryItem: (data: {
    folderId: string | null
    url: string
    filename: string
    source: 'local' | 'url'
  }): Promise<any> => ipcRenderer.invoke('db:add-image-library-item', data),
  deleteImageLibraryItem: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('db:delete-image-library-item', id),
  moveImageLibraryItem: (id: string, folderId: string | null): Promise<boolean> =>
    ipcRenderer.invoke('db:move-image-library-item', id, folderId),
  // 改动 v3：资源库图片重命名 / 跨文件夹移动
  updateImageLibraryItem: (
    id: string,
    patch: { filename?: string; url?: string; folderId?: string | null },
  ): Promise<any> => ipcRenderer.invoke('db:update-image-library-item', id, patch),
  // 改动 v3：资源库图片拖动换顺序
  reorderImageLibraryItems: (ids: string[], folderId: string | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('db:reorder-image-library-items', ids, folderId),

  // Material Sites（需求6:寻找素材面板）
  listMaterialSites: (): Promise<any[]> =>
    ipcRenderer.invoke('db:list-material-sites'),
  createMaterialSite: (data: {
    name: string;
    url: string;
    category: string;
    description?: string;
  }): Promise<any> => ipcRenderer.invoke('db:create-material-site', data),
  updateMaterialSite: (
    id: string,
    patch: { name?: string; url?: string; category?: string; description?: string },
  ): Promise<any> => ipcRenderer.invoke('db:update-material-site', id, patch),
  deleteMaterialSite: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('db:delete-material-site', id),

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

// ============================================================
// 骨碌碌安科收集 API
// 对应 electron/gululuCrawler.ts 中注册的 IPC 通道
// ============================================================
const gululuAPI = {
  collect: (payload: {
    url: string;
    startFloor: number;
    endFloor: number;
    retryFloorNums?: number[];
    existingItems?: any[];
  }): Promise<{
    ok: boolean;
    items: { floor: number; author: string; content: string; time?: number; floorId: number }[];
    totalFloors: number;
    title?: string;
    author?: string;
    error?: string;
    failedFloorNums?: number[];
  }> => ipcRenderer.invoke('gululu:collect', payload),
  cancelCollect: (taskId?: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('gululu:collect:cancel', taskId),
  fetchBookInfo: (url: string): Promise<{
    ok: boolean;
    totalFloors?: number;
    title?: string;
    author?: string;
    error?: string;
  }> => ipcRenderer.invoke('gululu:fetchBookInfo', url),
  onCollectProgress: (callback: (progress: {
    taskId: number;
    current: number;
    total: number;
    phase: 'starting' | 'fetching' | 'done' | 'error' | 'cancelled';
    message: string;
  }) => void): (() => void) => {
    const listener = (_e: any, p: any) => callback(p);
    ipcRenderer.on('gululu:collect:progress', listener);
    return () => ipcRenderer.removeListener('gululu:collect:progress', listener);
  },
}

contextBridge.exposeInMainWorld('windowAPI', windowAPI)
contextBridge.exposeInMainWorld('electronAPI', {
  // 保留原有的接口
  minimize: windowAPI.minimize,
  toggleMaximize: windowAPI.toggleMaximize,
  close: windowAPI.close,
  onMaximizeStateChange: windowAPI.onMaximizeStateChange,
  selectImage: imageAPI.select,
  saveImageLocal: imageAPI.saveLocal,
  scanImagesInDir: imageAPI.scanFiles,
  deleteImageLocal: imageAPI.deleteLocal,
  renameImageLocal: imageAPI.renameLocal,
  appendUrlRecord: imageAPI.appendUrlRecord, // v11：暴露给 UI 调用
  reconcileLibrary: imageAPI.reconcileLibrary, // v13: UI refresh() 调一次 reconcile
  syncDiskToDb: imageAPI.syncDiskToDb, // v50: UI refresh() 调一次同步磁盘 → DB（识别子目录与新放入的图片）
  readAsDataUrl: imageAPI.readAsDataUrl, // v19: IPC 兜底读取图片
  openImageFolder: imageAPI.openImageFolder,
  platform: process.platform,
  collectNga: ngaAPI.collect,
  cancelNgaCollect: ngaAPI.cancelCollect,
  pauseNgaCollect: ngaAPI.pauseCollect,
  decideNgaCollect: ngaAPI.decideCollect,
  onNgaCollectProgress: ngaAPI.onCollectProgress,
  fetchNgaThreadInfo: ngaAPI.fetchThreadInfo,
  // 整作品另存为 + 导入（代理 dbAPI）
  saveStoryAsFile: dbAPI.saveStoryAsFile,
  openStoryFile: dbAPI.openStoryFile,
  // 寻找安科：搜索骨碌碌 / NGA 安科版块
  searchAnke: {
    gululu: (
      keyword: string,
      matchField?: 'all' | 'title' | 'author',
      page?: number,
      limit?: number,
    ): Promise<{ ok: boolean; data?: any[]; error?: string }> =>
      ipcRenderer.invoke('search:gululu', { keyword, matchField: matchField || 'title', page, limit }),
    ngaAnke: (
      keyword: string,
      cookies?: string,
      matchField?: 'title' | 'author',
      startPage?: number,
      limit?: number,
    ): Promise<{ ok: boolean; data?: any[]; error?: string }> =>
      ipcRenderer.invoke('search:nga-anke', { keyword, cookies, matchField: matchField || 'title', startPage, limit }),
  },
  // 在系统浏览器打开外链
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  // 骰子音效：扫描可用 mp3
  listDiceSounds: (): Promise<string[]> => ipcRenderer.invoke('system:list-sounds'),
  // 导出为 EPUB 电子书（仅桌面端，含图片离线化 + 进度推送 + 暂停/取消）
  exportEpub: (
    storyId: string,
    suggestedName?: string,
    options?: { embedImages: boolean },
  ): Promise<{ ok: boolean; canceled?: boolean; userCanceled?: boolean; filePath?: string; error?: string; failedImageCount?: number }> =>
    ipcRenderer.invoke('story:export-epub', { storyId, suggestedName, options }),
  pauseEpubExport: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('epub:export:pause'),
  resumeEpubExport: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('epub:export:resume'),
  cancelEpubExport: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('epub:export:cancel'),
  onEpubExportProgress: (cb: (p: any) => void): (() => void) => {
    const listener = (_e: any, p: any) => cb(p)
    ipcRenderer.on('epub:export:progress', listener)
    return () => ipcRenderer.removeListener('epub:export:progress', listener)
  },
  // 骨碌碌安科收集
  collectGululu: gululuAPI.collect,
  cancelGululuCollect: gululuAPI.cancelCollect,
  fetchGululuBookInfo: gululuAPI.fetchBookInfo,
  onGululuCollectProgress: gululuAPI.onCollectProgress,
})
contextBridge.exposeInMainWorld('dbAPI', dbAPI)
contextBridge.exposeInMainWorld('appAPI', appAPI)

// ============================================================
// 玩转盘 API
// 对应 electron/ipc/wheel.ts 中注册的 IPC 通道
// 数据保存到 <dataDir>/wheels.json
// ============================================================
const wheelAPI = {
  // 方案 CRUD
  listSchemes: (): Promise<WheelScheme[]> => ipcRenderer.invoke('wheel:list-schemes'),
  getScheme: (id: string): Promise<WheelScheme | null> =>
    ipcRenderer.invoke('wheel:get-scheme', id),
  createScheme: (data: Omit<WheelScheme, 'id' | 'created_at' | 'updated_at'>): Promise<WheelScheme> =>
    ipcRenderer.invoke('wheel:create-scheme', data),
  updateScheme: (id: string, patch: Partial<WheelScheme>): Promise<WheelScheme | null> =>
    ipcRenderer.invoke('wheel:update-scheme', id, patch),
  deleteScheme: (id: string): Promise<boolean> => ipcRenderer.invoke('wheel:delete-scheme', id),
  // 历史记录
  addHistory: (record: DrawHistory): Promise<boolean> =>
    ipcRenderer.invoke('wheel:add-history', record),
  listHistory: (limit?: number): Promise<DrawHistory[]> =>
    ipcRenderer.invoke('wheel:list-history', limit),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('wheel:clear-history'),
  // 导入导出（弹系统对话框）
  saveSchemeAsFile: (
    data: WheelScheme,
    suggestedName?: string,
  ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('wheel:export-scheme', { data, suggestedName }),
  openSchemeFile: (): Promise<{
    ok: boolean
    canceled?: boolean
    filePath?: string
    data?: any
    error?: string
  }> => ipcRenderer.invoke('wheel:import-scheme'),
}
contextBridge.exposeInMainWorld('wheelAPI', wheelAPI)

// 类型声明（供 TypeScript 渲染进程使用）
export type ElectronAPI = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  /** 订阅窗口最大化/还原状态变化（修复拖动取消最大化时图标不更新的 bug） */
  onMaximizeStateChange: (cb: (isMaximized: boolean) => void) => () => void
  selectImage: (payload?: { multiple?: boolean }) => Promise<{ buffer: string; filename: string; mimeType: string; filePath?: string } | Array<{ buffer: string; filename: string; mimeType: string; filePath?: string }> | null>
  saveImageLocal: (payload: { buffer: string; filename: string; mimeType: string; folderId?: string | null; folderName?: string }) => Promise<{ ok: boolean; url?: string; error?: string }>
  /** 改动 8：扫描 <imagesDir>/ 下所有图片（含子目录） */
  scanImagesInDir: (payload?: { folderId?: string; folderName?: string }) => Promise<{ files: Array<{ path: string; filename: string; url: string; mtime: number; size: number; folder?: string }> }>
  /** v11：URL 上传时同步写 .urls.json 到对应文件夹(支持嵌套子目录) */
  appendUrlRecord: (payload: {
    folderId?: string | null
    folderName?: string
    record: { url: string; filename: string; created_at: string }
  }) => Promise<{ ok: boolean; count?: number; error?: string }>
  /** v13: 资源库 reconcile，修复 DB 与磁盘不一致 */
  reconcileLibrary: () => Promise<{
    ok: boolean
    changes: Array<{ id: string; newFolderId: string | null; reason: string }>
    error?: string
  }>
  /** 全量同步磁盘 data/images → DB（folders + items 一次性完成） */
  syncDiskToDb: () => Promise<{
    ok: boolean
    foldersCreated: number
    foldersReused: number
    itemsAdded: number
    itemsDeleted: number
    error?: string
  }>
  /** v19: IPC 兜底 — local:// 协议失败时读取图片为 data URL */
  readAsDataUrl: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
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
  decideNgaCollect: (taskId: number, decision: 'continue' | 'stop' | 'skip') => Promise<{ ok: boolean }>
  onNgaCollectProgress: (callback: (progress: {
    taskId: number;
    current: number;
    total: number;
    phase: 'starting' | 'fetching' | 'parsing' | 'filtering' | 'done' | 'error' | 'cancelled' | 'paused';
    message: string;
    itemsFound?: number;
    failedPages?: number[];
    needsUserDecision?: boolean;
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
    gululu: (
      keyword: string,
      matchField?: 'all' | 'title' | 'author',
      page?: number,
    ) => Promise<{ ok: boolean; data?: GululuResult[]; error?: string }>
    ngaAnke: (
      keyword: string,
      cookies?: string,
      matchField?: 'title' | 'author',
      startPage?: number,
    ) => Promise<{ ok: boolean; data?: NgaResult[]; error?: string }>
  }
  openExternal: (url: string) => Promise<void>
  listDiceSounds: () => Promise<string[]>
  uploadDiceSound: (payload: { filename: string; buffer: string; mimeType?: string }) => Promise<{ ok: boolean; name?: string; error?: string }>
  deleteDiceSound: (filename: string) => Promise<{ ok: boolean; error?: string }>
  getDiceSoundDataUrl: (filename: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  exportEpub: (
    storyId: string,
    suggestedName?: string,
    options?: { embedImages: boolean },
  ) => Promise<{ ok: boolean; canceled?: boolean; userCanceled?: boolean; filePath?: string; error?: string; failedImageCount?: number }>
  onEpubExportProgress: (cb: (p: any) => void) => () => void
  collectGululu: (payload: {
    url: string;
    startFloor: number;
    endFloor: number;
    retryFloorNums?: number[];
    existingItems?: any[];
  }) => Promise<{
    ok: boolean;
    items: { floor: number; author: string; content: string; time?: number; floorId: number }[];
    totalFloors: number;
    title?: string;
    author?: string;
    error?: string;
    failedFloorNums?: number[];
  }>
  cancelGululuCollect: (taskId?: number) => Promise<{ ok: boolean }>
  fetchGululuBookInfo: (url: string) => Promise<{
    ok: boolean;
    totalFloors?: number;
    title?: string;
    author?: string;
    error?: string;
  }>
  onGululuCollectProgress: (callback: (progress: {
    taskId: number;
    current: number;
    total: number;
    phase: 'starting' | 'fetching' | 'done' | 'error' | 'cancelled';
    message: string;
  }) => void) => () => void
}

declare global {
  interface Window {
    windowAPI: typeof windowAPI
    electronAPI: ElectronAPI
    dbAPI: typeof dbAPI
    appAPI: typeof appAPI
    dataAPI: typeof dataAPI
    wheelAPI: typeof wheelAPI
  }
}

export {}
