import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiceNGAImportDialog } from '../DiceNGAImportDialog';

describe('DiceNGAImportDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('粘贴 NGA 文本后确认会解析为选项', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<DiceNGAImportDialog open onClose={onClose} onConfirm={onConfirm} />);

    const textarea = screen.getByPlaceholderText(/1楼 用户A/) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '1楼 用户A：选项一\n2楼 用户B：选项二' },
    });
    fireEvent.click(screen.getByText('导入到骰子'));

    expect(onConfirm).toHaveBeenCalledWith([
      { displayValue: '1', content: '选项一' },
      { displayValue: '2', content: '选项二' },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('点击收集安价会内联展开帖子链接面板', () => {
    render(<DiceNGAImportDialog open onClose={() => {}} onConfirm={() => {}} />);

    expect(screen.queryByPlaceholderText(/read\.php\?tid=/)).toBeNull();
    fireEvent.click(screen.getByText('收集安价'));
    expect(screen.getByPlaceholderText(/read\.php\?tid=/)).toBeTruthy();
    expect(screen.getByText('开始收集')).toBeTruthy();
  });

  it('文本为空时导入按钮禁用', () => {
    render(<DiceNGAImportDialog open onClose={() => {}} onConfirm={() => {}} />);
    const button = screen.getByText('导入到骰子') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
