// ============================================================
// SmileyPicker（NGA 表情面板）组件测试
//
// 覆盖：
//   1. 默认停在 AC娘(v1)，渲染哭笑等表情格
//   2. 切换分类 Tab 后渲染该包表情
//   3. 点击表情回传 pack/face
// ============================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SmileyPicker } from '../SmileyPicker';

afterEach(cleanup);

describe('SmileyPicker', () => {
  it('默认停在 AC娘(v1) 并渲染哭笑表情', () => {
    render(<SmileyPicker onPick={() => {}} onClose={() => {}} />);
    const tab = screen.getByRole('tab', { name: 'AC娘(v1)' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '哭笑' })).toBeTruthy();
  });

  it('切换到 NG娘 后渲染该分类表情', () => {
    render(<SmileyPicker onPick={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'NG娘' }));
    expect(screen.getByRole('button', { name: '呲牙笑' })).toBeTruthy();
  });

  it('点击表情回传 pack 与 face', () => {
    const onPick = vi.fn();
    render(<SmileyPicker onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '哭笑' }));
    expect(onPick).toHaveBeenCalledWith('ac', '哭笑');
  });
});
