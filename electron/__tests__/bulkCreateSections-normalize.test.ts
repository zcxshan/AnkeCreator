// ============================================================
// bulkCreateSections order_index 归一化测试
//
// 修复根因：v3.5.1 导入用户的 .anke.json(23MB)后,在「重逢是故事的起点」章
// 新增节时出现混乱。原因之一是 bulkCreateSections 写入前未对每章 sections
// 归一化 order_index,导致同章节内可能出现重复/跳号/负数 order_index,落库后
// nextOrderIndex 在 corrupted 数据上算出非预期值。
//
// 本测试覆盖：
//   1. 同 order_index 重复 → 归一化为 0..N-1
//   2. order_index 跳号 → 归一化为 0..N-1
//   3. order_index 含负数 → 归一化为 0..N-1
//   4. 多章混合 → 每章独立归一化
//   5. 空 rows → 不报错
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron 模块（happy-dom 没有 electron.app）
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'appData') return os.tmpdir();
      return os.tmpdir();
    },
    getAppPath: () => process.env.APP_ROOT || process.cwd(),
    getName: () => 'test-app',
  },
  ipcMain: {
    handle: () => {},
  },
}));

// 用临时目录作为 data dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-normalize-'));
process.env.APP_ROOT = tmpDir;

// 加载 db-main
import * as db from '../db-main';

const storyId = 'test-story-norm';
const volId = 'test-vol-norm';
const storiesDir = path.join(tmpDir, 'data', 'stories');

if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

function makeBundle(chapterIds: string[] = ['test-ch-1']) {
  const now = new Date().toISOString();
  return {
    story: {
      id: storyId,
      title: '归一化测试作品',
      description: '',
      category: '',
      order_index: 0,
      is_starred: 0,
      is_pinned: 0,
      created_at: now,
      updated_at: now,
    },
    volumes: [
      {
        id: volId,
        story_id: storyId,
        title: '第一卷',
        order_index: 0,
        word_count: 0,
        created_at: now,
        updated_at: now,
      },
    ],
    chapters: chapterIds.map((cid, i) => ({
      id: cid,
      story_id: storyId,
      volume_id: volId,
      title: `第${i + 1}章`,
      order_index: i,
      word_count: 0,
      created_at: now,
      updated_at: now,
    })),
    sections: [] as any[],
    world_settings: [],
    characters: [],
    character_variants: [],
    character_relations: [],
    outlines: [],
    dice_history: [],
  };
}

function writeFreshBundle(chapterIds: string[] = ['test-ch-1']) {
  if (fs.existsSync(storiesDir)) {
    for (const f of fs.readdirSync(storiesDir)) {
      fs.unlinkSync(path.join(storiesDir, f));
    }
  }
  fs.writeFileSync(
    path.join(storiesDir, `${storyId}.json`),
    JSON.stringify(makeBundle(chapterIds), null, 2),
    'utf-8',
  );
}

