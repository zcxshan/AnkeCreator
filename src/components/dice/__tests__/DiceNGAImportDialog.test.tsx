import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiceNGAImportDialog } from '../DiceNGAImportDialog';

function seedHistory() {
  window.localStorage.setItem(
    'anjia-history',
    JSON.stringify([
      {
        id: 'h1',
        url: 'https://bbs.nga.cn/read.php?tid=123',
        startFloor: 0,
        endFloor: 2,
        prefix: '',
        items: [
          { floor: 0, author: '楼主', content: '选项A' },
          { floor: 1, author: '用户B', content: '选项B' },
        ],
        createdAt: Date.parse('2026-11-24T10:00:00'),
        label: 'tid=123 · 0-2楼',
      },
    ]),
  );
}

describe('DiceNGAImportDialog 收集历史', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('可以从收集安价历史载入选项并确认', () => {
    seedHistory();
    const onConfirm = vi.fn();
    render(<DiceNGAImportDialog open onClose={() => {}} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText(/收集历史/));
    fireEvent.click(screen.getByText('tid=123 · 0-2楼'));
    fireEvent.click(screen.getByText('导入到骰子'));

    expect(onConfirm).toHaveBeenCalledWith([
      { displayValue: '1', content: '选项A' },
      { displayValue: '2', content: '选项B' },
    ]);
  });

  it('没有历史时显示引导文案', () => {
    render(<DiceNGAImportDialog open onClose={() => {}} onConfirm={() => {}} />);
    fireEvent.click(screen.getByText(/收集历史/));
    expect(screen.getByText(/先到「收集安价」抓取楼层/)).toBeTruthy();
  });
});
