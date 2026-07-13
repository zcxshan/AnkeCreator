import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  /** 修改作品简介 */
  onEditDescription?: (id: string) => void;
  /** 导出为安科文件（JSON 格式） */
  onExport: (id: string) => void;
  onPinned?: (id: string) => void;
  onMoveToFavorite?: (id: string) => void;
  onExportEpub?: (id: string) => void;
  onReader?: (id: string) => void;
}

interface MenuPos {
  top: number;
  left: number;
}

export function WorkCard({
  work,
  onOpen,
  onDelete,
  onRename,
  onEditDescription,
  onExport,
  onPinned,
  onMoveToFavorite,
  onExportEpub,
  onReader,
}: WorkCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

  // 菜单 portal：点击外部或 ESC 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // 忽略「更多」按钮本身（按钮自己有 onClick 切换状态）
      if (menuBtnRef.current && menuBtnRef.current.contains(target)) return;
      // 忽略 portal 菜单内部点击
      const menuEl = document.getElementById('workcard-menu-portal');
      if (menuEl && menuEl.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const formattedDate = formatDate(work.updated_at);
  const isPinned = !!work.is_pinned;

  const openMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const btn = menuBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      // 菜单向下展开，左对齐到按钮左缘
      setMenuPos({ top: r.bottom + 4, left: r.left });
    } else {
      setMenuPos({ top: 80, left: 80 });
    }
    setMenuOpen(true);
  };

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

      {/* 悬停操作菜单（更多）—— 按钮仅触发，菜单通过 portal 渲染到 document.body 避免被卡片 overflow 遮挡 */}
      <div
        className="absolute top-3 right-3 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={menuBtnRef}
          onClick={openMenu}
          className="px-2 py-0.5 rounded-md text-[11px] font-medium border transition-opacity inline-flex items-center gap-1"
          style={{
            background: isPinned ? 'var(--accent-soft)' : 'var(--bg-card)',
            borderColor: isPinned ? 'var(--accent)' : 'var(--border-color)',
            color: isPinned ? 'var(--accent)' : 'var(--text-secondary)',
            opacity: 0.7,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.7';
          }}
          title="更多操作"
          aria-label="更多操作"
          aria-expanded={menuOpen}
        >
          {isPinned && <span>📌</span>}
          <span>更多</span>
        </button>
      </div>

      {/* 顶部左侧：文字按钮组（置顶 / 收藏到 / 删除） */}
      <div className="absolute top-3 left-3 z-[1] flex items-center gap-1.5">
        {/* 置顶按钮 */}
        {onPinned && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPinned(work.id);
            }}
            className="px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors"
            title={isPinned ? '取消置顶' : '置顶'}
            style={{
              background: isPinned ? 'var(--accent-soft)' : 'var(--bg-card)',
              borderColor: isPinned ? 'var(--accent)' : 'var(--border-color)',
              color: isPinned ? 'var(--accent)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isPinned
                ? 'var(--accent-soft)'
                : 'var(--bg-card)';
            }}
          >
            置顶
          </button>
        )}
        {/* 收藏到按钮 */}
        {onMoveToFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveToFavorite(work.id);
            }}
            className="px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors"
            title="收藏到指定收藏夹"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--accent)';
              e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-card)';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
          >
            📁 收藏到
          </button>
        )}
        {/* 删除按钮（始终可见，醒目颜色） */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}
          className="px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors"
          title="删除到回收站"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border-color)',
            color: 'var(--danger)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--danger-soft)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-card)';
          }}
        >
          删除
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
          title={work.title}
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

      {/* 「更多」菜单 portal —— 渲染到 body 避免被卡片 overflow 遮挡 */}
      {menuOpen && menuPos && createPortal(
        <div
          id="workcard-menu-portal"
          className="fixed min-w-[180px] rounded-xl shadow-xl border py-1.5"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 9000,
            background: 'var(--bg-card)',
            borderColor: 'var(--border-color)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem icon="✏️" label="重命名" onClick={() => { onRename(work.id); setMenuOpen(false); }} />
          {onEditDescription && (
            <MenuItem
              icon="📝"
              label="修改简介"
              onClick={() => { onEditDescription(work.id); setMenuOpen(false); }}
            />
          )}
          {onReader && (
            <MenuItem
              icon="📖"
              label="进入阅读模式"
              onClick={() => { onReader(work.id); setMenuOpen(false); }}
            />
          )}
          <MenuItem icon="💾" label="导出为安科文件" onClick={() => { onExport(work.id); setMenuOpen(false); }} />
          {onExportEpub && (
            <MenuItem
              icon="📚"
              label="导出为 epub 电子书"
              onClick={() => { onExportEpub(work.id); setMenuOpen(false); }}
            />
          )}
        </div>,
        document.body
      )}
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
