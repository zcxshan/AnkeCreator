/**
 * AnkeTab 收集进度条（AnkeProgressBar）
 *
 * 用于 AnkeTab 抓取/转换 NGA 帖子时显示进度。
 * 因为当前 collectNga IPC 是单次返回，本组件只表达
 * "正在跑"（current=0）和"完成"（current=total）两种状态。
 * 未来要做分页进度时，从主进程推 collectNga:onProgress 事件。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AnkeProgressBar } from './AnkeProgressBar';

describe('AnkeProgressBar', () => {
  it('current=0,total=10 渲染 0% 宽度', () => {
    const { container } = render(<AnkeProgressBar current={0} total={10} label="x" />);
    const bar = container.querySelector('[data-testid="anke-progress-fill"]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
    expect(container.textContent).toContain('0/10');
    expect(container.textContent).toContain('0%');
  });
  it('current=5,total=10 渲染 50% 宽度', () => {
    const { container } = render(<AnkeProgressBar current={5} total={10} label="x" />);
    const bar = container.querySelector('[data-testid="anke-progress-fill"]') as HTMLElement;
    expect(bar.style.width).toBe('50%');
    expect(container.textContent).toContain('5/10');
  });
  it('total=0 不抛异常，渲染 0%', () => {
    const { container } = render(<AnkeProgressBar current={0} total={0} label="x" />);
    const bar = container.querySelector('[data-testid="anke-progress-fill"]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });
});
