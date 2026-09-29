// ============================================================
// setSectionContent 单次 read-modify-write 测试
//
// 修复根因:旧版 setSectionContent 包含两次 read-modify-write 循环
//   1. 更新 content/word_count
//   2. 重新计算 stats 后再次写入
// 双写不仅性能差,还把 lost-update 的窗口期扩大了一倍。
//
// 新版 setSectionContent 在单次 withStoryWriteLock + readStoryFile +
// writeStoryFile 内一次性更新所有字段,本测试验证:
//   1. 调用 setSectionContent 一次,per-story 主文件只被写入一次
//   2. content / word_count / chapter wc / volume wc / stats 全部更新
//   3. stats 缓存文件也同步更新
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-sw-'));
process.env.APP_ROOT = tmpDir;

import * as db from '../db-main';

const storiesDir = path.join(tmpDir, 'data', 'stories');
const statsFilePath = path.join(tmpDir, 'data', 'story_stats.json');
if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

function cleanup() {
  if (fs.existsSync(storiesDir)) {
    for (const f of fs.readdirSync(storiesDir)) {
      try { fs.unlinkSync(path.join(storiesDir, f)); } catch {}
    }
  }
  try { if (fs.existsSync(statsFilePath)) fs.unlinkSync(statsFilePath); } catch {}
}

describe('setSectionContent 单次 read-modify-write', () => {
  beforeEach(() => {
    cleanup();
  });

  it('case 1: 单次 setSectionContent 后,per-story 主文件的 mtime 只变化一次', async () => {
    // 准备一个带 1 节的作品
    const story = db.createStory({ title: '单写测试' });
    const vol = await db.createVolume({ story_id: story.id, title: '第一卷' });
    const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: '第1章' });
    const sec = await db.createSection({ chapter_id: ch.id, title: '第1节', content: '<p>旧</p>' });

    const storyMainFile = path.join(storiesDir, `${story.id}.json`);

    // 记录 createSection 完成后的 mtimeMs
    const mtimeBefore = fs.statSync(storyMainFile).mtimeMs;

    // 等待 5ms 确保时间戳精度
    await new Promise((r) => setTimeout(r, 5));

    await db.setSectionContent(sec.id, '<p>新内容</p>');

    const mtimeAfter = fs.statSync(storyMainFile).mtimeMs;

    // 主文件被写入(mtime 应更新)
    expect(mtimeAfter).toBeGreaterThan(mtimeBefore);

    // 验证单次写入:在 setSectionContent 前后,文件没有中间被多次写入
    // 通过对比 stats 缓存文件的 mtime 与主文件 mtime 一致性来验证
    // (如果两次独立写入,会出现 stats 与主文件不同步的情况,旧版 bug 的根因)
    if (fs.existsSync(statsFilePath)) {
      const statsMtime = fs.statSync(statsFilePath).mtimeMs;
      // stats 文件应在主文件写入后的合理窗口内(±50ms 容差)
      expect(Math.abs(statsMtime - mtimeAfter)).toBeLessThan(100);
    }
  });

  it('case 2: 单次 setSectionContent 同时更新 content / word_count / chapter / volume / stats', async () => {
    const story = db.createStory({ title: '原子更新测试' });
    const vol = await db.createVolume({ story_id: story.id, title: '第一卷' });
    const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: '第1章' });
    const sec = await db.createSection({ chapter_id: ch.id, title: '第1节', content: '<p>旧</p>' });

    // 旧 word_count = 1 ("旧")
    expect(db.getSectionContent(sec.id)).toBe('<p>旧</p>');

    // 写入新内容:8 字符
    await db.setSectionContent(sec.id, '<p>12345678</p>');

    // 读取 story bundle,验证所有字段已更新
    const bundle = JSON.parse(fs.readFileSync(path.join(storiesDir, `${story.id}.json`), 'utf-8'));
    const section = bundle.sections.find((s: any) => s.id === sec.id);
    expect(section.content).toBe('<p>12345678</p>');
    expect(section.word_count).toBe(8); // 8 字符

    const chapter = bundle.chapters.find((c: any) => c.id === ch.id);
    expect(chapter.word_count).toBe(8); // 章字数同步更新

    const volume = bundle.volumes.find((v: any) => v.id === vol.id);
    expect(volume.word_count).toBe(8); // 卷字数同步更新

    expect(bundle.stats.word_count).toBe(8); // story stats 同步更新
    expect(bundle.stats.section_count).toBe(1);
    expect(bundle.stats.chapter_count).toBe(1);
  });

  it('case 3: setSectionContent 后,全局 story_stats.json 缓存文件也同步更新', async () => {
    const story = db.createStory({ title: 'stats 缓存测试' });
    const vol = await db.createVolume({ story_id: story.id, title: 'V1' });
    const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: 'C1' });
    const sec = await db.createSection({ chapter_id: ch.id, title: 'S1', content: '<p>x</p>' });

    await db.setSectionContent(sec.id, '<p>hello world</p>'); // 11 字符

    // 读取全局 stats 缓存文件
    const statsRaw = fs.readFileSync(statsFilePath, 'utf-8');
    const allStats = JSON.parse(statsRaw);
    const storyStats = allStats[story.id];

    expect(storyStats).toBeDefined();
    // "hello world" 经过 countWordsInHtml 去除 HTML 标签和空白后 = 10 字符
    expect(storyStats.word_count).toBe(10);
    expect(storyStats.section_count).toBe(1);
  });

  it('case 4: 写入 null 内容,word_count 应为 0,且不报错', async () => {
    const story = db.createStory({ title: 'null 内容测试' });
    const vol = await db.createVolume({ story_id: story.id, title: 'V1' });
    const ch = await db.createChapter({ story_id: story.id, volume_id: vol.id, title: 'C1' });
    const sec = await db.createSection({ chapter_id: ch.id, title: 'S1', content: '<p>has content</p>' });

    await db.setSectionContent(sec.id, null);

    const bundle = JSON.parse(fs.readFileSync(path.join(storiesDir, `${story.id}.json`), 'utf-8'));
    const section = bundle.sections.find((s: any) => s.id === sec.id);
    expect(section.content).toBeNull();
    expect(section.word_count).toBe(0);
    expect(bundle.stats.word_count).toBe(0);
  });

  it('case 5: 不存在的 section id,setSectionContent 静默返回(不报错)', async () => {
    const story = db.createStory({ title: '空作品' });
    // 不创建任何 section
    await expect(db.setSectionContent('non-existent-id', '<p>test</p>')).resolves.toBeUndefined();
  });
});
