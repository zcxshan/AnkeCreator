// ============================================================
// syncDiskToDb: 全量同步磁盘 data/images → DB
//
// 职责（一次性完成）：
// 1. 递归同步 folders：磁盘上的子目录 → DB folder 记录
//    - 按 (parentId, name) 匹配，已存在则复用 folderId
//    - 不存在则新建 DB 记录（不调 createImageLibraryFolder，因为磁盘目录已存在）
//    - 只增不删（孤儿 folder 记录由用户在 UI 手动删除）
//
// 2. 递归收集磁盘上所有图片文件（含 folderId）
//
// 3. 同步 items：
//    - 磁盘有但 DB 没有 → 新增 item（source='local'）
//    - DB 有但磁盘没有且 source='local' → 删除 item
//    - source='url' 的 item 不动（URL 图片磁盘上本就没有）
//
// 调用时机：ImageLibraryPage.refresh() 在 reconcile 之后调用
// 失败处理：只 console.warn，不阻塞 refresh（与 reconcile 的错误处理一致）
//
// 设计：纯函数版，接受 data + imagesDir，直接 import fs/path
//      与 migrateImageLibraryRootFolder.ts 风格一致
// ============================================================

import path from 'path';
import fs from 'fs';
import type { ImageLibraryFolder, ImageLibraryItem } from '../types/image-library';
import { IMAGE_EXTS, sanitizeFolderName } from './scanImageDirectory';
import { stripImageFilenameExtension } from './imageFilename';

/** 图片库数据（与 db-main.ts 中的 ImageLibraryData 结构一致） */
export interface ImageLibraryData {
  folders: Record<string, ImageLibraryFolder>;
  items: Record<string, ImageLibraryItem>;
}

export interface SyncDiskToDbResult {
  foldersCreated: number;
  foldersReused: number;
  itemsAdded: number;
  itemsDeleted: number;
}

interface DiskImageInfo {
  url: string;
  folderId: string | null;
  filename: string;
}

/**
 * 递归同步 folders：扫描磁盘子目录，创建/复用 DB folder 记录
 *
 * @param dirPath 当前扫描的磁盘目录
 * @param parentId 父 folderId（null=根目录下的子目录）
 * @param data DB 数据（会被原地修改）
 * @param counters 统计计数器
 */
function syncFoldersRecursive(
  dirPath: string,
  parentId: string | null,
  data: ImageLibraryData,
  counters: SyncDiskToDbResult,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    // 按 (parentId, name) 在 DB 中查找同名同父级的 folder
    const existing = Object.values(data.folders).find(
      (f) => f.parentId === parentId && f.name === entry.name,
    );

    let folderId: string;
    if (existing) {
      folderId = existing.id;
      counters.foldersReused++;
    } else {
      // 直接写 DB 记录（不调 createImageLibraryFolder，因为磁盘目录已存在）
      const newId = generateUuid();
      const now = new Date().toISOString();
      const newFolder: ImageLibraryFolder = {
        id: newId,
        name: entry.name,
        parentId,
        created_at: now,
        updated_at: now,
      };
      data.folders[newId] = newFolder;
      folderId = newId;
      counters.foldersCreated++;
    }

    // 递归处理子目录
    syncFoldersRecursive(path.join(dirPath, entry.name), folderId, data, counters);
  }
}

/**
 * 递归收集磁盘上所有图片文件（含 folderId）
 *
 * @param dirPath 当前扫描的磁盘目录
 * @param folderId 该目录对应的 DB folderId（null=根目录）
 * @param imagesDir 根目录（用于计算相对路径生成 URL）
 * @param data DB 数据（用于查找子目录对应的 folderId）
 * @param accumulator 收集结果的数组
 */
function collectDiskImages(
  dirPath: string,
  folderId: string | null,
  imagesDir: string,
  data: ImageLibraryData,
  accumulator: DiskImageInfo[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      // 查 DB 找到该子目录对应的 folderId（syncFoldersRecursive 已确保存在）
      const childFolder = Object.values(data.folders).find(
        (f) => f.parentId === folderId && f.name === entry.name,
      );
      if (childFolder) {
        collectDiskImages(full, childFolder.id, imagesDir, data, accumulator);
      }
    } else if (entry.isFile()) {
      if (entry.name.startsWith('.')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;

      // 计算相对路径，替换 \ 为 /（URL 格式要求）
      const relativePath = path.relative(imagesDir, full).replace(/\\/g, '/');
      accumulator.push({
        url: `local:///${relativePath}`,
        folderId,
        filename: stripImageFilenameExtension(entry.name),
      });
    }
  }
}

/**
 * 同步 items：对比磁盘图片与 DB items，新增/删除
 *
 * @param diskImages 磁盘上收集到的所有图片
 * @param data DB 数据（会被原地修改）
 * @param counters 统计计数器
 */
function syncItems(
  diskImages: DiskImageInfo[],
  data: ImageLibraryData,
  counters: SyncDiskToDbResult,
): void {
  // 磁盘 URL 集合
  const diskUrlSet = new Set(diskImages.map((img) => img.url));

  // 1. 删除：DB 有但磁盘没有的 local 图片
  for (const item of Object.values(data.items)) {
    if (item.source !== 'local') continue; // 不动 URL 图片
    if (!diskUrlSet.has(item.url)) {
      delete data.items[item.id];
      counters.itemsDeleted++;
    }
  }

  // 2. 新增：磁盘有但 DB 没有的
  const dbUrlSet = new Set(Object.values(data.items).map((it) => it.url));
  for (const img of diskImages) {
    if (dbUrlSet.has(img.url)) continue;

    // 计算 order（追加到目标 folder 末尾）
    const sameFolder = Object.values(data.items).filter((it) => it.folderId === img.folderId);
    const maxOrder = sameFolder.reduce(
      (m, it) => (typeof it.order === 'number' ? Math.max(m, it.order) : m),
      -1,
    );

    const newItem: ImageLibraryItem = {
      id: generateUuid(),
      folderId: img.folderId,
      url: img.url,
      filename: img.filename,
      source: 'local',
      order: maxOrder + 1,
      created_at: new Date().toISOString(),
    };
    data.items[newItem.id] = newItem;
    counters.itemsAdded++;
  }
}

/**
 * 简单 UUID 生成（与 db-main.ts 中的 uuid4 一致）
 * 放在函数内部是为了让纯函数不依赖 db-main.ts
 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 全量同步磁盘 data/images → DB
 *
 * 三步：
 * 1. 递归同步 folders（创建/复用 DB 记录）
 * 2. 递归收集磁盘图片
 * 3. 同步 items（新增/删除）
 *
 * @param data DB 数据（会被原地修改）
 * @param imagesDir 根目录（data/images/）
 * @returns 统计结果
 */
export function syncDiskToDbPure(
  data: ImageLibraryData,
  imagesDir: string,
): SyncDiskToDbResult {
  const counters: SyncDiskToDbResult = {
    foldersCreated: 0,
    foldersReused: 0,
    itemsAdded: 0,
    itemsDeleted: 0,
  };

  // Step 1: 递归同步 folders
  syncFoldersRecursive(imagesDir, null, data, counters);

  // Step 2: 收集磁盘图片
  const diskImages: DiskImageInfo[] = [];
  collectDiskImages(imagesDir, null, imagesDir, data, diskImages);

  // Step 3: 同步 items
  syncItems(diskImages, data, counters);

  return counters;
}
