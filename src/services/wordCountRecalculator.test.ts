import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.structure（必须先 mock，因为 wordCountRecalculator 依赖它）
const updateSectionMock = vi.fn(async (_id: string, _patch: any) => undefined);
const getSectionContentMock = vi.fn(async (_id: string) => '');
const listSectionMetadataMock = vi.fn(async (_chapterId: string) => [] as any[]);
const listChaptersMock = vi.fn(async (_storyId: string) => [] as any[]);

vi.mock('../db/structure', () => ({
  getSectionContent: (...args: any[]) => getSectionContentMock(...args),
  listSectionMetadata: (...args: any[]) => listSectionMetadataMock(...args),
  updateSection: (...args: any[]) => updateSectionMock(...args),
}));

vi.mock('../db', () => ({
  listChapters: (...args: any[]) => listChaptersMock(...args),
}));

// Mock useStoryStore.getState().refreshSections
const refreshSectionsMock = vi.fn(async () => {});
vi.mock('../store/storyStore', () => ({
  useStoryStore: {
    getState: () => ({
      activeStoryId: 'story-1',
      refreshSections: refreshSectionsMock,
    }),
  },
}));

// Mock 字数算法 - 我们用简化版（不依赖 DOM/Editor）
vi.mock('../components/pages/WorksListPage', () => ({
  // 简化版：HTML 中 div.text 内容长度 = 字数
  countWordsFromHtml: (html: string) => {
    if (!html) return { words: 0, dice: 0 };
    const m = html.match(/<div[^>]*data-type="text"[^>]*>([\s\S]*?)<\/div>/g);
    if (!m) return { words: 0, dice: 0 };
    const text = m.map((s) => s.replace(/<[^>]+>/g, '')).join('');
    return { words: text.replace(/\s/g, '').length, dice: 0 };
  },
}));

vi.mock('../components/pages/EditorPage', () => ({
  // 简化版：递归 walk 文本节点
  countWordsAndDice: (json: any) => {
    if (!json || typeof json !== 'object') return { words: 0, dice: 0 };
    let words = 0;
    let dice = 0;
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (typeof n.text === 'string') words += n.text.replace(/\s/g, '').length;
      if (n.type === 'dice-card' || n.type === 'dice') dice++;
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(json);
    return { words, dice };
  },
}));

import { recalculateWordCounts } from './wordCountRecalculator';

