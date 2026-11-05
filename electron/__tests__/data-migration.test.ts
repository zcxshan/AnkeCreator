// ============================================================
// 数据目录迁移测试
// 覆盖：
//   1. 正常迁移：复制数据，跳过 electron-data 与恢复标记
//   2. 目标目录非空 → 拒绝
//   3. 目标目录与当前目录相同 → 拒绝
//   4. 空目标路径 → 拒绝
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateDataDir } from '../dataMigration';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-migrate-'));

function makeCurrent(name: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sections'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'electron-data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'stories', 'a.json'), '{"title":"作品A"}', 'utf-8');
  fs.writeFileSync(path.join(dir, 'sections', 's1.json'), '{"content":"<p>x</p>"}', 'utf-8');
  fs.writeFileSync(path.join(dir, 'electron-data', 'session.bin'), 'cache', 'utf-8');
  fs.writeFileSync(path.join(dir, '.restore-request.json'), '{"name":"x"}', 'utf-8');
  return dir;
}

describe('migrateDataDir', () => {
  let current: string;

  beforeEach(() => {
    current = makeCurrent(`current-${Math.random().toString(36).slice(2)}`);
  });

  it('复制数据并跳过 electron-data / 恢复标记', () => {
    const target = path.join(tmpDir, `target-${Math.random().toString(36).slice(2)}`);
    const result = migrateDataDir(current, target);
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(target, 'stories', 'a.json'), 'utf-8')).toBe('{"title":"作品A"}');
    expect(fs.readFileSync(path.join(target, 'sections', 's1.json'), 'utf-8')).toBe('{"content":"<p>x</p>"}');
    expect(fs.existsSync(path.join(target, 'electron-data'))).toBe(false);
    expect(fs.existsSync(path.join(target, '.restore-request.json'))).toBe(false);
  });

  it('目标目录非空时拒绝迁移', () => {
    const target = path.join(tmpDir, `nonempty-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'user-file.txt'), 'keep me', 'utf-8');
    const result = migrateDataDir(current, target);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('必须为空');
    // 不应破坏目标目录已有文件
    expect(fs.existsSync(path.join(target, 'user-file.txt'))).toBe(true);
  });

  it('目标与当前目录相同时拒绝', () => {
    const result = migrateDataDir(current, current);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('相同');
  });

  it('空目标路径被拒绝', () => {
    const result = migrateDataDir(current, '');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未指定');
  });

  it('复制前回调抛错时清理半成品并返回失败', () => {
    const target = path.join(tmpDir, `fail-${Math.random().toString(36).slice(2)}`);
    const result = migrateDataDir(current, target, {
      beforeCopy: () => {
        throw new Error('模拟快照失败');
      },
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readdirSync(target)).toEqual([]);
  });
});
