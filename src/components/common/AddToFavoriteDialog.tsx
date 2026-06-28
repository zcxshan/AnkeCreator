import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Favorite } from '../../types/story';

export type AddToFavoriteMode = 'multi' | 'single';

interface AddToFavoriteDialogProps {
  open: boolean;
  storyId: string;
  favorites: Favorite[];
  /** 外部传入的"作品已在的收藏夹 id 列表"——父组件在打开弹窗前查好 */
  initialCheckedIds: string[];
  /**
   * 'multi'（默认）：勾选式 toggle 加入/移出多个收藏夹
   * 'single'：单选式，选中即移动到该收藏夹（同时移出其他）；空 = 移出所有
   */
  mode?: AddToFavoriteMode;
  onClose: () => void;
  /** 切换某个收藏夹的加入/移出状态；inFav 表示当前是否已加入 */
  onToggle: (favoriteId: string, inFav: boolean) => void;
  /**
   * single 模式下专用：直接选中该收藏夹作为唯一目标（parent 收到此回调后做移出+加入）
   * multi 模式不需要此回调
   */
  onSelectSingle?: (favoriteId: string) => void;
  /** 当列表为空时点击「去新建」会调用此回调 */
  onCreateNew?: () => void;
}

/**
 * 「加入收藏夹」弹窗
 * - multi：列出所有收藏夹，已加入的标 ✓，点击切换加入/移出
 * - single：单选式移动到指定收藏夹（不选 = 移出所有）
 * - 空状态显示「去新建」入口
 */
export function AddToFavoriteDialog({
  open,
  storyId,
  favorites,
  initialCheckedIds,
  mode = 'multi',
  onClose,
  onToggle,
  onSelectSingle,
  onCreateNew,
}: AddToFavoriteDialogProps) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set(initialCheckedIds));

  // 弹窗打开 / storyId / initialCheckedIds 变化时，重置本地状态
  useEffect(() => {
    if (open) {
      setCheckedIds(new Set(initialCheckedIds));
    }
  }, [open, storyId, initialCheckedIds]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const isSingle = mode === 'single';

  const handleClickItem = (fav: Favorite) => {
    if (isSingle) {
      // single 模式：直接调用 onSelectSingle，parent 自己做"移出所有+加入这一个"
      onSelectSingle?.(fav.id);
      return;
    }
    const inFav = checkedIds.has(fav.id);
    const next = new Set(checkedIds);
    if (inFav) next.delete(fav.id);
    else next.add(fav.id);
    setCheckedIds(next);
    onToggle(fav.id, inFav);
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        animation: 'addFavFade 0.15s ease-out',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="加入收藏夹"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          padding: '20px 24px 18px',
          width: 380,
          maxWidth: '90vw',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          animation: 'addFavSlideIn 0.18s ease-out',
          border: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <h3
          style={{
            margin: 0,
            marginBottom: 4,
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary, #111)',
          }}
        >
          {isSingle ? '移动到收藏夹' : '加入收藏夹'}
        </h3>
        <p
          style={{
            margin: 0,
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--text-secondary, #888)',
          }}
        >
          {isSingle
            ? '选中的收藏夹作为作品唯一归属（不选 = 移出所有）'
            : '点击切换加入 / 移出'}
        </p>

        {favorites.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--text-secondary, #888)',
              fontSize: 13,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
            <div style={{ marginBottom: 12 }}>还没有收藏夹</div>
            {onCreateNew && (
              <button
                onClick={() => {
                  onClose();
                  onCreateNew();
                }}
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: '1px solid rgba(37,99,235,0.2)',
                  borderRadius: 6,
                  background: 'rgba(37,99,235,0.10)',
                  color: '#2563eb',
                  cursor: 'pointer',
                }}
              >
                去新建收藏夹
              </button>
            )}
          </div>
        ) : (
          <div
            style={{
              overflowY: 'auto',
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'var(--bg-base, #fafafa)',
            }}
          >
            {favorites.map((fav) => {
              const inFav = checkedIds.has(fav.id);
              const indicatorSize = isSingle ? 16 : 18;
              const indicatorRadius = isSingle ? '50%' : 4;
              return (
                <button
                  key={fav.id}
                  onClick={() => handleClickItem(fav)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    fontSize: 13,
                    textAlign: 'left',
                    background: inFav ? 'rgba(37,99,235,0.06)' : 'transparent',
                    color: 'var(--text-primary, #111)',
                    border: 'none',
                    borderBottom: '1px solid var(--border-color, #e5e7eb)',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => {
                    if (!inFav) e.currentTarget.style.background = 'var(--bg-hover, #f3f4f6)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = inFav
                      ? 'rgba(37,99,235,0.06)'
                      : 'transparent';
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: indicatorSize,
                      height: indicatorSize,
                      borderRadius: indicatorRadius,
                      border: inFav
                        ? `1.5px solid #2563eb`
                        : '1.5px solid var(--border-color, #d1d5db)',
                      background: inFav ? '#2563eb' : 'transparent',
                      color: '#fff',
                      fontSize: 12,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    {inFav ? (isSingle ? '●' : '✓') : ''}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fav.name}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-secondary, #888)',
                      flexShrink: 0,
                    }}
                  >
                    {isSingle
                      ? (inFav ? '当前归属' : '点击移动')
                      : (inFav ? '已加入' : '未加入')}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 14,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '7px 18px',
              fontSize: 13,
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-primary, #111)',
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>
      </div>
      <style>
        {`
          @keyframes addFavFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes addFavSlideIn {
            from { opacity: 0; transform: translateY(-8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}
      </style>
    </div>,
    document.body
  );
}
