// ============================================================
// scanImageDirectory 单元测试 (T1-T9)
//
// 背景：v10 修复资源库子目录泄漏根目录图片 bug。
// - 旧 d04c495 版 image:scanFiles 忽略 folderId、且用 walk() 递归
// - v6 修复后,IPC handler 改用 buildFolderDiskPath(folderId) 解析嵌套路径
// - 同时把扫描逻辑抽成纯函数 (位于 src/utils/scanImageDirectory.ts)
//
// 本测试直接测纯函数,无需 mock electron / IPC。
// - 用 os.tmpdir() + fs.mkdtempSync() 建隔离测试目录
// - 用注入的 resolveFolderPath mock 把 folderId 映射到磁盘路径
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { scanImageDirectory, computeSaveLocalTarget } from './scanImageDirectory';

describe('scanImageDirectory - image:scanFiles 修复后 T1-T9 测试', () => {
  let tmpDir: string;

  beforeEach(() => {
    // 在系统临时目录建一个独立的 images 根
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-scan-ipu-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 写一个真实文件，size 和 mtime 由 fs 自动生成
  function writeFile(rel: string, content = 'x'): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  // 默认 mock:folderId 直接映射到 imagesDir/<folderId>
  // 多级 folderId '001/002' → imagesDir/001/002
  function makeResolver(map: Record<string, string | null> = {}) {
    return (folderId: string): string | null => {
      if (folderId in map) return map[folderId];
      // 默认行为:把 folderId 当作相对路径
      return path.join(tmpDir, folderId);
    };
  }

  it('T1: 不传 folderId → 扫根目录 → 只返回根目录的图', () => {
    writeFile('1.png');
    writeFile('2.png');
    writeFile('001/3.png'); // 子目录里的图
    writeFile('001/002/4.png'); // 多级子目录里的图

    const result = scanImageDirectory({
      imagesDir: tmpDir,
      resolveFolderPath: makeResolver(),
    });
    // 只返回根目录文件
    expect(result.files.map((f) => f.filename).sort()).toEqual(['1.png', '2.png']);
    // url 前缀是 local://
    expect(result.files[0].url.startsWith('local://')).toBe(true);
    // 扫描目录 = imagesDir
    expect(result.scanDir).toBe(tmpDir);
  });

  it('T2: 传 folderId="001" + resolveFolderPath → 扫 imagesDir/001/ → 只返回 001 的图(不返回根目录)', () => {
    writeFile('1.png');
    writeFile('2.png');
    writeFile('001/3.png');
    writeFile('001/4.png');

    const result = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001',
      resolveFolderPath: makeResolver({ '001': path.join(tmpDir, '001') }),
    });
    // 只返回 001 内的图
    expect(result.files.map((f) => f.filename).sort()).toEqual(['3.png', '4.png']);
    // url 前缀是 local://001/
    expect(result.files.every((f) => f.url.startsWith('local:///001/'))).toBe(true);
    // 扫描目录 = imagesDir/001
    expect(result.scanDir).toBe(path.join(tmpDir, '001'));
    // **关键断言**:根目录的 1.png / 2.png 绝不能出现(本 bug 的核心)
    expect(result.files.find((f) => f.filename === '1.png')).toBeUndefined();
    expect(result.files.find((f) => f.filename === '2.png')).toBeUndefined();
  });

  it('T3: 传 folderId 但 resolveFolderPath 返回 null → 回退扫根目录(防错)', () => {
    writeFile('1.png');
    writeFile('001/3.png');

    const result = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: 'invalid-folder-id',
      resolveFolderPath: makeResolver({ 'invalid-folder-id': null }),
    });
    // folderId 无效 → 回退扫根目录
    expect(result.files.map((f) => f.filename)).toEqual(['1.png']);
    expect(result.scanDir).toBe(tmpDir);
  });

  it('T4: 传多级 folderId="001/002" → 扫 imagesDir/001/002/ → 只返回 002 的图', () => {
    writeFile('1.png');
    writeFile('001/3.png');
    writeFile('001/002/4.png');
    writeFile('001/002/5.png');

    const result = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001/002',
      resolveFolderPath: makeResolver({
        '001/002': path.join(tmpDir, '001', '002'),
      }),
    });
    // 只返回 001/002 内的图
    expect(result.files.map((f) => f.filename).sort()).toEqual(['4.png', '5.png']);
    // url 前缀是 local://001/002/
    expect(result.files.every((f) => f.url.startsWith('local:///001/002/'))).toBe(true);
    // 扫描目录
    expect(result.scanDir).toBe(path.join(tmpDir, '001', '002'));
    // 根目录和 001 的图都不能出现
    expect(result.files.find((f) => f.filename === '1.png')).toBeUndefined();
    expect(result.files.find((f) => f.filename === '3.png')).toBeUndefined();
  });

  it('T5: 不传参数 → 扫根目录 → 只返回根目录文件(非递归,符合 v4 需求)', () => {
    writeFile('a.png');
    writeFile('b.jpg');
    writeFile('001/c.png'); // 子目录里的图
    writeFile('001/sub/d.png'); // 多级子目录里的图

    const result = scanImageDirectory({
      imagesDir: tmpDir,
      resolveFolderPath: makeResolver(),
    });
    // 只返回根目录文件,严格非递归
    const names = result.files.map((f) => f.filename).sort();
    expect(names).toEqual(['a.png', 'b.jpg']);
    // 001/c.png 和 001/sub/d.png 绝不能出现
    expect(result.files.find((f) => f.filename === 'c.png')).toBeUndefined();
    expect(result.files.find((f) => f.filename === 'd.png')).toBeUndefined();
  });

  it('T6: 扫描时跳过隐藏文件、非图片扩展名、子目录', () => {
    writeFile('a.png');
    writeFile('b.txt');           // 非图片
    writeFile('.hidden.png');     // 隐藏文件
    writeFile('c.webp');
    // 创建子目录(本身不是图,扫描应该跳过)
    fs.mkdirSync(path.join(tmpDir, '001'), { recursive: true });
    writeFile('001/d.png');

    const result = scanImageDirectory({
      imagesDir: tmpDir,
      resolveFolderPath: makeResolver(),
    });
    const names = result.files.map((f) => f.filename).sort();
    expect(names).toEqual(['a.png', 'c.webp']);
  });

  it('T7: 扫描目录不存在 → 返回空数组(不抛错)', () => {
    const nonExist = path.join(tmpDir, 'non-exist');
    const result = scanImageDirectory({
      imagesDir: nonExist,
      resolveFolderPath: makeResolver(),
    });
    expect(result.files).toEqual([]);
    expect(result.scanDir).toBe(nonExist);
  });

  it('T8: folderId 指向不存在的子目录 → 返回空数组(不抛错)', () => {
    writeFile('1.png'); // 根目录有图,但 folderId 指向不存在的子目录
    const result = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: 'no-such-folder',
      resolveFolderPath: makeResolver({
        'no-such-folder': path.join(tmpDir, 'no-such-folder'),
      }),
    });
    // 目标子目录不存在 → 空数组(不抛错,也不回退根目录)
    expect(result.files).toEqual([]);
    expect(result.scanDir).toBe(path.join(tmpDir, 'no-such-folder'));
  });

  it('T9: 传 folderName (旧版兼容) → 扫 imagesDir/<folderName>/ → 只返回该子目录的图', () => {
    writeFile('1.png');
    writeFile('001/3.png');

    const result = scanImageDirectory({
      imagesDir: tmpDir,
      folderName: '001',
      resolveFolderPath: makeResolver(),
    });
    // 旧版 folderName 也只扫指定子目录
    expect(result.files.map((f) => f.filename)).toEqual(['3.png']);
    expect(result.files[0].url).toBe('local:///001/3.png');
  });

  // 用户实际场景模拟: 根目录 5 张图, 001 子目录里没有任何图
  // 修复前:进入 001 子目录会显示 5 张图(泄漏)
  // 修复后:进入 001 子目录应该显示 0 张图
  it('T10: 用户实测场景 - 根目录 5 张图, 001 子目录空 → 进入 001 应返回 0 张图(原 bug 根因)', () => {
    // 模拟用户实际数据: 根目录有 1.png - 5.png, 001 子目录为空
    writeFile('1.png');
    writeFile('2.png');
    writeFile('3.png');
    writeFile('4.png');
    writeFile('5.png');
    fs.mkdirSync(path.join(tmpDir, '001'), { recursive: true });
    // 001 目录里没有图

    // 模拟用户进入 001 子目录(folderId = '001')
    const result = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001',
      resolveFolderPath: makeResolver({ '001': path.join(tmpDir, '001') }),
    });

    // **关键断言: 必须返回 0 张图(根目录的 1-5 绝不能泄漏到 001)**
    expect(result.files).toEqual([]);
    expect(result.scanDir).toBe(path.join(tmpDir, '001'));

    // 根目录扫描仍然正常(不受影响)
    const rootResult = scanImageDirectory({
      imagesDir: tmpDir,
      resolveFolderPath: makeResolver(),
    });
    expect(rootResult.files.map((f) => f.filename).sort()).toEqual([
      '1.png', '2.png', '3.png', '4.png', '5.png',
    ]);
  });

  // T11: 兄弟目录隔离 - 001 和 002 各自只显示自己的图,根目录只显示自己的图
  it('T11: 兄弟目录隔离 - 根/001/002 互不串扰', () => {
    // 根目录: 3 张图
    writeFile('root-a.png');
    writeFile('root-b.png');
    writeFile('root-c.png');
    // 001 子目录: 2 张图
    writeFile('001/001-x.png');
    writeFile('001/001-y.png');
    // 002 子目录: 1 张图
    writeFile('002/002-z.png');

    // 扫根 → 3 张
    const root = scanImageDirectory({
      imagesDir: tmpDir,
      resolveFolderPath: makeResolver(),
    });
    expect(root.files.map((f) => f.filename).sort()).toEqual(['root-a.png', 'root-b.png', 'root-c.png']);

    // 扫 001 → 2 张,只有 001 自己的图
    const r001 = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001',
      resolveFolderPath: makeResolver({ '001': path.join(tmpDir, '001') }),
    });
    expect(r001.files.map((f) => f.filename).sort()).toEqual(['001-x.png', '001-y.png']);
    expect(r001.files.every((f) => f.url.startsWith('local:///001/'))).toBe(true);
    // 根目录和 002 的图绝对不能出现
    expect(r001.files.find((f) => f.filename === 'root-a.png')).toBeUndefined();
    expect(r001.files.find((f) => f.filename === '002-z.png')).toBeUndefined();

    // 扫 002 → 1 张,只有 002 自己的图
    const r002 = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '002',
      resolveFolderPath: makeResolver({ '002': path.join(tmpDir, '002') }),
    });
    expect(r002.files.map((f) => f.filename).sort()).toEqual(['002-z.png']);
    expect(r002.files.every((f) => f.url.startsWith('local:///002/'))).toBe(true);
    expect(r002.files.find((f) => f.filename === 'root-a.png')).toBeUndefined();
    expect(r002.files.find((f) => f.filename === '001-x.png')).toBeUndefined();
  });

  // T12: 嵌套目录互不干扰 - 001/002 和 001/003 各自独立
  it('T12: 嵌套目录隔离 - 001/001/002/001/003 互不串扰', () => {
    // 001 顶级: 1 张图
    writeFile('001/a.png');
    // 001/002 嵌套: 3 张图
    writeFile('001/002/b1.png');
    writeFile('001/002/b2.png');
    writeFile('001/002/b3.png');
    // 001/003 嵌套: 2 张图
    writeFile('001/003/c1.png');
    writeFile('001/003/c2.png');

    // 扫 001 → 1 张,只有 001 自己的
    const r001 = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001',
      resolveFolderPath: makeResolver({ '001': path.join(tmpDir, '001') }),
    });
    expect(r001.files.map((f) => f.filename)).toEqual(['a.png']);
    expect(r001.files.find((f) => f.filename === 'b1.png')).toBeUndefined();
    expect(r001.files.find((f) => f.filename === 'c1.png')).toBeUndefined();

    // 扫 001/002 → 3 张,只有 002 自己的
    const r002 = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001/002',
      resolveFolderPath: makeResolver({
        '001/002': path.join(tmpDir, '001', '002'),
      }),
    });
    expect(r002.files.map((f) => f.filename).sort()).toEqual(['b1.png', 'b2.png', 'b3.png']);
    expect(r002.files.every((f) => f.url.startsWith('local:///001/002/'))).toBe(true);
    expect(r002.files.find((f) => f.filename === 'a.png')).toBeUndefined();
    expect(r002.files.find((f) => f.filename === 'c1.png')).toBeUndefined();

    // 扫 001/003 → 2 张,只有 003 自己的
    const r003 = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001/003',
      resolveFolderPath: makeResolver({
        '001/003': path.join(tmpDir, '001', '003'),
      }),
    });
    expect(r003.files.map((f) => f.filename).sort()).toEqual(['c1.png', 'c2.png']);
    expect(r003.files.every((f) => f.url.startsWith('local:///001/003/'))).toBe(true);
    expect(r003.files.find((f) => f.filename === 'a.png')).toBeUndefined();
    expect(r003.files.find((f) => f.filename === 'b1.png')).toBeUndefined();
  });

  // T13: 深层嵌套 (3+ 级) - 001/002/003 不应显示 001/002 自己的图
  it('T13: 3 级嵌套 - 001/002/003 只显示自己,父级 001/002 扫不到', () => {
    // 001/002 顶级: 1 张图
    writeFile('001/002/x.png');
    // 001/002/003 嵌套: 2 张图
    writeFile('001/002/003/y1.png');
    writeFile('001/002/003/y2.png');

    // 扫 001/002 → 1 张,只有 x.png
    const r002 = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001/002',
      resolveFolderPath: makeResolver({
        '001/002': path.join(tmpDir, '001', '002'),
      }),
    });
    expect(r002.files.map((f) => f.filename)).toEqual(['x.png']);
    // 003 子目录里的图不能泄漏到 001/002
    expect(r002.files.find((f) => f.filename === 'y1.png')).toBeUndefined();
    expect(r002.files.find((f) => f.filename === 'y2.png')).toBeUndefined();

    // 扫 001/002/003 → 2 张,只有 y1 y2
    const r003 = scanImageDirectory({
      imagesDir: tmpDir,
      folderId: '001/002/003',
      resolveFolderPath: makeResolver({
        '001/002/003': path.join(tmpDir, '001', '002', '003'),
      }),
    });
    expect(r003.files.map((f) => f.filename).sort()).toEqual(['y1.png', 'y2.png']);
    expect(r003.files.every((f) => f.url.startsWith('local:///001/002/003/'))).toBe(true);
    expect(r003.files.find((f) => f.filename === 'x.png')).toBeUndefined();
  });
});

