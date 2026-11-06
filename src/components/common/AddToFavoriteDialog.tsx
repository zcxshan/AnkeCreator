import { useEffect, useState } from 'react';
import type { Favorite } from '../../types/story';
import { Icon } from './Icon';
import { Modal } from './Modal';

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="add-to-favorite-dialog-title"
      contentStyle={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-toolbar)',
        boxShadow: 'var(--shadow-modal)',
        padding: '20px 24px 18px',
        width: 380,
        maxWidth: '90vw',
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        animation: 'modalSlideIn 0.18s ease-out',
        border: '1px solid var(--border-color)',
      }}
    >
        <h3
          id="add-to-favorite-dialog-title"
          className="m-[0px] mb-[4px] text-[15px] font-semibold text-[var(--text-primary)]"
        >
          {isSingle ? '移动到收藏夹' : '加入收藏夹'}
        </h3>
        <p
          className="m-[0px] mb-[12px] text-[12px] text-[var(--text-secondary)]"
        >
          {isSingle
            ? '选中的收藏夹作为作品唯一归属（不选 = 移出所有）'
            : '点击切换加入 / 移出'}
        </p>

        {favorites.length === 0 ? (
          <div
            className="py-[24px] px-[12px] text-center text-[var(--text-secondary)] text-[13px]"
          >
            <div className="flex justify-center mb-2"><Icon name="folder" size={32} /></div>
            <div className="mb-[12px]">还没有收藏夹</div>
            {onCreateNew && (
              <button
                onClick={() => {
                  onClose();
                  onCreateNew();
                }}
                className="py-[6px] px-[16px] text-[13px] font-semibold border border-[color:var(--tone-info-border)] rounded-[var(--radius-control)] bg-[var(--tone-info-veil)] text-[var(--tone-info)] cursor-pointer"
              >
                去新建收藏夹
              </button>
            )}
          </div>
        ) : (
          <div
            className="overflow-y-auto border border-[color:var(--border-color)] rounded-[var(--radius-control)] bg-[var(--bg-base)]"
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
                    background: inFav ? 'var(--tone-info-soft)' : 'transparent',
                    color: 'var(--text-primary)',
                    border: 'none',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => {
                    if (!inFav) e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = inFav
                      ? 'var(--tone-info-soft)'
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
                        ? `1.5px solid var(--tone-info)`
                        : '1.5px solid var(--border-color)',
                      background: inFav ? 'var(--tone-info)' : 'transparent',
                      color: 'var(--text-on-accent)',
                      fontSize: 12,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    {inFav ? <Icon name="check" size={12} /> : ''}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fav.name}
                  </span>
                  <span
                    className="text-[12px] text-[var(--text-secondary)] shrink-0"
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
          className="flex justify-end mt-[14px]"
        >
          <button
            onClick={onClose}
            className="py-[7px] px-[18px] text-[13px] border border-[color:var(--border-color)] rounded-[var(--radius-control)] bg-transparent text-[var(--text-primary)] cursor-pointer"
          >
            关闭
          </button>
        </div>
    </Modal>
  );
}
