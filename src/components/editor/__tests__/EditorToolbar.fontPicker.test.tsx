// ============================================================
// FontPicker（编辑器字体下拉）组件测试
//
// 覆盖：
//   1. 默认按当前值显示对应字体名
//   2. 点击展开贴纸风列表（role=listbox）
//   3. 选择字体后回传 NGA value 并收起
// ============================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FontPicker } from '../FontPicker';

afterEach(cleanup);

describe('FontPicker', () => {
  it('按当前值显示字体名', () => {
    render(<FontPicker value="yahei" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /微软雅黑/ })).toBeTruthy();
  });

  it('点击后展开列表，包含全部字体', () => {
    render(<FontPicker value="simsun" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /宋体/ }));
    expect(screen.getByRole('listbox', { name: '字体' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Arial' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Georgia' })).toBeTruthy();
  });

  it('选择字体后回传 value 并收起列表', () => {
    const onChange = vi.fn();
    render(<FontPicker value="simsun" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /宋体/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Arial' }));
    expect(onChange).toHaveBeenCalledWith('Arial');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
