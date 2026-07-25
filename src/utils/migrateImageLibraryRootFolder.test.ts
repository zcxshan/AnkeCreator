// v14：migrateV13RootFolderBug 单元测试
// TDD: 5 个测试场景
//
// 真实场景：v13 修复了 handleLocalUpload 的 folders.find bug，但副作用是
// 根目录上传时把 folderName='根目录' 传给 saveImageLocal，导致文件被存到
// data/images/根目录/ 子目录，url 也变成了 'local://根目录/xxx.png'
// 本函数启动时自动调用，把物理文件移回根目录，url 改回 'local://xxx.png'

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateV13RootFolderBug, type ImageLibraryMigrateItem } from './migrateImageLibraryRootFolder';

let tmpDir: string;
let imagesDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-root-folder-'));
  imagesDir = path.join(tmpDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/** 写一个测试文件 */
function writeFile(rel: string, content = 'fake-png-data'): string {
  const full = path.join(imagesDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

describe('migrateV13RootFolderBug', () => {
  // T1: url='local://根目录/1.png' + 文件存在于 根目录/1.png
  //     → 移动文件到 1.png + 改 url + 删空目录
  it('T1: 修复 url 含 根目录 前缀的 item（移动文件 + 改 url + 删空目录）', () => {
    writeFile('根目录/1.png');
    const items: ImageLibraryMigrateItem[] = [
      { id: 'item-1', url: 'local://根目录/1.png', folderId: null },
    ];
    const result = migrateV13RootFolderBug(items, imagesDir);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual({
      id: 'item-1',
      oldUrl: 'local://根目录/1.png',
      newUrl: 'local:///1.png',
      reason: 'v13-root-folder-pollution',
    });
    expect(items[0].url).toBe('local:///1.png'); // 原地修改
    expect(fs.existsSync(path.join(imagesDir, '1.png'))).toBe(true); // 文件已移动
    expect(fs.existsSync(path.join(imagesDir, '根目录'))).toBe(false); // 空目录已删
    expect(result.deletedRootDir).toBe(true);
  });

  // T2: 正常 url='local://001/4.png' → 不变
  it('T2: 正常的 local://001/4.png 不动', () => {
    writeFile('001/4.png');
    const items: ImageLibraryMigrateItem[] = [
      { id: 'item-2', url: 'local://001/4.png', folderId: 'folder-001' },
    ];
    const result = migrateV13RootFolderBug(items, imagesDir);
    expect(result.changes).toHaveLength(0);
    expect(items[0].url).toBe('local://001/4.png');
    expect(fs.existsSync(path.join(imagesDir, '001', '4.png'))).toBe(true);
  });

  // T3: URL 图片 (http://) → 不变
  it('T3: URL 图片（http://）不动', () => {
    const items: ImageLibraryMigrateItem[] = [
      { id: 'item-3', url: 'https://i.imgur.com/abc.png', folderId: null },
      { id: 'item-4', url: 'http://example.com/x.jpg', folderId: null },
    ];
    const result = migrateV13RootFolderBug(items, imagesDir);
    expect(result.changes).toHaveLength(0);
    expect(items[0].url).toBe('https://i.imgur.com/abc.png');
    expect(items[1].url).toBe('http://example.com/x.jpg');
  });

  // T4: 多个 item 混合 → 只处理 根目录 前缀的
  it('T4: 混合 item 只处理 根目录 前缀', () => {
    writeFile('根目录/1.png');
    writeFile('根目录/2.png');
    writeFile('001/4.png');
    const items: ImageLibraryMigrateItem[] = [
      { id: 'item-1', url: 'local://根目录/1.png', folderId: null },
      { id: 'item-2', url: 'local://001/4.png', folderId: 'folder-001' },
      { id: 'item-3', url: 'local://根目录/2.png', folderId: null },
      { id: 'item-4', url: 'https://example.com/a.png', folderId: null },
    ];
    const result = migrateV13RootFolderBug(items, imagesDir);
    expect(result.changes).toHaveLength(2);
    expect(items[0].url).toBe('local:///1.png');
    expect(items[1].url).toBe('local://001/4.png'); // 不变
    expect(items[2].url).toBe('local:///2.png');
    expect(items[3].url).toBe('https://example.com/a.png'); // 不变
    expect(fs.existsSync(path.join(imagesDir, '1.png'))).toBe(true);
    expect(fs.existsSync(path.join(imagesDir, '2.png'))).toBe(true);
    expect(fs.existsSync(path.join(imagesDir, '001', '4.png'))).toBe(true);
    expect(result.deletedRootDir).toBe(true);
  });

  // T5: 根目录目录非空 → 不删（保护用户数据）
  it('T5: 根目录目录非空时不删除（保护用户数据）', () => {
    writeFile('根目录/1.png');
    writeFile('根目录/extra.txt'); // 模拟用户额外放的文件
    const items: ImageLibraryMigrateItem[] = [
      { id: 'item-1', url: 'local://根目录/1.png', folderId: null },
    ];
    const result = migrateV13RootFolderBug(items, imagesDir);
    expect(result.changes).toHaveLength(1);
    expect(fs.existsSync(path.join(imagesDir, '1.png'))).toBe(true);
    expect(fs.existsSync(path.join(imagesDir, '根目录', 'extra.txt'))).toBe(true); // 保留
    expect(fs.existsSync(path.join(imagesDir, '根目录'))).toBe(true); // 目录不删
    expect(result.deletedRootDir).toBe(false);
  });

  // 额外: 物理文件不存在（但 DB 有 url）→ 仍然改 url
  it('附加：物理文件不存在但 DB 有污染 url → 仍然修正 url（避免下次打开还显示错）', () => {
    // 不写文件
    const items: ImageLibraryMigrateItem[] = [
      { id: 'item-x', url: 'local://根目录/missing.png', folderId: null },
    ];
    const result = migrateV13RootFolderBug(items, imagesDir);
    expect(result.changes).toHaveLength(1);
    expect(items[0].url).toBe('local:///missing.png');
    expect(result.deletedRootDir).toBe(false); // 目录不存在就不删
  });
});
