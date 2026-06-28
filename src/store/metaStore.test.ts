import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock db 模块：reorderOutlines 只用到 updateOutline
vi.mock('../db/index', () => ({
  updateOutline: vi.fn(),
}));

import { useMetaStore } from './metaStore';
import * as db from '../db/index';

describe('useMetaStore - reorderOutlines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 初始化 store 状态：3 条大纲
    useMetaStore.setState({
      outlines: [
        { id: 'a', order_index: 0 } as any,
        { id: 'b', order_index: 1 } as any,
        { id: 'c', order_index: 2 } as any,
      ],
    });
  });

  it('reorderOutlines 等待所有 DB 写入完成后再 resolve', async () => {
    let resolveCount = 0;
    (db.updateOutline as any).mockImplementation(() => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          resolveCount++;
          resolve();
        }, 10);
      });
    });

    // 调用并 await
    await useMetaStore.getState().reorderOutlines(['c', 'a', 'b']);

    // 关键断言：await 返回时，所有 3 次 DB 写入都应已完成
    expect(resolveCount).toBe(3);
    expect(db.updateOutline).toHaveBeenCalledTimes(3);
  });

  it('reorderOutlines 按 orderedIds 顺序写入正确的 order_index', async () => {
    (db.updateOutline as any).mockResolvedValue(undefined);

    await useMetaStore.getState().reorderOutlines(['c', 'a', 'b']);

    expect(db.updateOutline).toHaveBeenNthCalledWith(1, 'c', { order_index: 0 });
    expect(db.updateOutline).toHaveBeenNthCalledWith(2, 'a', { order_index: 1 });
    expect(db.updateOutline).toHaveBeenNthCalledWith(3, 'b', { order_index: 2 });
  });
});
