/**
 * NgaUpdateDialog：从 NGA 更新作品的弹窗
 *
 * 覆盖两条关键链路：
 * 1) 打开时按已关联帖子自动检测楼层数，并把终止楼层预填为总楼层；
 * 2) 选择「全部一节」后爬取，复用 collectAnkeToWorkJson，把解析出的节交给 onAppend。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const collectAnkeToWorkJson = vi.fn();
vi.mock('../../../utils/ankeCollect', () => ({
  collectAnkeToWorkJson: (...args: unknown[]) => collectAnkeToWorkJson(...args),
}));

vi.mock('../../../hooks/useNgaCollectCommon', () => ({
  useNgaCollectCommon: () => ({
    progress: { current: 0, total: 0 },
    progressMessage: '',
    paused: false,
    handleTogglePause: vi.fn(),
    handleCancel: vi.fn(),
  }),
}));

import { NgaUpdateDialog } from '../NgaUpdateDialog';

const THREAD_URL = 'https://bbs.nga.cn/read.php?tid=123456';

function installElectronApi(totalFloors: number, totalPages: number) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      fetchNgaThreadInfo: vi.fn().mockResolvedValue({
        ok: true,
        totalPages,
        totalFloors,
      }),
    },
  });
}

beforeEach(() => {
  collectAnkeToWorkJson.mockReset();
});

afterEach(() => {
  cleanup();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('NgaUpdateDialog', () => {
  it('自动检测楼层数并预填终止楼层', async () => {
    installElectronApi(120, 5);
    render(
      <NgaUpdateDialog
        open
        threadUrl={THREAD_URL}
        cookies=""
        onAppend={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('已检测到约 120 楼（5 页）')).toBeTruthy();
    const endInput = screen.getAllByRole('spinbutton')[1] as HTMLInputElement;
    expect(endInput.value).toBe('120');
  });

  it('按「全部一节」爬取并把节交给 onAppend', async () => {
    installElectronApi(120, 5);
    const onAppend = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    collectAnkeToWorkJson.mockResolvedValue({
      ok: true,
      jsonData: {
        data: {
          chapters: [
            {
              sections: [
                { title: '第 1 节', content: '内容 A' },
                { title: '', content: '内容 B' },
              ],
            },
          ],
        },
      },
      stats: { totalFloors: 120 },
      failedPages: [3],
      actualMaxFloor: 120,
    });

    render(
      <NgaUpdateDialog
        open
        threadUrl={THREAD_URL}
        cookies=""
        onAppend={onAppend}
        onClose={onClose}
      />,
    );

    await screen.findByText('已检测到约 120 楼（5 页）');
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'single' } });
    // 选择「全部一节」后不再显示「每 N 楼」输入框
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    fireEvent.click(screen.getByText('爬取并追加'));

    await waitFor(() => expect(onAppend).toHaveBeenCalledTimes(1));
    const [sections, meta] = onAppend.mock.calls[0];
    expect(sections).toEqual([
      { title: '第 1 节', content: '内容 A' },
      { title: '第 2 节', content: '内容 B' },
    ]);
    expect(meta).toMatchObject({ totalFloors: 120, failedPages: [3], actualMaxFloor: 120 });
    expect(collectAnkeToWorkJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: THREAD_URL,
        startFloor: 1,
        endFloor: 120,
        sectionMode: 'single',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
