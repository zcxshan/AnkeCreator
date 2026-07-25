// ============================================================
// syncDiskToDbPure 单元测试
//
// 测试场景（与计划文档同步）：
// - T1:  空目录 → 计数器全为 0，data 不变
// - T2:  单层子目录 A/1.png → 创建 1 folder + 1 item
// - T3:  嵌套 A/B/1.png → 创建 2 folders + 1 item，parentId 链正确
// - T4:  DB 已有同名同父级 folder → 复用 folderId
// - T5:  磁盘新增图片 → itemsAdded++
// - T6:  磁盘删除图片（DB 有但磁盘没有）→ itemsDeleted++
// - T7:  source='url' 的 item 磁盘上不存在 → 不删除
// - T8:  跳过隐藏目录 .hidden/ 和隐藏文件 .hidden.png
// - T9:  跳过非图片文件 readme.txt
// - T10: DB 已有 folder A/B，磁盘新增 A/B/C/1.png → 复用 A、B，新建 C
// - T11: 多级嵌套 A/B/C/D/1.png → 4 folders + 1 item，folderId 链 A→B→C→D
// - T12: 根目录图片 + 子目录图片并存，URL 格式正确
// - T13: order 字段正确计算（追加到目标 folder 末尾）
// - T14: 重复调用幂等性（无变更时不新增不删除）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  syncDiskToDbPure,
  type ImageLibraryData,
} from './syncDiskToDb';

