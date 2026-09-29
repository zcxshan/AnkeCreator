// ============================================================
// loadSection race condition 修复验证
//
// 修复根因：旧版 loadSection 在加载新节前会 set({ sectionId: null })，
// 此中间态期间用户输入触发的 setSectionContent 会因 if(sectionId) 失败
// 而跳过防抖保存，导致输入丢失。大文件下窗口拉长，加剧丢失。
//
// 新版 loadSection 改用 loadingSectionId 标记加载中，不清空 sectionId，
// 保证防抖保存持续生效；并在加载完成后用 loadingSectionId 守卫，防止
// 快速切换 A→B→C 时旧请求覆盖最终状态。
//
// 本测试验证：
//   1. 加载期间 sectionId 不被清空（防抖保存仍能触发）
//   2. 快速切换 A→B→C 时仅最终 C 被应用
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setSectionContentMock, getSectionContentMock } = vi.hoisted(() => ({
  setSectionContentMock: vi.fn(async (_id: string, _content: string) => {}),
  getSectionContentMock: vi.fn(async (_id: string) => 'content-for-section'),
}));

vi.mock('../../db/index', () => ({
  setSectionContent: setSectionContentMock,
  getSectionContent: getSectionContentMock,
}));

import { useEditorStore } from '../editorStore';

describe('loadSection race condition fix', () => {
  beforeEach(() => {
    setSectionContentMock.mockClear();
    getSectionContentMock.mockClear();
    useEditorStore.setState({
      sectionId: null,
      sectionContent: null,
      sectionLoading: false,
      loadingSectionId: null,
    });
  });

  it('加载期间 sectionId 不被清空（保持防抖保存生效）', async () => {
    getSectionContentMock.mockImplementation(
      () => new Promise((r) => setTimeout(() => r('new-content'), 50)),
    );
    // 先加载 section-A
    await useEditorStore.getState().loadSection('section-A');
    expect(useEditorStore.getState().sectionId).toBe('section-A');
    // 启动 section-B 的加载（不 await）
    const p = useEditorStore.getState().loadSection('section-B');
    // 此时 loadSection 内部 await db.setSectionContent('section-A', ...) 尚未 resolve
    // 关键验证：sectionId 仍是 section-A（未被清空为 null）—— 这是修复的核心
    expect(useEditorStore.getState().sectionId).toBe('section-A');
    // 等待 setSectionContent 微任务 resolve，loadSection 进入 set({ loadingSectionId, sectionLoading: true })
    await Promise.resolve();
    await Promise.resolve();
    // 现在已进入"加载中"状态，但仍未清空 sectionId
    expect(useEditorStore.getState().sectionId).toBe('section-A');
    expect(useEditorStore.getState().sectionLoading).toBe(true);
    expect(useEditorStore.getState().loadingSectionId).toBe('section-B');
    // 加载期间用户输入 → setSectionContent 应能触发防抖保存（sectionId 非空）
    useEditorStore.getState().setSectionContent('user-input');
    // await 完成
    await p;
    expect(useEditorStore.getState().sectionId).toBe('section-B');
    expect(useEditorStore.getState().sectionContent).toBe('new-content');
    expect(useEditorStore.getState().sectionLoading).toBe(false);
    expect(useEditorStore.getState().loadingSectionId).toBe(null);
  });

  it('快速切换 A→B→C 时仅最终 C 被应用', async () => {
    getSectionContentMock.mockImplementation(
      (id: string) => new Promise((r) => setTimeout(() => r(`content-${id}`), 30)),
    );
    const pA = useEditorStore.getState().loadSection('A');
    const pB = useEditorStore.getState().loadSection('B');
    const pC = useEditorStore.getState().loadSection('C');
    await Promise.all([pA, pB, pC]);
    // 最终 sectionId 应为最后请求的 C
    expect(useEditorStore.getState().sectionId).toBe('C');
    expect(useEditorStore.getState().sectionContent).toBe('content-C');
    // loading 状态已复位
    expect(useEditorStore.getState().sectionLoading).toBe(false);
    expect(useEditorStore.getState().loadingSectionId).toBe(null);
  });

  it('loadSection(null) 清空所有状态', async () => {
    // 先加载一个节
    await useEditorStore.getState().loadSection('section-X');
    expect(useEditorStore.getState().sectionId).toBe('section-X');
    // 清空
    await useEditorStore.getState().loadSection(null);
    expect(useEditorStore.getState().sectionId).toBe(null);
    expect(useEditorStore.getState().sectionContent).toBe(null);
    expect(useEditorStore.getState().sectionLoading).toBe(false);
    expect(useEditorStore.getState().loadingSectionId).toBe(null);
  });
});
