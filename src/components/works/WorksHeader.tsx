// ============================================================
// 作品列表顶部栏（二次元贴纸手账风）
// 返回 / 标题 / 操作区 / 筛选胶囊 / 搜索
// ============================================================

import { Icon, type IconName } from '../common/Icon';
import { isCapacitor } from '../../utils/platform';
import type { Favorite } from '../../types/story';

export type WorksFilterKey = 'all' | 'trash' | `fav:${string}`;

export interface WorksCategory {
  key: WorksFilterKey;
  label: string;
  count: number;
}

export interface WorksHeaderProps {
  totalCount: number;
  trashCount: number;
  categories: WorksCategory[];
  activeFilter: WorksFilterKey;
  favoriteStoryIds: Set<string>;
  favorites: Favorite[];
  favoriteMenuOpenId: string | null;
  search: string;
  batchMode: boolean;
  selectedCount: number;
  actionMenuOpen: boolean;
  canShowAuthor: boolean;
  onBack: () => void;
  onShowAuthor?: () => void;
  onOpenTrash: () => void;
  onNewStory: () => void;
  onImportStory: () => void;
  onToggleBatch: () => void;
  onBatchExport: () => void;
  onFilterChange: (key: WorksFilterKey) => void;
  onFavoriteMenuOpen: (favId: string | null) => void;
  onRenameFavorite: (fav: Favorite) => void;
  onDeleteFavorite: (fav: Favorite) => void;
  onNewFavorite: () => void;
  onSearchChange: (value: string) => void;
  onActionMenuOpenChange: (open: boolean) => void;
}

