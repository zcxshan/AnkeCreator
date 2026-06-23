import { useEffect, useState } from 'react';
import { useStoryStore } from '../../store/storyStore';
import * as db from '../../db/database';

interface HomePageProps {
  onOpenStory: (storyId: string) => void;
  onShowWorks?: () => void;
  onShowTemplates?: () => void;
  onShowTutorial?: () => void;
  onShowAuthor?: () => void;
  onShowAnjia?: () => void;
  onShowFindAnke?: () => void;
}

interface StatItem {
  icon: string;
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

/**
 * 首页（启动页）—— 浅色清新风格
 *
 * 布局：
 *   ┌────────────────────────────────────────┐
 *   │ 欢迎回来！准备开始新的安科创作          │
 *   │ 骰子决定命运，故事由此展开              │
 *   │  [ + 新建安科 ]   [ 打开已有 ]         │
 *   ├────────────────────────────────────────┤
 *   │ 创作概览                               │
 *   │ ┌─────────┬──────────┬──────────┐      │
 *   │ │ 📝 字数 │ 🎲 骰点  │ 📚 作品  │      │
 *   │ └─────────┴──────────┴──────────┘      │
 *   ├────────────────────────────────────────┤
 *   │ 最近编辑的作品（点击进入编辑）         │
 *   └────────────────────────────────────────┘
 */
export function HomePage({ onOpenStory, onShowWorks, onShowTemplates, onShowTutorial, onShowAuthor, onShowAnjia, onShowFindAnke }: HomePageProps) {
  const { stories, createStory, setActiveStory } = useStoryStore();

  const [showNewStoryModal, setShowNewStoryModal] = useState(false);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStoryDescription, setNewStoryDescription] = useState('');

  // 统计数据：所有作品的字数、骰点数、作品数（基于富文本 content 字段）
  const [stats, setStats] = useState<StatItem[]>([
    { icon: '📝', label: '累计创作字数', value: '0' },
    { icon: '🎲', label: '骰点总次数', value: '0' },
    { icon: '📚', label: '安科作品数', value: '0' },
  ]);

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      let totalWords = 0;
      let totalDice = 0;
      const storyCount = stories.length;

      for (const story of stories) {
        const chapters = await db.listChapters(story.id);
        for (const chapter of chapters) {
          const sections = await db.listSections(chapter.id);
          for (const section of sections) {
            const content = section.content;
            if (content) {
              const { words, dice } = countContent(content);
              totalWords += words;
              totalDice += dice;
            }
          }
        }
      }

