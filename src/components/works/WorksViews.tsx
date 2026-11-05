import type { DragEvent } from 'react';
import { Icon } from '../common/Icon';
import { WorkCard, type WorkSummary } from '../common/WorkCard';

// ========== 作品列表页的展示型区块 ==========
// 仅负责渲染；所有状态与副作用仍由 WorksListPage 持有。

export function WorksEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="relative mb-6">
        <div
          className="w-32 h-32 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--accent-bg) 100%)' }}
        >
          <Icon name="dices" size={56} />
        </div>
        <div
          className="bg-[var(--accent-bg)] absolute -top-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center"
        >
          <Icon name="sparkles" size={14} />
        </div>
        <div
          className="bg-[var(--accent-soft)] absolute -bottom-1 -left-3 w-8 h-8 rounded-full flex items-center justify-center text-lg"
        >
          <Icon name="bookText" size={14} />
        </div>
      </div>
      <h2 className="text-[var(--text-primary)] text-lg font-semibold mb-2">
        还没有安科作品，点击上方"新建安科"开始第一个作品吧
      </h2>
      <p className="text-[var(--text-secondary)] text-sm max-w-md">
        从一张白纸开始，用骰子决定命运，让故事由此展开。
      </p>
    </div>
  );
}

export function WorksNoMatchState() {
  return (
    <div className="text-[var(--text-secondary)] text-center py-20 text-sm">
      <div className="text-4xl mb-3"><Icon name="search" size={36} /></div>
      没有找到匹配的作品，换个关键词试试吧
    </div>
  );
}

/** 首屏加载中：避免"空库"与"正在读盘"混为一谈 */
export function WorksLoadingState() {
  return (
    <div
      className="text-[var(--text-secondary)] flex flex-col items-center justify-center py-20 text-sm"
      role="status"
      aria-live="polite"
    >
      <Icon name="hourglass" size={32} />
      <span className="mt-3">正在加载作品列表…</span>
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
    <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
      <Icon name="alert" size={36} />
      <h2 className="text-[var(--text-primary)] text-base font-semibold mt-3">
        作品列表加载失败
      </h2>
      <p className="text-[var(--danger)] text-xs mt-2 max-w-md break-all">
        {message}
      </p>
      <button
        onClick={onRetry}
        className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] mt-5 px-4 py-2 text-sm rounded-lg"
      >
        <span className="inline-flex items-center gap-1"><Icon name="refresh" size={14} /> 重新加载</span>
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
    <div className="anke-card flex items-center gap-4 px-4 py-3">
      <Icon name="bookText" size={24} />
      <div className="flex-1 min-w-0">
        <div className="text-[var(--text-primary)] text-sm font-semibold truncate">
          {work.title}
        </div>
      </div>
      <button
        onClick={onRestore}
        className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-3 py-1.5 text-xs rounded-lg transition-colors"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent)';
          e.currentTarget.style.color = 'var(--text-on-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent-bg)';
          e.currentTarget.style.color = 'var(--accent)';
        }}
      >
        还原
      </button>
      <button
        onClick={onPermanentDelete}
        className="bg-[var(--danger-soft)] text-[var(--danger)] px-3 py-1.5 text-xs rounded-lg transition-colors"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--danger)';
          e.currentTarget.style.color = 'var(--text-on-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--danger-soft)';
          e.currentTarget.style.color = 'var(--danger)';
        }}
      >
        彻底删除
      </button>
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
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-[var(--text-primary)] text-lg font-semibold inline-flex items-center gap-2">
          <Icon name="trash" size={16} /><span>回收站</span>
        </h2>
        <span className="text-[var(--text-secondary)] text-sm">{totalCount} 个作品</span>
        {totalCount > 0 && (
          <button
            onClick={onClearTrash}
            className="bg-[var(--danger-soft)] text-[var(--danger)] ml-auto px-3 py-1.5 text-xs rounded-lg transition-colors"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--danger)';
              e.currentTarget.style.color = 'var(--text-on-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--danger-soft)';
              e.currentTarget.style.color = 'var(--danger)';
            }}
          >
            清空回收站
          </button>
        )}
      </div>
      {totalCount === 0 ? (
        <div className="text-[var(--text-secondary)] text-center py-16 text-sm">回收站为空</div>
      ) : (
        <div className="space-y-3">
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
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5"
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {works.map((work) => (
        <div
          key={work.id}
          className="relative rounded-[var(--radius-xl)]"
          style={{
            transform: dragOverId === work.id ? 'translateY(-4px) scale(1.02)' : undefined,
            transition: 'transform 150ms ease',
            opacity: dragId === work.id ? 0.6 : 1,
            boxShadow: dragOverId === work.id ? '0 0 0 2px var(--accent)' : undefined,
          }}
        >
          {batchMode && (
            <div
              className="absolute top-2 left-2 z-30"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(work.id);
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(work.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleSelect(work.id);
                }}
                aria-label={`选择作品 ${work.title}`}
                style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent)' }}
              />
            </div>
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
      ))}
    </div>
  );
}
