import { useState, useEffect } from 'react';
import { useMetaStore } from '../../store/metaStore';
import { useToastStore } from '../../store/toastStore';
import type { WorldSettingTemplate } from '../../types';
import { Icon } from '../common/Icon';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyHint, Modal } from './shared';

// ============================================================
// 世界观模板
// ============================================================

export function WorldTemplatesPanel({ onSelectionChange }: { onSelectionChange?: (ids: string[]) => void } = {}) {
  const templates = useMetaStore((s) => s.worldSettingTemplates);
  const create = useMetaStore((s) => s.createWorldSettingTemplate);
  const update = useMetaStore((s) => s.updateWorldSettingTemplate);
  const remove = useMetaStore((s) => s.deleteWorldSettingTemplate);
  const batchRemove = useMetaStore((s) => s.batchDeleteWorldSettingTemplates);
  const reorder = useMetaStore((s) => s.reorderWorldSettingTemplates);

  const [editing, setEditing] = useState<WorldSettingTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<{ ids: string[]; names: string[] } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 选中状态变化时通知父组件（用于导出模板功能）
  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  const allSelectableSelected = templates.length > 0 && templates.every((t) => selectedIds.includes(t.id));

  const toggleSelectAll = () => {
    if (allSelectableSelected) setSelectedIds([]);
    else setSelectedIds(templates.map((t) => t.id));
  };

  const toggleSelect = (id: string, sel: boolean) => {
    setSelectedIds((prev) => (sel ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };

  const handleBatchDelete = async () => {
    if (!pendingBatchDelete) return;
    const target = pendingBatchDelete;
    setPendingBatchDelete(null);
    try {
      const res = await batchRemove(target.ids);
      useToastStore.getState().showToast(`已删除 ${res.deleted} 个模板`, 'success');
      setSelectedIds((prev) => prev.filter((id) => !target.ids.includes(id)));
    } catch (err) {
      useToastStore.getState().showToast((err as Error).message, 'error');
    }
  };

  const handleCreate = async () => {
    const id = await create({ title: '新的世界观模板', content: '' });
    const t = useMetaStore.getState().worldSettingTemplates.find((x) => x.id === id);
    if (t) setEditing(t);
  };

  const handleDrop = (dropTargetId: string) => {
    if (!dragId || dragId === dropTargetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const ids = templates.map((t) => t.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(dropTargetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const next = ids.slice();
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragId);
    reorder(next);
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-[var(--text-secondary)] text-sm flex items-center gap-3">
          <span>共 {templates.length} 条世界观模板</span>
          {selectedIds.length > 0 && (
            <span className="text-[var(--accent)]">已选 {selectedIds.length} 项</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="bg-transparent text-[var(--text-secondary)] border border-[color:var(--border-color)] px-3 py-1.5 text-sm rounded-md transition-colors"
            >
              {allSelectableSelected ? '取消全选' : '全选'}
            </button>
          )}
          {selectedIds.length > 0 && (
            <button
              onClick={() => {
                const names = templates.filter((t) => selectedIds.includes(t.id)).map((t) => t.title);
                setPendingBatchDelete({ ids: [...selectedIds], names });
              }}
              className="bg-[var(--danger)] text-[var(--text-on-accent)] border border-[color:var(--danger)] px-3 py-1.5 text-sm rounded-md transition-colors"
            >
              批量删除 ({selectedIds.length})
            </button>
          )}
          <button
            onClick={handleCreate}
            className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            + 新建模板
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyHint
          title="还没有世界观模板"
          desc="点击「新建模板」开始创建，模板可以被任意作品引用。"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <WorldTemplateCard
              key={t.id}
              template={t}
              selected={selectedIds.includes(t.id)}
              isDragOver={dragOverId === t.id && dragId !== t.id}
              onSelectChange={(sel) => toggleSelect(t.id, sel)}
              onEdit={() => setEditing(t)}
              onDelete={() => {
                setPendingDelete({ id: t.id, name: t.title });
              }}
              onDragStart={() => setDragId(t.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragId && dragId !== t.id) setDragOverId(t.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOverId(null);
              }}
              onDrop={() => handleDrop(t.id)}
            />
          ))}
        </div>
      )}

      {editing && (
        <WorldTemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            update(editing.id, patch);
            setEditing(null);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除模板「${pendingDelete.name}」？此操作不可撤销。`}
          danger
          onConfirm={() => {
            remove(pendingDelete.id);
            useToastStore.getState().showToast('模板已删除', 'success');
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingBatchDelete && (
        <ConfirmDialog
          open={true}
          title="批量删除确认"
          message={`确定删除以下 ${pendingBatchDelete.ids.length} 个模板？${pendingBatchDelete.ids.length <= 5 ? `\n• ${pendingBatchDelete.names.join('\n• ')}` : ''}\n此操作不可撤销。`}
          danger
          onConfirm={handleBatchDelete}
          onCancel={() => setPendingBatchDelete(null)}
        />
      )}
    </div>
  );
}

function WorldTemplateCard({
  template,
  selected,
  isDragOver,
  onSelectChange,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  template: WorldSettingTemplate;
  selected: boolean;
  isDragOver?: boolean;
  onSelectChange: (sel: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
}) {
  const isDraggable = !!onDragStart;
  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? onDragStart : undefined}
      onDragOver={isDraggable ? onDragOver : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onDrop={isDraggable ? onDrop : undefined}
      className="rounded-xl p-4 transition-shadow hover:shadow-md relative"
      style={{
        background: selected ? 'var(--accent-bg)' : 'var(--bg-card)',
        border: `1px solid ${isDragOver ? 'var(--accent)' : selected ? 'var(--accent)' : 'var(--border-color)'}`,
        borderTopWidth: isDragOver ? 3 : 1,
        borderTopColor: isDragOver ? 'var(--accent)' : (selected ? 'var(--accent)' : 'var(--border-color)'),
        cursor: isDraggable ? 'grab' : undefined,
      }}
    >
      {/* 多选复选框（左上角） */}
      <label
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute top-[8px] left-[8px] cursor-pointer leading-[0]"
        title="勾选以加入批量删除"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange(e.target.checked)}
          onDragStart={(e) => e.preventDefault()}
          className="w-[16px] h-[16px] cursor-pointer"
        />
      </label>
      {/* 拖动 handle */}
      {isDraggable && (
        <span
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-[8px] left-[28px] cursor-grab text-[var(--text-secondary)] text-[12px] select-none"
          title="按住拖动以重排序"
        >
          ⋮⋮
        </span>
      )}

      <div className="flex items-center gap-2 pr-2" style={{ paddingLeft: isDraggable ? 48 : 24 }}>
        <div className="text-[var(--text-primary)] font-medium truncate">
          {template.title}
        </div>
      </div>
      <div className="text-[var(--text-secondary)] mt-1.5 text-xs line-clamp-3">
        {(template.content || '').replace(/<[^>]+>/g, '').slice(0, 120) || '（无内容）'}
      </div>
      <div className="text-[var(--text-muted)] mt-3 text-xs">
        更新于 {new Date(template.updated_at).toLocaleString()}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onEdit}
          className="bg-[var(--bg-hover)] text-[var(--text-primary)] text-xs px-2.5 py-1 rounded-md transition-colors"
        >
          编辑
        </button>
        <button
          onClick={onDelete}
          className="bg-transparent text-[var(--text-secondary)] text-xs px-2.5 py-1 rounded-md transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          删除
        </button>
      </div>
    </div>
  );
}

function WorldTemplateEditor({
  template,
  onClose,
  onSave,
}: {
  template: WorldSettingTemplate;
  onClose: () => void;
  onSave: (patch: { title: string; content: string }) => void;
}) {
  const [title, setTitle] = useState(template.title);
  const [content, setContent] = useState(template.content || '');
  return (
    <Modal title={`编辑模板：${template.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-[var(--text-secondary)] block text-xs mb-1">标题</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3 py-2 text-sm rounded-md outline-none"
          />
        </div>
        <div>
          <label className="text-[var(--text-secondary)] block text-xs mb-1">内容（纯文本）</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3 py-2 text-sm rounded-md outline-none resize-y"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-[var(--text-primary)] px-4 py-1.5 text-sm rounded-md">取消</button>
          <button
            onClick={() => onSave({ title: title.trim() || '未命名模板', content })}
            className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-4 py-1.5 text-sm rounded-md"
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
