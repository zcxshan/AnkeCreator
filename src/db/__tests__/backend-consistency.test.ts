// ============================================================
// 三后端一致性（Electron 由 db-main 自身测试覆盖；此处验证
// renderer 可运行的两种后端：内存 SQL 模拟 + IndexedDB）
//
// 同一组业务场景在两个后端上执行，断言结果完全一致：
//   1. 作品创建 / 列表排序
//   2. 卷 → 章 → 节 的层级与自动排序
//   3. 节字数统计（原子块不计入正文）
//   4. updateSection 时正文变更 → 字数重算
//   5. moveSections(null) 为 no-op（不得把节移出章）
//   6. 软删除 / 回收站 / 还原
//   7. 删除章 → 级联删除节
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

type Backend = 'memory' | 'indexeddb';

async function loadBackend(kind: Backend): Promise<any> {
  vi.resetModules();
  if (kind === 'indexeddb') {
    (globalThis as any).indexedDB = new IDBFactory();
    (globalThis as any).IDBKeyRange = IDBKeyRange;
  } else {
    delete (globalThis as any).indexedDB;
    delete (globalThis as any).IDBKeyRange;
  }
  delete (window as any).dbAPI;

  const db = await import('../index');
  db.initDatabase();
  return db;
}

interface ScenarioResult {
  storyCount: number;
  storyTitle: string;
  volumeOrder: number;
  chapterOrder: number;
  sectionTitles: string[];
  sectionWords: number[];
  updatedWordCount: number;
  updatedContent: string | null;
  bbcode: string | null;
  titlesAfterNullMove: string[];
  visibleAfterSoftDelete: number;
  trashedCount: number;
  visibleAfterRestore: number;
  sectionsAfterChapterDelete: number;
}

async function runScenario(db: any): Promise<ScenarioResult> {
  const story = await db.createStory({ title: '作品A', description: '简介' });
  const stories = await db.listStories();

  const volume = await db.createVolume({ story_id: story.id, title: '卷一' });
  const chapter = await db.createChapter({
    story_id: story.id,
    volume_id: volume.id,
    title: '章一',
  });

  const s1 = await db.createSection({
    chapter_id: chapter.id,
    title: '节一',
    content: '<p>你好世界</p>',
  });
  const s2 = await db.createSection({
    chapter_id: chapter.id,
    title: '节二',
    content: '<p>abc</p><div data-type="dice-card">1d100=42</div>',
  });

  let sections = await db.listSections(chapter.id);

  await db.updateSection(s1.id, { content: '<p>改写</p>' });
  const updatedContent = await db.getSectionContent(s1.id);
  const bbcode = await db.getSectionBBCode(s1.id);
  const updatedSection = (await db.listSections(chapter.id)).find((s: any) => s.id === s1.id);

  // 无效目标章：必须 no-op，节仍留在原章
  await db.moveSections(null, [s2.id]);
  const titlesAfterNullMove = (await db.listSections(chapter.id)).map((s: any) => s.title);

  await db.softDeleteStory(story.id);
  const visibleAfterSoftDelete = (await db.listStories()).length;
  const trashedCount = (await db.listTrashedStories()).length;
  await db.restoreStory(story.id);
  const visibleAfterRestore = (await db.listStories()).length;

  await db.deleteChapter(chapter.id);
  const sectionsAfterChapterDelete = (await db.listSections(chapter.id)).length;

  return {
    storyCount: stories.length,
    storyTitle: stories[0]?.title,
    volumeOrder: volume.order_index,
    chapterOrder: chapter.order_index,
    sectionTitles: sections.map((s: any) => s.title),
    sectionWords: sections.map((s: any) => s.word_count ?? 0),
    updatedWordCount: updatedSection?.word_count ?? -1,
    updatedContent,
    bbcode,
    titlesAfterNullMove,
    visibleAfterSoftDelete,
    trashedCount,
    visibleAfterRestore,
    sectionsAfterChapterDelete,
  };
}

const EXPECTED: Omit<ScenarioResult, 'storyTitle'> & { storyTitle?: string } = {
  storyCount: 1,
  storyTitle: '作品A',
  volumeOrder: 0,
  chapterOrder: 0,
  sectionTitles: ['节一', '节二'],
  sectionWords: [4, 3],
  updatedWordCount: 2,
  updatedContent: '<p>改写</p>',
  bbcode: null,
  titlesAfterNullMove: ['节一', '节二'],
  visibleAfterSoftDelete: 0,
  trashedCount: 1,
  visibleAfterRestore: 1,
  sectionsAfterChapterDelete: 0,
};

describe.each<Backend>(['memory', 'indexeddb'])('后端一致性：%s', (kind) => {
  let db: any;

  beforeEach(async () => {
    db = await loadBackend(kind);
  });

  it('作品 / 卷 / 章 / 节 的完整生命周期结果一致', async () => {
    const result = await runScenario(db);
    expect(result).toEqual(EXPECTED);
  });
});
