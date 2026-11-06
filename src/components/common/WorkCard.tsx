import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
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

/** 封面配色（按作品 id 稳定取色） */
const COVER_PAIRS: Array<{ bg: string; accent: string }> = [
  { bg: 'var(--an-pink-soft)', accent: 'var(--an-pink)' },
  { bg: 'var(--an-sky-soft)', accent: 'var(--an-sky)' },
  { bg: 'var(--an-mint-soft)', accent: 'var(--an-mint)' },
  { bg: 'var(--an-lemon-soft)', accent: 'var(--an-lemon)' },
  { bg: 'var(--an-lilac-soft)', accent: 'var(--an-lilac)' },
];

function pickCover(id: string): { bg: string; accent: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_PAIRS[hash % COVER_PAIRS.length];
}

function WorkCardInner({
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
  const cover = pickCover(work.id);

  const openMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const btn = menuBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 200) });
    } else {
      setMenuPos({ top: 80, left: 80 });
    }
    setMenuOpen(true);
  };

  if (confirmDelete) {
    return (
      <div
        className="an-card"
        style={{
          minHeight: 260,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 6,
        }}
      >
        <span style={{ color: '#c0392b' }}>
          <Icon name="trash" size={28} />
        </span>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--an-ink)' }}>确认删除？</div>
        <div style={{ fontSize: 12, color: 'var(--an-ink-soft)', marginBottom: 8 }}>
          作品会移入回收站，可随时还原
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="an-btn an-btn--sm an-btn--ghost" onClick={() => setConfirmDelete(false)}>
            取消
          </button>
          <button
            className="an-btn an-btn--sm an-btn--pink"
            onClick={() => {
              onDelete(work.id);
              setConfirmDelete(false);
            }}
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
      className="an-card an-card--hover"
      style={{
        outline: 'none',
        cursor: 'pointer',
        overflow: 'hidden',
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 260,
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = '0 0 0 3px var(--an-pink), var(--an-shadow-pop)';
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = 'var(--an-shadow-pop)';
      }}
    >
      {/* 封面 */}
      <div
        style={{
          position: 'relative',
          height: 116,
          background: `linear-gradient(135deg, ${cover.bg} 0%, var(--an-card) 100%)`,
          borderBottom: '3px solid var(--an-ink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -18,
            right: -18,
            width: 62,
            height: 62,
            borderRadius: '50%',
            background: cover.accent,
            opacity: 0.35,
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: -20,
            left: -16,
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: cover.accent,
            opacity: 0.25,
          }}
        />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: 58,
            height: 58,
            borderRadius: '50%',
            border: '3px solid var(--an-ink)',
            background: 'var(--an-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 0 var(--an-ink)',
            color: 'var(--an-ink)',
          }}
        >
          <Icon name="bookText" size={28} />
        </div>

        {isPinned && (
          <span
            className="an-chip"
            style={{ position: 'absolute', top: 8, left: 8, background: 'var(--an-lemon)' }}
            title="已置顶"
          >
            <Icon name="pin" size={11} /> 置顶
          </span>
        )}

        <span className="an-chip" style={{ position: 'absolute', bottom: 8, left: 8 }}>
          <Icon name="dices" size={11} /> 安科
        </span>
        <span className="an-chip" style={{ position: 'absolute', bottom: 8, right: 8 }}>
          {work.chapterCount} 章 · {work.sectionCount} 节
        </span>

        {/* 更多菜单入口 */}
        <div style={{ position: 'absolute', top: 8, right: 8 }} onClick={(e) => e.stopPropagation()}>
          <button
            ref={menuBtnRef}
            onClick={openMenu}
            className="an-pill"
            style={{ minHeight: 28, padding: '3px 10px', fontSize: 12, background: 'var(--an-card)' }}
            title="更多操作"
            aria-label="更多操作"
            aria-expanded={menuOpen}
          >
            <Icon name="menu" size={13} /> 更多
          </button>
        </div>
      </div>

      {/* 信息 */}
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}>
        <h3
          style={{
            margin: 0,
            fontFamily: 'var(--an-font-display)',
            fontSize: 18,
            lineHeight: 1.3,
            color: 'var(--an-ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={work.title}
        >
          {work.title}
        </h3>
        <p
          style={{
            margin: '6px 0 0',
            minHeight: 34,
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--an-ink-soft)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {work.description || '还没有简介'}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          <span className="an-chip">
            <Icon name="pen" size={11} />
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {work.wordCount.toLocaleString()} 字
            </span>
          </span>
          <span className="an-chip">
            <Icon name="dices" size={11} />
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{work.diceCount}</span>
          </span>
          <span className="an-chip" style={{ marginLeft: 'auto' }}>
            <Icon name="clock" size={11} /> {formattedDate}
          </span>
        </div>
      </div>

      {/* 「更多」菜单 portal —— 渲染到 body 避免被卡片 overflow 遮挡 */}
      {menuOpen && menuPos && createPortal(
        <div
          id="workcard-menu-portal"
          className="an-card an-pop-in"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            minWidth: 190,
            padding: '6px 0',
            zIndex: 9000,
            boxShadow: 'var(--an-shadow-pop-lg)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {onPinned && (
            <MenuItem
              icon="pin"
              label={isPinned ? '取消置顶' : '置顶'}
              onClick={() => { onPinned(work.id); setMenuOpen(false); }}
            />
          )}
          {onMoveToFavorite && (
            <MenuItem
              icon="folder"
              label="收藏到…"
              onClick={() => { onMoveToFavorite(work.id); setMenuOpen(false); }}
            />
          )}
          {onReader && (
            <MenuItem
              icon="bookText"
              label="进入阅读模式"
              onClick={() => { onReader(work.id); setMenuOpen(false); }}
            />
          )}
          <MenuItem icon="pen" label="重命名" onClick={() => { onRename(work.id); setMenuOpen(false); }} />
          {onEditDescription && (
            <MenuItem
              icon="fileText"
              label="修改简介"
              onClick={() => { onEditDescription(work.id); setMenuOpen(false); }}
            />
          )}
          <MenuItem icon="save" label="导出为安科文件" onClick={() => { onExport(work.id); setMenuOpen(false); }} />
          {onExportEpub && (
            <MenuItem
              icon="book"
              label="导出为 epub 电子书"
              onClick={() => { onExportEpub(work.id); setMenuOpen(false); }}
            />
          )}
          <div style={{ height: 1, background: 'var(--an-ink-faint)', margin: '4px 8px' }} />
          <MenuItem
            icon="trash"
            label="删除到回收站"
            danger
            onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

export const WorkCard = memo(WorkCardInner);

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'left',
        color: danger ? '#c0392b' : 'var(--an-ink)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--an-pink-soft)' : 'var(--an-paper-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>
        <Icon name={icon} size={14} />
      </span>
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
