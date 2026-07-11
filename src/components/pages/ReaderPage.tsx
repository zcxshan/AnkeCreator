import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useToastStore } from '../../store/toastStore';
import * as db from '../../db/index';
import { isCapacitor, isElectron, isMobile } from '../../utils/platform';

interface ReaderPageProps {
  onBack: () => void;
}

type Theme = 'light' | 'dark' | 'sepia';
type FontSize = 'small' | 'medium' | 'large';

const THEME_COLORS: Record<Theme, { bg: string; text: string; textSecondary: string; border: string; accent: string }> = {
  light: { bg: '#ffffff', text: '#1a1a1a', textSecondary: '#666', border: '#e5e5e5', accent: '#2563eb' },
  dark: { bg: '#1a1a1a', text: '#e0e0e0', textSecondary: '#999', border: '#333', accent: '#60a5fa' },
  sepia: { bg: '#f5f0e6', text: '#3a2a1a', textSecondary: '#7a6a5a', border: '#d9ccb8', accent: '#8b6914' },
};

const FONT_SIZES: Record<FontSize, number> = { small: 14, medium: 16, large: 18 };

const SERIF_FONT = `Georgia, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif`;

export function ReaderPage({ onBack }: ReaderPageProps) {
  const { stories, activeStoryId, volumes, chapters, sections, activeSectionId, setActiveSection } = useStoryStore();
  const showToast = useToastStore((s) => s.showToast);

  const [theme, setTheme] = useState<Theme>('light');
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [autoScroll, setAutoScroll] = useState(false);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(!isCapacitor);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sectionContent, setSectionContent] = useState<string>('');
  const [contentLoading, setContentLoading] = useState(false);

  const readingAreaRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef<number | null>(null);
  const userScrolledRef = useRef(false);

  const story = stories.find((s) => s.id === activeStoryId);
  const activeSection = sections.find((s) => s.id === activeSectionId);

  const sortedVolumes = useMemo(() => [...volumes].sort((a, b) => a.order_index - b.order_index), [volumes]);
  const sortedChapters = useMemo(() => [...chapters].sort((a, b) => a.order_index - b.order_index), [chapters]);

  const chaptersByVolume = useMemo(() => {
    const map = new Map<string | null, typeof chapters>();
    const noVolChs = sortedChapters.filter((ch) => !ch.volume_id);
    for (const ch of noVolChs) {
      if (!map.has(null)) map.set(null, []);
      map.get(null)!.push(ch);
    }
    for (const vol of sortedVolumes) {
      const chs = sortedChapters.filter((ch) => ch.volume_id === vol.id);
      if (chs.length > 0) map.set(vol.id, chs);
    }
    return map;
  }, [sortedVolumes, sortedChapters]);

  const sectionsByChapter = useMemo(() => {
    const map = new Map<string, typeof sections>();
    for (const sec of sections) {
      const chId = sec.chapter_id;
      if (!map.has(chId)) map.set(chId, []);
      map.get(chId)!.push(sec);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.order_index - b.order_index);
    }
    return map;
  }, [sections]);

  const flatSections = useMemo(() => {
    const result: typeof sections = [];
    for (const ch of sortedChapters) {
      const secs = sectionsByChapter.get(ch.id) || [];
      result.push(...secs);
    }
    return result;
  }, [sortedChapters, sectionsByChapter]);

  const currentIndex = useMemo(() => {
    if (!activeSectionId) return -1;
    return flatSections.findIndex((s) => s.id === activeSectionId);
  }, [flatSections, activeSectionId]);

  const prevSection = currentIndex > 0 ? flatSections[currentIndex - 1] : null;
  const nextSection = currentIndex >= 0 && currentIndex < flatSections.length - 1 ? flatSections[currentIndex + 1] : null;

  const goToPrev = useCallback(() => {
    if (prevSection) {
      setActiveSection(prevSection.id);
      setLeftDrawerOpen(false);
      if (readingAreaRef.current) readingAreaRef.current.scrollTop = 0;
    }
  }, [prevSection, setActiveSection]);

  const goToNext = useCallback(() => {
    if (nextSection) {
      setActiveSection(nextSection.id);
      setLeftDrawerOpen(false);
      if (readingAreaRef.current) readingAreaRef.current.scrollTop = 0;
    }
  }, [nextSection, setActiveSection]);

  useEffect(() => {
    if (!activeSectionId) {
      setSectionContent('');
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setSectionContent('');
    db.getSectionContent(activeSectionId)
      .then((content) => {
        if (!cancelled) {
          setSectionContent(content || '');
          setContentLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ReaderPage] 加载节内容失败:', err);
          setSectionContent('<p style="color:#999">内容加载失败</p>');
          setContentLoading(false);
          showToast('内容加载失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSectionId, showToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goToPrev, goToNext]);

  useEffect(() => {
    if (autoScroll && !userScrolledRef.current) {
      autoScrollRef.current = window.requestAnimationFrame(function scroll() {
        if (readingAreaRef.current && !userScrolledRef.current) {
          readingAreaRef.current.scrollTop += 1;
          if (readingAreaRef.current.scrollTop < readingAreaRef.current.scrollHeight - readingAreaRef.current.clientHeight) {
            autoScrollRef.current = window.requestAnimationFrame(scroll);
          } else {
            setAutoScroll(false);
          }
        }
      });
    }
    return () => {
      if (autoScrollRef.current) {
        window.cancelAnimationFrame(autoScrollRef.current);
      }
    };
  }, [autoScroll]);

  useEffect(() => {
    const el = readingAreaRef.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const delta = Math.abs(el.scrollTop - lastTop);
      if (delta > 5 && autoScroll) {
        userScrolledRef.current = true;
        setAutoScroll(false);
        setTimeout(() => { userScrolledRef.current = false; }, 500);
      }
      lastTop = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [autoScroll]);

  useEffect(() => {
    const root = readingAreaRef.current;
    if (!root) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      const head = target.closest?.('.collapse-head') as HTMLElement | null;
      if (head) {
        const block = head.closest?.('[data-type="collapse-block"]') as HTMLElement | null;
        if (block) {
          const body = block.querySelector<HTMLElement>('.collapse-body');
          const toggle = block.querySelector<HTMLElement>('.collapse-toggle');
          const isCollapsed = block.dataset.collapsed === 'true';
          if (isCollapsed) {
            if (body) body.style.display = 'block';
            if (toggle) toggle.textContent = '−';
            block.dataset.collapsed = 'false';
          } else {
            if (body) body.style.display = 'none';
            if (toggle) toggle.textContent = '+';
            block.dataset.collapsed = 'true';
          }
          e.preventDefault();
          return;
        }
      }

      const img = target.closest?.('[data-type="image-block"] img') as HTMLImageElement | null;
      if (img) {
        window.open(img.src, '_blank');
        e.preventDefault();
        return;
      }
    };

    root.addEventListener('click', onClick);
    return () => { root.removeEventListener('click', onClick); };
  }, [activeSectionId, sectionContent]);

  const colors = THEME_COLORS[theme];
  const fontPx = FONT_SIZES[fontSize];

  const handleSectionClick = (sectionId: string) => {
    setActiveSection(sectionId);
    setLeftDrawerOpen(false);
    if (readingAreaRef.current) {
      readingAreaRef.current.scrollTop = 0;
    }
  };

  const canGoPrev = !!prevSection;
  const canGoNext = !!nextSection;

  if (!story) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: THEME_COLORS.light.textSecondary }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
        <div>未选择作品，请先从作品列表打开一个作品</div>
        <button onClick={onBack} style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}>返回</button>
      </div>
    );
  }

  return (
    // 桌面端：固定视口高（减去 TitleBar 32px）+ overflow: hidden
    // → 内部目录与内容各自独立滚动（不与 body 同步滚）
    // 移动端：保留 minHeight: 100% 由 body 统一滚动（前两轮设计）
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        ...(isMobile
          ? { minHeight: '100%' }
          : { height: isElectron ? 'calc(100vh - 32px)' : '100vh' }),
        overflow: isMobile ? 'visible' : 'hidden',
        background: colors.bg,
        color: colors.text,
      }}
    >
      {/* 全宽顶栏（正常文档流，不悬浮，避免与 overflow:hidden 父容器冲突） */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: colors.bg, borderBottom: `1px solid ${colors.border}` }}>
        <button onClick={onBack} title="返回" style={toolbarBtnStyle(colors)}>← 返回</button>
        <span style={{ fontWeight: 600 }}>{story.title}</span>
      </div>
      {/* 左右分栏 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
      {isCapacitor && leftDrawerOpen && (
        <div
          className="mobile-drawer-backdrop"
          style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setLeftDrawerOpen(false)}
        />
      )}

      <div
        className={isCapacitor ? 'mobile-drawer-panel-left' : ''}
        style={{
          width: leftDrawerOpen ? 260 : 0,
          flexShrink: 0,
          borderRight: `1px solid ${colors.border}`,
          overflow: 'auto',
          background: colors.bg,
          position: isCapacitor ? 'absolute' : 'relative',
          left: 0, top: 0, bottom: 0,
          zIndex: isCapacitor ? 31 : 'auto',
          maxWidth: isCapacitor ? '85%' : 'none',
          transition: 'width 0.25s ease',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 }}>目录</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: SERIF_FONT, marginTop: 4 }}>{story.title}</div>
        </div>
        <div style={{ padding: '8px 0', paddingBottom: 60 }}>
          {sortedVolumes.length === 0 ? (
            Array.from(chaptersByVolume.entries())
              .filter(([volId]) => volId === null)
              .map(([, chs]) => chs.map((ch) => (
                <div key={ch.id}>
                  <div style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary, fontFamily: SERIF_FONT }}>
                    {ch.title}
                  </div>
                  {(sectionsByChapter.get(ch.id) || []).map((sec) => (
                    <div
                      key={sec.id}
                      onClick={() => handleSectionClick(sec.id)}
                      style={{
                        padding: '6px 20px 6px 32px',
                        fontSize: 13,
                        cursor: 'pointer',
                        color: sec.id === activeSectionId ? colors.accent : colors.text,
                        fontWeight: sec.id === activeSectionId ? 600 : 400,
                        background: sec.id === activeSectionId ? `${colors.accent}11` : 'transparent',
                      }}
                    >
                      {sec.title}
                    </div>
                  ))}
                </div>
              )))
          ) : (
            sortedVolumes.map((vol) => (
              <div key={vol.id}>
                <div style={{ padding: '10px 20px 4px', fontSize: 12, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {vol.title}
                </div>
                {(chaptersByVolume.get(vol.id) || []).map((ch) => (
                  <div key={ch.id}>
                    <div style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary, fontFamily: SERIF_FONT }}>
                      {ch.title}
                    </div>
                    {(sectionsByChapter.get(ch.id) || []).map((sec) => (
                      <div
                        key={sec.id}
                        onClick={() => handleSectionClick(sec.id)}
                        style={{
                          padding: '6px 20px 6px 32px',
                          fontSize: 13,
                          cursor: 'pointer',
                          color: sec.id === activeSectionId ? colors.accent : colors.text,
                          fontWeight: sec.id === activeSectionId ? 600 : 400,
                          background: sec.id === activeSectionId ? `${colors.accent}11` : 'transparent',
                        }}
                      >
                        {sec.title}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
          {/* 未归卷的章节（有卷时也显示在最后） */}
          {sortedVolumes.length > 0 && (chaptersByVolume.get(null) || []).length > 0 && (
            <div key="no-vol">
              {(chaptersByVolume.get(null) || []).map((ch) => (
                <div key={ch.id}>
                  <div style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, color: colors.textSecondary, fontFamily: SERIF_FONT }}>
                    {ch.title}
                  </div>
                  {(sectionsByChapter.get(ch.id) || []).map((sec) => (
                    <div
                      key={sec.id}
                      onClick={() => handleSectionClick(sec.id)}
                      style={{
                        padding: '6px 20px 6px 32px',
                        fontSize: 13,
                        cursor: 'pointer',
                        color: sec.id === activeSectionId ? colors.accent : colors.text,
                        fontWeight: sec.id === activeSectionId ? 600 : 400,
                        background: sec.id === activeSectionId ? `${colors.accent}11` : 'transparent',
                      }}
                    >
                      {sec.title}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bg,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          position: 'relative',
        }}>
          <button onClick={() => setLeftDrawerOpen(!leftDrawerOpen)} title="目录" style={toolbarBtnStyle(colors)}>☰</button>

          <button
            onClick={goToPrev}
            disabled={!canGoPrev}
            title="上一节 (←)"
            style={{ ...toolbarBtnStyle(colors), opacity: canGoPrev ? 1 : 0.4, cursor: canGoPrev ? 'pointer' : 'not-allowed' }}
          >
            ◀ 上一节
          </button>
          <button
            onClick={goToNext}
            disabled={!canGoNext}
            title="下一节 (→)"
            style={{ ...toolbarBtnStyle(colors), opacity: canGoNext ? 1 : 0.4, cursor: canGoNext ? 'pointer' : 'not-allowed' }}
          >
            下一节 ▶
          </button>

          {!isCapacitor && currentIndex >= 0 && (
            <span style={{ fontSize: 12, color: colors.textSecondary, marginLeft: 4 }}>
              {currentIndex + 1} / {flatSections.length}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {isCapacitor ? (
            <>
              <button
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                title="更多"
                style={{
                  ...toolbarBtnStyle(colors),
                  color: moreMenuOpen ? colors.accent : colors.text,
                  fontWeight: moreMenuOpen ? 700 : 400,
                }}
              >
                ⋯ 更多
              </button>
              {moreMenuOpen && (
                <>
                  <div
                    onClick={() => setMoreMenuOpen(false)}
                    style={{
                      position: 'fixed',
                      inset: 0,
                      zIndex: 40,
                      background: 'rgba(0,0,0,0.3)',
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 8,
                    zIndex: 41,
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    padding: 12,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    minWidth: 220,
                  }}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: colors.textSecondary, marginRight: 4 }}>字号</span>
                      {(['small', 'medium', 'large'] as FontSize[]).map((fs) => (
                        <button
                          key={fs}
                          title={`${fs === 'small' ? '小' : fs === 'medium' ? '中' : '大'}字号`}
                          onClick={() => setFontSize(fs)}
                          style={{
                            ...toolbarBtnStyle(colors),
                            padding: '4px 8px',
                            fontSize: fs === 'small' ? 11 : fs === 'medium' ? 13 : 15,
                            fontWeight: fontSize === fs ? 700 : 400,
                            color: fontSize === fs ? colors.accent : colors.textSecondary,
                            borderBottom: fontSize === fs ? `2px solid ${colors.accent}` : '2px solid transparent',
                          }}
                        >
                          {fs === 'small' ? '小' : fs === 'medium' ? '中' : '大'}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: colors.textSecondary, marginRight: 4 }}>主题</span>
                      {(['light', 'dark', 'sepia'] as Theme[]).map((t) => (
                        <button
                          key={t}
                          title={`${t === 'light' ? '亮色' : t === 'dark' ? '暗色' : '护眼'}主题`}
                          onClick={() => setTheme(t)}
                          style={{
                            width: 24, height: 24, borderRadius: '50%',
                            border: theme === t ? `2px solid ${colors.accent}` : `2px solid ${colors.border}`,
                            background: THEME_COLORS[t].bg,
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>

                    <button
                      onClick={() => setAutoScroll(!autoScroll)}
                      title="自动滚动"
                      style={{
                        ...toolbarBtnStyle(colors),
                        color: autoScroll ? colors.accent : colors.textSecondary,
                        fontWeight: autoScroll ? 700 : 400,
                      }}
                    >
                      {autoScroll ? '⏸ 暂停' : '▶ 自动滚动'}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: colors.textSecondary, marginRight: 4 }}>字号</span>
                {(['small', 'medium', 'large'] as FontSize[]).map((fs) => (
                  <button
                    key={fs}
                    title={`${fs === 'small' ? '小' : fs === 'medium' ? '中' : '大'}字号`}
                    onClick={() => setFontSize(fs)}
                    style={{
                      ...toolbarBtnStyle(colors),
                      padding: '4px 8px',
                      fontSize: fs === 'small' ? 11 : fs === 'medium' ? 13 : 15,
                      fontWeight: fontSize === fs ? 700 : 400,
                      color: fontSize === fs ? colors.accent : colors.textSecondary,
                      borderBottom: fontSize === fs ? `2px solid ${colors.accent}` : '2px solid transparent',
                    }}
                  >
                    {fs === 'small' ? '小' : fs === 'medium' ? '中' : '大'}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: colors.textSecondary, marginRight: 4 }}>主题</span>
                {(['light', 'dark', 'sepia'] as Theme[]).map((t) => (
                  <button
                    key={t}
                    title={`${t === 'light' ? '亮色' : t === 'dark' ? '暗色' : '护眼'}主题`}
                    onClick={() => setTheme(t)}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      border: theme === t ? `2px solid ${colors.accent}` : `2px solid ${colors.border}`,
                      background: THEME_COLORS[t].bg,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>

              <button
                onClick={() => setAutoScroll(!autoScroll)}
                title="自动滚动"
                style={{
                  ...toolbarBtnStyle(colors),
                  color: autoScroll ? colors.accent : colors.textSecondary,
                  fontWeight: autoScroll ? 700 : 400,
                }}
              >
                {autoScroll ? '⏸ 暂停' : '▶ 自动滚动'}
              </button>
            </>
          )}
        </div>

        <div
          ref={readingAreaRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '32px 24px 80px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            {activeSection ? (
              <>
                <div style={{
                  fontSize: 28,
                  fontWeight: 700,
                  fontFamily: SERIF_FONT,
                  marginBottom: 8,
                  lineHeight: 1.3,
                }}>
                  {activeSection.title}
                </div>
                <div style={{
                  width: 48,
                  height: 2,
                  background: colors.accent,
                  marginBottom: 24,
                }} />
                {contentLoading ? (
                  <div style={{ textAlign: 'center', color: colors.textSecondary, padding: 48 }}>
                    <div style={{ fontSize: 14 }}>加载中…</div>
                  </div>
                ) : (
                  <div
                    className="reader-content"
                    style={{
                      fontSize: fontPx,
                      lineHeight: 1.9,
                      fontFamily: SERIF_FONT,
                      color: colors.text,
                    }}
                    dangerouslySetInnerHTML={{ __html: sectionContent || '<p style="color:#999">（本节无内容）</p>' }}
                  />
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', color: colors.textSecondary, padding: 48 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
                <div>请从左侧目录选择一个小节开始阅读</div>
              </div>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderTop: `1px solid ${colors.border}`,
          background: colors.bg,
          paddingBottom: isCapacitor ? 'calc(8px + env(safe-area-inset-bottom))' : 8,
        }}>
          <button
            onClick={goToPrev}
            disabled={!canGoPrev}
            style={{
              ...toolbarBtnStyle(colors),
              opacity: canGoPrev ? 1 : 0.4,
              cursor: canGoPrev ? 'pointer' : 'not-allowed',
              padding: '10px 20px',
              fontSize: 14,
            }}
          >
            ◀ 上一节
          </button>

          {currentIndex >= 0 && flatSections.length > 0 && (
            <span style={{ fontSize: 12, color: colors.textSecondary }}>
              {currentIndex + 1} / {flatSections.length}
            </span>
          )}

          <button
            onClick={goToNext}
            disabled={!canGoNext}
            style={{
              ...toolbarBtnStyle(colors),
              opacity: canGoNext ? 1 : 0.4,
              cursor: canGoNext ? 'pointer' : 'not-allowed',
              padding: '10px 20px',
              fontSize: 14,
            }}
          >
            下一节 ▶
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

function toolbarBtnStyle(colors: { text: string; textSecondary: string; border: string; bg: string }) {
  return {
    padding: '6px 12px',
    border: `1px solid ${colors.border}`,
    background: 'transparent',
    color: colors.text,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  } as React.CSSProperties;
}
