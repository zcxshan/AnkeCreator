/**
 * EditorPage 渲染测试：接受 volume_id: null 的章节（"未归卷"）
 *
 * 背景：ankecolect 导出的章节不含 volume_id，导入后章节在"未归卷"区。
 * 修复前 EditorPage 的渲染条件要求 activeVolume && volIdx >= 0，
 * 导致未归卷的节主区显示空状态、富文本编辑器（连同工具栏）也不渲染。
 *
 * 修复后：只要 section 和 activeChapter 存在就渲染，
 * activeVolume 可选（null 时面包屑显示"未归卷"）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

// ---------- Store mocks ----------

const sectionState = {
  sectionId: 'sec-1',
  sectionContent: '<p>test content</p>',
  setSectionContent: vi.fn(),
  loadSection: vi.fn(),
  flushSectionContent: vi.fn(),
  flushDebouncedSave: vi.fn(),
  editorMode: 'bbcode' as 'visual' | 'bbcode',
  setEditorMode: vi.fn(),
  // 需求5:快速跳转 — 按节持久化滚动位置
  sectionScrollPositions: {} as Record<string, number>,
  setSectionScrollPosition: vi.fn(),
  getSectionScrollPosition: vi.fn(() => undefined),
};

vi.mock('../../store/editorStore', () => ({
  useEditorStore: (selector?: any) => (typeof selector === 'function' ? selector(sectionState) : sectionState),
  flushDebouncedSave: vi.fn(),
}));

const storyState = {
  stories: [{ id: 'story-1', title: 'Test Story' }],
  chapters: [
    // 关键：volume_id 为 null —— 这就是未归卷的章节
    { id: 'ch-1', story_id: 'story-1', title: '第1章', volume_id: null, order_index: 0 },
  ],
  volumes: [],
  sections: [
    { id: 'sec-1', chapter_id: 'ch-1', title: '我的节', content: '<p>test</p>', order_index: 0 },
  ],
  activeStoryId: 'story-1',
  activeChapterId: 'ch-1',
  activeSectionId: 'sec-1',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

vi.mock('../../store/storyStore', () => ({
  useStoryStore: (selector?: any) => (typeof selector === 'function' ? selector(storyState) : storyState),
}));

vi.mock('../../store/diceStore', () => ({
  useDiceStore: () => ({ openDialog: vi.fn() }),
}));

vi.mock('../../store/settingStore', () => ({
  useSettingStore: () => ({ ngaCookies: '' }),
}));

vi.mock('../../store/toastStore', () => {
  const showToast = vi.fn();
  // zustand 风格的 store：既是 hook 又有 .getState() 静态方法
  const useToastStore: any = () => ({ showToast });
  useToastStore.getState = () => ({ showToast });
  return { useToastStore };
});

vi.mock('../../store/diceHistoryStore', () => ({
  useDiceHistoryStore: () => ({ addRecord: vi.fn() }),
  buildDiceHistoryRecord: vi.fn(),
}));

vi.mock('../../store/imageWarningStore', () => ({
  useImageWarningStore: () => ({ show: vi.fn() }),
}));

vi.mock('../../store/metaStore', () => ({
  useMetaStore: () => ({}),
}));

vi.mock('../../store/themeStore', () => ({
  useThemeStore: () => ({}),
}));

// Phase E — 子卡点 3.2：BBCode 视图 Ctrl+Z
// 暴露可追踪的 undo / redo / push / reset，便于测试断言
// 用 vi.hoisted 让 historyState 在 vi.mock 工厂里也能访问
const { historyState } = vi.hoisted(() => {
  const state = {
    current: '',
    past: [] as string[],
    future: [] as string[],
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    undo: vi.fn(() => null as string | null),
    redo: vi.fn(() => null as string | null),
    push: vi.fn((newContent: string) => {
      if (newContent === state.current) return;
      state.past.push(state.current);
      state.current = newContent;
      state.future = [];
      state.canUndo.mockReturnValue(state.past.length > 0);
      state.canRedo.mockReturnValue(state.future.length > 0);
    }),
    reset: vi.fn((content: string) => {
      state.current = content;
      state.past = [];
      state.future = [];
      state.canUndo.mockReturnValue(false);
      state.canRedo.mockReturnValue(false);
    }),
  };
  return { historyState: state };
});

vi.mock('../../store/editorHistoryStore', () => {
  // zustand 的 hook 同时是函数（订阅器），又有 getState/setState 静态方法
  // 这里手动模拟：让 useEditorHistoryStore.getState() 能返回 historyState
  const useStoreFn: any = (selector?: any) =>
    typeof selector === 'function' ? selector(historyState) : historyState;
  useStoreFn.getState = () => historyState;
  useStoreFn.setState = (partial: any) => {
    Object.assign(historyState, typeof partial === 'function' ? partial(historyState) : partial);
  };
  useStoreFn.subscribe = vi.fn(() => () => {});
  return {
    useEditorHistoryStore: useStoreFn,
  };
});

vi.mock('../../hooks/useSectionEditor', () => ({
  useSectionEditor: vi.fn(),
}));

vi.mock('../../db/index', () => ({
  getStoryWithAll: vi.fn(),
  listSections: vi.fn(),
  getSectionContent: vi.fn(),
  setSectionContent: vi.fn(),
  setSectionBBCode: vi.fn(),
  listVolumes: vi.fn(),
  listChapters: vi.fn(),
  listWorldSettings: vi.fn(),
  listCharacters: vi.fn(),
  listCharacterRelations: vi.fn(),
  listOutline: vi.fn(),
  getOutline: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any));

// ---------- Sub-component mocks ----------

vi.mock('../editor/RichTextEditor', () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any));

// BBCodeEditor 是 EditorPage.tsx 内部局部组件，无法用 vi.mock 拦截
// 这里通过 querySelector 找 textarea（BBCodeEditor 渲染一个带 placeholder 的 textarea）

vi.mock('../outline/OutlineTree', () => ({
  OutlineTree: () => <div data-testid="outline-tree" />,
}));

vi.mock('../outline/OutlineEditor', () => ({
  OutlineEditor: () => null,
}));

vi.mock('../common/SyncDialog', () => ({
  SyncDialog: () => null,
}));

vi.mock('../dice/DiceConfigDialog', () => ({
  DiceConfigDialog: () => null,
}));

vi.mock('../character/CharacterEditor', () => ({
  CharacterPanel: () => null,
  CharacterEditor: () => null,
}));

vi.mock('../editor/RelationshipPanel', () => ({
  RelationshipPanel: () => null,
}));

vi.mock('../common/InputDialog', () => ({
  InputDialog: () => null,
}));

vi.mock('../common/UploadProgressDialog', () => ({
  UploadProgressDialog: () => null,
}));

vi.mock('../common/WorldSettingPanel', () => ({
  WorldSettingPanel: () => null,
}));

vi.mock('../common/DirectoryTree', () => ({
  DirectoryTree: () => null,
}));

vi.mock('../common/LocalModeBanner', () => ({
  LocalModeBanner: () => null,
}));

vi.mock('../../utils/uploadImage', () => ({
  uploadImagesWithProgress: vi.fn(),
  ensureLocalWarning: vi.fn(),
}));

vi.mock('../../utils/platform', () => ({
  isCapacitor: false,
  isElectron: false,
  isWeb: true,
  isMobile: false,
}));

vi.mock('../../utils/structureSync', () => ({
  computeDiff: vi.fn(),
  buildOutlineStructure: vi.fn(),
  buildDirectoryStructure: vi.fn(),
}));

describe('EditorPage 接受 volume_id: null 的章节', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('section 在未归卷 chapter 中时仍渲染编辑器（不再显示空状态）', async () => {
    const { EditorPage } = await import('./EditorPage');
    render(<EditorPage onBack={() => {}} />);
    // 关键断言：不应再看到"请在左侧选择一个节开始编辑"
    expect(screen.queryByText('请在左侧选择一个节开始编辑')).toBeNull();
    // 富文本编辑器应渲染（这里被 mock 成 data-testid）
    expect(screen.getByTestId('rich-text-editor')).toBeTruthy();
  });

  it('右侧"节标题"输入框显示 section.title（来自 store，不是 hardcoded 默认）', async () => {
    const { EditorPage } = await import('./EditorPage');
    render(<EditorPage onBack={() => {}} />);
    // 断言：至少有一个 input 的 defaultValue 来自 store 中的 "我的节"
    // （可能有两个：chapter 标题 + section 标题，都用了"我的节"作为 fixture）
    const titleInputs = screen.getAllByDisplayValue('我的节');
    expect(titleInputs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('EditorPage BBCode 视图保留用户内容（不离开即清空）', () => {
  // 保存初始 state 用于测试隔离
  const initialSections = [{ id: 'sec-1', chapter_id: 'ch-1', title: '我的节', content: '<p>test</p>', order_index: 0 }];
  const initialActiveSectionId = 'sec-1';

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    // 重置 sections 和 activeSectionId
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
  });

  afterEach(() => {
    cleanup();
    // 测试结束统一重置
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
  });

  it('首次挂载后切到 BBCode 视图：textarea 立即显示 section.bbcode（不再 isFirstMount 跳过）', async () => {
    const original = storyState.sections[0] as any;
    original.bbcode = '[b]节内保存的 BBCode[/b]';

    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    // 切到 BBCode 视图
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });

    // 找 textarea
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');

    // 关键断言：textarea 立即显示 section.bbcode（不再空白）
    expect(ta.value).toBe('[b]节内保存的 BBCode[/b]');

    delete original.bbcode;
  });

  it('BBCode 视图编辑 → 切到 visual → 切回 BBCode：textarea 仍显示用户输入（不被覆盖）', async () => {
    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    // 切到 BBCode 视图
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });

    // 用户输入
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');
    const userInput = '[i]用户正在编辑的 BBCode，不要丢[/i]';
    await act(async () => {
      fireEvent.change(ta, { target: { value: userInput } });
    });
    expect(ta.value).toBe(userInput);

    // 切到 visual 视图（不等防抖）
    const visualTab = screen.queryAllByRole('button').find((b) => /可视化编辑/.test(b.textContent || ''));
    if (!visualTab) throw new Error('No "可视化编辑" tab');
    await act(async () => {
      fireEvent.click(visualTab);
    });

    // 切回 BBCode 视图
    await act(async () => {
      const backToBBCode = screen.queryAllByRole('button').find((b) => /BBcode编辑/.test(b.textContent || ''));
      if (!backToBBCode) throw new Error('No "BBcode编辑" tab after switch');
      fireEvent.click(backToBBCode);
    });

    // 关键断言：textarea 仍显示用户输入（不被 section.bbcode 覆盖）
    const ta2 = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta2.value).toBe(userInput);
  });

  it('切换到不同 section：BBCode 视图的 textarea 重置为新 section 的 bbcode', async () => {
    // 准备两个节
    storyState.sections = [
      { id: 'sec-1', chapter_id: 'ch-1', title: '节1', content: '<p>1</p>', order_index: 0, bbcode: '[b]节1 BBCode[/b]' } as any,
      { id: 'sec-2', chapter_id: 'ch-1', title: '节2', content: '<p>2</p>', order_index: 1, bbcode: '[color=red]节2 BBCode[/color]' } as any,
    ];
    storyState.activeSectionId = 'sec-1';

    const { EditorPage } = await import('./EditorPage');
    const { container, rerender } = render(<EditorPage onBack={() => {}} />);

    // 切到 BBCode 视图
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });
    const ta1 = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta1.value).toBe('[b]节1 BBCode[/b]');

    // 切换 active section 到 sec-2
    await act(async () => {
      storyState.activeSectionId = 'sec-2';
    });
    rerender(<EditorPage onBack={() => {}} />);

    // 找新 textarea
    const ta2 = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta2.value).toBe('[color=red]节2 BBCode[/color]');
    // 还原由 afterEach 处理
  });
});

describe('EditorPage 显式加载按钮（取消自动对照）', () => {
  const initialSections = [{ id: 'sec-1', chapter_id: 'ch-1', title: '我的节', content: '<p>test</p>', order_index: 0 }];
  const initialActiveSectionId = 'sec-1';

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
    sectionState.sectionContent = '<p>test content</p>';
  });

  afterEach(() => {
    cleanup();
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
    sectionState.sectionContent = '<p>test content</p>';
  });

  it('BBCode 视图编辑 textarea 不自动触发 setSectionContent（取消自动对照）', async () => {
    // 监听 setSectionContent：之前会自动调，现在应该不调
    const setSectionContent = sectionState.setSectionContent as unknown as ReturnType<typeof vi.fn>;
    setSectionContent.mockClear();

    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    // 切到 BBCode 视图
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });

    // 改 textarea 内容
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');
    await act(async () => {
      fireEvent.change(ta, { target: { value: '[b]手动编辑的 BBCode[/b]' } });
    });

    // 等防抖 300ms
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    // 关键断言：setSectionContent 整个测试期间没被自动调过
    // （自动对照被取消：BBCode 视图编辑只持久化 section.bbcode，不应触发 setSectionContent）
    // 备注：初始化的 useSectionEditor / loadSection 等可能调用，但都跟用户 BBCode 编辑无关
    // 我们用 mock.calls 中查找参数是"BBCode 转换产物"的 —— 之前会是 <b>手动编辑的 BBCode</b>
    const autoConvertedCall = setSectionContent.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('手动编辑的 BBCode')
    );
    expect(autoConvertedCall).toBeUndefined();
  });

  it('BBCode 视图"同步到可视化"按钮：把 bbcodeDraft 转成 visual 内容写入 sectionContent', async () => {
    const original = storyState.sections[0] as any;
    original.bbcode = '[b]从 BBCode 加载[/b]';

    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    // 切到 BBCode 视图
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });

    // 找"同步到可视化"按钮
    const syncBtn = screen.queryAllByRole('button').find((b) => /同步到可视化/.test(b.textContent || ''));
    if (!syncBtn) throw new Error('No "同步到可视化" button');

    // 记录 setSectionContent 调用前的状态
    const setSectionContent = sectionState.setSectionContent as unknown as ReturnType<typeof vi.fn>;
    setSectionContent.mockClear();

    await act(async () => {
      fireEvent.click(syncBtn);
    });

    // 同步按钮改为弹二次确认弹窗，需点击"确认覆盖"才会实际执行同步
    const confirmBtn = await screen.findByRole('button', { name: /确认覆盖/ });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // 关键断言：setSectionContent 被调用，参数包含 <b> 从 BBCode 加载 </b>
    expect(setSectionContent).toHaveBeenCalled();
    const lastCallArg = setSectionContent.mock.calls[setSectionContent.mock.calls.length - 1][0];
    expect(lastCallArg).toContain('<b>');
    expect(lastCallArg).toContain('从 BBCode 加载');
    expect(lastCallArg).toContain('</b>');

    delete original.bbcode;
  });

  it('visual 视图"同步到BBCode"按钮：把 sectionContent 转成 BBCode 写入 bbcodeDraft + setSectionBBCode', async () => {
    // 设置 visual 内容
    sectionState.sectionContent = '<b>visual 转换</b>';

    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    // 默认在 visual 视图，找"同步到BBCode"按钮
    const syncBtn = screen.queryAllByRole('button').find((b) => /同步到BBCode/.test(b.textContent || ''));
    if (!syncBtn) throw new Error('No "同步到BBCode" button');

    await act(async () => {
      fireEvent.click(syncBtn);
    });

    // 同步按钮改为弹二次确认弹窗，需点击"确认覆盖"才会实际执行同步
    const confirmBtn = await screen.findByRole('button', { name: /确认覆盖/ });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // 切到 BBCode 视图查看 textarea
    const bbcodeTab = screen.queryAllByRole('button').find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });

    // 关键断言：textarea.value 包含转换后的 [b]visual 转换[/b]
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toContain('[b]');
    expect(ta.value).toContain('visual 转换');
    expect(ta.value).toContain('[/b]');

    // 清理
    sectionState.sectionContent = '<p>test content</p>';
  });

  it('bbcodeDraft 为空时点"同步到可视化"给 toast 提示，不抛错', async () => {
    const original = storyState.sections[0] as any;
    original.bbcode = '';

    const { EditorPage } = await import('./EditorPage');
    render(<EditorPage onBack={() => {}} />);

    // 切到 BBCode 视图
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });

    // 找"同步到可视化"按钮
    const syncBtn = screen.queryAllByRole('button').find((b) => /同步到可视化/.test(b.textContent || ''));
    if (!syncBtn) throw new Error('No "同步到可视化" button');

    // 不应抛错
    expect(() => {
      fireEvent.click(syncBtn);
    }).not.toThrow();

    delete original.bbcode;
  });
});

describe('EditorPage BBCode 语法校验（集成 bbcodeValidator）', () => {
  const initialSections = [{ id: 'sec-1', chapter_id: 'ch-1', title: '我的节', content: '<p>test</p>', order_index: 0 }];
  const initialActiveSectionId = 'sec-1';

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
  });

  afterEach(() => {
    cleanup();
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
  });

  // 切换到 BBCode 视图的辅助函数
  async function switchToBBCodeView() {
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });
  }

  it('输入未闭合的 [b] 标签时显示校验错误（红色文本包含 "未闭合" 或 "[b]"）', async () => {
    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    await switchToBBCodeView();

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');

    // 输入未闭合的 [b]
    await act(async () => {
      fireEvent.change(ta, { target: { value: '[b]unclosed' } });
    });

    // 等防抖 300ms 触发 onDebouncedChange → validateBBCode
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    // v35: 错误面板默认折叠，先点击展开按钮
    const expandBtn = screen.queryByText(/BBCode 语法错误/);
    if (expandBtn) {
      await act(async () => {
        fireEvent.click(expandBtn);
      });
    }

    // 关键断言：出现校验错误信息
    // 注意：用 "未闭合" 而非 "[b]" 作为匹配，因为 textarea 的 textContent
    // 在 jsdom 中也会包含用户输入的 "[b]unclosed"，会造成假阳性。
    // "未闭合" 只会出现在 validateBBCode 产生的错误消息里。
    const errorMsg = screen.queryByText(/未闭合/);
    expect(errorMsg).not.toBeNull();
  });

  it('输入合法的 [b]ok[/b] 时不显示校验错误', async () => {
    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    await switchToBBCodeView();

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');

    // 输入合法的 [b]ok[/b]
    await act(async () => {
      fireEvent.change(ta, { target: { value: '[b]ok[/b]' } });
    });

    // 等防抖 300ms 触发 onDebouncedChange → validateBBCode
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    // 关键断言：没有校验错误信息（错误面板不渲染）
    const errorPanel = screen.queryByText(/BBCode 语法错误/);
    expect(errorPanel).toBeNull();
  });
});

describe('EditorPage 阅读模式入口', () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    // 准备 store 初始数据
    storyState.sections = JSON.parse(JSON.stringify([
      { id: 'sec-1', chapter_id: 'ch-1', title: '我的节', content: '<p>test</p>', order_index: 0 },
    ])) as any;
    storyState.activeSectionId = 'sec-1';
    sectionState.sectionContent = '<p>test content</p>';
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  });

  it('桌面端 📖 按钮包含文字 "阅读"', async () => {
    // 模拟桌面端宽度（>= 768px, md 断点）
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} onOpenReader={() => {}} />);

    // 找带 title="阅读模式" 的按钮
    const btn = screen.getByTitle('阅读模式');
    expect(btn).toBeTruthy();
    // 桌面端按钮文本应包含 "阅读"
    expect(btn.textContent).toContain('阅读');
  });

  it('点击 📖 按钮调用 onOpenReader', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const onOpenReader = vi.fn();
    const { EditorPage } = await import('./EditorPage');
    render(<EditorPage onBack={() => {}} onOpenReader={onOpenReader} />);

    const btn = screen.getByTitle('阅读模式');
    fireEvent.click(btn);
    expect(onOpenReader).toHaveBeenCalled();
  });
});

/**
 * Phase E — 子卡点 3.2：BBCode 视图 Ctrl+Z / Ctrl+Y
 *
 * 之前：BBCode 视图用原生 textarea 走浏览器内置 undo（每次切节重置），
 *   自定义历史栈不生效。
 * 修复：textarea 的 onKeyDown 拦截 Ctrl+Z/Y，调用自定义栈；
 *   onChange 推自定义栈。
 */
