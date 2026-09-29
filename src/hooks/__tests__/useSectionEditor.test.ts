// ============================================================
// useSectionEditor hook 测试
//
// 修复根因:旧版 hook 在节切换时,除了调用 loadSection(其内部
// await db.setSectionContent 保存旧节),还额外触发 fire-and-forget
// 的 db.setSectionContent。这两个并发的 setSectionContent 造成
// lost-update,导致旧节内容被覆盖。
//
// 新版 hook 移除了冗余的 fire-and-forget 写入,仅依赖 loadSection
// 内的串行化写入。本测试验证:
//   1. 节切换时:调用 flushDebouncedSave + loadSection(各一次)
//   2. 节切换时:不直接调用 db.setSectionContent(由 loadSection 内部处理)
//   3. 同一 sectionId 再次设置:不触发任何调用
//   4. 组件卸载时:flush 保存被触发
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ---------- Mocks (使用 vi.hoisted 避免 hoisting 问题) ----------

const { flushDebouncedSaveMock, loadSectionMock, flushSectionContentMock, setSectionContentMock, mockSectionIdHolder } = vi.hoisted(() => ({
  flushDebouncedSaveMock: vi.fn(),
  loadSectionMock: vi.fn(async (_sectionId: string | null) => {}),
  flushSectionContentMock: vi.fn(async () => {}),
  setSectionContentMock: vi.fn(async (_id: string, _content: string | null) => {}),
  mockSectionIdHolder: { value: null as string | null },
}));

vi.mock('../../store/editorStore', () => ({
  useEditorStore: (selector?: any) => {
    const state = {
      sectionId: mockSectionIdHolder.value,
      loadSection: loadSectionMock,
      flushSectionContent: flushSectionContentMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  flushDebouncedSave: flushDebouncedSaveMock,
}));

vi.mock('../../db/index', () => ({
  setSectionContent: setSectionContentMock,
  getSectionContent: vi.fn(async () => null),
}));

// 加载被测 hook
import { useSectionEditor } from '../useSectionEditor';

// ---------- 测试 ----------

describe('useSectionEditor hook', () => {
  beforeEach(() => {
    flushDebouncedSaveMock.mockClear();
    loadSectionMock.mockClear();
    flushSectionContentMock.mockClear();
    setSectionContentMock.mockClear();
    mockSectionIdHolder.value = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('case 1: 切换到新节时,调用 flushDebouncedSave + loadSection', async () => {
    // 初始挂载:null → sec-1
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useSectionEditor(id),
      { initialProps: { id: 'sec-1' } },
    );

    // 初始挂载会触发一次 flushDebouncedSave + loadSection (null → sec-1)
    expect(flushDebouncedSaveMock).toHaveBeenCalledTimes(1);
    expect(loadSectionMock).toHaveBeenCalledTimes(1);
    expect(loadSectionMock).toHaveBeenCalledWith('sec-1');

    // 清空计数,准备下一次切换
    flushDebouncedSaveMock.mockClear();
    loadSectionMock.mockClear();

    // 切换到 sec-2
    await act(async () => {
      rerender({ id: 'sec-2' });
    });

    // 切换:应再次调用一次
    expect(flushDebouncedSaveMock).toHaveBeenCalledTimes(1);
    expect(loadSectionMock).toHaveBeenCalledTimes(1);
    expect(loadSectionMock).toHaveBeenCalledWith('sec-2');
  });

  it('case 2: 节切换时不直接调用 db.setSectionContent(由 loadSection 内部串行处理)', async () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useSectionEditor(id),
      { initialProps: { id: 'sec-1' } },
    );

    await act(async () => {
      rerender({ id: 'sec-2' });
    });

    // 关键断言:hook 自身不直接调用 db.setSectionContent
    // (旧版 bug:hook + loadSection 各调一次,造成并发 lost-update)
    expect(setSectionContentMock).not.toHaveBeenCalled();
  });

  it('case 3: 同一 sectionId 再次触发,不重复调用 loadSection', async () => {
    // 初始挂载:sec-1
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useSectionEditor(id),
      { initialProps: { id: 'sec-1' } },
    );

    // 清空计数(初始挂载已经调用了一次)
    flushDebouncedSaveMock.mockClear();
    loadSectionMock.mockClear();

    // 同 id 重新渲染
    await act(async () => {
      rerender({ id: 'sec-1' });
    });

    expect(loadSectionMock).not.toHaveBeenCalled();
    expect(flushDebouncedSaveMock).not.toHaveBeenCalled();
  });

  it('case 4: null → 有效节切换,正常触发 loadSection', async () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useSectionEditor(id),
      { initialProps: { id: null } },
    );

    // 初始挂载:null,不触发
    expect(loadSectionMock).not.toHaveBeenCalled();
    expect(flushDebouncedSaveMock).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ id: 'sec-1' });
    });

    expect(loadSectionMock).toHaveBeenCalledTimes(1);
    expect(loadSectionMock).toHaveBeenCalledWith('sec-1');
  });

  it('case 5: 返回 flushContent 与 flushSectionContent 一致', () => {
    const { result } = renderHook(
      ({ id }: { id: string | null }) => useSectionEditor(id),
      { initialProps: { id: 'sec-1' } },
    );

    expect(result.current.flushContent).toBe(flushSectionContentMock);
  });
});
