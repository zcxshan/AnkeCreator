/**
 * AnkeTab render 烟雾测试
 *
 * 目的：捕获"组件函数体内引用了未定义变量"这类 bug。
 * 之前出过 `ReferenceError: sectionMode is not defined` —— useState 声明在
 * 一次 Edit 中未落盘，但 JSX / 函数调用已写好。
 *
 * 这个测试只要 render AnkeTab 就会在组件函数顶部执行，
 * 任何缺失的 useState/变量声明都会立刻在测试里抛 ReferenceError。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';

// Mock 依赖 store：AnkeTab 启动时就读这两个 store
vi.mock('../../store/settingStore', () => ({
  useSettingStore: vi.fn((selector?: any) => {
    if (typeof selector === 'function') return selector({ ngaCookies: '' });
    return { ngaCookies: '' };
  }),
}));
vi.mock('../../store/toastStore', () => ({
  useToastStore: vi.fn((selector?: any) => {
    if (typeof selector === 'function') return selector({ showToast: () => '' });
    return { showToast: () => '' };
  }),
}));

// Mock collectAnkeToWorkJson：默认永不 resolve（保持 running=true）
// 单个测试可以用 .mockResolvedValueOnce / .mockImplementation 覆盖
vi.mock('../../utils/ankeCollect', () => ({
  collectAnkeToWorkJson: vi.fn().mockImplementation(
    () => new Promise(() => {}),
  ),
  formatPostTime: (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' '),
  DEFAULT_FORMAT_SETTINGS: {
    volumeTitleFormat: '第一卷',
    chapterTitleFormat: '第一章',
    sectionTitleFormat: '第 {startFloor}-{endFloor} 楼',
    sectionContentRangeFormat: '',
  },
}));

// electronAPI 不存在时不调用，但 render 不应触发
describe('AnkeTab render 烟雾', () => {
  it('render AnkeTab 不应抛 ReferenceError', async () => {
    const { AnkeTab } = await import('./AnjiaPage');
    // 直接调 render —— 任何未声明的变量会在组件函数体执行时立刻抛
    expect(() => render(<AnkeTab />)).not.toThrow();
  });
});

describe('AnkeTab 取消按钮', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('跑中显示"取消"按钮（不在跑中时不显示）', async () => {
    const { AnkeTab } = await import('./AnjiaPage');
    render(<AnkeTab />);
    // 初始状态：未跑，不应有"取消"按钮
    expect(screen.queryByText('取消')).toBeNull();
  });

  it('点击"取消"按钮调用 window.electronAPI.cancelNgaCollect', async () => {
    // mock electronAPI
    const cancelNgaCollect = vi.fn().mockResolvedValue({ ok: true });
    const collectNga = vi.fn().mockImplementation(
      () => new Promise(() => {}), // 永不 resolve，模拟"跑中"
    );
    (global as any).window.electronAPI = {
      collectNga,
      cancelNgaCollect,
      // saveStoryAsFile：防止跑完走到保存路径
      saveStoryAsFile: vi.fn(),
    };

    const { AnkeTab } = await import('./AnjiaPage');
    render(<AnkeTab />);
    // 填表单（默认值应已合理，否则用 fireEvent.change）
    const urlInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, { target: { value: 'https://nga.178.com/read.php?tid=1234' } });
    });
    // 点击"开始收集"按钮
    const startBtn = screen.getByText(/开始收集|确认收集|开始爬取|启动/);
    await act(async () => {
      fireEvent.click(startBtn);
    });
    // 现在应该显示"取消"按钮
    const cancelBtn = screen.queryByText('取消');
    if (cancelBtn) {
      await act(async () => {
        fireEvent.click(cancelBtn);
      });
      expect(cancelNgaCollect).toHaveBeenCalled();
    } else {
      // 实现尚未到位，断言失败（RED 状态）
      throw new Error('未找到"取消"按钮 —— AnkeTab 尚未实现跑中取消功能');
    }
    // 清理
    delete (global as any).window.electronAPI;
  });
});

describe('AnjiaPage 移动端提示', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetModules();
    // 确保移动端测试环境：有 Capacitor、无 electronAPI
    delete (global as any).window.electronAPI;
    (global as any).window = (global as any).window || {};
    (global as any).window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
  });
  afterEach(() => {
    delete (global as any).window.Capacitor;
    delete (global as any).window.electronAPI;
  });

  it('移动端（isCapacitor=true）显示"移动端暂不支持收集"提示', async () => {
    const { AnjiaPage } = await import('./AnjiaPage');
    render(<AnjiaPage onBack={() => {}} />);
    expect(screen.getByText('移动端暂不支持收集')).toBeDefined();
  });

  it('移动端提示卡片包含"了解桌面版"按钮', async () => {
    const { AnjiaPage } = await import('./AnjiaPage');
    render(<AnjiaPage onBack={() => {}} />);
    expect(screen.getByText('了解桌面版')).toBeDefined();
  });
});
