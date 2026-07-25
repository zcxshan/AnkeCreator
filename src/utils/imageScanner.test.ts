import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { scanImageDir } from './imageScanner';

describe('scanImageDir - 资源库扫描非递归（v4 测试）', () => {
  let tmpDir: string;

  beforeEach(() => {
    // 在系统临时目录建一个独立的 images 根
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-scan-'));
  });

  afterEach(() => {
    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 写一个真实文件，size 和 mtime 由 fs 自动生成
  function writeFile(rel: string, content = 'x'): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  it('C1：根目录扫描有 a.png 和 001/b.png → 只返回 a.png（不递归）', () => {
    writeFile('a.png');
    writeFile('001/b.png');
    const files = scanImageDir({ baseDir: tmpDir });
    expect(files.map((f) => f.filename)).toEqual(['a.png']);
  });

  it('C2：扫子目录 001 → 001 内有 a.png 和 sub/b.png → 只返回 a.png', () => {
    writeFile('001/a.png');
    writeFile('001/sub/b.png');
    const files = scanImageDir({ baseDir: tmpDir, folderName: '001' });
    expect(files.map((f) => f.filename)).toEqual(['a.png']);
  });

  it('C3：根目录有 001/ 子目录 → 扫描根目录不返回 001 内的文件', () => {
    writeFile('001/b.png');
    writeFile('001/sub/c.png');
    const files = scanImageDir({ baseDir: tmpDir });
    expect(files).toEqual([]);
  });

  it('C4：根目录扫描遇到多种文件 → 只返回图片扩展名', () => {
    writeFile('a.png');
    writeFile('b.jpg');
    writeFile('c.txt');
    writeFile('d.webp');
    writeFile('e.mp4');  // 非图片
    writeFile('.hidden.png');  // 隐藏文件，跳过
    const files = scanImageDir({ baseDir: tmpDir });
    const names = files.map((f) => f.filename).sort();
    expect(names).toEqual(['a.png', 'b.jpg', 'd.webp']);
  });

  it('C5：根目录存在但为空 → 返回空数组', () => {
    const files = scanImageDir({ baseDir: tmpDir });
    expect(files).toEqual([]);
  });

  it('C6：根目录不存在 → 返回空数组（不抛错）', () => {
    const nonExist = path.join(tmpDir, 'non-exist');
    const files = scanImageDir({ baseDir: nonExist });
    expect(files).toEqual([]);
  });

  it('C7：扫子目录时子目录不存在 → 返回空数组（不抛错）', () => {
    writeFile('001/a.png');
    const files = scanImageDir({ baseDir: tmpDir, folderName: 'non-exist-folder' });
    expect(files).toEqual([]);
  });

  it('C8：根目录文件 url 前缀是 "local://"，子目录文件 url 前缀是 "local://<folder>/"', () => {
    writeFile('a.png');
    writeFile('001/a.png');
    const rootFiles = scanImageDir({ baseDir: tmpDir });
    const folderFiles = scanImageDir({ baseDir: tmpDir, folderName: '001' });
    expect(rootFiles[0].url).toBe('local://a.png');
    expect(folderFiles[0].url).toBe('local://001/a.png');
  });

  it('C9：根目录扫描时 folder 字段是 undefined；子目录扫描时 folder 字段是 folderName', () => {
    writeFile('a.png');
    writeFile('001/a.png');
    const rootFiles = scanImageDir({ baseDir: tmpDir });
    const folderFiles = scanImageDir({ baseDir: tmpDir, folderName: '001' });
    expect(rootFiles[0].folder).toBeUndefined();
    expect(folderFiles[0].folder).toBe('001');
  });
});

describe('scanImageDir - 多级嵌套子目录扫描（v7 测试）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-scan-nested-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(rel: string, content = 'x'): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  it('H1：扫多级子目录 folder1/folder2 → url 前缀是 local://folder1/folder2/', () => {
    writeFile('folder1/folder2/a.png');
    const files = scanImageDir({ baseDir: tmpDir, folderName: 'folder1/folder2' });
    expect(files.length).toBe(1);
    expect(files[0].url).toBe('local://folder1/folder2/a.png');
  });

  it('H2：扫多级子目录，url 包含完整相对路径', () => {
    writeFile('a/b/c/d.png');
    const files = scanImageDir({ baseDir: tmpDir, folderName: 'a/b/c' });
    expect(files.length).toBe(1);
    expect(files[0].url).toBe('local://a/b/c/d.png');
  });

  it('H3：扫不存在的多级子目录 → 返回空数组（不抛错）', () => {
    const files = scanImageDir({ baseDir: tmpDir, folderName: 'x/y/z' });
    expect(files).toEqual([]);
  });
});