describe('computeSaveLocalTarget - image:saveLocal 目标路径解析 T14-T15', () => {
  const imagesDir = '/fake/images';

  // T14: 单层 folderId="001" → 写入 images/001/,URL 前缀 local://001/
  it('T14: folderId="001" → destDir=images/001,urlPrefix=local://001/', () => {
    const target = computeSaveLocalTarget({
      imagesDir,
      folderId: '001',
      resolveFolderPath: (id) => (id === '001' ? '/fake/images/001' : null),
    });
    expect(target.destDir).toBe('/fake/images/001');
    expect(target.urlPrefix).toBe('local:///001/');
  });

  // T15: 多级 folderId="001/002" → 写入 images/001/002/,URL 前缀 local://001/002/
  it('T15: folderId="001/002" 嵌套 → destDir=images/001/002,urlPrefix=local://001/002/', () => {
    const target = computeSaveLocalTarget({
      imagesDir,
      folderId: '001/002',
      resolveFolderPath: (id) => (id === '001/002' ? '/fake/images/001/002' : null),
    });
    expect(target.destDir).toBe('/fake/images/001/002');
    expect(target.urlPrefix).toBe('local:///001/002/');
  });

  // T16: folderId 无效 → 回退根目录
  it('T16: folderId 无效 (resolveFolderPath 返回 null) → 回退根目录', () => {
    const target = computeSaveLocalTarget({
      imagesDir,
      folderId: 'invalid',
      resolveFolderPath: () => null,
    });
    expect(target.destDir).toBe('/fake/images');
    expect(target.urlPrefix).toBe('local:///');
  });

  // T17: 不传 folderId/folderName → 根目录
  it('T17: 不传参数 → 根目录,local://', () => {
    const target = computeSaveLocalTarget({
      imagesDir,
      resolveFolderPath: () => null,
    });
    expect(target.destDir).toBe('/fake/images');
    expect(target.urlPrefix).toBe('local:///');
  });

  // T18: 旧版 folderName="001" 兼容 → 拼接到 images/001/,URL local://001/
  it('T18: folderName="001" 旧版兼容 → destDir=images/001,urlPrefix=local://001/', () => {
    const target = computeSaveLocalTarget({
      imagesDir,
      folderName: '001',
      resolveFolderPath: () => null,
    });
    // 用 path.join 兼容 Windows/Unix 分隔符
    expect(target.destDir).toBe(path.join('/fake/images', '001'));
    expect(target.urlPrefix).toBe('local:///001/');
  });

  // T19: 同时传 folderId + folderName → folderId 优先
  it('T19: 同时传 folderId + folderName → folderId 优先', () => {
    const target = computeSaveLocalTarget({
      imagesDir,
      folderId: '001',
      folderName: '999', // 应该被忽略
      resolveFolderPath: (id) => (id === '001' ? '/fake/images/001' : null),
    });
    expect(target.destDir).toBe('/fake/images/001');
    expect(target.urlPrefix).toBe('local:///001/');
  });
});
