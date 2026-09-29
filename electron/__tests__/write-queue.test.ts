// ============================================================
// per-story 写入锁(write-queue)测试
//
// 修复根因:用户反馈导入 .anke.json 后,在「重逢是故事的起点」章新增节
// 时出现内容错乱/丢失。除 order_index 归一化外,真正的根因是
// setSectionContent 与 createSection / loadSection 触发的并发
// read-modify-write race,导致 lost-update。
//
// 本测试覆盖:
//   1. 并发 setSectionContent 调用,最终内容应为最后一次写入
//   2. 并发 createSection + setSectionContent 不丢节
//   3. 并发 setSectionContent 写不同 section,各自内容独立
//   4. 同 storyId 写操作串行化(顺序一致性)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron 模块(happy-dom 没有 electron.app)
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-wq-'));
process.env.APP_ROOT = tmpDir;

// 加载 db-main
import * as db from '../db-main';

const storiesDir = path.join(tmpDir, 'data', 'stories');
if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

async function setupStoryWithSections(sectionCount: number): Promise<{ storyId: string; chapterId: string; sectionIds: string[] }> {
  const story = db.createStory({ title: '并发测试作品' });
  const volume = await db.createVolume({ story_id: story.id, title: '第一卷' });
  const chapter = await db.createChapter({ story_id: story.id, volume_id: volume.id, title: '重逢是故事的起点' });
  const sectionIds: string[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const sec = await db.createSection({ chapter_id: chapter.id, title: `第${i + 1}节`, content: `<p>初始内容 ${i}</p>` });
    sectionIds.push(sec.id);
  }
  return { storyId: story.id, chapterId: chapter.id, sectionIds };
}

function cleanup() {
  if (fs.existsSync(storiesDir)) {
    for (const f of fs.readdirSync(storiesDir)) {
      try { fs.unlinkSync(path.join(storiesDir, f)); } catch {}
    }
  }
}

describe('per-story 写入锁 (write-queue)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('case 1: 并发 setSectionContent,最终内容应为最后一次写入', async () => {
    const { sectionIds } = await setupStoryWithSections(1);
    const sid = sectionIds[0];

    // 同时发起 5 个并发写入,内容从 v1..v5
    const writes = [];
    for (let i = 1; i <= 5; i++) {
      writes.push(db.setSectionContent(sid, `<p>v${i}</p>`));
    }
    await Promise.all(writes);

    // 最终内容应为 v5(最后入队的)
    // 注意:由于 Promise 链的入队顺序与调用顺序一致,v5 是最后写入的
    const content = db.getSectionContent(sid);
    expect(content).toBe('<p>v5</p>');
  });

  it('case 2: 并发 createSection + setSectionContent 不丢节', async () => {
    const { chapterId, sectionIds } = await setupStoryWithSections(1);
    const sid = sectionIds[0];

    // 同时:对已有节写内容 + 创建 5 个新节
    const tasks: Promise<any>[] = [];
    tasks.push(db.setSectionContent(sid, '<p>更新后的内容</p>'));
    for (let i = 0; i < 5; i++) {
      tasks.push(db.createSection({ chapter_id: chapterId, title: `新增节 ${i + 1}`, content: `<p>新内容 ${i}</p>` }));
    }
    await Promise.all(tasks);

    // 验证:已有节内容正确,且总共 6 节
    const sections = db.listSections(chapterId);
    expect(sections.length).toBe(6);
    expect(db.getSectionContent(sid)).toBe('<p>更新后的内容</p>');
  });

  it('case 3: 并发写不同 section,各自内容独立不串', async () => {
    const { sectionIds } = await setupStoryWithSections(3);
    const [s1, s2, s3] = sectionIds;

    // 并发写 3 个不同 section
    await Promise.all([
      db.setSectionContent(s1, '<p>A</p>'),
      db.setSectionContent(s2, '<p>B</p>'),
      db.setSectionContent(s3, '<p>C</p>'),
    ]);

    expect(db.getSectionContent(s1)).toBe('<p>A</p>');
    expect(db.getSectionContent(s2)).toBe('<p>B</p>');
    expect(db.getSectionContent(s3)).toBe('<p>C</p>');
  });

  it('case 4: 写操作串行化(顺序一致性,无交错)', async () => {
    const { sectionIds } = await setupStoryWithSections(1);
    const sid = sectionIds[0];

    // 记录每个写操作的执行区间
    const executionLog: string[] = [];
    const originalWriteFile = (db as any).__test_writeStoryFile_override;
    // 通过 monkey-patch writeStoryFile 不可行(它是内部函数),改用 createSection 顺序验证

    // 通过 createSection 创建 10 节并发,验证最终顺序正确
    const { chapterId } = await (async () => {
      // 重新 setup
      const story = db.createStory({ title: '顺序测试作品' });
      const vol = await db.createVolume({ story_id: story.id, title: 'V1' });
      const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: 'C1' });
      return { chapterId: ch.id };
    })();

    const tasks: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(db.createSection({ chapter_id: chapterId, title: `S${i}` }));
    }
    await Promise.all(tasks);

    const sections = db.listSections(chapterId);
    expect(sections.length).toBe(10);
    // order_index 应为 0..9
    const orders = sections.map((s) => s.order_index).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });

  it('case 5: 同一节快速切换内容 + 创建新节,验证无 lost-update', async () => {
    // 模拟用户场景:在节 A 编辑过程中,切换到新节 B
    // 旧逻辑:useSectionEditor + loadSection 并发触发 setSectionContent → A 内容被旧值覆盖
    // 新逻辑:写入锁串行化,且 setSectionContent 单次 read-modify-write
    const { chapterId, sectionIds } = await setupStoryWithSections(1);
    const sidA = sectionIds[0];

    // 先在 A 中写入"最新编辑内容"
    await db.setSectionContent(sidA, '<p>用户最新编辑内容</p>');

    // 同时:创建新节 B + 再次更新 A
    const newSecPromise = db.createSection({ chapter_id: chapterId, title: '新节 B', content: '<p>B 内容</p>' });
    const updateAPromise = db.setSectionContent(sidA, '<p>用户最新编辑内容(再次更新)</p>');
    await Promise.all([newSecPromise, updateAPromise]);

    // A 的内容应为最后一次写入
    expect(db.getSectionContent(sidA)).toBe('<p>用户最新编辑内容(再次更新)</p>');
    // B 已创建
    const sections = db.listSections(chapterId);
    expect(sections.length).toBe(2);
  });

  it('case 6: 高并发场景(50 个并发写入),最终值正确', async () => {
    const { sectionIds } = await setupStoryWithSections(1);
    const sid = sectionIds[0];

    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      tasks.push(db.setSectionContent(sid, `<p>iteration-${i}</p>`));
    }
    await Promise.all(tasks);

    // 最终应为 iteration-49
    expect(db.getSectionContent(sid)).toBe('<p>iteration-49</p>');
  });
});
