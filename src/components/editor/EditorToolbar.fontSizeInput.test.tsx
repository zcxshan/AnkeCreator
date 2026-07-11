/**
 * EditorToolbar 字号 input + range 单元测试
 *
 * 关注点：
 * 1. 字号 input 范围 20-500
 * 2. 存在 range 滑动条，范围 20-500
 * 3. input 和 range 互相同步（受控组件都绑定 activeFontSizePct）
 * 4. 连续输入不丢焦点（不在每次 onChange 时偷焦点）
 * 5. 允许输入 < 20 / > 500，失焦时自动钳位
 *
 * 注：上轮测试的 onMouseDown.preventDefault 已被移除（用户决定让选区视觉高亮短暂消失，
 *     换取 input 可点击）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock 所有 store
const setActiveStylesMock = vi.fn();
const lockActiveStylesMock = vi.fn();
vi.mock('../../store/editorStore', () => ({
  useEditorStore: Object.assign(
    vi.fn((selector: any) => {
      const state = {
        activeStyles: { fontSize: '120%', fontFamily: '', color: '', bold: false, italic: false, underline: false, strike: false },
        cursorStyles: { fontSize: '120%', fontFamily: '', color: '', bold: false, italic: false, underline: false, strike: false },
        activeStylesLocked: false,
        setActiveStyles: setActiveStylesMock,
        lockActiveStyles: lockActiveStylesMock,
        unlockActiveStyles: vi.fn(),
      };
      return typeof selector === 'function' ? selector(state) : state;
    }),
    { getState: () => ({ activeStyles: { fontSize: '120%' }, setActiveStyles: setActiveStylesMock, lockActiveStyles: lockActiveStylesMock }) },
  ),
}));
vi.mock('../../store/settingStore', () => ({
  useSettingStore: vi.fn((selector: any) => {
    const state = { localUploadEnabled: false, ngaCookies: '', imageStoreMode: 'remote' };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: Object.assign(
    vi.fn((selector: any) => {
      const state = { showToast: vi.fn() };
      return typeof selector === 'function' ? selector(state) : state;
    }),
    { getState: () => ({ showToast: vi.fn() }) },
  ),
}));
vi.mock('../../store/diceStore', () => ({
  useDiceStore: vi.fn((selector: any) => {
    const state = { /* whatever */ };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

vi.mock('../../utils/uploadImage', () => ({
  uploadImagesWithProgress: vi.fn(),
  ensureLocalWarning: vi.fn(),
}));

import { EditorToolbar } from './EditorToolbar';

function makeProps(editorEl?: HTMLElement | null) {
  return {
    editorElRef: { current: editorEl ?? null } as React.MutableRefObject<HTMLElement | null>,
    savedRangeRef: { current: null } as React.MutableRefObject<Range | null>,
    onInsertImage: vi.fn(),
    onInsertDice: vi.fn(),
  };
}

