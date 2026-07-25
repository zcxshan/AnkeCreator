// ============================================================
// 图片库 facade（渲染层）
// 仿 favorites.ts：window.dbAPI?.X 优先（Electron 桌面端），
// 否则走内存降级（浏览器/Capacitor）。
// 高内聚低耦合：自包含，仅通过 window.dbAPI 薄接口通信。
// ============================================================

import type { ImageLibraryFolder, ImageLibraryItem } from '../types';

// 内存降级存储
let memoryFolders: ImageLibraryFolder[] = [];
let memoryItems: ImageLibraryItem[] = [];
let memIdCounter = 0;
function memId(): string {
  return `mem-${Date.now()}-${++memIdCounter}`;
}
function memNow(): string {
  return new Date().toISOString();
}

export async function listImageLibraryFolders(
  parentId?: string | null,
): Promise<ImageLibraryFolder[]> {
  if (window.dbAPI?.listImageLibraryFolders) {
    return window.dbAPI.listImageLibraryFolders(parentId ?? null);
  }
  return memoryFolders.filter((f) => (f.parentId ?? null) === (parentId ?? null));
}

// v36: 列出所有文件夹(不过滤 parentId),用于子目录删除时的统计
export async function listAllImageLibraryFolders(): Promise<ImageLibraryFolder[]> {
  if (window.dbAPI?.listAllImageLibraryFolders) {
    return window.dbAPI.listAllImageLibraryFolders();
  }
  return [...memoryFolders];
}

// v36: 列出所有图片项(不过滤 folderId),用于子目录删除时的统计
export async function listAllImageLibraryItems(): Promise<ImageLibraryItem[]> {
  if (window.dbAPI?.listAllImageLibraryItems) {
    return window.dbAPI.listAllImageLibraryItems();
  }
  return [...memoryItems];
}

export async function createImageLibraryFolder(data: {
  name: string;
  parentId: string | null;
}): Promise<ImageLibraryFolder> {
  if (window.dbAPI?.createImageLibraryFolder) {
    return window.dbAPI.createImageLibraryFolder(data);
  }
  const folder: ImageLibraryFolder = {
    id: memId(),
    name: data.name,
    parentId: data.parentId,
    created_at: memNow(),
    updated_at: memNow(),
  };
  memoryFolders.push(folder);
  return folder;
}

export async function renameImageLibraryFolder(
  id: string,
  name: string,
): Promise<ImageLibraryFolder> {
  if (window.dbAPI?.renameImageLibraryFolder) {
    return window.dbAPI.renameImageLibraryFolder(id, name);
  }
  const f = memoryFolders.find((x) => x.id === id);
  if (f) {
    f.name = name;
    f.updated_at = memNow();
  }
  return f!;
}

export async function deleteImageLibraryFolder(id: string): Promise<boolean> {
  if (window.dbAPI?.deleteImageLibraryFolder) {
    return window.dbAPI.deleteImageLibraryFolder(id);
  }
  memoryFolders = memoryFolders.filter((f) => f.id !== id);
  memoryItems = memoryItems.filter((i) => i.folderId !== id);
  return true;
}

export async function listImageLibraryItems(
  folderId?: string | null,
): Promise<ImageLibraryItem[]> {
  if (window.dbAPI?.listImageLibraryItems) {
    return window.dbAPI.listImageLibraryItems(folderId ?? null);
  }
  return memoryItems.filter((i) => (i.folderId ?? null) === (folderId ?? null));
}

export async function addImageLibraryItem(data: {
  folderId: string | null;
  url: string;
  filename: string;
  source: 'local' | 'url';
}): Promise<ImageLibraryItem> {
  if (window.dbAPI?.addImageLibraryItem) {
    return window.dbAPI.addImageLibraryItem(data);
  }
  const item: ImageLibraryItem = {
    id: memId(),
    ...data,
    created_at: memNow(),
  };
  memoryItems.push(item);
  return item;
}

export async function deleteImageLibraryItem(id: string): Promise<boolean> {
  if (window.dbAPI?.deleteImageLibraryItem) {
    return window.dbAPI.deleteImageLibraryItem(id);
  }
  memoryItems = memoryItems.filter((i) => i.id !== id);
  return true;
}

export async function moveImageLibraryItem(
  id: string,
  folderId: string | null,
): Promise<boolean> {
  if (window.dbAPI?.moveImageLibraryItem) {
    return window.dbAPI.moveImageLibraryItem(id, folderId);
  }
  const item = memoryItems.find((i) => i.id === id);
  if (item) item.folderId = folderId;
  return true;
}

// 改动 v3：资源库图片重命名 / 跨文件夹移动（DB + 内存双路径）
export async function updateImageLibraryItem(
  id: string,
  patch: { filename?: string; url?: string; folderId?: string | null },
): Promise<ImageLibraryItem | null> {
  if (window.dbAPI?.updateImageLibraryItem) {
    return window.dbAPI.updateImageLibraryItem(id, patch);
  }
  const item = memoryItems.find((i) => i.id === id);
  if (!item) return null;
  if (patch.filename !== undefined) item.filename = patch.filename;
  if (patch.url !== undefined) item.url = patch.url;
  if (patch.folderId !== undefined) item.folderId = patch.folderId;
  return item;
}

// 改动 v3：资源库图片拖动换顺序（DB + 内存双路径）
export async function reorderImageLibraryItems(
  ids: string[],
  folderId: string | null,
): Promise<boolean> {
  if (window.dbAPI?.reorderImageLibraryItems) {
    const res = await window.dbAPI.reorderImageLibraryItems(ids, folderId);
    return !!res?.ok;
  }
  for (let i = 0; i < ids.length; i++) {
    const item = memoryItems.find((it) => it.id === ids[i]);
    if (item && item.folderId === folderId) item.order = i;
  }
  return true;
}

export const CHARACTER_FOLDER_NAME = '人物';

/** 确保图片库根目录下存在「人物」文件夹，返回其 id */
export async function ensureCharacterFolder(): Promise<string> {
  const folders = await listImageLibraryFolders(null);
  const existing = folders.find((f) => f.name === CHARACTER_FOLDER_NAME);
  if (existing) return existing.id;
  const created = await createImageLibraryFolder({ name: CHARACTER_FOLDER_NAME, parentId: null });
  return created.id;
}