export function WorksHeader({
  totalCount,
  trashCount,
  categories,
  activeFilter,
  favoriteStoryIds,
  favorites,
  favoriteMenuOpenId,
  search,
  batchMode,
  selectedCount,
  actionMenuOpen,
  canShowAuthor,
  onBack,
  onShowAuthor,
  onOpenTrash,
  onNewStory,
  onImportStory,
  onToggleBatch,
  onBatchExport,
  onFilterChange,
  onFavoriteMenuOpen,
  onRenameFavorite,
  onDeleteFavorite,
  onNewFavorite,
  onSearchChange,
  onActionMenuOpenChange,
}: WorksHeaderProps) {
  const menuItem = (
    icon: IconName,
    label: string,
    onClick: () => void,
    danger = false,
  ) => (
    <button
      onClick={() => {
        onActionMenuOpenChange(false);
        onClick();
      }}
      style={{
        width: '100%',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        textAlign: 'left',
        fontSize: 13,
        fontWeight: 600,
        background: 'transparent',
        color: danger ? '#c0392b' : 'var(--an-ink)',
        cursor: 'pointer',
        border: 'none',
      }}
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );

  return (
    <header
      className="sticky top-9 z-40"
      style={{
        background: 'var(--an-paper-2)',
        borderBottom: '3px solid var(--an-ink)',
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '14px 24px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <button className="an-pill" onClick={onBack} title="返回">
          <Icon name="back" size={14} /> 返回
        </button>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--an-font-display)',
            fontSize: 24,
            color: 'var(--an-ink)',
            whiteSpace: 'nowrap',
          }}
        >
          我的安科作品
        </h1>
        <span className="an-badge">{totalCount} 部</span>

        {isCapacitor ? (
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <button
              className="an-pill"
              onClick={() => onActionMenuOpenChange(!actionMenuOpen)}
              aria-expanded={actionMenuOpen}
              aria-label="操作菜单"
            >
              <Icon name="menu" size={16} /> 操作
            </button>
            {actionMenuOpen && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                  onClick={() => onActionMenuOpenChange(false)}
                />
                <div
                  className="an-card"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 6px)',
                    zIndex: 40,
                    minWidth: 190,
                    padding: '8px 0',
                    boxShadow: 'var(--an-shadow-pop)',
                  }}
                >
                  {canShowAuthor && onShowAuthor && menuItem('bot', '关于作者', onShowAuthor)}
                  {menuItem('trash', `回收站${trashCount > 0 ? `(${trashCount})` : ''}`, onOpenTrash)}
                  {menuItem('plus', '新建安科', onNewStory)}
                  {menuItem('download', '导入作品', onImportStory)}
                  {menuItem('box', batchMode ? '取消批量' : '批量导出', onToggleBatch)}
                  {batchMode &&
                    menuItem('upload', `导出选中 (${selectedCount})`, onBatchExport)}
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {canShowAuthor && onShowAuthor && (
              <button className="an-pill" onClick={onShowAuthor}>
                <Icon name="bot" size={12} /> 关于作者
              </button>
            )}
            <button className="an-pill" onClick={onOpenTrash} title="回收站">
              <Icon name="trash" size={12} /> 回收站{trashCount > 0 ? ` (${trashCount})` : ''}
            </button>
            <button className="an-pill" onClick={onImportStory}>
              <Icon name="download" size={12} /> 导入
            </button>
            <button
              className={`an-pill${batchMode ? ' is-active' : ''}`}
              onClick={onToggleBatch}
              aria-pressed={batchMode}
            >
              <Icon name="box" size={12} /> {batchMode ? '取消批量' : '批量导出'}
            </button>
            {batchMode && (
              <button
                className="an-btn an-btn--sm an-btn--sky"
                onClick={onBatchExport}
                disabled={selectedCount === 0}
              >
                <Icon name="upload" size={12} /> 导出选中 ({selectedCount})
              </button>
            )}
            <button className="an-btn an-btn--sm an-btn--pink" onClick={onNewStory}>
              <Icon name="plus" size={14} /> 新建安科
            </button>
          </div>
        )}
      </div>

      {/* 筛选胶囊 + 搜索 */}
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 24px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div className="an-rail" style={{ flex: '1 1 auto', minWidth: 0, paddingBottom: 4 }}>
          {categories.map((cat) => {
            const active = activeFilter === cat.key;
            const isFavorite = cat.key.startsWith('fav:');
            const favId = isFavorite ? cat.key.slice(4) : null;
            return (
              <div key={cat.key} style={{ position: 'relative', flex: '0 0 auto' }}>
                <button
                  className={`an-pill${active ? ' is-active' : ''}`}
                  onClick={() => onFilterChange(cat.key)}
                  aria-pressed={active}
                  onContextMenu={(e) => {
                    if (!isFavorite) return;
                    e.preventDefault();
                    onFavoriteMenuOpen(favId);
                  }}
                >
                  {isFavorite && <Icon name="folder" size={12} />}
                  <span>{cat.label}</span>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>
                    {isFavorite && activeFilter === cat.key ? favoriteStoryIds.size : cat.count}
                  </span>
                </button>
                {isFavorite && favoriteMenuOpenId === favId && (
                  <div
                    className="an-card"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: 0,
                      zIndex: 30,
                      minWidth: 140,
                      padding: '6px 0',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        const f = favorites.find((x) => x.id === favId);
                        if (f) onRenameFavorite(f);
                        onFavoriteMenuOpen(null);
                      }}
                      className="an-menu-item"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'transparent',
                        color: 'var(--an-ink)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        border: 'none',
                      }}
                    >
                      <Icon name="pen" size={13} /> 重命名
                    </button>
                    <button
                      onClick={() => {
                        const f = favorites.find((x) => x.id === favId);
                        if (f) onDeleteFavorite(f);
                        onFavoriteMenuOpen(null);
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'transparent',
                        color: '#c0392b',
                        textAlign: 'left',
                        cursor: 'pointer',
                        border: 'none',
                      }}
                    >
                      <Icon name="trash" size={13} /> 删除（仅空）
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <button className="an-pill" onClick={onNewFavorite} title="新建收藏夹">
            <Icon name="plus" size={12} /> 新建收藏夹
          </button>
        </div>

        <div style={{ position: 'relative', flex: '0 0 auto', width: isCapacitor ? '100%' : undefined }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--an-ink-soft)',
              display: 'inline-flex',
            }}
          >
            <Icon name="search" size={13} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索作品..."
            aria-label="搜索作品"
            style={{
              width: isCapacitor ? '100%' : 220,
              padding: '8px 14px 8px 34px',
              borderRadius: 999,
              border: '2px solid var(--an-ink)',
              background: 'var(--an-card)',
              color: 'var(--an-ink)',
              fontSize: 12,
              outline: 'none',
            }}
          />
        </div>
      </div>
    </header>
  );
}