      if (!cancelled) {
        setStats([
          { icon: '📝', label: '累计创作字数', value: totalWords.toLocaleString() },
          { icon: '🎲', label: '骰点总次数', value: totalDice.toLocaleString() },
          { icon: '📚', label: '安科作品数', value: storyCount.toLocaleString() },
        ]);
      }
    };
    compute();
    return () => {
      cancelled = true;
    };
  }, [stories]);

  // 最近编辑的作品摘要（最多 3 个）
  const [recentStories, setRecentStories] = useState<RecentStorySummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      const sorted = [...stories]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 3);

      const results: RecentStorySummary[] = [];
      for (const story of sorted) {
        let sectionCount = 0;
        let diceCount = 0;
        let wordCount = 0;
        const chapters = await db.listChapters(story.id);
        for (const chapter of chapters) {
          const sections = await db.listSections(chapter.id);
          sectionCount += sections.length;
          for (const section of sections) {
            const content = section.content;
            if (content) {
              const { words, dice } = countContent(content);
              wordCount += words;
              diceCount += dice;
            }
          }
        }
        results.push({
          id: story.id,
          title: story.title,
          description: story.description || '',
          updatedAt: formatDate(story.updated_at),
          sectionCount,
          diceCount,
          wordCount,
        });
      }

      if (!cancelled) {
        setRecentStories(results);
      }
    };
    compute();
    return () => {
      cancelled = true;
    };
  }, [stories]);

  const handleCreateStory = async () => {
    const title = newStoryTitle.trim() || `未命名作品 ${new Date().toLocaleDateString()}`;
    const storyId = await createStory(title, newStoryDescription.trim());
    setShowNewStoryModal(false);
    setNewStoryTitle('');
    setNewStoryDescription('');
    await setActiveStory(storyId);
    onOpenStory(storyId);
  };

  return (
    <div className="h-full w-full flex flex-col items-center overflow-y-auto" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div className="w-full max-w-4xl px-8 py-12">
        {/* 欢迎区 */}
        <section className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-5 rounded-full bg-emerald-100/70 text-emerald-700 text-xs font-medium tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            安科助手 · Anke Creator
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight" style={{ color: 'var(--text-primary)' }}>
            欢迎回来！
            <span className="block mt-2 bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500 bg-clip-text text-transparent">
              准备开始新的安科创作
            </span>
          </h1>
          <p className="mt-4 text-base sm:text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            骰子决定命运，故事由此展开 —— 让每一次掷骰都成为精彩的转折。
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => setShowNewStoryModal(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-on-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent)' }}
            >
              <span className="text-lg leading-none">+</span>
              新建安科
            </button>
            <button
              onClick={() => setShowOpenModal(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}
            >
              打开已有
            </button>
            {onShowTemplates && (
              <button
                onClick={onShowTemplates}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              >
                <span>📦</span> 模板库
              </button>
            )}
            {onShowTutorial && (
              <button
                onClick={onShowTutorial}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              >
                <span>📚</span> 使用教程
              </button>
            )}
            {onShowAnjia && (
              <button
                onClick={onShowAnjia}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              >
                <span>📜</span> 收集安价
              </button>
            )}
            {onShowFindAnke && (
              <button
                onClick={onShowFindAnke}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              >
                <span>🔍</span> 寻找安科
              </button>
            )}
          </div>
        </section>

        {/* 统计卡片 */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-primary)' }}>创作概览</h2>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>基于全部作品</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="group relative rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl" aria-hidden="true">
                    {stat.icon}
                  </span>
                  <span className="text-[10px] font-medium tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
                    TOTAL
                  </span>
                </div>
                <div className="mt-5 text-3xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {stat.value}
                </div>
                <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 最近作品 */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-primary)' }}>
              最近编辑
            </h2>
            {recentStories.length > 0 && (
              <button
                onClick={onShowWorks || (() => setShowOpenModal(true))}
                className="text-xs transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                查看全部 →
              </button>
            )}
          </div>

          {recentStories.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-color)' }}>
              <div className="text-4xl mb-3">✒️</div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>还没有作品，开始你的第一个安科吧</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>点击上方「新建安科」按钮创建</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentStories.map((story) => (
                <button
                  key={story.id}
                  onClick={() => {
                    setActiveStory(story.id);
                    onOpenStory(story.id);
                  }}
                  className="w-full text-left rounded-2xl p-5 hover:shadow-md transition-all group"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold truncate transition-colors text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                          {story.title}
                        </h3>
                      </div>
                      <p className="mt-1.5 text-sm line-clamp-1 text-[var(--text-secondary)]">
                        {story.description}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1">
                          <span>🕒</span>
                          <span>{story.updatedAt}</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span>📖</span>
                          <span>{story.sectionCount} 章节</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span>🎲</span>
                          <span>{story.diceCount} 骰点</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span>✏️</span>
                          <span>{story.wordCount.toLocaleString()} 字</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 group-hover:translate-x-0.5 transition-all text-lg text-[var(--text-muted)] group-hover:text-[var(--accent)]">
                      →
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-16 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
          用骰子编织故事 · Anke Creator
        </footer>
      </div>

      {/* 新建作品弹窗 */}
      {showNewStoryModal && (
        <Modal onClose={() => setShowNewStoryModal(false)} title="新建安科作品">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>作品标题</label>
              <input
                autoFocus
                type="text"
                value={newStoryTitle}
                onChange={(e) => setNewStoryTitle(e.target.value)}
                placeholder="给你的安科起个名字"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg outline-none transition-all"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateStory();
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>作品简介（可选）</label>
              <textarea
                rows={3}
                value={newStoryDescription}
                onChange={(e) => setNewStoryDescription(e.target.value)}
                placeholder="一句话介绍这个安科世界…"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg outline-none transition-all resize-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewStoryModal(false)}
                className="px-4 py-2 text-sm rounded-lg transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                取消
              </button>
              <button
                onClick={handleCreateStory}
                className="px-4 py-2 text-sm rounded-lg transition-colors"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-on-accent)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent)' }}
              >
                创建并进入
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 打开已有作品弹窗 */}
      {showOpenModal && (
        <Modal onClose={() => setShowOpenModal(false)} title="选择作品">
          {stories.length === 0 ? (
            <div className="text-center py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
              还没有作品，点击「新建安科」创建第一个吧
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {[...stories]
                .sort(
                  (a, b) =>
                    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
                )
                .map((story) => (
                  <button
                    key={story.id}
                    onClick={() => {
                      setShowOpenModal(false);
                      setActiveStory(story.id);
                      onOpenStory(story.id);
                    }}
                    className="w-full text-left px-4 py-3 rounded-lg transition-all"
                    style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-bg)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-card)' }}
                  >
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{story.title}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {formatDate(story.updated_at)}
                      {story.description ? ` · ${story.description}` : ''}
                    </div>
                  </button>
                ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/** 通用弹窗组件 */
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
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-xl w-full max-w-md p-6"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 基于 HTML 字符串统计字数（用于 contenteditable 编辑器） */
function countWordsFromHtml(html: string): { words: number; dice: number } {
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
          if (
            el.dataset?.type === 'image-block' ||
            el.dataset?.type === 'dice-card'
          ) {
            dice++;
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
function countContent(content: string): { words: number; dice: number } {
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
function countWordsAndDice(json: any): { words: number; dice: number } {
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