describe('recalculateWordCounts - 用前端算法重算字数', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listChaptersMock.mockResolvedValue([
      { id: 'ch-1', story_id: 'story-1', order_index: 0 },
      { id: 'ch-2', story_id: 'story-1', order_index: 1 },
    ]);
  });

  it('空作品 → 立即返回 0/0/0', async () => {
    listChaptersMock.mockResolvedValueOnce([]);
    const result = await recalculateWordCounts('story-1').promise;
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('旧 word_count 错误 → 重算后更新', async () => {
    listSectionMetadataMock
      .mockResolvedValueOnce([
        { id: 'sec-1', chapter_id: 'ch-1', order_index: 0, word_count: 999 }, // 错
      ])
      .mockResolvedValueOnce([]);
    getSectionContentMock.mockResolvedValueOnce(
      '<div data-type="text">hello world</div>', // 实际字数 10
    );
    const result = await recalculateWordCounts('story-1').promise;
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(updateSectionMock).toHaveBeenCalledWith('sec-1', { word_count: 10 });
    expect(result.totalBefore).toBe(999);
    expect(result.totalAfter).toBe(10);
  });

  it('旧 word_count 正确 → 重算后跳过（不写 DB）', async () => {
    listSectionMetadataMock
      .mockResolvedValueOnce([
        { id: 'sec-1', chapter_id: 'ch-1', order_index: 0, word_count: 10 },
      ])
      .mockResolvedValueOnce([]);
    getSectionContentMock.mockResolvedValueOnce('<div data-type="text">hello world</div>');
    const result = await recalculateWordCounts('story-1').promise;
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(updateSectionMock).not.toHaveBeenCalled();
  });

  it('进度回调正确触发', async () => {
    const secs = Array.from({ length: 25 }, (_, i) => ({
      id: `sec-${i}`,
      chapter_id: 'ch-1',
      order_index: i,
      word_count: 0, // 全部会更新
    }));
    listChaptersMock.mockResolvedValueOnce([{ id: 'ch-1', story_id: 'story-1', order_index: 0 }]);
    listSectionMetadataMock.mockResolvedValueOnce(secs);
    getSectionContentMock.mockImplementation(async () => '<div data-type="text">x</div>');

    const progressCalls: Array<[number, number]> = [];
    const result = await recalculateWordCounts('story-1', {
      onProgress: (done, total) => progressCalls.push([done, total]),
      batchSize: 10,
    }).promise;

    expect(result.updated).toBe(25);
    // 第一批 10 节完成时回调一次，第二批 10 节一次，第三批 5 节一次 → 共 3 次
    expect(progressCalls.length).toBeGreaterThanOrEqual(3);
    // 最后一次回调 total=25, done=25
    expect(progressCalls[progressCalls.length - 1]).toEqual([25, 25]);
  });

  it('中途 abort → 抛 AbortError，剩余节不更新', async () => {
    const secs = Array.from({ length: 30 }, (_, i) => ({
      id: `sec-${i}`,
      chapter_id: 'ch-1',
      order_index: i,
      word_count: 0,
    }));
    listChaptersMock.mockResolvedValueOnce([{ id: 'ch-1', story_id: 'story-1', order_index: 0 }]);
    listSectionMetadataMock.mockResolvedValueOnce(secs);
    getSectionContentMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return '<div data-type="text">x</div>';
    });

    const controller = recalculateWordCounts('story-1', { batchSize: 5 });
    // 在第一批次中途 abort
    setTimeout(() => controller.abort(), 5);

    await expect(controller.promise).rejects.toThrow();
    try {
      await controller.promise;
    } catch (e) {
      expect((e as Error).name).toBe('AbortError');
    }
    // 至少有一次 updateSection，但远小于 30
    expect(updateSectionMock.mock.calls.length).toBeLessThan(30);
  });

  it('HTML 内容用 countWordsFromHtml（前端算法）', async () => {
    listSectionMetadataMock
      .mockResolvedValueOnce([
        { id: 'sec-1', chapter_id: 'ch-1', order_index: 0, word_count: 0 },
      ])
      .mockResolvedValueOnce([]);
    // 包含 dice-card（不计入字数）
    getSectionContentMock.mockResolvedValueOnce(
      '<div data-type="text">正文文字</div><div data-type="dice-card" data-result="50">骰子</div>',
    );
    await recalculateWordCounts('story-1').promise;
    // "正文文字" = 4 字
    expect(updateSectionMock).toHaveBeenCalledWith('sec-1', { word_count: 4 });
  });

  it('JSON 内容（TipTap 旧格式）用 countWordsAndDice', async () => {
    listSectionMetadataMock
      .mockResolvedValueOnce([
        { id: 'sec-1', chapter_id: 'ch-1', order_index: 0, word_count: 0 },
      ])
      .mockResolvedValueOnce([]);
    // JSON 字符串（必须可 JSON.parse）
    const json = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '旧格式文字' }] },
        { type: 'dice-card', result: 50 },
      ],
    };
    getSectionContentMock.mockResolvedValueOnce(JSON.stringify(json));
    await recalculateWordCounts('story-1').promise;
    // "旧格式文字" = 5 字
    expect(updateSectionMock).toHaveBeenCalledWith('sec-1', { word_count: 5 });
  });

  it('失败时不抛错，统计到 failed', async () => {
    listSectionMetadataMock
      .mockResolvedValueOnce([
        { id: 'sec-1', chapter_id: 'ch-1', order_index: 0, word_count: 10 },
        { id: 'sec-2', chapter_id: 'ch-1', order_index: 1, word_count: 20 },
      ])
      .mockResolvedValueOnce([]);
    // sec-1 成功，sec-2 抛错
    getSectionContentMock
      .mockResolvedValueOnce('<div data-type="text">x</div>')
      .mockRejectedValueOnce(new Error('DB error'));

    const result = await recalculateWordCounts('story-1').promise;
    expect(result.failed).toBe(1);
    // 失败时 totalAfter 用原值，避免总和失真
    expect(result.totalAfter).toBe(1 + 20); // sec-1 新值 1 + sec-2 旧值 20
  });

  it('完成后调 refreshSections 触发目录树更新', async () => {
    listSectionMetadataMock
      .mockResolvedValueOnce([
        { id: 'sec-1', chapter_id: 'ch-1', order_index: 0, word_count: 999 },
      ])
      .mockResolvedValueOnce([]);
    getSectionContentMock.mockResolvedValueOnce('<div data-type="text">x</div>');

    await recalculateWordCounts('story-1').promise;
    expect(refreshSectionsMock).toHaveBeenCalledTimes(1);
  });

  it('activeStoryId 不匹配时跳过 refreshSections', async () => {
    // override getState to return different story
    const useStoryStore = await import('../store/storyStore');
    vi.spyOn(useStoryStore.useStoryStore, 'getState').mockReturnValueOnce({
      activeStoryId: 'other-story',
      refreshSections: refreshSectionsMock,
    } as any);
    listSectionMetadataMock
      .mockResolvedValueOnce([
        { id: 'sec-1', chapter_id: 'ch-1', order_index: 0, word_count: 999 },
      ])
      .mockResolvedValueOnce([]);
    getSectionContentMock.mockResolvedValueOnce('<div data-type="text">x</div>');

    await recalculateWordCounts('story-1').promise;
    expect(refreshSectionsMock).not.toHaveBeenCalled();
  });
});