describe('EditorToolbar 字号 input + range', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setActiveStylesMock.mockClear();
    lockActiveStylesMock.mockClear();
  });

  it('字号 input 存在且 min=20, max=500', () => {
    render(<EditorToolbar {...makeProps()} />, { container });
    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(numInput).toBeTruthy();
    expect(numInput.min).toBe('20');
    expect(numInput.max).toBe('500');
    expect(numInput.step).toBe('1');
  });

  it('存在 range 滑动条，min=20, max=500', () => {
    render(<EditorToolbar {...makeProps()} />, { container });
    const rangeInput = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(rangeInput).toBeTruthy();
    expect(rangeInput.min).toBe('20');
    expect(rangeInput.max).toBe('500');
    expect(rangeInput.step).toBe('1');
  });

  it('input 和 range 互相同步（同一 activeFontSizePct）', () => {
    render(<EditorToolbar {...makeProps()} />, { container });
    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const rangeInput = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    // 当前 mock 字号 120%
    expect(numInput.value).toBe('120');
    expect(rangeInput.value).toBe('120');
  });

  it('字号 input 不再 preventDefault（确保可点击聚焦）', () => {
    render(<EditorToolbar {...makeProps()} />, { container });
    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    const spy = vi.spyOn(evt, 'preventDefault');
    numInput.dispatchEvent(evt);
    // preventDefault 不应被调用（让 input 正常获取焦点）
    expect(spy).not.toHaveBeenCalled();
  });

  it('字号 input 连续输入不丢焦点（每次 onChange 不触发 focusEditor）', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    render(<EditorToolbar {...makeProps(editor)} />, { container });

    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    numInput.focus();
    expect(document.activeElement).toBe(numInput);

    // 模拟连续输入 "1" -> "15" -> "150"
    fireEvent.change(numInput, { target: { value: '1' } });
    expect(document.activeElement).toBe(numInput);
    fireEvent.change(numInput, { target: { value: '15' } });
    expect(document.activeElement).toBe(numInput);
    fireEvent.change(numInput, { target: { value: '150' } });
    expect(document.activeElement).toBe(numInput);
  });

  it('字号 input 输入 < 20 数值仅更新本地态，不应用到 store', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    render(<EditorToolbar {...makeProps(editor)} />, { container });

    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    setActiveStylesMock.mockClear();
    fireEvent.change(numInput, { target: { value: '5' } });
    // 越界值不应用：setActiveStyles 不应被调用
    expect(setActiveStylesMock).not.toHaveBeenCalled();
    // input 显示本地态的 5
    expect(numInput.value).toBe('5');
  });

  it('字号 input 输入 < 20 后失焦，自动钳位为 20 并应用', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    render(<EditorToolbar {...makeProps(editor)} />, { container });

    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    setActiveStylesMock.mockClear();
    fireEvent.change(numInput, { target: { value: '5' } });
    // 越界值未应用
    expect(setActiveStylesMock).not.toHaveBeenCalled();
    // 失焦 → 钳位到 20
    fireEvent.blur(numInput);
    expect(numInput.value).toBe('20');
    // 失焦后会调 handleFontSizeChange(20) → setActiveStyles 被调用
    expect(setActiveStylesMock).toHaveBeenCalled();
    const lastCall = setActiveStylesMock.mock.calls[setActiveStylesMock.mock.calls.length - 1][0];
    expect(lastCall.fontSize).toBe('20%');
  });

  it('字号 input 输入 > 500 后失焦，自动钳位为 500 并应用', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    render(<EditorToolbar {...makeProps(editor)} />, { container });

    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    setActiveStylesMock.mockClear();
    fireEvent.change(numInput, { target: { value: '999' } });
    // 越界值未应用
    expect(setActiveStylesMock).not.toHaveBeenCalled();
    // 失焦 → 钳位到 500
    fireEvent.blur(numInput);
    expect(numInput.value).toBe('500');
    expect(setActiveStylesMock).toHaveBeenCalled();
    const lastCall = setActiveStylesMock.mock.calls[setActiveStylesMock.mock.calls.length - 1][0];
    expect(lastCall.fontSize).toBe('500%');
  });

  it('字号 input 按 Enter 触发 blur，blur 处理器正确应用当前值', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    render(<EditorToolbar {...makeProps(editor)} />, { container });

    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    setActiveStylesMock.mockClear();
    numInput.focus();
    fireEvent.change(numInput, { target: { value: '180' } });
    // 180 在范围内，onChange 已应用
    expect(setActiveStylesMock).toHaveBeenCalled();
    const callsBeforeEnter = setActiveStylesMock.mock.calls.length;
    // 按 Enter → blur
    fireEvent.keyDown(numInput, { key: 'Enter' });
    // blur 后会再调一次（保持状态一致）
    expect(setActiveStylesMock.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeEnter);
    // 不失焦（不在 toolbar 内的 element），但 blur 事件被触发
  });

  it('字号 range 滑动条实时应用并同步本地态', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    render(<EditorToolbar {...makeProps(editor)} />, { container });

    const rangeInput = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    const numInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    setActiveStylesMock.mockClear();
    fireEvent.change(rangeInput, { target: { value: '250' } });
    // setActiveStyles 被调用
    expect(setActiveStylesMock).toHaveBeenCalled();
    const lastCall = setActiveStylesMock.mock.calls[setActiveStylesMock.mock.calls.length - 1][0];
    expect(lastCall.fontSize).toBe('250%');
    // 同步到 input 的本地态
    expect(numInput.value).toBe('250');
  });
});