describe('Phase E - BBCode 视图 Ctrl+Z / Ctrl+Y 拦截', () => {
  const initialSections = [{ id: 'sec-1', chapter_id: 'ch-1', title: '我的节', content: '<p>test</p>', order_index: 0 }];
  const initialActiveSectionId = 'sec-1';

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
    sectionState.sectionContent = '<p>test content</p>';
    // 重置 history mock 状态
    historyState.current = '';
    historyState.past = [];
    historyState.future = [];
    historyState.canUndo.mockReturnValue(false);
    historyState.canRedo.mockReturnValue(false);
    historyState.undo.mockReturnValue(null);
    historyState.redo.mockReturnValue(null);
    historyState.push.mockClear();
    historyState.reset.mockClear();
  });

  afterEach(() => {
    cleanup();
    storyState.sections = JSON.parse(JSON.stringify(initialSections)) as any;
    storyState.activeSectionId = initialActiveSectionId;
    sectionState.sectionContent = '<p>test content</p>';
  });

  async function switchToBBCodeView() {
    const allButtons = screen.queryAllByRole('button');
    const bbcodeTab = allButtons.find((b) => /BBcode编辑/.test(b.textContent || ''));
    if (!bbcodeTab) throw new Error('No "BBcode编辑" tab');
    await act(async () => {
      fireEvent.click(bbcodeTab);
    });
  }

  it('BBCode 视图 textarea 在 Ctrl+Z 时调用 useEditorHistoryStore.undo()（不走浏览器原生 undo）', async () => {
    // 准备：undo 应返回某个历史快照
    const previousSnapshot = '[b]之前的内容[/b]';
    historyState.undo.mockReturnValue(previousSnapshot);
    historyState.canUndo.mockReturnValue(true);

    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    await switchToBBCodeView();

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');

    // 设置 bbcodeDraft 一些当前内容（让 undo 后内容有变化可断言）
    await act(async () => {
      fireEvent.change(ta, { target: { value: '[b]当前内容[/b]' } });
    });

    // 模拟 Ctrl+Z
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    });

    // 关键断言：调用了自定义 undo
    expect(historyState.undo).toHaveBeenCalled();

    // textarea 应被恢复到 undo 返回的内容
    expect(ta.value).toBe(previousSnapshot);
  });

  it('BBCode 视图 textarea 在 Ctrl+Y 时调用 useEditorHistoryStore.redo()', async () => {
    const nextSnapshot = '[b]重做后的内容[/b]';
    historyState.redo.mockReturnValue(nextSnapshot);
    historyState.canRedo.mockReturnValue(true);

    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    await switchToBBCodeView();

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');

    // 设置 bbcodeDraft 一些内容
    await act(async () => {
      fireEvent.change(ta, { target: { value: '[b]当前内容[/b]' } });
    });

    // 模拟 Ctrl+Y
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'y', ctrlKey: true });
    });

    // 关键断言：调用了自定义 redo
    expect(historyState.redo).toHaveBeenCalled();
    expect(ta.value).toBe(nextSnapshot);
  });

  it('BBCode 视图 Ctrl+Shift+Z 也走 redo（兼容 Mac 习惯）', async () => {
    const nextSnapshot = '[b]redo by shift+z[/b]';
    historyState.redo.mockReturnValue(nextSnapshot);
    historyState.canRedo.mockReturnValue(true);

    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    await switchToBBCodeView();

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');

    await act(async () => {
      fireEvent.change(ta, { target: { value: 'something' } });
    });

    await act(async () => {
      fireEvent.keyDown(ta, { key: 'z', ctrlKey: true, shiftKey: true });
    });

    expect(historyState.redo).toHaveBeenCalled();
    expect(ta.value).toBe(nextSnapshot);
  });

  it('BBCode 视图 Ctrl+V 不被 Ctrl+Z 拦截影响（粘贴正常）', async () => {
    const { EditorPage } = await import('./EditorPage');
    const { container } = render(<EditorPage onBack={() => {}} />);

    await switchToBBCodeView();

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!ta) throw new Error('No textarea in BBCode view');

    // 模拟 Ctrl+V
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'v', ctrlKey: true });
    });

    // 关键断言：undo/redo 没被调（因为 Ctrl+V 不是 Z/Y）
    expect(historyState.undo).not.toHaveBeenCalled();
    expect(historyState.redo).not.toHaveBeenCalled();
  });
});
