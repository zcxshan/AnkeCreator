// 端到端模拟：完整 .anke.json 导入 + 新增节
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getAppPath: () => process.env.APP_ROOT || process.cwd(),
    getName: () => 'test-app',
  },
  ipcMain: { handle: () => {} },
}));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankecreator-e2e-'));
process.env.APP_ROOT = tmpDir;

import * as db from '../db-main';
import { ensureDefaultVolumeAndChapter } from '../../src/utils/storyImport';

const storiesDir = path.join(tmpDir, 'data', 'stories');
if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

// 找到真实的 .anke.json（直接读固定路径，不引入额外依赖）
const ankeFile = 'C:/Users/dell/Desktop/某音乐的迷途之星_某学都的人偶剧目.anke.json';
console.log('ankeFile:', ankeFile);

describe('E2E: 真实文件导入 + 新增节', () => {
  let storyId: string;
  let volId: string;
  let targetChapterId: string;
  let ankeData: any;

  beforeEach(async () => {
    // 清空 stories 目录
    if (fs.existsSync(storiesDir)) {
      for (const f of fs.readdirSync(storiesDir)) {
        fs.unlinkSync(path.join(storiesDir, f));
      }
    }
    ankeData = JSON.parse(fs.readFileSync(ankeFile, 'utf-8'));
  });

  it('导入完整文件后检查目标章的 order_index', { timeout: 30000 }, async () => {
    const newStory = db.createStory({ title: ankeData.data.title });
    storyId = newStory.id;
    console.log('Created story:', storyId);

    const result = await ensureDefaultVolumeAndChapter(
      storyId,
      ankeData.data,
      {
        createVolume: async (data) => db.createVolume(data) as any,
        createChapter: async (data) => db.createChapter(data) as any,
        createSection: async (data) => db.createSection(data) as any,
        bulkCreateVolumes: async (rows) => db.bulkCreateVolumes(rows) as any,
        bulkCreateChapters: async (rows) => db.bulkCreateChapters(rows) as any,
        bulkCreateSections: async (rows) => db.bulkCreateSections(rows) as any,
      },
    );

    console.log('Volume id map size:', Object.keys(result.volumeIdMap).length);
    console.log('Chapter id map size:', Object.keys(result.chapterIdMap).length);
    console.log('Section id map size:', Object.keys(result.sectionIdMap).length);

    // 找目标章
    const targetChOldId = ankeData.data.chapters.find(
      (ch: any) => ch.title === '重逢是故事的起点',
    )?.id;
    targetChapterId = result.chapterIdMap[targetChOldId];
    console.log('Target chapter new id:', targetChapterId);

    // 列出该章的 sections
    const secs = db.listSections(targetChapterId);
    console.log('Target chapter section count:', secs.length);
    console.log('order_index list:', secs.map((s: any) => s.order_index));

    // 验证是否完整
    expect(secs.length).toBe(20);
    expect(secs.map((s: any) => s.order_index).sort((a: number, b: number) => a - b)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    );
  });

  // 23MB 文件导入较慢，超时延长
  it('Step 2: 在目标章新增节 - order_index 应为 20', { timeout: 30000 }, async () => {
    const newStory = db.createStory({ title: '测试' });
    storyId = newStory.id;

    const result = await ensureDefaultVolumeAndChapter(
      storyId,
      ankeData.data,
      {
        createVolume: async (data) => db.createVolume(data) as any,
        createChapter: async (data) => db.createChapter(data) as any,
        createSection: async (data) => db.createSection(data) as any,
        bulkCreateVolumes: async (rows) => db.bulkCreateVolumes(rows) as any,
        bulkCreateChapters: async (rows) => db.bulkCreateChapters(rows) as any,
        bulkCreateSections: async (rows) => db.bulkCreateSections(rows) as any,
      },
    );

    const targetChOldId = ankeData.data.chapters.find(
      (ch: any) => ch.title === '重逢是故事的起点',
    )?.id;
    targetChapterId = result.chapterIdMap[targetChOldId];

    // 新增节
    const newSec = await db.createSection({
      chapter_id: targetChapterId,
      title: '新的节',
      content: '<p>新节内容</p>',
    });
    console.log('新节 order_index:', newSec.order_index);

    // 列出全部 sections
    const allSecs = db.listSections(targetChapterId);
    console.log('全部 order_index:', allSecs.map((s: any) => s.order_index));
    console.log('全部 title:', allSecs.map((s: any) => s.title));

    expect(newSec.order_index).toBe(20);
    expect(allSecs.length).toBe(21);

    // 验证文件实际写入
    const filePath = path.join(storiesDir, `${storyId}.json`);
    const fileBundle = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const fileSecs = fileBundle.sections.filter((s: any) => s.chapter_id === targetChapterId);
    console.log('文件中 sections 数量:', fileSecs.length);
    console.log('文件中 order_index:', fileSecs.map((s: any) => s.order_index).sort((a: number, b: number) => a - b));

    expect(fileSecs.length).toBe(21);
  });
});
