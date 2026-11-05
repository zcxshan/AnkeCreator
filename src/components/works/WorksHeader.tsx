// ============================================================
// 作品列表顶部栏（返回 / 标题 / 操作区 / 筛选栏 / 搜索）
// 从 WorksListPage 抽出，页面只负责状态与业务回调
// ============================================================

import { Icon } from '../common/Icon';
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
  return (
    <header
      className="bg-[var(--bg-card)] border-b border-b-[color:var(--border-color)] sticky top-8 z-40 backdrop-blur"
    >
      <div className="max-w-6xl mx-auto px-6 sm:px-8 py-4 flex items-center gap-2">
        <button
          aria-label="返回"
          onClick={onBack}
          className="text-[var(--text-secondary)] w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title="返回"
        >
          <Icon name="back" size={16} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-[var(--text-primary)] text-base font-semibold tracking-tight">
            我的安科作品
          </h1>
          <span className="text-[var(--text-secondary)] text-sm">
            共 {totalCount} 部
          </span>
        </div>

        {isCapacitor ? (
          // 移动端：折叠按钮菜单
          <div className="ml-auto relative">
            <button
              onClick={() => onActionMenuOpenChange(!actionMenuOpen)}
              aria-expanded={actionMenuOpen}
              aria-label="操作菜单"
              className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
              title="操作"
            >
              <Icon name="menu" size={20} />
              <span>操作</span>
            </button>
            {actionMenuOpen && (
              <>
                {/* 点击遮罩关闭菜单 */}
                <div className="fixed inset-0 z-30" onClick={() => onActionMenuOpenChange(false)} />
                <div
                  className="bg-[var(--bg-card)] border border-[color:var(--border-color)] absolute right-0 top-full mt-1 z-40 min-w-[180px] rounded-lg shadow-lg overflow-hidden"
                >
                  {canShowAuthor && onShowAuthor && (
                    <button
                      onClick={() => {
                        onActionMenuOpenChange(false);
                        onShowAuthor();
                      }}
                      className="text-[var(--text-secondary)] w-full px-4 py-2.5 text-left text-[13px] transition-colors inline-flex items-center gap-2"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-hover)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }}
                    >
                      <Icon name="bot" size={14} />
                      <span>关于作者</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onActionMenuOpenChange(false);
                      onOpenTrash();
                    }}
                    className="text-[var(--text-secondary)] w-full px-4 py-2.5 text-left text-[13px] transition-colors inline-flex items-center gap-2"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hover)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                  >
                    <Icon name="trash" size={14} />
                    <span>回收站{trashCount > 0 ? `(${trashCount})` : ''}</span>
                  </button>
                  <button
                    onClick={() => {
                      onActionMenuOpenChange(false);
                      onNewStory();
                    }}
                    className="text-[var(--accent)] w-full px-4 py-2.5 text-left text-[13px] font-medium transition-colors inline-flex items-center gap-2"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '';
                    }}
                  >
                    <span>+</span>
                    <span>新建安科</span>
                  </button>
                  <button
                    onClick={() => {
                      onActionMenuOpenChange(false);
                      onImportStory();
                    }}
                    className="text-[var(--text-primary)] w-full px-4 py-2.5 text-left text-[13px] transition-colors inline-flex items-center gap-2"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '';
                    }}
                  >
                    <Icon name="download" size={14} />
                    <span>导入作品</span>
                  </button>
                  <button
                    onClick={() => {
                      onActionMenuOpenChange(false);
                      onToggleBatch();
                    }}
                    className="w-full px-4 py-2.5 text-left text-[13px] transition-colors inline-flex items-center gap-2"
                    style={{ color: 'var(--text-primary)', background: batchMode ? 'var(--accent-soft)' : 'transparent' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = batchMode ? 'var(--accent-soft)' : '';
                    }}
                  >
                    <Icon name="box" size={14} />
                    <span>{batchMode ? '取消批量' : '批量导出'}</span>
                  </button>
                  {batchMode && (
                    <button
                      onClick={() => {
                        onActionMenuOpenChange(false);
                        onBatchExport();
                      }}
                      disabled={selectedCount === 0}
                      className="text-[var(--text-on-accent)] bg-[var(--accent)] w-full px-4 py-2.5 text-left text-[13px] font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Icon name="upload" size={14} />
                      <span>导出选中 ({selectedCount})</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {canShowAuthor && onShowAuthor && (
              <button
                onClick={onShowAuthor}
                className="text-[var(--text-secondary)] ml-auto text-sm transition-colors"
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                关于作者
              </button>
            )}

            <div className="anke-card flex items-center gap-2 flex-wrap px-3 py-2">
              <button
                onClick={onOpenTrash}
                className="text-[var(--text-secondary)] px-3 py-2 text-xs rounded-lg transition-colors inline-flex items-center gap-1.5"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '';
                }}
                title="回收站"
              >
                <Icon name="trash" size={14} />
                <span>回收站{trashCount > 0 ? `(${trashCount})` : ''}</span>
              </button>
              <button
                onClick={onNewStory}
                className="bg-[var(--accent)] text-[var(--text-on-accent)] px-4 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
              >
                <span className="text-base leading-none">+</span>
                <span>新建安科</span>
              </button>
              <button
                onClick={onImportStory}
                className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-4 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.background = 'var(--bg-card)';
                }}
              >
                <Icon name="download" size={14} />
                <span>导入作品</span>
              </button>
              <button
                onClick={onToggleBatch}
                aria-pressed={batchMode}
                className="anke-btn"
                style={{
                  background: batchMode ? 'var(--accent-soft)' : undefined,
                  color: batchMode ? 'var(--accent)' : undefined,
                  borderColor: batchMode ? 'var(--accent)' : undefined,
                }}
              >
                <Icon name="box" size={14} />
                <span>{batchMode ? '取消批量' : '批量导出'}</span>
              </button>
              {batchMode && (
                <button
                  onClick={onBatchExport}
                  disabled={selectedCount === 0}
                  className="bg-[var(--accent)] text-[var(--text-on-accent)] px-4 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  onMouseEnter={(e) => {
                    if (selectedCount > 0) e.currentTarget.style.opacity = '0.9';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                >
                  <Icon name="upload" size={14} />
                  <span>导出选中 ({selectedCount})</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* 筛选栏 */}
      <div className="max-w-6xl mx-auto px-6 sm:px-8 pb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0 scrollbar-hide">
          {categories.map((cat) => {
            const active = activeFilter === cat.key;
            const isFavorite = cat.key.startsWith('fav:');
            const favId = isFavorite ? cat.key.slice(4) : null;
            return (
              <div key={cat.key} className="relative shrink-0">
                <button
                  onClick={() => onFilterChange(cat.key)}
                  aria-pressed={active}
                  onContextMenu={(e) => {
                    if (!isFavorite) return;
                    e.preventDefault();
                    onFavoriteMenuOpen(favId);
                  }}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-all"
                  style={{
                    background: active ? 'var(--text-primary)' : 'var(--bg-card)',
                    color: active ? 'var(--bg-card)' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'transparent' : 'var(--border-color)'}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {isFavorite && <Icon name="folder" size={12} />}
                  <span>{cat.label}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      background: active ? 'var(--on-accent-veil)' : 'var(--bg-hover)',
                      color: active ? 'var(--bg-card)' : 'var(--text-secondary)',
                    }}
                  >
                    {isFavorite ? favoriteStoryIds.size : cat.count}
                  </span>
                </button>
                {/* 收藏夹右键菜单 */}
                {isFavorite && favoriteMenuOpenId === favId && (
                  <div
                    className="bg-[var(--bg-card)] border-[color:var(--border-color)] absolute top-full left-0 mt-1 min-w-[120px] rounded-lg shadow-xl border py-1 z-30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="text-[var(--text-primary)] w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                      onClick={() => {
                        const f = favorites.find((x) => x.id === favId);
                        if (f) onRenameFavorite(f);
                        onFavoriteMenuOpen(null);
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Icon name="pen" size={14} />
                        <span>重命名</span>
                      </span>
                    </button>
                    <button
                      className="text-[var(--danger)] w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                      onClick={() => {
                        const f = favorites.find((x) => x.id === favId);
                        if (f) onDeleteFavorite(f);
                        onFavoriteMenuOpen(null);
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Icon name="trash" size={14} />
                        <span>删除（仅空）</span>
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {/* 新建收藏夹按钮 */}
          <button
            onClick={onNewFavorite}
            className="bg-transparent text-[var(--text-secondary)] border border-[color:var(--border-color)] shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1 transition-all"
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent)';
              e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
            title="新建收藏夹"
          >
            <span className="text-base leading-none">+</span>
            <span>新建收藏夹</span>
          </button>
        </div>

        <div className="relative shrink-0">
          <span className="text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 text-xs">
            <Icon name="search" size={12} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索作品..."
            aria-label="搜索作品"
            className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-48 sm:w-56 pl-8 pr-3 py-1.5 text-xs rounded-full outline-none transition-all"
          />
        </div>
      </div>
    </header>
  );
}
