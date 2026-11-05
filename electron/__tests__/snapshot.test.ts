// ============================================================
// 自动快照（data/snapshots/<日期>）测试
//
// 覆盖：
//   1. 创建快照：stories/sections/templates/wheels 全部纳入，统计正确
//   2. 每日快照幂等：同一天多次启动只保留一份
//   3. 保留策略：只保留最近 7 份
//   4. 恢复：内容回到快照状态，且当前数据先备份到 backup/pre-restore-*
//   5. 非法快照名拒绝（防目录穿越）
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createSnapshot,
  createManualSnapshot,
  ensureDailySnapshot,
  listSnapshots,
  pruneSnapshots,
  restoreSnapshot,
  requestRestore,
  consumeRestoreRequest,
} from '../snapshot';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-snapshot-'));
const dataDir = path.join(tmpDir, 'data');

function writeFixture() {
  const storiesDir = path.join(dataDir, 'stories');
  const sectionsDir = path.join(dataDir, 'sections');
  const templatesDir = path.join(dataDir, 'templates');
  fs.mkdirSync(storiesDir, { recursive: true });
  fs.mkdirSync(sectionsDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(storiesDir, 's1.json'), JSON.stringify({ title: '作品A' }), 'utf-8');
  fs.writeFileSync(path.join(storiesDir, 's2.json'), JSON.stringify({ title: '作品B' }), 'utf-8');
  fs.writeFileSync(path.join(sectionsDir, 'sec-1.json'), JSON.stringify({ content: '<p>正文</p>' }), 'utf-8');
  fs.writeFileSync(path.join(sectionsDir, 'sec-2.json'), JSON.stringify({ content: '<p>正文2</p>' }), 'utf-8');
  fs.writeFileSync(path.join(templatesDir, 't1.json'), JSON.stringify({ name: '模板' }), 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'wheels.json'), JSON.stringify({ list: [] }), 'utf-8');
}

beforeAll(() => {
  writeFixture();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe('snapshot 自动快照', () => {
  it('创建快照：纳入 stories/sections/templates/wheels 并统计文件数', () => {
    const info = createSnapshot(dataDir, '2026-11-01');
    expect(info).toBeTruthy();
    expect(info!.storyFiles).toBe(2);
    expect(info!.sectionFiles).toBe(2);
    expect(info!.totalBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dataDir, 'snapshots', '2026-11-01', 'wheels.json'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'snapshots', '2026-11-01', 'templates', 't1.json'))).toBe(true);
  });

  it('每日快照幂等：同一天多次调用只保留一份', () => {
    const fixed = new Date(2026, 10, 2);
    const first = ensureDailySnapshot(dataDir, fixed);
    const second = ensureDailySnapshot(dataDir, fixed);
    expect(first?.name).toBe('2026-11-02');
    expect(second?.name).toBe('2026-11-02');
    const names = listSnapshots(dataDir).map((s) => s.name);
    expect(names.filter((n) => n === '2026-11-02').length).toBe(1);
  });

  it('手动快照精确到秒，允许同一天多份', () => {
    const a = createManualSnapshot(dataDir, new Date(2026, 10, 3, 10, 0, 1));
    const b = createManualSnapshot(dataDir, new Date(2026, 10, 3, 10, 0, 2));
    expect(a?.name).toBe('2026-11-03-100001');
    expect(b?.name).toBe('2026-11-03-100002');
    expect(listSnapshots(dataDir).map((s) => s.name)).toEqual(
      expect.arrayContaining(['2026-11-03-100001', '2026-11-03-100002']),
    );
  });

  it('保留策略：只保留最近 7 份', () => {
    for (let i = 1; i <= 9; i++) {
      createSnapshot(dataDir, `2026-10-0${i}`);
    }
    const removed = pruneSnapshots(dataDir, 7);
    expect(removed.length).toBeGreaterThan(0);
    const names = listSnapshots(dataDir).map((s) => s.name);
    expect(names.length).toBe(7);
    // 保留的是名字最大的 7 份
    expect(names).toContain('2026-10-09');
    expect(names).not.toContain('2026-10-01');
  });

  it('恢复快照：内容回到快照状态，且当前数据已备份到 backup/pre-restore-*', () => {
    const snapName = '2026-11-01';
    // 修改当前数据
    fs.writeFileSync(
      path.join(dataDir, 'stories', 's1.json'),
      JSON.stringify({ title: '作品A-被改坏' }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(dataDir, 'sections', 'sec-1.json'),
      JSON.stringify({ content: '<p>被改坏</p>' }),
      'utf-8',
    );

    const result = restoreSnapshot(dataDir, snapName);
    expect(result.restoredEntries).toEqual(
      expect.arrayContaining(['stories', 'sections', 'templates', 'wheels.json']),
    );

    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'stories', 's1.json'), 'utf-8'))).toEqual({
      title: '作品A',
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(dataDir, 'sections', 'sec-1.json'), 'utf-8')),
    ).toEqual({ content: '<p>正文</p>' });

    // 安全备份保留了恢复前（损坏）的数据
    expect(fs.existsSync(result.safetyBackup)).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(result.safetyBackup, 'stories', 's1.json'), 'utf-8')),
    ).toEqual({ title: '作品A-被改坏' });
  });

  it('拒绝非法快照名（防目录穿越）', () => {
    expect(() => createSnapshot(dataDir, '../evil')).toThrow();
    expect(() => restoreSnapshot(dataDir, '../../etc')).toThrow();
    expect(() => requestRestore(dataDir, '../evil')).toThrow();
  });

  it('恢复请求：写入标记，下次启动时消费并清理标记', () => {
    createSnapshot(dataDir, '2026-11-04');
    requestRestore(dataDir, '2026-11-04');
    const marker = path.join(dataDir, '.restore-request.json');
    expect(fs.existsSync(marker)).toBe(true);

    const result = consumeRestoreRequest(dataDir);
    expect(result?.name).toBe('2026-11-04');
    expect(fs.existsSync(marker)).toBe(false);
    // 无请求时返回 null
    expect(consumeRestoreRequest(dataDir)).toBeNull();
  });
});
