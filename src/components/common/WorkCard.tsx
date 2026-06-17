import { useEffect, useRef, useState } from 'react';
import type { Story } from '../../types';

export interface WorkSummary extends Story {
  wordCount: number;
  diceCount: number;
  sectionCount: number;
  chapterCount: number;
}

interface WorkCardProps {
  work: WorkSummary;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  onExport: (id: string) => void;
  onSaveAs?: (id: string) => void;
  onDuplicate: (id: string) => void;
  onStarred?: (id: string) => void;
  onPinned?: (id: string) => void;
}

export function WorkCard({
  work,
  onOpen,
  onDelete,
  onRename,
  onExport,
  onSaveAs,
  onDuplicate,
  onStarred,
  onPinned,
}: WorkCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const formattedDate = formatDate(work.updated_at);
  const isPinned = !!work.is_pinned;
  const isStarred = !!work.is_starred;

  if (confirmDelete) {
    return (
      <div className="group relative rounded-2xl border p-5 shadow-sm flex flex-col items-center justify-center min-h-[280px] text-center"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--danger)' }}
      >
        <div className="text-3xl mb-2">🗑️</div>
        <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>确认删除？</div>
        <div className="text-xs mb-4 px-2" style={{ color: 'var(--text-secondary)' }}>该操作不可撤销</div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
          >
            取消
          </button>
          <button
            onClick={() => {
              onDelete(work.id);
              setConfirmDelete(false);
            }}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ background: 'var(--danger)', color: 'var(--text-on-accent)' }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            确认删除
          </button>
        </div>
      </div>
    );
  }

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(work.id);
    }
  };

  return (
    <div
      role="article"
      tabIndex={0}
      aria-label={work.title}
      onClick={() => onOpen(work.id)}
      onKeyDown={handleCardKeyDown}
      draggable
      data-story-id={work.id}
      className="group relative rounded-2xl border hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-color)',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)';
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)';
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* 置顶作品左侧 accent 竖条 */}
      {isPinned && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ background: 'var(--accent)' }}
        />
      )}

      {/* 悬停操作菜单 */}
      <div
        ref={menuRef}
        className="absolute top-3 right-3 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-8 h-8 rounded-lg backdrop-blur border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-secondary)',
          }}
          aria-label="更多操作"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="19" r="2" fill="currentColor" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute top-10 right-0 min-w-[140px] rounded-xl shadow-xl border py-1.5 z-20"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
          >
            <MenuItem icon="✏️" label="重命名" onClick={() => { onRename(work.id); setMenuOpen(false); }} />
            {onSaveAs && (
              <MenuItem
                icon="💾"
                label="另存为安科文件"
                onClick={() => { onSaveAs(work.id); setMenuOpen(false); }}
              />
            )}
            <MenuItem icon="📋" label="复制副本" onClick={() => { onDuplicate(work.id); setMenuOpen(false); }} />
          </div>
        )}
      </div>

      {/* 顶部左侧：分类标签 + 置顶 + 标星 + 删除图标 */}
      <div className="absolute top-3 left-3 z-[1] flex items-center gap-1.5">
        {/* 置顶按钮 */}
        {onPinned && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPinned(work.id);
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-opacity opacity-100"
            title={isPinned ? '取消置顶' : '置顶'}
            style={{
              background: isPinned ? 'var(--accent-soft)' : 'var(--bg-hover)',
              borderColor: 'var(--border-color)',
              color: isPinned ? 'var(--accent)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            📌
          </button>
        )}
        {/* 标星按钮 */}
        {onStarred && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStarred(work.id);
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-opacity opacity-100"
            title={isStarred ? '取消标星' : '标星（收藏）'}
            style={{
              background: isStarred ? 'var(--accent-soft)' : 'var(--bg-hover)',
              borderColor: 'var(--border-color)',
              color: isStarred ? 'var(--accent)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            {isStarred ? '⭐' : '☆'}
          </button>
        )}
        {/* 📤 导出按钮（始终可见） */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExport(work.id);
          }}
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-opacity opacity-100"
          title="导出安科作品全部数据"
          style={{
            background: 'var(--bg-hover)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-secondary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-bg)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          📤
        </button>
        {/* 🗑 删除按钮（始终可见，醒目颜色） */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-opacity opacity-100"
          title="删除到回收站"
          style={{
            background: 'var(--bg-hover)',
            borderColor: 'var(--border-color)',
            color: 'var(--danger)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--danger-soft)';
            e.currentTarget.style.opacity = '0.85';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.opacity = '1';
          }}
        >
          🗑
        </button>
      </div>

      {/* 无封面的顶部区域 - 使用渐变背景和图标组合 */}
      <div
        className="relative h-24 flex items-center justify-center overflow-hidden"
        style={{ background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--bg-card) 100%)' }}
      >
        {/* 背景装饰图案 */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-16 h-16 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ background: 'var(--accent)' }} />
          <div className="absolute bottom-0 right-0 w-20 h-20 rounded-full translate-x-1/2 translate-y-1/2" style={{ background: 'var(--accent)' }} />
          <div className="absolute top-1/2 left-1/2 w-12 h-12 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ background: 'var(--accent)' }} />
        </div>
        {/* 主图标 */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="text-4xl opacity-80 drop-shadow-sm">📖</div>
          <div className="text-[10px] mt-1 font-medium" style={{ color: 'var(--text-secondary)' }}>安科作品</div>
        </div>
        {/* 安科骰点标记 */}
        <div className="absolute bottom-2 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full backdrop-blur-sm border text-[10px] font-medium shadow-sm"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--accent)' }}
        >
          <span>🎲</span>
          <span>安科</span>
        </div>
        {/* 章节计数 */}
        <div className="absolute bottom-2 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full backdrop-blur-sm border text-[10px] font-medium shadow-sm"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
        >
          <span>📑</span>
          <span>{work.chapterCount}章·{work.sectionCount}节</span>
        </div>
      </div>

      {/* 底部信息 */}
      <div className="p-4">
        <h3 className="text-sm font-semibold truncate transition-colors"
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
        >
          {work.title}
        </h3>
        <div className="mt-1.5 flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className="inline-flex items-center gap-1">
            <span>📝</span>
            <span className="tabular-nums">{work.wordCount.toLocaleString()} 字</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span>🎲</span>
            <span className="tabular-nums">{work.diceCount}</span>
          </span>
          <span className="ml-auto">{formattedDate}</span>
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left transition-colors"
      style={{
        color: danger ? 'var(--danger)' : 'var(--text-secondary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--danger-soft)' : 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span className="w-4 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

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
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (d.getFullYear() === now.getFullYear()) return `${m}-${day}`;
    return `${d.getFullYear()}-${m}-${day}`;
  } catch {
    return iso;
  }
}
