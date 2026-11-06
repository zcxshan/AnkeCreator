import { useState, useEffect, useCallback, memo } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useEditorStore } from '../../store/editorStore';
import { Icon, type IconName } from '../common/Icon';
import { NGA_IMAGE_SIZES, NGA_DEFAULT_IMAGE_SIZE } from '../../types';
import type { Section } from '../../types';
import type { RichTextEditorCommands } from '../../editor/tiptap/TiptapEditorPane';
import { SearchPanel } from './SearchPanel';
import { GlobalSearchPanel } from './GlobalSearchPanel';
import { CompactImageLibraryPanel } from './CompactImageLibraryPanel';
import { QuickDicePanel, DiceHistoryPanel } from './DicePanels';
import { CompactCharacterPanel } from './CharacterPanels';

// ========== 右侧栏：属性 / 骰点记录 / 图库 / 人物 四 Tab 切换 ==========
// 人物角色已并入右栏（可搜索、切换按人物/按差分、插入差分到正文）
// memo 包裹：EditorPage 重渲染时跳过（其 props 均为稳定引用 / 内部自行订阅 store）

type RightPanelTab = 'properties' | 'dice' | 'gallery' | 'characters';

export const RightPanel = memo(function RightPanel({
  activeTab,
  setActiveTab,
  section,
  onRenameSection,
  onJumpToDice,
  onRestoreDice,
  onInsertUnrolledDice,
  onCheckDiceExists,
  selectedImage,
  onSetImageSize,
  richTextEditorCommandsRef,
  onShowToast,
  width,
  editorMode,
  bbcodeTextareaRef,
  visualEditorRef,
  bbcodeValue,
  onBBCodeChange,
  hideHeader,
  onCollapse,
}: {
  activeTab: RightPanelTab;
  setActiveTab: (tab: RightPanelTab) => void;
  section: Section | undefined;
  onRenameSection: (newTitle: string) => void;
  onJumpToDice: (sectionId: string, payloadSnapshot: string) => void;
  onRestoreDice: (sectionId: string, payloadSnapshot: string) => void;
  onInsertUnrolledDice: (sectionId: string, payloadSnapshot: string) => void;
  onCheckDiceExists: (sectionId: string, payloadSnapshot: string) => boolean;
  selectedImage: { width: number; height: number; src?: string; dataSize?: string } | null;
  onSetImageSize: (size: string) => void;
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
  width?: number;
  editorMode: 'visual' | 'bbcode';
  bbcodeTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  visualEditorRef: React.RefObject<HTMLDivElement | null>;
  bbcodeValue: string;
  onBBCodeChange: (v: string) => void;
  hideHeader?: boolean;
  onCollapse?: () => void;
}) {
  const [imageSizeNga, setImageSizeNga] = useState<string>('original');
  const [imageUrl, setImageUrl] = useState<string>('');
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  // 搜索模式：'current' = 当前节内搜索（SearchPanel）；'global' = 全作品搜索（GlobalSearchPanel）
  const [searchMode, setSearchMode] = useState<'current' | 'global'>('current');
  // 跨节搜索（GlobalSearchPanel）跳转时携带的 query；SearchPanel 消费后清空
  const [pendingSearchQuery, setPendingSearchQuery] = useState('');
  // 全作品搜索跳转：切换到对应作品 + 节，并切回当前节搜索便于继续编辑
  const setActiveStory = useStoryStore((s) => s.setActiveStory);
  const setActiveSection = useStoryStore((s) => s.setActiveSection);
  // 需求5:快速跳转 - 响应式订阅当前节的保存滚动位置
  const currentSectionId = section?.id ?? '';
  const savedScrollTop = useEditorStore((s) =>
    currentSectionId ? s.sectionScrollPositions[currentSectionId] : undefined,
  );
  const hasLastPosition = savedScrollTop !== undefined;
  const handleGlobalSearchNavigate = useCallback(
    async (storyId: string, sectionId: string, searchQuery?: string) => {
      const curStoryId = useStoryStore.getState().activeStoryId;
      // 同作品：直接切节（省一次 setActiveStory 数据清空 + 重新加载 + 闪屏）
      if (storyId === curStoryId) {
        setActiveSection(sectionId);
      } else {
        // 跨作品：先 await 加载完新 story 数据，再切节
        // （否则 setActiveSection 找不到 section，activeChapterId 也会被 loadStoryData 用 chapters[0] 覆盖）
        await setActiveStory(storyId);
        setActiveSection(sectionId);
      }
      setActiveTab('properties');
      setSearchMode('current');
      // 把跨节搜索的 query 传给 SearchPanel，自动填入并 doFind 到第一个匹配
      setPendingSearchQuery(searchQuery || '');
    },
    [setActiveStory, setActiveSection, setActiveTab],
  );

  // 当选中图片变化时，同步输入框的值
  useEffect(() => {
    if (selectedImage) {
      setImageSizeNga(selectedImage.dataSize || 'original');
      setImageUrl(selectedImage.src || '');
    }
  }, [selectedImage?.dataSize, selectedImage?.src]);
  const tabs: {
    key: RightPanelTab;
    label: string;
    icon: IconName;
  }[] = [
    { key: 'properties', label: '属性', icon: 'settings' },
    { key: 'dice', label: '骰点', icon: 'dices' },
    { key: 'gallery', label: '图库', icon: 'image' },
    { key: 'characters', label: '人物', icon: 'theater' },
  ];

  return (
    <aside
      className="ed-pane--right shrink-0 flex flex-col overflow-hidden overflow-y-auto"
      style={{
        width: width ?? '100%',
        background: 'var(--an-paper-2)',
        borderLeft: width !== undefined ? '3px solid var(--an-ink)' : 'none',
      }}
    >
      {/* Tab 头部（hideHeader 时隐藏，由外部提供 tab 头） */}
      {!hideHeader && (
      <div
        className="shrink-0 flex items-stretch"
        style={{ borderBottom: '2px solid var(--an-ink)', background: 'var(--an-paper-2)' }}
      >
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex-1 flex items-center justify-center px-2 h-11 text-[13px] font-medium transition-colors shrink-0 whitespace-nowrap"
              style={{
                color: active ? 'var(--an-ink)' : 'var(--text-secondary)',
                background: active ? 'var(--an-pink-soft)' : 'transparent',
                borderBottom: active ? '3px solid var(--an-pink)' : '3px solid transparent',
                fontWeight: active ? 700 : 500,
              }}
            >
              <span className="inline-flex items-center gap-1">
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
              </span>
            </button>
          );
        })}
        {onCollapse && (
          <button aria-label="折叠右侧面板"
            onClick={onCollapse}
            title="折叠右侧面板"
            className="text-[var(--an-ink-soft)] shrink-0 flex items-center justify-center w-8 h-11 text-xs transition-colors"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--an-pink-soft)';
              e.currentTarget.style.color = 'var(--an-ink)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--an-ink-soft)';
            }}
          >
            <Icon name="chevronRight" size={14} />
          </button>
        )}
      </div>
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'properties' && (
          <div className="p-3 space-y-3">
            {/* 快速骰子面板：表达式投掷 + 复制骰点文本，无历史记录 */}
            <QuickDicePanel />
            {section ? (
              <>
                <div>
                  <div className="text-[var(--text-secondary)] text-[12px] font-medium mb-1">节标题</div>
                  <input
                    defaultValue={section.title}
                    onBlur={(e) => onRenameSection(e.target.value.trim() || section.title)}
                    className="border-[color:var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] w-full px-2 py-1.5 text-xs rounded-md border outline-none"
                  />
                </div>
                <div className="text-[var(--text-secondary)] text-[12px]">
                  创建: {section.created_at?.slice(0, 10) || '-'}
                  <br />
                  更新: {section.updated_at?.slice(0, 10) || '-'}
                </div>
              </>
            ) : (
              <div className="text-[var(--text-secondary)] text-xs text-center py-8">
                选择一节开始编辑
              </div>
            )}

            {/* 选中图片时显示尺寸编辑区 */}
            {selectedImage && (
              <div className="border-[color:var(--border-color)] pt-4 border-t">
                <div className="text-[var(--text-primary)] text-[12px] font-semibold mb-3">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="image" size={14} />
                    图片属性
                  </span>
                </div>
                {/* NGA 尺寸选择 */}
                <div className="mb-3">
                  <div className="text-[var(--text-secondary)] text-[12px] mb-1">
                    尺寸预设（点击切换）
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {NGA_IMAGE_SIZES.map((s) => {
                      const active = imageSizeNga === s.value;
                      return (
                        <button
                          key={s.value}
                          onClick={() => {
                            setImageSizeNga(s.value);
                            onSetImageSize(s.value);
                          }}
                          className="text-[12px] px-2 py-1.5 rounded-md transition-colors"
                          style={{
                            background: active ? 'var(--accent-bg)' : 'var(--bg-hover)',
                            color: active ? 'var(--accent)' : 'var(--text-primary)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color)'}`,
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* URL */}
                <div className="mb-2">
                  <div className="text-[var(--text-secondary)] text-[12px] mb-1">
                    图片 URL
                  </div>
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    onBlur={() => {
                      if (imageUrl.trim()) {
                        richTextEditorCommandsRef.current?.updateSelectedImageSrc(imageUrl.trim());
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && imageUrl.trim()) {
                        richTextEditorCommandsRef.current?.updateSelectedImageSrc(imageUrl.trim());
                      }
                    }}
                    className="border-[color:var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] w-full px-2 py-1.5 text-xs rounded-md border outline-none transition-colors"
                    placeholder="图片链接地址"
                  />
                </div>
                <div className="text-[var(--text-secondary)] text-[12px]">
                  提示：点击上方尺寸预设调整大小，导出时会拼接到图片 URL 后缀。
                </div>
              </div>
            )}

            {/* 搜索面板：常驻显示在属性面板内 */}
            <div
              className="border-[color:var(--border-color)] pt-4 border-t"
            >
              {/* 搜索模式切换 Tab */}
              <div
                className="border-b border-b-[color:var(--border-color)] flex gap-1 mb-2"
              >
                {(['current', 'global'] as const).map((mode) => {
                  const active = searchMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSearchMode(mode)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: active ? 600 : 400,
                        background: active ? 'var(--bg-hover)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--text-secondary)',
                        border: 'none',
                        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {mode === 'current' ? '当前节' : (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="globe" size={14} />
                          全作品
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {searchMode === 'current' ? (
                <SearchPanel
                  editorMode={editorMode}
                  bbcodeTextareaRef={bbcodeTextareaRef}
                  visualEditorRef={visualEditorRef}
                  bbcodeValue={bbcodeValue}
                  onBBCodeChange={onBBCodeChange}
                  initialQuery={pendingSearchQuery}
                  onInitialQueryConsumed={() => setPendingSearchQuery('')}
                />
              ) : (
                <GlobalSearchPanel
                  onNavigate={handleGlobalSearchNavigate}
                  currentStoryId={activeStoryId}
                />
              )}
            </div>
            {/* ===== 需求5:快速跳转 ===== */}
            <div className="border-[color:var(--border-color)] pt-4 border-t">
              <div
                className="text-[var(--text-primary)] text-[12px] font-semibold mb-3"
              >
                <span className="inline-flex items-center gap-1">
                  <Icon name="rocket" size={14} />
                  快速跳转
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 px-2 py-2 text-xs rounded-md transition-colors ancke-btn"
                  onClick={() => richTextEditorCommandsRef.current?.scrollToTop()}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon name="arrowUp" size={14} />
                    顶部
                  </span>
                </button>
                <button
                  className="flex-1 px-2 py-2 text-xs rounded-md transition-colors ancke-btn"
                  onClick={() => richTextEditorCommandsRef.current?.scrollToBottom()}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon name="arrowDown" size={14} />
                    底部
                  </span>
                </button>
                <button
                  className="flex-1 px-2 py-2 text-xs rounded-md transition-colors ancke-btn"
                  style={{
                    color: hasLastPosition ? 'var(--text-primary)' : 'var(--text-muted)',
                    opacity: hasLastPosition ? 1 : 0.5,
                    cursor: hasLastPosition ? 'pointer' : 'not-allowed',
                  }}
                  disabled={!hasLastPosition}
                  onClick={() => {
                    if (savedScrollTop !== undefined) {
                      richTextEditorCommandsRef.current?.setScrollTop(savedScrollTop);
                    }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon name="pin" size={14} />
                    上次位置
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'dice' && (
            <DiceHistoryPanel
              storyId={activeStoryId}
              onJumpToDice={onJumpToDice}
              onRestoreDice={onRestoreDice}
              onInsertUnrolledDice={onInsertUnrolledDice}
              onCheckDiceExists={onCheckDiceExists}
            />
          )}
        {activeTab === 'gallery' && (
          <CompactImageLibraryPanel
            onInsertImage={(url) => {
              if (richTextEditorCommandsRef.current) {
                richTextEditorCommandsRef.current.insertImage(url, NGA_DEFAULT_IMAGE_SIZE);
                onShowToast?.('已插入图片');
              } else {
                onShowToast?.('没有可用的编辑器');
              }
            }}
          />
        )}
        {activeTab === 'characters' && (
          <CompactCharacterPanel
            richTextEditorCommandsRef={richTextEditorCommandsRef}
            onShowToast={onShowToast}
          />
        )}
      </div>
    </aside>
  );
});
