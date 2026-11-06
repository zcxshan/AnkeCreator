import { useEffect, useState } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useDiceHistoryStore } from '../../store/diceHistoryStore';
import * as db from '../../db/index';
import { isCapacitor } from '../../utils/platform';
import { Icon, type IconName } from '../../components/common/Icon';

interface HomePageProps {
  onOpenStory: (storyId: string) => void;
  onShowWorks?: () => void;
  onShowResourceLibrary?: () => void;
  onShowTutorial?: () => void;
  onShowAuthor?: () => void;
  onShowDiscovery?: () => void;
  onShowPlayground?: () => void;
  onShowCreationLog?: (storyId: string) => void;
}

interface StatItem {
  icon: IconName;
  label: string;
  value: string;
}

interface RecentStorySummary {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  sectionCount: number;
  diceCount: number;
  wordCount: number;
}

/** 快捷入口配色循环 */
const ENTRY_COLORS = ['var(--an-pink)', 'var(--an-sky)', 'var(--an-mint)', 'var(--an-lemon)', 'var(--an-lilac)', 'var(--an-pink)'];
const RECENT_STRIPES = ['var(--an-pink)', 'var(--an-sky)', 'var(--an-mint)', 'var(--an-lemon)'];

/**
 * 首页（启动页）—— 二次元贴纸手账风
 *
 * 布局：
 *   Hero（欢迎语 + 主操作 + 贴纸插画）
 *   创作概览（三张歪斜贴纸卡）
 *   快捷入口（资源库 / 教程 / 发现 / 娱乐 / 日志 / 作者）
 *   最近编辑（三张作品卡）
 */
