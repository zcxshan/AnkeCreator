// ============================================================
// 全作品搜索面板（嵌入右侧属性面板，与 SearchPanel 并存）
// ------------------------------------------------------------
// 功能：
// - 输入关键字 → 扫描所有作品的所有节
// - 在 section.title + section.content（HTML 剥离为纯文本）中查找
// - 大小写不敏感；结果按 作品 → 章 → 节 自然顺序排序
// - 上限 200 条，避免 UI 卡顿
// - 点击结果调用 onNavigate(storyId, sectionId) 跳转
// ============================================================

import { useEffect, useRef, useState } from 'react';
import * as db from '../../db';
import type { Story, Chapter, Section } from '../../types';

interface Hit {
  storyId: string;
  storyTitle: string;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  /** 命中上下文（已剥离 HTML 标签，前后各 30 字符） */
  snippet: string;
  /** 命中字段：'title' = 节标题命中，'content' = 正文命中 */
  field: 'title' | 'content';
}

interface GlobalSearchPanelProps {
  onNavigate: (storyId: string, sectionId: string) => void;
  currentStoryId?: string | null;
}

const MAX_RESULTS = 200;
const SNIPPET_RADIUS = 30;

/** 剥离 HTML 标签，反转义常见实体，结果用于显示与查找 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 构建命中上下文片段 */
function buildSnippet(text: string, matchIndex: number, queryLen: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + queryLen + SNIPPET_RADIUS);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return snippet;
}

export function GlobalSearchPanel({ onNavigate, currentStoryId }: GlobalSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // 用于中断过期搜索请求（用户连续按 Enter 时只采纳最新一次结果）
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动 focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearched(false);
      return;
    }
    const lowerQuery = q.toLowerCase();
    const queryLen = q.length;
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    setSearched(true);
    try {
      const stories: Story[] = await db.listStories();
      const results: Hit[] = [];

      // 串行扫描每个 story，避免一次性发起过多并发查询压垮 sqlite
      for (const story of stories) {
        if (myRequestId !== requestIdRef.current) return; // 已被新请求取代
        const chapters: Chapter[] = await db.listChapters(story.id);
        for (const chapter of chapters) {
          if (myRequestId !== requestIdRef.current) return;
          const sections: Section[] = await db.listSections(chapter.id);
          for (const section of sections) {
            // 命中节标题
            const titleLower = (section.title || '').toLowerCase();
            const titleIdx = titleLower.indexOf(lowerQuery);
            if (titleIdx >= 0) {
              results.push({
                storyId: story.id,
                storyTitle: story.title,
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                sectionId: section.id,
                sectionTitle: section.title,
                snippet: buildSnippet(section.title || '', titleIdx, queryLen),
                field: 'title',
              });
              if (results.length >= MAX_RESULTS) break;
              continue; // 同一节不重复加 content 命中
            }
            // 命中正文
            const contentHtml = section.content || '';
            if (!contentHtml) continue;
            const plain = htmlToPlainText(contentHtml);
            const contentLower = plain.toLowerCase();
            const contentIdx = contentLower.indexOf(lowerQuery);
            if (contentIdx >= 0) {
              results.push({
                storyId: story.id,
                storyTitle: story.title,
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                sectionId: section.id,
                sectionTitle: section.title,
                snippet: buildSnippet(plain, contentIdx, queryLen),
                field: 'content',
              });
              if (results.length >= MAX_RESULTS) break;
            }
          }
          if (results.length >= MAX_RESULTS) break;
        }
        if (results.length >= MAX_RESULTS) break;
      }

      if (myRequestId !== requestIdRef.current) return;
      setHits(results);
    } catch (e) {
      if (myRequestId !== requestIdRef.current) return;
      console.error('[GlobalSearchPanel] search failed:', e);
      setHits([]);
    } finally {
      if (myRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void doSearch();
    }
  };

  const handleClickHit = async (hit: Hit) => {
    // onNavigate 现在是 async（跨作品时 await setActiveStory），用 try/catch 防止错误冒泡
    try {
      await onNavigate(hit.storyId, hit.sectionId, query);
    } catch (e) {
      console.error('[GlobalSearchPanel] navigate failed:', e);
    }
  };

  // 状态文本
  const statusText = (() => {
    if (loading) return '搜索中…';
    if (!searched) return '输入关键字后按 Enter 搜索所有作品';
    if (hits.length === 0) return `未找到包含「${query}」的节`;
    if (hits.length >= MAX_RESULTS) return `找到 ${hits.length}+ 条（已截断到 ${MAX_RESULTS}）`;
    return `找到 ${hits.length} 条结果`;
  })();

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
        🌐 全作品搜索 · 扫描所有作品的所有节
      </div>

      {/* 搜索框 */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearched(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder="关键字（搜索所有作品正文与标题）…"
          style={{
            flex: 1,
            padding: '5px 8px',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            background: 'var(--bg-input, var(--bg-card))',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => void doSearch()}
          disabled={!query.trim() || loading}
          style={{
            padding: '4px 10px',
            background: 'var(--accent)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            color: 'var(--text-on-accent)',
            cursor: !query.trim() || loading ? 'not-allowed' : 'pointer',
            fontSize: 12,
            opacity: !query.trim() || loading ? 0.5 : 1,
          }}
          title="搜索"
        >
          搜索
        </button>
      </div>

      {/* 状态文本 */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', minHeight: 14 }}>
        {statusText}
      </div>

      {/* 结果列表 */}
      {hits.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 360,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {hits.map((hit, i) => {
            const isCurrent = hit.storyId === currentStoryId;
            return (
              <button
                key={`${hit.sectionId}-${i}`}
                type="button"
                onClick={() => handleClickHit(hit)}
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: isCurrent ? 'var(--bg-hover)' : 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isCurrent ? 'var(--bg-hover)' : 'transparent';
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    marginBottom: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{hit.storyTitle}</span>
                  <span style={{ color: 'var(--text-muted)' }}>›</span>
                  <span>{hit.chapterTitle}</span>
                  <span style={{ color: 'var(--text-muted)' }}>›</span>
                  <span style={{ fontWeight: 500 }}>{hit.sectionTitle}</span>
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '0 4px',
                        background: 'var(--accent)',
                        color: 'var(--text-on-accent)',
                        borderRadius: 2,
                      }}
                    >
                      当前
                    </span>
                  )}
                  {hit.field === 'title' && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '0 4px',
                        background: 'var(--bg-hover)',
                        color: 'var(--text-secondary)',
                        borderRadius: 2,
                      }}
                    >
                      标题命中
                    </span>
                  )}
                </div>
                {hit.field === 'content' && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {hit.snippet}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
