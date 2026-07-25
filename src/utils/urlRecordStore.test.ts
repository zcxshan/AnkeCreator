import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { appendUrlRecord, readUrlRecords, removeUrlRecord } from './urlRecordStore';

describe('appendUrlRecord - URL 上传记录写入 .urls.json（v5 测试）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-record-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRecord(overrides: Partial<{ url: string; filename: string; created_at: string }> = {}) {
    return {
      url: 'https://example.com/img.png',
      filename: 'img.png',
      created_at: '2026-07-13T10:00:00.000Z',
      ...overrides,
    };
  }

  it('F1: 在根目录 appendUrlRecord → 创建 .urls.json 并写入记录', () => {
    const res = appendUrlRecord({ dir: tmpDir, record: makeRecord() });
    expect(res.ok).toBe(true);
    expect(res.inserted).toBe(true);
    expect(res.count).toBe(1);

    const file = path.join(tmpDir, '.urls.json');
    expect(fs.existsSync(file)).toBe(true);
    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(arr).toEqual([
      {
        url: 'https://example.com/img.png',
        filename: 'img.png',
        created_at: '2026-07-13T10:00:00.000Z',
      },
    ]);
  });

  it('F2: 在子目录 appendUrlRecord → 子目录有 .urls.json，根目录无', () => {
    const subDir = path.join(tmpDir, '001');
    const res = appendUrlRecord({ dir: subDir, record: makeRecord() });
    expect(res.ok).toBe(true);
    expect(res.inserted).toBe(true);

    expect(fs.existsSync(path.join(subDir, '.urls.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.urls.json'))).toBe(false);
  });

  it('F3: 同一 URL 重复添加 → 只写一次，count 不递增', () => {
    appendUrlRecord({ dir: tmpDir, record: makeRecord() });
    const res2 = appendUrlRecord({ dir: tmpDir, record: makeRecord() });
    expect(res2.ok).toBe(true);
    expect(res2.inserted).toBe(false);
    expect(res2.count).toBe(1);

    const arr = JSON.parse(fs.readFileSync(path.join(tmpDir, '.urls.json'), 'utf-8'));
    expect(arr.length).toBe(1);
  });

  it('F4: 损坏的 .urls.json 自动重置为合法 JSON', () => {
    const file = path.join(tmpDir, '.urls.json');
    fs.writeFileSync(file, 'this is not json {', 'utf-8');

    const res = appendUrlRecord({ dir: tmpDir, record: makeRecord() });
    expect(res.ok).toBe(true);
    expect(res.inserted).toBe(true);
    expect(res.count).toBe(1);

    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(arr.length).toBe(1);
  });

  it('F5: 根目录和子目录各自的 .urls.json 互不干扰', () => {
    appendUrlRecord({
      dir: tmpDir,
      record: makeRecord({ url: 'https://a.com/1.png', filename: '1.png' }),
    });
    appendUrlRecord({
      dir: path.join(tmpDir, '001'),
      record: makeRecord({ url: 'https://a.com/2.png', filename: '2.png' }),
    });
    appendUrlRecord({
      dir: path.join(tmpDir, '002'),
      record: makeRecord({ url: 'https://a.com/3.png', filename: '3.png' }),
    });

    const rootArr = readUrlRecords(tmpDir);
    const d1 = readUrlRecords(path.join(tmpDir, '001'));
    const d2 = readUrlRecords(path.join(tmpDir, '002'));

    expect(rootArr.map((r) => r.url)).toEqual(['https://a.com/1.png']);
    expect(d1.map((r) => r.url)).toEqual(['https://a.com/2.png']);
    expect(d2.map((r) => r.url)).toEqual(['https://a.com/3.png']);
  });

  it('F6: 目录不存在时自动创建', () => {
    const nestedDir = path.join(tmpDir, 'a', 'b', 'c');
    expect(fs.existsSync(nestedDir)).toBe(false);
    const res = appendUrlRecord({ dir: nestedDir, record: makeRecord() });
    expect(res.ok).toBe(true);
    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.existsSync(path.join(nestedDir, '.urls.json'))).toBe(true);
  });

  it('F7: 多级子目录（001/sub）也独立维护自己的 .urls.json', () => {
    const subDir = path.join(tmpDir, '001', 'sub');
    appendUrlRecord({
      dir: subDir,
      record: makeRecord({ url: 'https://a.com/sub1.png', filename: 'sub1.png' }),
    });
    appendUrlRecord({
      dir: subDir,
      record: makeRecord({ url: 'https://a.com/sub2.png', filename: 'sub2.png' }),
    });

    const arr = readUrlRecords(subDir);
    expect(arr.length).toBe(2);
    // 父目录 001 不应有 .urls.json（除非显式 append）
    expect(fs.existsSync(path.join(tmpDir, '001', '.urls.json'))).toBe(false);
  });

  it('F8: URL 为空 → 返回 ok=false, error', () => {
    const res = appendUrlRecord({
      dir: tmpDir,
      record: { url: '', filename: 'x', created_at: '2026-07-13' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('URL');
  });

  it('F9: .urls.json 内容是格式化的（带缩进）', () => {
    appendUrlRecord({ dir: tmpDir, record: makeRecord() });
    const raw = fs.readFileSync(path.join(tmpDir, '.urls.json'), 'utf-8');
    // 格式化输出会有换行 + 缩进
    expect(raw).toContain('\n');
    expect(raw).toMatch(/^\[/);
  });

  it('F10: 已有合法 .urls.json（数组非空）时 append → 追加到末尾', () => {
    const file = path.join(tmpDir, '.urls.json');
    const existing = [
      { url: 'https://a.com/old.png', filename: 'old.png', created_at: '2026-07-01' },
    ];
    fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf-8');

    appendUrlRecord({
      dir: tmpDir,
      record: makeRecord({ url: 'https://a.com/new.png', filename: 'new.png' }),
    });

    const arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(arr.length).toBe(2);
    expect(arr[0].url).toBe('https://a.com/old.png');
    expect(arr[1].url).toBe('https://a.com/new.png');
  });
});

describe('removeUrlRecord - 从 .urls.json 移除 URL 记录（v7 测试）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-record-remove-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('N1: 移除存在的 URL → removed: true，文件中不再有该记录', () => {
    appendUrlRecord({
      dir: tmpDir,
      record: { url: 'https://a.com/1.png', filename: '1.png', created_at: '2026-07-13' },
    });
    appendUrlRecord({
      dir: tmpDir,
      record: { url: 'https://a.com/2.png', filename: '2.png', created_at: '2026-07-13' },
    });

    const res = removeUrlRecord(tmpDir, 'https://a.com/1.png');
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(true);

    const arr = readUrlRecords(tmpDir);
    expect(arr.length).toBe(1);
    expect(arr[0].url).toBe('https://a.com/2.png');
  });

  it('N2: 移除不存在的 URL → removed: false，文件不变', () => {
    appendUrlRecord({
      dir: tmpDir,
      record: { url: 'https://a.com/1.png', filename: '1.png', created_at: '2026-07-13' },
    });

    const res = removeUrlRecord(tmpDir, 'https://a.com/nonexistent.png');
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(false);

    const arr = readUrlRecords(tmpDir);
    expect(arr.length).toBe(1);
  });

  it('N3: .urls.json 不存在 → removed: false（不抛错）', () => {
    const res = removeUrlRecord(tmpDir, 'https://a.com/1.png');
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(false);
  });

  it('N4: .urls.json 损坏 → removed: false（不抛错）', () => {
    const file = path.join(tmpDir, '.urls.json');
    fs.writeFileSync(file, 'this is not json {', 'utf-8');

    const res = removeUrlRecord(tmpDir, 'https://a.com/1.png');
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(false);
  });
});