export function HomePage({ onOpenStory, onShowWorks, onShowResourceLibrary, onShowTutorial, onShowAuthor, onShowDiscovery, onShowPlayground, onShowCreationLog }: HomePageProps) {
  const { stories, createStory, setActiveStory } = useStoryStore();

  const [showNewStoryModal, setShowNewStoryModal] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStoryDescription, setNewStoryDescription] = useState('');
  // 创作日志作品选择弹窗
  const [showStoryPicker, setShowStoryPicker] = useState(false);
  const [pickerStories, setPickerStories] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  // 最近编辑作品列表（供首页「最近编辑」区块渲染）
  const [recentStories, setRecentStories] = useState<RecentStorySummary[]>([]);
  // 最近作品加载态：数据库读取可能失败，页面必须有 loading / empty / error 三态
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentReloadKey, setRecentReloadKey] = useState(0);

  // 统计数据：所有作品的字数、骰点数、作品数（基于富文本 content 字段）
  const [stats, setStats] = useState<StatItem[]>([
    { icon: 'pen', label: '累计创作字数', value: '0' },
    { icon: 'dices', label: '骰点总次数', value: '0' },
    { icon: 'book', label: '安科作品数', value: '0' },
  ]);

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      setRecentLoading(true);
      setRecentError(null);
      try {
        // 一次性聚合查询：3 次文件读 vs 原来 N×M 次（消灭 N+1）
        const storiesWithStats = await db.listStoriesWithStats();
        const diceRecords = useDiceHistoryStore.getState().records;

        let totalWords = 0;
        const storyCount = storiesWithStats.length;
        for (const s of storiesWithStats) {
          totalWords += s.wordCount || 0;
        }

        // 只统计当前仍存在的作品的骰点记录（#1：删除作品后骰子历史可能残留）
        const validStoryIds = new Set(storiesWithStats.map((s) => s.id));
        const totalDice = diceRecords.filter((r) => validStoryIds.has(r.storyId)).length;

        if (!cancelled) {
          setStats([
            { icon: 'pen', label: '累计创作字数', value: totalWords.toLocaleString() },
            { icon: 'dices', label: '骰点总次数', value: totalDice.toLocaleString() },
            { icon: 'book', label: '安科作品数', value: storyCount.toLocaleString() },
          ]);
        }

        // 预建骰子记录 → 作品 ID 计数索引，避免为每个作品重复 filter 遍历
        const diceCountByStory = new Map<string, number>();
        for (const r of diceRecords) {
          diceCountByStory.set(r.storyId, (diceCountByStory.get(r.storyId) ?? 0) + 1);
        }

        // 最近编辑的作品摘要（最多 3 个），复用已聚合的统计字段
        const sorted = [...storiesWithStats]
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, 3);

        const results: RecentStorySummary[] = sorted.map((story) => ({
          id: story.id,
          title: story.title,
          description: story.description || '',
          updatedAt: formatDate(story.updated_at),
          sectionCount: story.sectionCount || 0,
          diceCount: diceCountByStory.get(story.id) ?? 0,
          wordCount: story.wordCount || 0,
        }));

        if (!cancelled) {
          setRecentStories(results);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[HomePage] 加载最近作品失败：', e);
          setRecentError((e as Error)?.message || String(e));
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    };
    void compute();
    return () => {
      cancelled = true;
    };
  }, [stories, recentReloadKey]);

  const handleCreateStory = async () => {
    const title = newStoryTitle.trim() || `未命名作品 ${new Date().toLocaleDateString()}`;
    const storyId = await createStory(title, newStoryDescription.trim());
    setShowNewStoryModal(false);
    setNewStoryTitle('');
    setNewStoryDescription('');
    await setActiveStory(storyId);
    // 安卓版：创建后跳到作品列表，让用户从列表点开作品进编辑（不直接进入编辑区）
    // 桌面端：保持原行为，创建后立即进入编辑
    if (isCapacitor) {
      onShowWorks?.();
    } else {
      onOpenStory(storyId);
    }
  };

  const entries: Array<{
    key: string;
    icon: IconName;
    label: string;
    desc: string;
    onClick: () => void;
    visible: boolean;
  }> = [
    {
      key: 'resource',
      icon: 'folder',
      label: '资源库',
      desc: '图片与人物差分',
      onClick: () => onShowResourceLibrary?.(),
      visible: !!onShowResourceLibrary,
    },
    {
      key: 'tutorial',
      icon: 'bookText',
      label: '使用教程',
      desc: '快速上手安科创作',
      onClick: () => onShowTutorial?.(),
      visible: !!onShowTutorial,
    },
    {
      key: 'discovery',
      icon: 'search',
      label: '发现安科',
      desc: '看看大家在写什么',
      onClick: () => onShowDiscovery?.(),
      visible: !!onShowDiscovery && !isCapacitor,
    },
    {
      key: 'playground',
      icon: 'dices',
      label: '娱乐',
      desc: '骰子与转盘小工具',
      onClick: () => onShowPlayground?.(),
      visible: !!onShowPlayground,
    },
    {
      key: 'log',
      icon: 'pen',
      label: '创作日志',
      desc: '查看写作足迹',
      onClick: async () => {
        try {
          const list = await db.listStories();
          setPickerStories(list.map((s: any) => ({ id: s.id, title: s.title, updated_at: s.updated_at })));
          setShowStoryPicker(true);
        } catch {
          setPickerStories([]);
          setShowStoryPicker(true);
        }
      },
      visible: !!onShowCreationLog,
    },
    {
      key: 'author',
      icon: 'bot',
      label: '关于作者',
      desc: '认识一下创作者',
      onClick: () => onShowAuthor?.(),
      visible: !!onShowAuthor,
    },
  ];

  const visibleEntries = entries.filter((e) => e.visible);

  return (
    <div className="an-page">
      <div className="an-shell" style={{ maxWidth: 1180, padding: '32px 24px 40px' }}>
        {/* Hero */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: isCapacitor ? '1fr' : 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
            gap: 24,
            alignItems: 'center',
            marginBottom: 30,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <span className="an-badge">
              <Icon name="sparkles" size={12} /> 安科助手 · Anke Creator
            </span>
            <h1
              className="an-title"
              style={{
                display: 'block',
                margin: '16px 0 0',
                fontSize: 'clamp(30px, 4.6vw, 50px)',
                lineHeight: 1.18,
              }}
            >
              欢迎回来！
              <span style={{ display: 'block', color: 'var(--an-pink)' }}>
                准备开始新的安科创作
              </span>
            </h1>
            <p
              style={{
                margin: '14px 0 0',
                fontSize: 14,
                lineHeight: 1.8,
                color: 'var(--an-ink-soft)',
                maxWidth: 560,
              }}
            >
              骰子决定命运，故事由此展开 —— 让每一次掷骰都成为精彩的转折。
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
              <button
                className="an-btn an-btn--pink"
                onClick={() => setShowNewStoryModal(true)}
                style={{ fontSize: 19, minHeight: 48, padding: '12px 28px' }}
              >
                <Icon name="fileText" size={18} /> 新建安科
              </button>
              {onShowWorks && (
                <button
                  className="an-btn an-btn--sky"
                  onClick={onShowWorks}
                  style={{ fontSize: 19, minHeight: 48, padding: '12px 28px' }}
                >
                  <Icon name="book" size={18} /> 我的安科作品
                </button>
              )}
            </div>
          </div>

          {!isCapacitor && <HeroArt />}
        </section>

        {/* 创作概览 */}
        <section style={{ marginBottom: 30 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 14,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: 'var(--an-font-display)',
                fontSize: 22,
                color: 'var(--an-ink)',
              }}
            >
              创作概览
            </h2>
            <span style={{ fontSize: 12, color: 'var(--an-ink-soft)' }}>基于全部作品</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
            }}
          >
            {stats.map((stat, index) => {
              const color = ENTRY_COLORS[index % ENTRY_COLORS.length];
              return (
                <div
                  key={stat.label}
                  className="an-card an-card--hover"
                  style={{
                    padding: 20,
                    transform: index === 1 ? 'rotate(1.2deg)' : index === 2 ? 'rotate(-1.2deg)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        width: 44,
                        height: 44,
                        flex: '0 0 auto',
                        borderRadius: 14,
                        border: '3px solid var(--an-ink)',
                        background: color,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--an-ink)',
                        boxShadow: '0 3px 0 var(--an-ink)',
                      }}
                    >
                      <Icon name={stat.icon} size={22} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: 'var(--an-font-display)',
                          fontSize: 30,
                          lineHeight: 1.1,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--an-ink)',
                        }}
                      >
                        {stat.value}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--an-ink-soft)', marginTop: 2 }}>
                        {stat.label}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 快捷入口 */}
        {visibleEntries.length > 0 && (
          <section style={{ marginBottom: 30 }}>
            <h2
              style={{
                margin: '0 0 14px',
                fontFamily: 'var(--an-font-display)',
                fontSize: 22,
                color: 'var(--an-ink)',
              }}
            >
              快捷入口
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              {visibleEntries.map((entry, index) => {
                const color = ENTRY_COLORS[index % ENTRY_COLORS.length];
                return (
                  <button
                    key={entry.key}
                    onClick={entry.onClick}
                    className="an-card an-card--hover"
                    style={{
                      padding: 14,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: 'var(--an-card)',
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        flex: '0 0 auto',
                        borderRadius: 12,
                        border: '3px solid var(--an-ink)',
                        background: color,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--an-ink)',
                      }}
                    >
                      <Icon name={entry.icon} size={20} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 15,
                          fontWeight: 700,
                          color: 'var(--an-ink)',
                        }}
                      >
                        {entry.label}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: 'var(--an-ink-soft)',
                          marginTop: 2,
                        }}
                      >
                        {entry.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* 最近编辑 */}
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 14,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: 'var(--an-font-display)',
                fontSize: 22,
                color: 'var(--an-ink)',
              }}
            >
              最近编辑
            </h2>
            {onShowWorks && (
              <button className="an-pill" onClick={onShowWorks}>
                我的安科作品 <Icon name="forward" size={12} />
              </button>
            )}
          </div>

          {recentError ? (
            <div className="an-card" role="alert" style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ color: '#c0392b', display: 'flex', justifyContent: 'center' }}>
                <Icon name="alert" size={28} />
              </div>
              <p style={{ margin: '10px 0 0', fontWeight: 700, fontSize: 15 }}>最近作品加载失败</p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--an-ink-soft)', wordBreak: 'break-all' }}>
                {recentError}
              </p>
              <button
                className="an-btn an-btn--sm an-btn--pink"
                style={{ marginTop: 16 }}
                onClick={() => setRecentReloadKey((k) => k + 1)}
              >
                <Icon name="refresh" size={14} /> 重新加载
              </button>
            </div>
          ) : recentLoading && recentStories.length === 0 ? (
            <div
              className="an-card"
              role="status"
              aria-live="polite"
              style={{ padding: 40, textAlign: 'center', color: 'var(--an-ink-soft)', fontSize: 13 }}
            >
              <Icon name="hourglass" size={28} />
              <div style={{ marginTop: 8 }}>正在加载最近作品…</div>
            </div>
          ) : recentStories.length === 0 ? (
            <div className="an-empty">
              <Icon name="pen" size={48} />
              <div className="an-empty__title">还没有作品，开始你的第一个安科吧</div>
              <div className="an-empty__desc">点击「新建安科」创建，或从已有作品文件导入。</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
                <button className="an-btn an-btn--pink" onClick={() => setShowNewStoryModal(true)}>
                  <Icon name="plus" size={16} /> 新建安科
                </button>
                {onShowWorks && (
                  <button className="an-btn an-btn--ghost" onClick={onShowWorks}>
                    <Icon name="book" size={16} /> 我的作品
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 16,
              }}
            >
              {recentStories.map((story, index) => (
                <button
                  key={story.id}
                  onClick={() => {
                    setActiveStory(story.id);
                    // 安卓版：跳到作品列表，让用户从列表点开作品进编辑（不直接进入编辑区）
                    // 桌面端：保持原行为，直接进入编辑
                    if (isCapacitor) {
                      onShowWorks?.();
                    } else {
                      onOpenStory(story.id);
                    }
                  }}
                  className="an-card an-card--hover"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 0,
                    overflow: 'hidden',
                    background: 'var(--an-card)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'block',
                      height: 8,
                      background: RECENT_STRIPES[index % RECENT_STRIPES.length],
                      borderBottom: '2px solid var(--an-ink)',
                    }}
                  />
                  <span style={{ display: 'block', padding: '14px 16px 16px' }}>
                    <span
                      style={{
                        display: 'block',
                        fontFamily: 'var(--an-font-display)',
                        fontSize: 18,
                        color: 'var(--an-ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={story.title}
                    >
                      {story.title}
                    </span>
                    <span
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        marginTop: 4,
                        minHeight: 34,
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: 'var(--an-ink-soft)',
                      }}
                    >
                      {story.description || '还没有简介'}
                    </span>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      <span className="an-chip">
                        <Icon name="clock" size={11} /> {story.updatedAt}
                      </span>
                      <span className="an-chip">
                        <Icon name="bookText" size={11} /> {story.sectionCount} 节
                      </span>
                      <span className="an-chip">
                        <Icon name="pen" size={11} /> {story.wordCount.toLocaleString()} 字
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <footer
          style={{
            marginTop: 48,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--an-ink-soft)',
          }}
        >
          用骰子编织故事 · Anke Creator
        </footer>
      </div>

      {/* 新建作品弹窗 */}
      {showNewStoryModal && (
        <Modal onClose={() => setShowNewStoryModal(false)} title="新建安科作品">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--an-ink)' }}>
                作品标题
              </label>
              <input
                autoFocus
                type="text"
                value={newStoryTitle}
                onChange={(e) => setNewStoryTitle(e.target.value)}
                placeholder="给你的安科起个名字"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 14,
                  border: '2px solid var(--an-ink)',
                  background: 'var(--an-paper-2)',
                  color: 'var(--an-ink)',
                  fontSize: 14,
                  outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateStory();
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--an-ink)' }}>
                作品简介（可选）
              </label>
              <textarea
                rows={3}
                value={newStoryDescription}
                onChange={(e) => setNewStoryDescription(e.target.value)}
                placeholder="一句话介绍这个安科世界…"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 14,
                  border: '2px solid var(--an-ink)',
                  background: 'var(--an-paper-2)',
                  color: 'var(--an-ink)',
                  fontSize: 14,
                  outline: 'none',
                  resize: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
              <button className="an-btn an-btn--ghost an-btn--sm" onClick={() => setShowNewStoryModal(false)}>
                取消
              </button>
              <button className="an-btn an-btn--sm an-btn--pink" onClick={handleCreateStory}>
                创建并进入
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 创作日志作品选择弹窗 */}
      {showStoryPicker && (
        <Modal onClose={() => setShowStoryPicker(false)} title="选择作品查看创作日志">
          {pickerStories.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--an-ink-soft)' }}>
              暂无作品，请先创建一个安科作品
            </div>
          ) : (
            <div className="an-scroll" style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pickerStories.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setShowStoryPicker(false);
                    onShowCreationLog?.(s.id);
                  }}
                  className="an-card"
                  style={{ padding: '10px 14px', textAlign: 'left', cursor: 'pointer', boxShadow: '0 3px 0 var(--an-ink)' }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--an-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--an-ink-soft)', marginTop: 2 }}>
                    更新于 {new Date(s.updated_at).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
            <button className="an-btn an-btn--ghost an-btn--sm" onClick={() => setShowStoryPicker(false)}>
              取消
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** 首页贴纸插画：书 + 骰子 + 星星 */
function HeroArt() {
  return (
    <div style={{ position: 'relative', maxWidth: 430, margin: '0 auto', padding: '20px 12px 28px' }}>
      <svg viewBox="0 0 430 330" width="100%" role="img" aria-label="安科创作插画">
        {/* 背景 blob */}
        <path
          d="M92 62 C170 10 330 22 382 92 C426 152 400 252 328 292 C244 340 108 318 58 238 C18 172 38 100 92 62 Z"
          fill="#eae3ff"
          stroke="#40325c"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {/* 星星 */}
        <path d="M96 88 l9 20 22 3 -16 15 4 22 -19 -11 -19 11 4 -22 -16 -15 22 -3 Z" fill="#ffd45e" stroke="#40325c" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M356 176 l7 15 17 2 -12 12 3 17 -15 -9 -15 9 3 -17 -12 -12 17 -2 Z" fill="#ff86b8" stroke="#40325c" strokeWidth="2.5" strokeLinejoin="round" />
        {/* 书本 */}
        <path d="M86 214 Q212 190 215 214 L215 286 Q110 264 86 286 Z" fill="#fffdf6" stroke="#40325c" strokeWidth="3" strokeLinejoin="round" />
        <path d="M344 214 Q218 190 215 214 L215 286 Q320 264 344 286 Z" fill="#fffdf6" stroke="#40325c" strokeWidth="3" strokeLinejoin="round" />
        <path d="M215 214 L215 286" stroke="#40325c" strokeWidth="3" />
        <path d="M108 232 Q168 220 196 231" stroke="#b39bff" strokeWidth="4" strokeLinecap="round" />
        <path d="M108 248 Q168 236 196 247" stroke="#5cc6ff" strokeWidth="4" strokeLinecap="round" />
        <path d="M234 231 Q292 220 322 231" stroke="#ff86b8" strokeWidth="4" strokeLinecap="round" />
        <path d="M234 247 Q292 236 322 247" stroke="#4fdcae" strokeWidth="4" strokeLinecap="round" />
        {/* 骰子（二十面体简化） */}
        <g transform="translate(276 126) rotate(9)">
          <path d="M0 -62 L54 -30 L54 28 L0 62 L-54 28 L-54 -30 Z" fill="#4fdcae" stroke="#40325c" strokeWidth="3" strokeLinejoin="round" />
          <path d="M0 -62 L0 -18 L54 28 M0 -18 L-54 28 M0 -18 L0 62" fill="none" stroke="#40325c" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="-20" cy="-8" r="4" fill="#40325c" />
          <circle cx="20" cy="-8" r="4" fill="#40325c" />
          <circle cx="0" cy="22" r="4" fill="#40325c" />
        </g>
        {/* 胶带 */}
        <g transform="rotate(-8 150 278)">
          <rect x="64" y="270" width="120" height="22" rx="4" fill="#ffd45e" stroke="#40325c" strokeWidth="3" />
          <path d="M84 270 v22 M104 270 v22 M124 270 v22 M144 270 v22 M164 270 v22" stroke="#40325c" strokeWidth="1.5" opacity="0.35" />
        </g>
      </svg>
      <div
        className="an-bubble"
        style={{ position: 'absolute', left: 0, bottom: 0, transform: 'rotate(-3deg)', fontSize: 13 }}
      >
        骰子决定命运，故事由此展开
      </div>
    </div>
  );
}

/** 贴纸风通用弹窗 */
function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(40, 28, 60, 0.38)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        className="an-card an-pop-in"
        style={{ width: '100%', maxWidth: 460, padding: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--an-font-display)', fontSize: 22, color: 'var(--an-ink)' }}>
            {title}
          </h3>
          <button className="an-pill" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={12} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 基于 HTML 字符串统计字数（用于 contenteditable 编辑器） */
export function countWordsFromHtml(html: string): { words: number; dice: number } {
  if (!html) return { words: 0, dice: 0 };
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    let words = 0;
    let dice = 0;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_ALL, {
      acceptNode(node: Node): number {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.dataset?.type === 'dice-card') {
            // 只 dice-card 算骰子；image-block 不算
            dice++;
            return NodeFilter.FILTER_REJECT;
          }
          if (el.dataset?.type === 'image-block') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent || '').replace(/\s/g, '');
      words += text.length;
      node = walker.nextNode();
    }
    return { words, dice };
  } catch {
    return { words: 0, dice: 0 };
  }
}

/** 兼容两种格式：先尝试旧版 JSON（TipTap），失败则走 HTML（contenteditable） */
export function countContent(content: string): { words: number; dice: number } {
  if (!content) return { words: 0, dice: 0 };
  try {
    const json = JSON.parse(content);
    if (json && typeof json === 'object') {
      return countWordsAndDice(json);
    }
  } catch {
    // fallthrough
  }
  return countWordsFromHtml(content);
}

/** 从富文本 JSON 中统计字数和骰点数 */
export function countWordsAndDice(json: any): { words: number; dice: number } {
  let words = 0;
  let dice = 0;
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') {
      words += node.text.replace(/\s/g, '').length;
    }
    if (node.type === 'dice-card' || node.type === 'dice') {
      dice++;
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };
  walk(json);
  return { words, dice };
}

/** 格式化时间为简短可读形式 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffHour < 24) return `${diffHour} 小时前`;
    if (diffDay < 7) return `${diffDay} 天前`;

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (y === now.getFullYear()) return `${m}-${day}`;
    return `${y}-${m}-${day}`;
  } catch {
    return iso;
  }
}