let tmpDir: string;
let imagesDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-disk-to-db-'));
  imagesDir = path.join(tmpDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/** 在 imagesDir 下创建文件（rel 用正斜杠） */
function writeFile(rel: string, content = 'fake-img'): void {
  const full = path.join(imagesDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** 创建空的 ImageLibraryData */
function emptyData(): ImageLibraryData {
  return { folders: {}, items: {} };
}

/** 在 data 中手动添加一个 folder，返回 folderId */
function addFolder(
  data: ImageLibraryData,
  name: string,
  parentId: string | null,
): string {
  const id = `folder-${name}-${parentId ?? 'root'}`;
  const now = new Date().toISOString();
  data.folders[id] = { id, name, parentId, created_at: now, updated_at: now };
  return id;
}

/** 在 data 中手动添加一个 item */
function addItem(
  data: ImageLibraryData,
  opts: {
    folderId: string | null;
    url: string;
    filename: string;
    source?: 'local' | 'url';
    order?: number;
  },
): string {
  const id = `item-${Math.random().toString(36).slice(2, 10)}`;
  data.items[id] = {
    id,
    folderId: opts.folderId,
    url: opts.url,
    filename: opts.filename,
    source: opts.source ?? 'local',
    order: opts.order ?? 0,
    created_at: new Date().toISOString(),
  };
  return id;
}

describe('syncDiskToDbPure', () => {
  // T1: 空目录 → 计数器全为 0，data 不变
  it('T1: 空目录 → 计数器全为 0，data 不变', () => {
    const data = emptyData();
    const result = syncDiskToDbPure(data, imagesDir);
    expect(result).toEqual({
      foldersCreated: 0,
      foldersReused: 0,
      itemsAdded: 0,
      itemsDeleted: 0,
    });
    expect(Object.keys(data.folders)).toHaveLength(0);
    expect(Object.keys(data.items)).toHaveLength(0);
  });

  // T2: 单层子目录 A/1.png → 创建 1 folder + 1 item
  it('T2: 单层子目录 A/1.png → 创建 1 folder + 1 item', () => {
    writeFile('A/1.png');
    const data = emptyData();
    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(1);
    expect(result.itemsAdded).toBe(1);

    const folders = Object.values(data.folders);
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('A');
    expect(folders[0].parentId).toBeNull();

    const items = Object.values(data.items);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('local:///A/1.png');
    expect(items[0].folderId).toBe(folders[0].id);
    expect(items[0].source).toBe('local');
    expect(items[0].filename).toBe('1'); // 扩展名被剥离
  });

  // T3: 嵌套 A/B/1.png → 创建 2 folders + 1 item，parentId 链正确
  it('T3: 嵌套 A/B/1.png → 创建 2 folders + 1 item，parentId 链正确', () => {
    writeFile('A/B/1.png');
    const data = emptyData();
    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(2);
    expect(result.itemsAdded).toBe(1);

    const folderA = Object.values(data.folders).find((f) => f.name === 'A' && f.parentId === null);
    const folderB = Object.values(data.folders).find((f) => f.name === 'B');
    expect(folderA).toBeDefined();
    expect(folderB).toBeDefined();
    expect(folderB!.parentId).toBe(folderA!.id);

    const items = Object.values(data.items);
    expect(items[0].url).toBe('local:///A/B/1.png');
    expect(items[0].folderId).toBe(folderB!.id);
  });

  // T4: DB 已有同名同父级 folder → 复用 folderId，不重复创建
  it('T4: DB 已有同名同父级 folder → 复用 folderId', () => {
    writeFile('A/1.png');
    const data = emptyData();
    const existingFolderId = addFolder(data, 'A', null);

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(0);
    expect(result.foldersReused).toBe(1);
    expect(Object.keys(data.folders)).toHaveLength(1);
    expect(data.folders[existingFolderId]).toBeDefined();

    // 新增的 item 应挂到已有的 folderId 上
    const items = Object.values(data.items);
    expect(items).toHaveLength(1);
    expect(items[0].folderId).toBe(existingFolderId);
  });

  // T5: 磁盘新增图片 → itemsAdded++
  it('T5: 磁盘新增图片 → itemsAdded++', () => {
    writeFile('A/1.png');
    writeFile('A/2.png');
    const data = emptyData();
    const folderId = addFolder(data, 'A', null);
    // DB 已有 1.png
    addItem(data, { folderId, url: 'local:///A/1.png', filename: '1' });

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.itemsAdded).toBe(1);
    expect(result.itemsDeleted).toBe(0);
    expect(Object.values(data.items)).toHaveLength(2);
    const urls = Object.values(data.items).map((it) => it.url);
    expect(urls).toContain('local:///A/1.png');
    expect(urls).toContain('local:///A/2.png');
  });

  // T6: 磁盘删除图片（DB 有但磁盘没有）→ itemsDeleted++，仅 source='local'
  it('T6: 磁盘删除图片 → itemsDeleted++（仅 local 图片）', () => {
    // 磁盘上只有 1.png
    writeFile('A/1.png');
    const data = emptyData();
    const folderId = addFolder(data, 'A', null);
    // DB 中有 1.png（磁盘存在）和 2.png（磁盘不存在，孤儿）
    addItem(data, { folderId, url: 'local:///A/1.png', filename: '1' });
    const orphanId = addItem(data, { folderId, url: 'local:///A/2.png', filename: '2' });

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.itemsAdded).toBe(0);
    expect(result.itemsDeleted).toBe(1);
    expect(data.items[orphanId]).toBeUndefined();
    // 1.png 仍保留
    const remaining = Object.values(data.items);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].url).toBe('local:///A/1.png');
  });

  // T7: source='url' 的 item 磁盘上不存在 → 不删除
  it('T7: source=url 的 item 磁盘上不存在 → 不删除', () => {
    const data = emptyData();
    // URL 图片，磁盘上本就没有
    const urlItemId = addItem(data, {
      folderId: null,
      url: 'https://example.com/remote.png',
      filename: 'remote',
      source: 'url',
    });

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.itemsDeleted).toBe(0);
    expect(data.items[urlItemId]).toBeDefined();
    expect(data.items[urlItemId].url).toBe('https://example.com/remote.png');
  });

  // T8: 跳过隐藏目录 .hidden/ 和隐藏文件 .hidden.png
  it('T8: 跳过隐藏目录 .hidden/ 和隐藏文件 .hidden.png', () => {
    writeFile('.hidden/1.png');
    writeFile('.hidden.png');
    writeFile('visible.png');
    const data = emptyData();

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(0);
    expect(result.itemsAdded).toBe(1);
    const items = Object.values(data.items);
    expect(items[0].url).toBe('local:///visible.png');
  });

  // T9: 跳过非图片文件 readme.txt
  it('T9: 跳过非图片文件 readme.txt', () => {
    writeFile('readme.txt');
    writeFile('real.png');
    const data = emptyData();

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.itemsAdded).toBe(1);
    const items = Object.values(data.items);
    expect(items[0].url).toBe('local:///real.png');
  });

  // T10: DB 已有 folder A/B，磁盘新增 A/B/C/1.png → 复用 A、B，新建 C + 1 item
  it('T10: DB 已有 A/B，磁盘新增 A/B/C/1.png → 复用 A、B，新建 C', () => {
    writeFile('A/B/C/1.png');
    const data = emptyData();
    const folderAId = addFolder(data, 'A', null);
    const folderBId = addFolder(data, 'B', folderAId);

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(1); // 只新建 C
    expect(result.foldersReused).toBe(2); // 复用 A、B
    expect(result.itemsAdded).toBe(1);

    const folderC = Object.values(data.folders).find(
      (f) => f.name === 'C' && f.parentId === folderBId,
    );
    expect(folderC).toBeDefined();

    const items = Object.values(data.items);
    expect(items[0].url).toBe('local:///A/B/C/1.png');
    expect(items[0].folderId).toBe(folderC!.id);
  });

  // T11: 多级嵌套 A/B/C/D/1.png → 4 folders + 1 item，folderId 链 A→B→C→D
  it('T11: 多级嵌套 A/B/C/D/1.png → 4 folders + 1 item，parentId 链正确', () => {
    writeFile('A/B/C/D/1.png');
    const data = emptyData();

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(4);
    expect(result.itemsAdded).toBe(1);

    const folderA = Object.values(data.folders).find((f) => f.name === 'A' && f.parentId === null);
    const folderB = Object.values(data.folders).find((f) => f.name === 'B');
    const folderC = Object.values(data.folders).find((f) => f.name === 'C');
    const folderD = Object.values(data.folders).find((f) => f.name === 'D');

    expect(folderA).toBeDefined();
    expect(folderB!.parentId).toBe(folderA!.id);
    expect(folderC!.parentId).toBe(folderB!.id);
    expect(folderD!.parentId).toBe(folderC!.id);

    const items = Object.values(data.items);
    expect(items[0].url).toBe('local:///A/B/C/D/1.png');
    expect(items[0].folderId).toBe(folderD!.id);
  });

  // T12: 根目录图片 + 子目录图片并存，URL 格式正确
  it('T12: 根目录图片 + 子目录图片并存，URL 格式正确', () => {
    writeFile('root.png');
    writeFile('A/sub.png');
    const data = emptyData();

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(1);
    expect(result.itemsAdded).toBe(2);

    const urls = Object.values(data.items).map((it) => it.url).sort();
    expect(urls).toEqual(['local:///A/sub.png', 'local:///root.png']);

    // 根目录图片的 folderId 为 null
    const rootItem = Object.values(data.items).find((it) => it.url === 'local:///root.png');
    expect(rootItem!.folderId).toBeNull();
  });

  // T13: order 字段正确计算（追加到目标 folder 末尾）
  // existing.png 也在磁盘上（避免被 syncItems 删除），DB 中已有 order=5
  // 新增 new1、new2 的 order 应该是 6、7（追加到末尾）
  it('T13: order 字段正确计算（追加到末尾）', () => {
    writeFile('A/existing.png');
    writeFile('A/new1.png');
    writeFile('A/new2.png');
    const data = emptyData();
    const folderId = addFolder(data, 'A', null);
    // DB 已有 order=5 的 item
    addItem(data, { folderId, url: 'local:///A/existing.png', filename: 'existing', order: 5 });

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.itemsAdded).toBe(2);
    expect(result.itemsDeleted).toBe(0); // existing.png 仍在磁盘，不删除
    const newItems = Object.values(data.items).filter(
      (it) => it.url !== 'local:///A/existing.png',
    );
    // syncItems 内 for 循环按 diskImages 顺序处理：
    //   - 第一个新 item 的 maxOrder=5（来自 existing）→ order=6
    //   - 第二个新 item 此时 sameFolder 包含第一个新 item（已写入 data.items），maxOrder=6 → order=7
    const orders = newItems.map((it) => it.order).sort();
    expect(orders).toEqual([6, 7]);
  });

  // T14: 重复调用幂等性（无变更时不新增不删除）
  it('T14: 重复调用幂等性（第二次调用无变更）', () => {
    writeFile('A/1.png');
    writeFile('A/2.png');

    const data = emptyData();
    const r1 = syncDiskToDbPure(data, imagesDir);
    expect(r1.foldersCreated).toBe(1);
    expect(r1.itemsAdded).toBe(2);

    // 第二次调用：磁盘和 DB 一致，不应有变更
    const r2 = syncDiskToDbPure(data, imagesDir);
    expect(r2).toEqual({
      foldersCreated: 0,
      foldersReused: 1, // 复用已有的 A
      itemsAdded: 0,
      itemsDeleted: 0,
    });

    // items 数量不变
    expect(Object.keys(data.items)).toHaveLength(2);
  });

  // T15: 混合场景 - 多个文件夹、嵌套、URL 图片共存
  it('T15: 混合场景 - 多文件夹 + 嵌套 + URL 图片', () => {
    writeFile('A/1.png');
    writeFile('A/2.jpg');
    writeFile('B/C/3.gif');
    writeFile('root.webp');
    const data = emptyData();
    // DB 中已有 URL 图片（不动）
    const urlItemId = addItem(data, {
      folderId: null,
      url: 'https://example.com/a.png',
      filename: 'a',
      source: 'url',
    });

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(3); // A, B, C
    expect(result.itemsAdded).toBe(4); // 1.png, 2.jpg, 3.gif, root.webp
    expect(result.itemsDeleted).toBe(0);

    // URL 图片保留
    expect(data.items[urlItemId]).toBeDefined();

    const urls = Object.values(data.items).map((it) => it.url).sort();
    expect(urls).toContain('local:///A/1.png');
    expect(urls).toContain('local:///A/2.jpg');
    expect(urls).toContain('local:///B/C/3.gif');
    expect(urls).toContain('local:///root.webp');
    expect(urls).toContain('https://example.com/a.png');
  });

  // T16: 文件夹复用但磁盘上文件夹被删除 → 不删除 DB folder 记录（只增不删 folders）
  it('T16: 磁盘上文件夹被删除 → 不删除 DB folder 记录（只增不删 folders）', () => {
    // 磁盘上没有 A 文件夹了
    const data = emptyData();
    const folderAId = addFolder(data, 'A', null);
    // DB 中有 A 文件夹下的孤儿 item
    const orphanItemId = addItem(data, {
      folderId: folderAId,
      url: 'local:///A/1.png',
      filename: '1',
    });

    const result = syncDiskToDbPure(data, imagesDir);

    // folder A 不删除（只增不删 folders）
    expect(data.folders[folderAId]).toBeDefined();
    // 但孤儿 item 删除
    expect(result.itemsDeleted).toBe(1);
    expect(data.items[orphanItemId]).toBeUndefined();
  });

  // T17: 同名文件夹在不同父级下应分别创建
  it('T17: 同名文件夹在不同父级下应分别创建', () => {
    writeFile('A/sub/1.png');
    writeFile('B/sub/2.png');
    const data = emptyData();

    const result = syncDiskToDbPure(data, imagesDir);

    expect(result.foldersCreated).toBe(4); // A, A/sub, B, B/sub
    const subFolders = Object.values(data.folders).filter((f) => f.name === 'sub');
    expect(subFolders).toHaveLength(2);
    // 两个 sub 的 parentId 不同
    const parentIds = new Set(subFolders.map((f) => f.parentId));
    expect(parentIds.size).toBe(2);
  });
});
