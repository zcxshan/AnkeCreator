import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../db/index', () => ({
  setSectionContent: vi.fn(),
}));

import * as db from '../db/index';
import { htmlToNGABBCode } from '../utils/ngaHtmlToBBCode';

async function loadStore() {
  vi.resetModules();
  const mod = await import('./editorStore');
  return mod;
}

describe('editorStore 保存状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('写盘成功后才标记为已保存', async () => {
    (db.setSectionContent as Mock).mockResolvedValue(undefined);
    const { useEditorStore, flushDebouncedSave } = await loadStore();
    useEditorStore.setState({ sectionId: 's1', sectionContent: '<p>a</p>' });

    useEditorStore.getState().setSectionContent('<p>b</p>');
    // 防抖未到期前是 pending
    expect(useEditorStore.getState().saveStatus).toBe('pending');

    const ok = await flushDebouncedSave();
    expect(ok).toBe(true);
    // content 与派生 BBCode 在同一次写入落盘，且状态里缓存派生结果
    expect(db.setSectionContent).toHaveBeenCalledWith(
      's1',
      '<p>b</p>',
      htmlToNGABBCode('<p>b</p>'),
    );
    expect(useEditorStore.getState().saveStatus).toBe('saved');
    expect(useEditorStore.getState().sectionBbcode).toBe(htmlToNGABBCode('<p>b</p>'));
  });

  it('写盘失败时状态为 failed，并保留内容供重试', async () => {
    (db.setSectionContent as Mock).mockRejectedValue(new Error('EACCES: 只读目录'));
    const { useEditorStore, flushDebouncedSave, hasPendingSave } = await loadStore();
    useEditorStore.setState({ sectionId: 's1', sectionContent: '<p>a</p>' });

    useEditorStore.getState().setSectionContent('<p>b</p>');
    const ok = await flushDebouncedSave();

    expect(ok).toBe(false);
    expect(useEditorStore.getState().saveStatus).toBe('failed');
    expect(useEditorStore.getState().saveError).toContain('EACCES');
    // 失败内容仍挂起，避免静默丢失
    expect(hasPendingSave()).toBe(true);
  }, 15000);

  it('失败后重试成功会回到 saved', async () => {
    (db.setSectionContent as Mock).mockRejectedValueOnce(new Error('磁盘已满'));
    (db.setSectionContent as Mock).mockResolvedValue(undefined);
    const { useEditorStore, flushDebouncedSave } = await loadStore();
    useEditorStore.setState({ sectionId: 's1', sectionContent: '<p>a</p>' });

    useEditorStore.getState().setSectionContent('<p>b</p>');
    await flushDebouncedSave();

    const ok = await useEditorStore.getState().retryPendingSave();
    expect(ok).toBe(true);
    expect(useEditorStore.getState().saveStatus).toBe('saved');
    // 重试仍写入同一份内容（BBCode 派生值保持一致）
    expect(db.setSectionContent).toHaveBeenLastCalledWith(
      's1',
      '<p>b</p>',
      htmlToNGABBCode('<p>b</p>'),
    );
  }, 15000);

  it('保存期间的新输入不会被旧写入覆盖，最终状态回到 saved', async () => {
    let resolveFirst: (() => void) | null = null;
    (db.setSectionContent as Mock)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(undefined);

    const { useEditorStore, flushDebouncedSave } = await loadStore();
    useEditorStore.setState({ sectionId: 's1', sectionContent: '<p>a</p>' });
    useEditorStore.getState().setSectionContent('<p>first</p>');

    const flushing = flushDebouncedSave();
    // 第一次写盘仍在途时产生新输入
    useEditorStore.getState().setSectionContent('<p>second</p>');
    resolveFirst?.();
    await flushing;

    // 新输入仍处于 pending，不能被第一次写盘结果标记为 saved
    expect(useEditorStore.getState().saveStatus).toBe('pending');
    const ok = await flushDebouncedSave();
    expect(ok).toBe(true);
    expect(db.setSectionContent).toHaveBeenLastCalledWith(
      's1',
      '<p>second</p>',
      htmlToNGABBCode('<p>second</p>'),
    );
    expect(useEditorStore.getState().saveStatus).toBe('saved');
  });
});
