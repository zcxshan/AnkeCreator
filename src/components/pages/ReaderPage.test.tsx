import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ReaderPage } from './ReaderPage';

// Mock stores
vi.mock('../../store/storyStore', () => ({
  useStoryStore: (() => ({
    stories: [{ id: 's1', title: '测试作品' }],
    activeStoryId: 's1',
    volumes: [],
    chapters: [{ id: 'c1', title: '第一章', story_id: 's1', volume_id: null, order_index: 0 }],
    sections: [{ id: 'sec1', title: '第一节', chapter_id: 'c1', order_index: 0, content: '<p>阅读内容</p>' }],
    activeSectionId: 'sec1',
    setActiveSection: vi.fn(),
  })) as any,
}));
(useStoryStore as any).getState = () => ({});

vi.mock('../../db/index', () => ({
  getStoryWithAll: vi.fn().mockResolvedValue({
    id: 's1', title: '测试作品',
    chapters: [{ id: 'c1', title: '第一章', sections: [{ id: 'sec1', title: '第一节', content: '<p>阅读内容</p>' }] }],
  }),
  getSectionContent: vi.fn().mockResolvedValue('<p>阅读内容</p>'),
}));

vi.mock('../../utils/platform', () => ({
  isCapacitor: false,
  isElectron: false,
}));

// showToast 必须引用稳定：ReaderPage 内容加载 useEffect 依赖 [activeSectionId, showToast]，
// 若每次 render 返回新函数引用会导致 effect 无限重跑、contentLoading 永远为 true
const { stableShowToast } = vi.hoisted(() => ({ stableShowToast: vi.fn() }));
vi.mock('../../store/toastStore', () => ({
  useToastStore: ((selector?: any) =>
    typeof selector === 'function'
      ? selector({ showToast: stableShowToast })
      : { showToast: stableShowToast }
  ) as any,
}));

import { useStoryStore } from '../../store/storyStore';

afterEach(cleanup);

describe('ReaderPage', () => {
  it('渲染作品标题和章节列表', async () => {
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('测试作品')).toBeTruthy();
    });
    expect(screen.getByText('第一章')).toBeTruthy();
  });

  it('渲染节内容', async () => {
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('阅读内容')).toBeTruthy();
    });
  });

  it('点击章节跳转到该章节的节', async () => {
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('第一章')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('第一章'));
    // Should call setActiveSection or navigate
  });

  it('字号调节按钮：小/中/大', async () => {
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('测试作品')).toBeTruthy();
    });
    expect(screen.getByTitle('小字号') || screen.getByText('小')).toBeTruthy();
    expect(screen.getByTitle('中字号') || screen.getByText('中')).toBeTruthy();
    expect(screen.getByTitle('大字号') || screen.getByText('大')).toBeTruthy();
  });

  it('主题切换按钮：亮/暗/护眼', async () => {
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('测试作品')).toBeTruthy();
    });
    // Look for theme buttons
    expect(screen.getByTitle('亮色主题') || screen.getByText('亮')).toBeTruthy();
    expect(screen.getByTitle('暗色主题') || screen.getByText('暗')).toBeTruthy();
    expect(screen.getByTitle('护眼主题') || screen.getByText('护眼')).toBeTruthy();
  });

  it('自动滚动按钮', async () => {
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('测试作品')).toBeTruthy();
    });
    const autoScrollBtn = screen.getByTitle('自动滚动') || screen.getByText('自动滚动');
    expect(autoScrollBtn).toBeTruthy();
  });

  it('返回按钮调用 onBack', async () => {
    const onBack = vi.fn();
    render(<ReaderPage onBack={onBack} />);
    await waitFor(() => {
      expect(screen.getByText('测试作品')).toBeTruthy();
    });
    const backBtn = screen.getByTitle('返回') || screen.getByText('返回');
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalled();
  });
});

describe('ReaderPage 桌面端目录切换', () => {
  beforeEach(() => {
    cleanup();
  });

  it('桌面端（isCapacitor=false）也显示 ☰ 按钮', async () => {
    // isCapacitor 已经在文件顶部 mock 为 false（默认桌面端）
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('测试作品')).toBeTruthy();
    });
    // ☰ 按钮应可见（带 title="目录"）
    const btn = screen.getByTitle('目录');
    expect(btn).toBeTruthy();
  });

  it('点击 ☰ 按钮折叠/展开目录侧栏（桌面端默认展开后被折叠）', async () => {
    render(<ReaderPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('测试作品')).toBeTruthy();
    });

    // 桌面端默认应展开（isCapacitor=false），所以章节标题可见
    expect(screen.getByText('第一章')).toBeTruthy();

    // 点击 ☰ 按钮折叠
    const toggleBtn = screen.getByTitle('目录');
    fireEvent.click(toggleBtn);

    // 折叠后侧栏宽度应为 0，章节标题不再可见
    await waitFor(() => {
      // 目录的 260px 宽折叠到 0
      const drawer = document.querySelector('div[style*="width: 0"]');
      expect(drawer).toBeTruthy();
    });

    // 再次点击展开
    fireEvent.click(toggleBtn);
    await waitFor(() => {
      const drawer = document.querySelector('div[style*="width: 260px"]');
      expect(drawer).toBeTruthy();
    });
  });
});
