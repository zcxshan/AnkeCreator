import type { DragEvent } from 'react';
import { Icon } from '../common/Icon';
import { WorkCard, type WorkSummary } from '../common/WorkCard';

// ========== 作品列表页的展示型区块（贴纸手账风） ==========
// 仅负责渲染；所有状态与副作用仍由 WorksListPage 持有。

export function WorksEmptyState() {
  return (
    <div className="an-empty" style={{ padding: '56px 24px' }}>
      <span style={{ color: 'var(--an-pink)' }}>
        <Icon name="dices" size={56} />
      </span>
      <div className="an-empty__title">还没有安科作品</div>
      <div className="an-empty__desc">
        点击上方「新建安科」开始第一个作品吧。从一张白纸开始，用骰子决定命运，让故事由此展开。
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
        <span className="an-chip">1. 新建作品</span>
        <span className="an-chip">2. 添加目录</span>
        <span className="an-chip">3. 掷骰写作</span>
      </div>
    </div>
  );
}

export function WorksNoMatchState() {
  return (
    <div className="an-empty" style={{ padding: '48px 24px' }}>
      <span style={{ color: 'var(--an-ink-soft)' }}>
        <Icon name="search" size={40} />
      </span>
      <div className="an-empty__title" style={{ fontSize: 18 }}>
        没有找到匹配的作品
      </div>
      <div className="an-empty__desc">换个关键词试试，或清空搜索条件。</div>
    </div>
  );
}

/** 首屏加载中：避免「空库」与「正在读盘」混为一谈 */
export function WorksLoadingState() {
  return (
    <div
      className="an-card"
      style={{
        padding: '56px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        color: 'var(--an-ink-soft)',
        fontSize: 13,
      }}
      role="status"
      aria-live="polite"
    >
      <Icon name="hourglass" size={32} />
      <span>正在加载作品列表…</span>
    </div>
  );
}

/** 列表读取失败：必须让用户看见原因并能重试，而不是永久停在加载态 */
export function WorksErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="an-card"
      style={{
        padding: '48px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 8,
      }}
      role="alert"
    >
      <span style={{ color: '#c0392b' }}>
        <Icon name="alert" size={36} />
      </span>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--an-ink)' }}>
        作品列表加载失败
      </div>
      <p style={{ margin: 0, fontSize: 12, color: '#c0392b', maxWidth: 460, wordBreak: 'break-all' }}>
        {message}
      </p>
      <button
        onClick={onRetry}
        className="an-btn an-btn--sm an-btn--pink"
        style={{ marginTop: 10 }}
      >
        <Icon name="refresh" size={14} /> 重新加载
      </button>
    </div>
  );
}

function TrashCard({
  work,
  onRestore,
  onPermanentDelete,
}: {
  work: WorkSummary;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  return (
    <div
      className="an-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          flex: '0 0 auto',
          borderRadius: 12,
          border: '3px solid var(--an-ink)',
          background: 'var(--an-pink-soft)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--an-ink)',
        }}
      >
        <Icon name="bookText" size={22} />
      </span>
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--an-ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {work.title}
        </div>
        {work.description && (
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: 'var(--an-ink-soft)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {work.description}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onRestore} className="an-btn an-btn--sm an-btn--mint">
          <Icon name="refresh" size={13} /> 还原
        </button>
        <button
          onClick={onPermanentDelete}
          className="an-btn an-btn--sm an-btn--ghost"
          style={{ color: '#c0392b' }}
        >
          <Icon name="trash" size={13} /> 彻底删除
        </button>
      </div>
    </div>
  );
}

export function TrashView({
  totalCount,
  works,
  onClearTrash,
  onRestore,
  onPermanentDelete,
}: {
  totalCount: number;
  works: WorkSummary[];
  onClearTrash: () => void;
  onRestore: (work: WorkSummary) => void;
  onPermanentDelete: (work: WorkSummary) => void;
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <span className="an-badge">
          <Icon name="trash" size={12} /> 回收站
        </span>
        <span style={{ fontSize: 13, color: 'var(--an-ink-soft)' }}>{totalCount} 个作品</span>
        {totalCount > 0 && (
          <button
            onClick={onClearTrash}
            className="an-btn an-btn--sm an-btn--ghost"
            style={{ marginLeft: 'auto', color: '#c0392b' }}
          >
            <Icon name="trash" size={13} /> 清空回收站
          </button>
        )}
      </div>
      {totalCount === 0 ? (
        <div className="an-empty">
          <span style={{ color: 'var(--an-ink-faint)' }}>
            <Icon name="trash" size={48} />
          </span>
          <div className="an-empty__title" style={{ fontSize: 18 }}>
            回收站为空
          </div>
          <div className="an-empty__desc">删除的作品会先放在这里，可以随时还原。</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {works.map((work) => (
            <TrashCard
              key={work.id}
              work={work}
              onRestore={() => onRestore(work)}
              onPermanentDelete={() => onPermanentDelete(work)}
            />
          ))}
        </div>
      )}
    </>
  );
}

export interface WorksGridViewProps {
  works: WorkSummary[];
  batchMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  dragId: string | null;
  dragOverId: string | null;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string) => void;
  onEditDescription: (id: string) => void;
  onExport: (id: string) => void;
  onPinned: (id: string) => void;
  onMoveToFavorite: (id: string) => void;
  onExportEpub: (id: string) => void;
  onReader?: (id: string) => void;
}

export function WorksGridView({
  works,
  batchMode,
  selectedIds,
  onToggleSelect,
  dragId,
  dragOverId,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onOpen,
  onDelete,
  onRename,
  onEditDescription,
  onExport,
  onPinned,
  onMoveToFavorite,
  onExportEpub,
  onReader,
}: WorksGridViewProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
        gap: 18,
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {works.map((work) => {
        const isSelected = selectedIds.has(work.id);
        return (
          <div
            key={work.id}
            style={{
              position: 'relative',
              borderRadius: 20,
              transform: dragOverId === work.id ? 'translateY(-6px) scale(1.02)' : undefined,
              transition: 'transform 150ms var(--an-ease-bounce), box-shadow 150ms ease',
              opacity: dragId === work.id ? 0.55 : 1,
              boxShadow:
                dragOverId === work.id
                  ? '0 0 0 3px var(--an-pink), var(--an-shadow-soft)'
                  : isSelected
                    ? '0 0 0 3px var(--an-mint)'
                    : undefined,
            }}
          >
            {batchMode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(work.id);
                }}
                aria-label={`选择作品 ${work.title}`}
                aria-pressed={isSelected}
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  zIndex: 30,
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: '3px solid var(--an-ink)',
                  background: isSelected ? 'var(--an-mint)' : 'var(--an-card)',
                  color: 'var(--an-ink)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 0 var(--an-ink)',
                }}
              >
                {isSelected && <Icon name="check" size={14} />}
              </button>
            )}
            <WorkCard
              work={work}
              onOpen={onOpen}
              onDelete={onDelete}
              onRename={onRename}
              onEditDescription={onEditDescription}
              onExport={onExport}
              onPinned={onPinned}
              onMoveToFavorite={onMoveToFavorite}
              onExportEpub={onExportEpub}
              onReader={onReader}
            />
          </div>
        );
      })}
    </div>
  );
}
