import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index', () => ({
  listStories: vi.fn(async () => []),
  deleteStory: vi.fn(async () => undefined),
  softDeleteStory: vi.fn(async () => undefined),
  listVolumes: vi.fn(async (storyId: string) =>
    storyId === 'story-b'
      ? [{ id: 'vol-b', story_id: 'story-b', title: 'B 卷', order_index: 0, created_at: '', updated_at: '' }]
      : [],
  ),
  listChapters: vi.fn(async () => []),
  listOutlines: vi.fn(async () => []),
  listSectionMetadata: vi.fn(async () => []),
}));

import { useStoryStore } from './storyStore';
import { useEditorStore } from './editorStore';

describe('作品数据隔离', () => {
  beforeEach(async () => {
    // 等待模块加载时的自动 loadStories 落地，避免覆盖测试数据
    await new Promise((resolve) => setTimeout(resolve, 0));
    useStoryStore.setState({
      stories: [
        { id: 'story-a', title: 'A 作品', created_at: '', updated_at: '' } as never,
        { id: 'story-b', title: 'B 作品', created_at: '', updated_at: '' } as never,
      ],
      trashedStories: [],
      activeStoryId: 'story-a',
      volumes: [
        { id: 'vol-a', story_id: 'story-a', title: 'A 卷', order_index: 0, created_at: '', updated_at: '' },
      ] as never,
      chapters: [
        { id: 'chap-a', story_id: 'story-a', volume_id: 'vol-a', title: 'A 章', order_index: 0, created_at: '', updated_at: '' },
      ] as never,
      sections: [
        { id: 'sec-a', story_id: 'story-a', chapter_id: 'chap-a', title: 'A 节', order_index: 0, created_at: '', updated_at: '' },
      ] as never,
      outlines: [{ id: 'outline-a', story_id: 'story-a', title: 'A 大纲' }] as never,
      activeChapterId: 'chap-a',
      activeSectionId: 'sec-a',
      activeOutlineId: 'outline-a',
    });
    useEditorStore.getState().clearSection();
    // 直接构造「正在编辑 A 作品第 1 节」的状态（避免触发防抖落盘）
    useEditorStore.setState({ sectionId: 'sec-a', sectionContent: '<p>A 作品正文</p>' });
  });

  it('删除当前作品后不残留旧作品内容，并自动切到下一作品', async () => {
    await useStoryStore.getState().deleteStory('story-a');

    const state = useStoryStore.getState();
    expect(state.activeStoryId).toBe('story-b');
    // 旧作品的卷/章/节/大纲不能残留
    expect(state.outlines).toEqual([]);
    expect(state.chapters).toEqual([]);
    expect(state.sections).toEqual([]);
    expect(state.volumes.map((v) => v.id)).toEqual(['vol-b']);
    // 编辑器里的旧正文必须清空
    expect(useEditorStore.getState().sectionId).toBeNull();
    expect(useEditorStore.getState().sectionContent).toBeNull();
  });

  it('移入回收站当前作品后同样不残留旧内容', async () => {
    await useStoryStore.getState().softDeleteStory('story-a');

    const state = useStoryStore.getState();
    expect(state.activeStoryId).toBe('story-b');
    expect(state.outlines).toEqual([]);
    expect(useEditorStore.getState().sectionContent).toBeNull();
  });

  it('切节后旧节迟到的正文回传不会写进新节', async () => {
    useEditorStore.setState({ sectionId: 'sec-b', sectionContent: '<p>B 节原内容</p>' });
    // 模拟编辑器在切节后回传旧节内容
    useEditorStore.getState().setSectionContent('<p>旧节内容</p>', null, 'sec-a');

    expect(useEditorStore.getState().sectionId).toBe('sec-b');
    expect(useEditorStore.getState().sectionContent).toBe('<p>B 节原内容</p>');
  });
});