describe('bulkCreateSections order_index 归一化', () => {
  beforeEach(() => {
    writeFreshBundle(['test-ch-1']);
  });

  it('case 1: 同 order_index 重复 (0,0,1,1) → 归一化为 0..3', async () => {
    await db.bulkCreateSections([
      { chapter_id: 'test-ch-1', title: 'A', order_index: 0 },
      { chapter_id: 'test-ch-1', title: 'B', order_index: 0 },
      { chapter_id: 'test-ch-1', title: 'C', order_index: 1 },
      { chapter_id: 'test-ch-1', title: 'D', order_index: 1 },
    ]);
    const sections = db.listSections('test-ch-1');
    const orders = sections.map((s) => s.order_index).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3]);
    // 标题顺序应保持
    const sortedByOrder = [...sections].sort((a, b) => a.order_index - b.order_index);
    expect(sortedByOrder.map((s) => s.title)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('case 2: order_index 跳号 (0,2,5,7) → 归一化为 0..3', async () => {
    await db.bulkCreateSections([
      { chapter_id: 'test-ch-1', title: 'A', order_index: 0 },
      { chapter_id: 'test-ch-1', title: 'B', order_index: 2 },
      { chapter_id: 'test-ch-1', title: 'C', order_index: 5 },
      { chapter_id: 'test-ch-1', title: 'D', order_index: 7 },
    ]);
    const sections = db.listSections('test-ch-1');
    const orders = sections.map((s) => s.order_index).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3]);
    const sortedByOrder = [...sections].sort((a, b) => a.order_index - b.order_index);
    expect(sortedByOrder.map((s) => s.title)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('case 3: order_index 含负数 (-1, 0, 1) → 归一化为 0..2', async () => {
    await db.bulkCreateSections([
      { chapter_id: 'test-ch-1', title: 'A', order_index: -1 },
      { chapter_id: 'test-ch-1', title: 'B', order_index: 0 },
      { chapter_id: 'test-ch-1', title: 'C', order_index: 1 },
    ]);
    const sections = db.listSections('test-ch-1');
    const orders = sections.map((s) => s.order_index).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2]);
    const sortedByOrder = [...sections].sort((a, b) => a.order_index - b.order_index);
    expect(sortedByOrder.map((s) => s.title)).toEqual(['A', 'B', 'C']);
  });

  it('case 4: 多章混合 → 每章独立归一化', async () => {
    writeFreshBundle(['test-ch-1', 'test-ch-2']);
    await db.bulkCreateSections([
      { chapter_id: 'test-ch-1', title: '1A', order_index: 5 },
      { chapter_id: 'test-ch-1', title: '1B', order_index: 5 },
      { chapter_id: 'test-ch-2', title: '2A', order_index: 10 },
      { chapter_id: 'test-ch-2', title: '2B', order_index: 10 },
      { chapter_id: 'test-ch-2', title: '2C', order_index: 10 },
    ]);
    const s1 = db.listSections('test-ch-1').map((s) => s.order_index).sort((a, b) => a - b);
    const s2 = db.listSections('test-ch-2').map((s) => s.order_index).sort((a, b) => a - b);
    expect(s1).toEqual([0, 1]);
    expect(s2).toEqual([0, 1, 2]);
  });

  it('case 5: 空 rows → 不报错', async () => {
    await expect(db.bulkCreateSections([])).resolves.toBeDefined();
    const sections = db.listSections('test-ch-1');
    expect(sections).toEqual([]);
  });

  it('case 6: 导入后再 createSection,新节 order_index = N (末尾)', async () => {
    await db.bulkCreateSections([
      { chapter_id: 'test-ch-1', title: 'A', order_index: 0 },
      { chapter_id: 'test-ch-1', title: 'B', order_index: 0 },  // 重复
      { chapter_id: 'test-ch-1', title: 'C', order_index: 5 },  // 跳号
      { chapter_id: 'test-ch-1', title: 'D', order_index: 7 },
    ]);
    const newSec = await db.createSection({ chapter_id: 'test-ch-1', title: '新的节' });
    expect(newSec.order_index).toBe(4);  // N = 4
    const sections = db.listSections('test-ch-1');
    const orders = sections.map((s) => s.order_index).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4]);
  });

  it('case 7: 模拟用户真实数据(20 节同 order_index 全冲突)导入后,新增节仍正确', async () => {
    const rows = [];
    for (let i = 0; i < 20; i++) {
      // 故意让所有 order_index 重复为 0(模拟损坏数据)
      rows.push({ chapter_id: 'test-ch-1', title: `第${i + 1}节`, order_index: 0 });
    }
    await db.bulkCreateSections(rows);
    const sections = db.listSections('test-ch-1');
    expect(sections.length).toBe(20);
    const orders = sections.map((s) => s.order_index).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 20 }, (_, i) => i));

    // 新增节 → 应在末尾 (order_index = 20)
    const newSec = await db.createSection({ chapter_id: 'test-ch-1', title: '新的节' });
    expect(newSec.order_index).toBe(20);
  });

  it('case 8: listSections 同 order_index 时按 id 稳定排序', async () => {
    // 手动构造 4 行同 order_index
    await db.bulkCreateSections([
      { chapter_id: 'test-ch-1', title: 'X1', order_index: 5 },
      { chapter_id: 'test-ch-1', title: 'X2', order_index: 5 },
      { chapter_id: 'test-ch-1', title: 'X3', order_index: 5 },
    ]);
    const sections = db.listSections('test-ch-1');
    // 每次返回顺序应一致
    const orders1 = sections.map((s) => s.id);
    const orders2 = db.listSections('test-ch-1').map((s) => s.id);
    expect(orders1).toEqual(orders2);
  });
});
