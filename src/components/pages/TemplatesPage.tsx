import { useEffect, useState, useRef } from 'react';
import { useMetaStore } from '../../store/metaStore';
import { useStoryStore } from '../../store/storyStore';
import type {
  WorldSettingTemplate,
  CharacterTemplate,
} from '../../types';
import { AttributeTable } from '../character/AttributeTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { InputDialog } from '../common/InputDialog';
import { UploadProgressDialog } from '../common/UploadProgressDialog';
import { useToastStore } from '../../store/toastStore';
import { useSettingStore } from '../../store/settingStore';
import { uploadImagesWithProgress, ensureLocalWarning, type UploadProgressEvent } from '../../utils/uploadImage';
import { addImageLibraryItem, ensureCharacterFolder } from '../../db/imageLibrary';

interface TemplatesPanelProps {
  onShowAuthor?: () => void;
  initialTab?: TabKey;
  /** 子 Tab 切换回调（让外层记住用户选择，切走再切回不重置）（#3） */
  onTabChange?: (tab: TabKey) => void;
}

type TabKey = 'world' | 'character';

/**
 * 模板面板：两个 Tab（世界观 / 人物），CRUD + 复制为草稿。
 * 嵌入 ResourceLibraryPage 使用；initialTab 控制初始展示的子 Tab。
 */
export function TemplatesPanel({ onShowAuthor, initialTab = 'world', onTabChange }: TemplatesPanelProps) {
  const loadTemplates = useMetaStore((s) => s.loadTemplates);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // 两个 Tab 各自的选中 ID（用于导出模板功能）
  const [worldSelectedIds, setWorldSelectedIds] = useState<string[]>([]);
  const [characterSelectedIds, setCharacterSelectedIds] = useState<string[]>([]);

  // 切换子 Tab 时同步通知外层（#3）
  const handleTabChange = (next: TabKey) => {
    setTab(next);
    onTabChange?.(next);
  };

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // 导出选中的模板为 JSON 文件
  const handleExport = () => {
    const { worldSettingTemplates, characterTemplates } = useMetaStore.getState();
    const filteredWorld = worldSettingTemplates.filter((t) => worldSelectedIds.includes(t.id));
    const filteredChar = characterTemplates.filter((t) => characterSelectedIds.includes(t.id));
    if (filteredWorld.length === 0 && filteredChar.length === 0) {
      useToastStore.getState().showToast(
        '请先勾选需要导出的模板（点击列表前的复选框）',
        'warning',
      );
      return;
    }
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      worldSettingTemplates: filteredWorld,
      characterTemplates: filteredChar,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anke-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    useToastStore.getState().showToast(
      `已导出 ${filteredWorld.length} 个世界观模板、${filteredChar.length} 个人物模板`,
      'success',
    );
  };

  // 触发导入文件选择
  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  // 读取并导入模板 JSON
  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object') {
        useToastStore.getState().showToast('文件格式不正确', 'error');
        return;
      }
      const result = await useMetaStore.getState().importTemplates(data);
      useToastStore.getState().showToast(
        `已导入 ${result.worldCount} 个世界观模板、${result.charCount} 个人物模板${result.failed > 0 ? `（失败 ${result.failed} 个）` : ''}`,
        result.failed > 0 ? 'warning' : 'success',
      );
    } catch (err) {
      useToastStore.getState().showToast(
        `导入失败：${(err as Error).message || '文件解析错误'}`,
        'error',
      );
    }
  };

  return (
    <div className="min-h-full w-full flex flex-col" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header
        className="flex items-center justify-between px-6 py-3"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center gap-3">
          {onShowAuthor && (
            <button
              onClick={onShowAuthor}
              className="text-xs transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              关于作者
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            独立于具体作品，可被任意作品引用
          </div>
          <button
            onClick={handleExport}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            title="先勾选模板，再点击导出"
          >
            📥 导出模板
          </button>
          <button
            onClick={handleImportClick}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            title="从 JSON 文件导入模板"
          >
            📤 导入模板
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </header>

      <div
        className="flex items-center gap-1 px-6 py-2"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <TabBtn label="🌐 世界观模板" active={tab === 'world'} onClick={() => handleTabChange('world')} />
        <TabBtn label="🧑 人物模板" active={tab === 'character'} onClick={() => handleTabChange('character')} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'world' ? (
          <WorldTemplatesPanel onSelectionChange={setWorldSelectedIds} />
        ) : (
          <CharacterTemplatesPanel onSelectionChange={setCharacterSelectedIds} />
        )}
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-1.5 text-sm rounded-md transition-all"
      style={{
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

// ============================================================
// 世界观模板
// ============================================================

function WorldTemplatesPanel({ onSelectionChange }: { onSelectionChange?: (ids: string[]) => void } = {}) {
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
        <div className="text-sm flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
          <span>共 {templates.length} 条世界观模板</span>
          {selectedIds.length > 0 && (
            <span style={{ color: 'var(--accent)' }}>已选 {selectedIds.length} 项</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="px-3 py-1.5 text-sm rounded-md transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
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
              className="px-3 py-1.5 text-sm rounded-md transition-colors"
              style={{
                background: 'var(--danger, #d33)',
                color: '#fff',
                border: '1px solid var(--danger, #d33)',
              }}
            >
              批量删除 ({selectedIds.length})
            </button>
          )}
          <button
            onClick={handleCreate}
            className="px-4 py-1.5 text-sm rounded-md transition-colors"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
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
        style={{ position: 'absolute', top: 8, left: 8, cursor: 'pointer', lineHeight: 0 }}
        title="勾选以加入批量删除"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange(e.target.checked)}
          onDragStart={(e) => e.preventDefault()}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
      </label>
      {/* 拖动 handle */}
      {isDraggable && (
        <span
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 8,
            left: 28,
            cursor: 'grab',
            color: 'var(--text-secondary)',
            fontSize: 12,
            userSelect: 'none',
          }}
          title="按住拖动以重排序"
        >
          ⋮⋮
        </span>
      )}

      <div className="flex items-center gap-2 pr-2" style={{ paddingLeft: isDraggable ? 48 : 24 }}>
        <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {template.title}
        </div>
      </div>
      <div className="mt-1.5 text-xs line-clamp-3" style={{ color: 'var(--text-secondary)' }}>
        {(template.content || '').replace(/<[^>]+>/g, '').slice(0, 120) || '（无内容）'}
      </div>
      <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        更新于 {new Date(template.updated_at).toLocaleString()}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onEdit}
          className="text-xs px-2.5 py-1 rounded-md transition-colors"
          style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
        >
          编辑
        </button>
        <button
          onClick={onDelete}
          className="text-xs px-2.5 py-1 rounded-md transition-colors"
          style={{ background: 'transparent', color: 'var(--text-secondary)' }}
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
          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>标题</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
          />
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>内容（纯文本）</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 text-sm rounded-md outline-none resize-y"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-md" style={{ color: 'var(--text-primary)' }}>取消</button>
          <button
            onClick={() => onSave({ title: title.trim() || '未命名模板', content })}
            className="px-4 py-1.5 text-sm rounded-md"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// 人物模板
// ============================================================

function CharacterTemplatesPanel({ onSelectionChange }: { onSelectionChange?: (ids: string[]) => void } = {}) {
  const templates = useMetaStore((s) => s.characterTemplates);
  const create = useMetaStore((s) => s.createCharacterTemplate);
  const update = useMetaStore((s) => s.updateCharacterTemplate);
  const remove = useMetaStore((s) => s.deleteCharacterTemplate);
  const batchRemove = useMetaStore((s) => s.batchDeleteCharacterTemplates);
  const reorder = useMetaStore((s) => s.reorderCharacterTemplates);

  const [editing, setEditing] = useState<CharacterTemplate | null>(null);
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
    const id = await create({ name: '新人物模板' });
    const t = useMetaStore.getState().characterTemplates.find((x) => x.id === id);
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
        <div className="text-sm flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
          <span>共 {templates.length} 个人物模板</span>
          {selectedIds.length > 0 && (
            <span style={{ color: 'var(--accent)' }}>已选 {selectedIds.length} 项</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="px-3 py-1.5 text-sm rounded-md transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
            >
              {allSelectableSelected ? '取消全选' : '全选'}
            </button>
          )}
          {selectedIds.length > 0 && (
            <button
              onClick={() => {
                const names = templates.filter((t) => selectedIds.includes(t.id)).map((t) => t.name);
                setPendingBatchDelete({ ids: [...selectedIds], names });
              }}
              className="px-3 py-1.5 text-sm rounded-md transition-colors"
              style={{
                background: 'var(--danger, #d33)',
                color: '#fff',
                border: '1px solid var(--danger, #d33)',
              }}
            >
              批量删除 ({selectedIds.length})
            </button>
          )}
          <button
            onClick={handleCreate}
            className="px-4 py-1.5 text-sm rounded-md transition-colors"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
          >
            + 新建模板
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyHint
          title="还没有人物模板"
          desc="点击「新建模板」创建，模板可被任意作品导入为新角色。"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <CharacterTemplateCard
              key={t.id}
              template={t}
              selected={selectedIds.includes(t.id)}
              isDragOver={dragOverId === t.id && dragId !== t.id}
              onSelectChange={(sel) => toggleSelect(t.id, sel)}
              onEdit={() => setEditing(t)}
              onDelete={() => {
                setPendingDelete({ id: t.id, name: t.name });
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
        <CharacterTemplateEditor
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

function CharacterTemplateCard({
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
  template: CharacterTemplate;
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
        style={{ position: 'absolute', top: 8, left: 8, cursor: 'pointer', lineHeight: 0 }}
        title="勾选以加入批量删除"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange(e.target.checked)}
          onDragStart={(e) => e.preventDefault()}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
      </label>
      {/* 拖动 handle */}
      {isDraggable && (
        <span
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 8,
            left: 28,
            cursor: 'grab',
            color: 'var(--text-secondary)',
            fontSize: 12,
            userSelect: 'none',
          }}
          title="按住拖动以重排序"
        >
          ⋮⋮
        </span>
      )}

      <div className="flex items-center gap-3" style={{ paddingLeft: isDraggable ? 48 : 24 }}>
        <div
          className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
          style={{ background: 'var(--bg-hover)' }}
        >
          {template.avatar ? (
            <img
              src={template.avatar}
              className="w-full h-full object-cover"
              alt=""
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              {(template.name || '?').slice(0, 1)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {template.name}
            </div>
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {template.personality || '（无性格描述）'}
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        更新于 {new Date(template.updated_at).toLocaleString()}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onEdit}
          className="text-xs px-2.5 py-1 rounded-md transition-colors"
          style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
        >
          编辑
        </button>
        <button
          onClick={onDelete}
          className="text-xs px-2.5 py-1 rounded-md transition-colors"
          style={{ background: 'transparent', color: 'var(--text-secondary)' }}
        >
          删除
        </button>
      </div>
    </div>
  );
}

function CharacterTemplateEditor({
  template,
  onClose,
  onSave,
}: {
  template: CharacterTemplate;
  onClose: () => void;
  onSave: (patch: Partial<Pick<CharacterTemplate, 'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'variants'>>) => void;
}) {
  const [name, setName] = useState(template.name);
  const [avatar, setAvatar] = useState(template.avatar || '');
  const [personality, setPersonality] = useState(template.personality || '');
  const [notes, setNotes] = useState(template.notes || '');
  /**
   * 实时维护模板的属性（用户在 AttributeTable 里编辑时同步更新，save 时使用）。
   * 不再与外部 attrTypes state 同步，根除属性失焦 bug（参考 2026-06-17 失焦修复）。
   */
  const [liveAttributes, setLiveAttributes] = useState<Record<string, string>>(
    () => {
      // 兼容历史 number 值：统一转为 string
      const raw = template.attributes || {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) out[k] = String(v);
      return out;
    },
  );

  const [variants, setVariants] = useState<{ id?: string; name: string; url: string }[]>(
    (template.variants || []).map((v) => ({ id: v.id, name: v.name, url: v.url }))
  );
  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantUrl, setNewVariantUrl] = useState('');
  const newVariantFileRef = useRef<HTMLInputElement | null>(null);
  const batchUploadRef = useRef<HTMLInputElement | null>(null);
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<number | null>(null);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState(false);
  const [batchAttrOpen, setBatchAttrOpen] = useState(false);
  const [batchVariantOpen, setBatchVariantOpen] = useState(false);

  // 订阅本地上传总开关：关闭时把上传按钮置灰
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const localUploadDisabledReason = '本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传';
  const isLocalUploadDisabled = !localUploadEnabled;

  // 上传进度弹窗状态
  const [uploadTasks, setUploadTasks] = useState<UploadProgressEvent[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  useEffect(() => {
    setName(template.name);
    setAvatar(template.avatar || '');
    setPersonality(template.personality || '');
    setNotes(template.notes || '');
    setLiveAttributes(template.attributes || {});
    setVariants((template.variants || []).map((v) => ({ id: v.id, name: v.name, url: v.url })));
  }, [template.id]);

  const handleAddVariant = () => {
    const url = newVariantUrl.trim();
    if (!url) return;
    const vname = newVariantName.trim() || `差分 ${variants.length + 1}`;
    setVariants([...variants, { name: vname, url }]);
    setNewVariantName('');
    setNewVariantUrl('');
  };

  const handleVariantFile = async (file: File) => {
    // 检查本地上传总开关（默认关闭）
    if (!useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告（统一由全局 store 管理）
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks([
      {
        taskId: `${Date.now()}_0`,
        fileName: file.name || 'variant',
        status: 'pending',
        progress: 0,
      },
    ]);
    setUploadDialogOpen(true);
    const [res] = await uploadImagesWithProgress([file], (e) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
      );
    });
    if (res.ok && res.url) {
      setNewVariantUrl(res.url);
      // 默认差分名 = 图片文件名（去后缀）（#12，与 CharacterEditor 行为一致）
      const defaultName = file.name.replace(/\.[^.]+$/, '');
      if (defaultName) setNewVariantName(defaultName);
      useToastStore.getState().showToast('差分图片就绪', 'success');
      // 入库到图片库人物文件夹（失败不影响编辑器正常使用）
      try {
        const folderId = await ensureCharacterFolder();
        await addImageLibraryItem({ folderId, url: res.url, filename: file.name, source: 'local' });
      } catch {}
    } else {
      useToastStore
        .getState()
        .showToast(
          `${res.error || '图片上传失败'}，请检查网络后重新选择`,
          'error',
        );
    }
  };

  /**
   * 批量上传多张图片，差分名默认取文件名（去扩展名），最多 50 张
   */
  const handleBatchUploadVariants = async (files: FileList) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (list.length > 50) {
      useToastStore.getState().showToast('批量上传最多 50 张图片', 'warning');
    }
    const accepted = list.slice(0, 50);
    // 检查本地上传总开关（默认关闭）
    if (!useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks(
      accepted.map((f, i) => ({
        taskId: `${Date.now()}_${i}`,
        fileName: f.name || `image_${i}`,
        status: 'pending',
        progress: 0,
      })),
    );
    setUploadDialogOpen(true);
    const results = await uploadImagesWithProgress(accepted, (e) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
      );
    });
    const successes: { name: string; url: string }[] = [];
    const failures: { name: string; reason: string }[] = [];
    results.forEach((r, i) => {
      const fname = accepted[i]?.name || `image_${i}`;
      if (r.ok && r.url) {
        const dotIdx = fname.lastIndexOf('.');
        const name = dotIdx > 0 ? fname.slice(0, dotIdx) : fname;
        successes.push({ name, url: r.url });
        // 入库到图片库人物文件夹（失败不影响编辑器正常使用）
        const url = r.url;
        ensureCharacterFolder()
          .then((folderId) => addImageLibraryItem({ folderId, url, filename: fname, source: 'local' }))
          .catch(() => {});
      } else {
        failures.push({
          name: fname,
          reason: r.error || '上传失败',
        });
      }
    });
    if (successes.length > 0) {
      setVariants([...variants, ...successes]);
    }
    if (failures.length === 0) {
      useToastStore.getState().showToast(`已批量上传 ${successes.length} 张差分`, 'success');
    } else if (successes.length > 0) {
      useToastStore
        .getState()
        .showToast(`上传完成：成功 ${successes.length}，失败 ${failures.length}（${failures[0].name}: ${failures[0].reason}）`, 'warning');
    } else {
      useToastStore.getState().showToast(`批量上传失败：${failures[0].reason}`, 'error');
    }
  };

  const updateVariant = (index: number, updates: { name?: string; url?: string }) => {
    const next = [...variants];
    next[index] = { ...next[index], ...updates };
    setVariants(next);
  };

  const deleteVariant = (index: number) => {
    setPendingDeleteVariant(index);
  };

  const moveVariant = (index: number, dir: -1 | 1) => {
    const list = [...variants];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    setVariants(list);
  };

  const handleAvatarFromFile = async (file: File) => {
    try {
      const results = await uploadImagesWithProgress([file], () => {});
      if (results[0]?.ok && results[0].url) {
        setAvatar(results[0].url);
        // 入库到图片库人物文件夹（失败不影响编辑器正常使用）
        try {
          const folderId = await ensureCharacterFolder();
          await addImageLibraryItem({ folderId, url: results[0].url, filename: file.name, source: 'local' });
        } catch {}
      } else {
        useToastStore.getState().showToast(results[0]?.error || '头像上传失败', 'error');
      }
    } catch (e) {
      useToastStore.getState().showToast((e as Error).message || '头像上传失败', 'error');
    }
  };

  const handleAttrChange = (next: Record<string, string>) => {
    setLiveAttributes(next);
  };

  /** 批量添加属性：解析"key:value"多行/逗号分隔输入，合并到 liveAttributes（统一存为 string） */
  const handleBatchAddAttributes = (text: string) => {
    const entries = parseBatchEntries(text);
    if (entries.length === 0) {
      useToastStore.getState().showToast('没有解析到有效属性', 'warning');
      setBatchAttrOpen(false);
      return;
    }
    const merged: Record<string, string> = { ...liveAttributes };
    for (const { key, value } of entries) {
      merged[key] = value;  // 统一存为 string（不再做 number 转换）
    }
    setLiveAttributes(merged);
    useToastStore.getState().showToast(`已批量添加 ${entries.length} 条属性`, 'success');
    setBatchAttrOpen(false);
  };

  /** 批量添加差分：解析"差分名:图片URL"多行输入 */
  const handleBatchAddVariants = (text: string) => {
    const entries = parseBatchEntries(text);
    if (entries.length === 0) {
      useToastStore.getState().showToast('没有解析到有效差分', 'warning');
      setBatchVariantOpen(false);
      return;
    }
    const urlRe = /^https?:\/\//i;
    const accepted: { name: string; url: string }[] = [];
    const skipped: string[] = [];
    for (const { key, value } of entries) {
      if (!urlRe.test(value)) {
        skipped.push(key);
        continue;
      }
      accepted.push({ name: key, url: value });
    }
    if (accepted.length > 0) {
      setVariants([...variants, ...accepted]);
      useToastStore.getState().showToast(`已批量添加 ${accepted.length} 条差分`, 'success');
    }
    if (skipped.length > 0) {
      const preview = skipped.slice(0, 3).join('、');
      const more = skipped.length > 3 ? ` 等 ${skipped.length} 条` : '';
      useToastStore
        .getState()
        .showToast(`已跳过 ${preview}${more}（URL 必须以 http:// 或 https:// 开头）`, 'warning');
    }
    setBatchVariantOpen(false);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      useToastStore.getState().showToast('姓名不能为空', 'error');
      return;
    }
    onSave({
      name: trimmed,
      avatar: avatar.trim(),
      personality,
      notes,
      attributes: liveAttributes,
      variants: variants.map((v, idx) => ({
        id: v.id || crypto.randomUUID(),
        name: v.name,
        url: v.url,
        character_id: template.id,
        order_index: idx,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
    });
  };

  const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' } as React.CSSProperties;
  const labelColor = 'var(--text-secondary)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--bg-overlay)' }}>
      <div
        className="w-[90%] max-w-[720px] max-h-[90vh] overflow-y-auto rounded-lg shadow-2xl flex flex-col"
        style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>✎ 编辑人物模板</div>
          </div>
          <button
            onClick={onClose}
            className="text-sm transition-colors"
            style={{ color: labelColor }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = labelColor)}
            title="关闭"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1">
          <div className="flex gap-4 items-start">
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-5xl"
                style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)' }}
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt="avatar"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span style={{ color: 'var(--text-secondary)' }}>{name?.slice(0, 1) || '👤'}</span>
                )}
              </div>

              <label
                className="text-xs px-2 py-1 rounded cursor-pointer transition-colors"
                style={{
                  background: 'var(--bg-sidebar)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  opacity: isLocalUploadDisabled ? 0.45 : 1,
                  cursor: isLocalUploadDisabled ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (isLocalUploadDisabled) return;
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-sidebar)';
                }}
                onClick={(e) => {
                  if (isLocalUploadDisabled) {
                    e.preventDefault();
                    useToastStore.getState().showToast(localUploadDisabledReason, 'error');
                  }
                }}
                title={isLocalUploadDisabled ? localUploadDisabledReason : ''}
              >
                上传图片
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isLocalUploadDisabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleAvatarFromFile(file);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <input
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="或填写图片URL/路径"
                className="w-40 text-[10px] border rounded px-2 py-1 outline-none"
                style={inputStyle}
              />
              {avatar && (
                <button
                  onClick={() => setAvatar('')}
                  className="text-[10px] transition-colors"
                  style={{ color: labelColor }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = labelColor)}
                >
                  清除头像
                </button>
              )}
            </div>

            <div className="flex-1 space-y-2">
              <div>
                <label className="text-xs block mb-1" style={{ color: labelColor }}>姓名 *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="角色姓名"
                  className="w-full border rounded px-2 py-1.5 outline-none text-sm"
                  style={{ ...inputStyle, outline: 'none' }}
                />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: labelColor }}>性格描述</label>
                <textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="例如：开朗活泼、内心坚强、说话直率..."
                  rows={4}
                  className="w-full border rounded px-2 py-1.5 outline-none text-sm resize-y"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: labelColor }}>备注（可选）</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="其他备注信息..."
                  rows={2}
                  className="w-full border rounded px-2 py-1.5 outline-none text-sm resize-y"
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs" style={{ color: labelColor }}>属性表</label>
              <button
                onClick={() => setBatchAttrOpen(true)}
                className="text-[10px] px-2 py-0.5 rounded"
                style={{ background: 'var(--bg-sidebar)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                title="批量添加属性，每行格式：属性名:属性值"
              >
                批量添加
              </button>
            </div>
            <AttributeTable
              attributes={liveAttributes}
              onChange={handleAttrChange}
            />
          </div>

          {/* 差分管理 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs" style={{ color: labelColor }}>
                人物差分（表情/姿势/服饰等图片变体）
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: labelColor }}>
                  共 {variants.length} 个
                </span>
                <button
                  onClick={() => setBatchVariantOpen(true)}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ background: 'var(--bg-sidebar)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                  title="批量添加差分，每行格式：差分名:图片URL"
                >
                  批量添加
                </button>
                <button
                  onClick={() => {
                    if (isLocalUploadDisabled) {
                      useToastStore.getState().showToast(localUploadDisabledReason, 'error');
                      return;
                    }
                    batchUploadRef.current?.click();
                  }}
                  disabled={isLocalUploadDisabled}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{
                    background: 'var(--bg-sidebar)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    opacity: isLocalUploadDisabled ? 0.45 : 1,
                    cursor: isLocalUploadDisabled ? 'not-allowed' : 'pointer',
                  }}
                  title={isLocalUploadDisabled ? localUploadDisabledReason : '从本机选择多张图片批量上传到 sm.ms，差分名取文件名'}
                >
                  📂 批量上传
                </button>
                <input
                  ref={batchUploadRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleBatchUploadVariants(e.target.files);
                    }
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            {/* 现有差分列表 */}
            <div className="space-y-1 mb-2">
              {variants.map((v, idx) => (
                <div
                  key={v.id || `new_${idx}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}
                >
                  <div
                    className="w-10 h-10 rounded shrink-0 relative overflow-hidden"
                    style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}
                  >
                    <img
                      src={v.url}
                      alt={v.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        img.style.display = 'none';
                        const fallback = img.parentElement?.querySelector('.img-fallback') as HTMLElement | null;
                        if (fallback) fallback.style.display = 'flex';
                        console.warn('[VariantImage] 加载失败:', v.url);
                      }}
                    />
                    <div
                      className="img-fallback absolute inset-0 hidden items-center justify-center text-xs font-semibold"
                      style={{ color: 'var(--text-muted, #999)' }}
                    >
                      {(v.name || '?').charAt(0)}
                    </div>
                  </div>
                  <input
                    value={v.name}
                    onChange={(e) => updateVariant(idx, { name: e.target.value })}
                    placeholder="差分名称"
                    className="flex-1 border rounded px-2 py-1 outline-none text-xs"
                    style={inputStyle}
                  />
                  <input
                    value={v.url}
                    onChange={(e) => updateVariant(idx, { url: e.target.value })}
                    placeholder="图片 URL"
                    className="flex-1 border rounded px-2 py-1 outline-none text-xs"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => moveVariant(idx, -1)}
                    disabled={idx === 0}
                    className="text-xs px-1.5 py-0.5 rounded disabled:opacity-30"
                    style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveVariant(idx, 1)}
                    disabled={idx === variants.length - 1}
                    className="text-xs px-1.5 py-0.5 rounded disabled:opacity-30"
                    style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                    title="下移"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => deleteVariant(idx)}
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {variants.length === 0 && (
                <div
                  className="text-[10px] italic text-center py-2"
                  style={{ color: labelColor }}
                >
                  暂无差分，下方添加
                </div>
              )}
            </div>

            {/* 添加新差分 */}
            <div className="flex items-center gap-2">
              <input
                value={newVariantName}
                onChange={(e) => setNewVariantName(e.target.value)}
                placeholder="差分名称（可空）"
                className="w-32 border rounded px-2 py-1 outline-none text-xs"
                style={inputStyle}
              />
              <input
                value={newVariantUrl}
                onChange={(e) => setNewVariantUrl(e.target.value)}
                placeholder="图片 URL 或点击右侧上传"
                className="flex-1 border rounded px-2 py-1 outline-none text-xs"
                style={inputStyle}
              />
              <button
                onClick={() => {
                  if (isLocalUploadDisabled) {
                    useToastStore.getState().showToast(localUploadDisabledReason, 'error');
                    return;
                  }
                  newVariantFileRef.current?.click();
                }}
                disabled={isLocalUploadDisabled}
                className="text-xs px-2 py-1 rounded whitespace-nowrap"
                style={{
                  background: 'var(--bg-sidebar)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  opacity: isLocalUploadDisabled ? 0.45 : 1,
                  cursor: isLocalUploadDisabled ? 'not-allowed' : 'pointer',
                }}
                title={isLocalUploadDisabled ? localUploadDisabledReason : '从本地上传'}
              >
                📁 上传
              </button>
              <input
                ref={newVariantFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleVariantFile(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={handleAddVariant}
                disabled={!newVariantUrl.trim()}
                className="text-xs px-2 py-1 rounded whitespace-nowrap disabled:opacity-40"
                style={{ background: 'var(--success)', color: 'var(--text-on-accent)' }}
              >
                + 添加
              </button>
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-sidebar)' }}
        >
          <button
            onClick={() => setPendingDeleteTemplate(true)}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--danger)';
              e.currentTarget.style.color = 'var(--text-on-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--danger-soft)';
              e.currentTarget.style.color = 'var(--danger)';
            }}
          >
            删除此模板
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1 rounded transition-colors"
              style={{ background: 'var(--bg-sidebar)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-sidebar)')}
            >
              取消
            </button>
            <button
              onClick={save}
              className="text-xs px-3 py-1 rounded transition-colors"
              style={{ background: 'var(--success)', color: 'var(--text-on-accent)' }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              保存
            </button>
          </div>
        </div>
      </div>

      {pendingDeleteVariant !== null && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除差分"${variants[pendingDeleteVariant].name}"？`}
          danger
          onConfirm={() => {
            setVariants(variants.filter((_, i) => i !== pendingDeleteVariant));
            setPendingDeleteVariant(null);
          }}
          onCancel={() => setPendingDeleteVariant(null)}
        />
      )}

      {pendingDeleteTemplate && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除模板"${template.name}"？此操作不可撤销。`}
          danger
          onConfirm={() => {
            useMetaStore.getState().deleteCharacterTemplate(template.id);
            useToastStore.getState().showToast('模板已删除', 'success');
            setPendingDeleteTemplate(false);
            onClose();
          }}
          onCancel={() => setPendingDeleteTemplate(false)}
        />
      )}

      <InputDialog
        open={batchAttrOpen}
        title="批量添加属性"
        placeholder={'每行一条，格式：属性名:属性值\n示例：\nHP:100\nMP:50\n好感度:80'}
        multiline
        rows={6}
        onConfirm={handleBatchAddAttributes}
        onCancel={() => setBatchAttrOpen(false)}
      />

      <InputDialog
        open={batchVariantOpen}
        title="批量添加差分"
        placeholder="每行一条，格式：差分名:图片URL&#10;示例：&#10;微笑:https://example.com/smile.png&#10;哭泣:https://example.com/cry.png"
        multiline
        rows={10}
        maxLength={10000}
        onConfirm={handleBatchAddVariants}
        onCancel={() => setBatchVariantOpen(false)}
      />

      {/* 上传进度弹窗 */}
      <UploadProgressDialog
        open={uploadDialogOpen}
        tasks={uploadTasks}
        onClose={() => setUploadDialogOpen(false)}
      />
    </div>
  );
}

/**
 * 解析 "key:value" 多行/逗号输入，返回 [{ key, value }, ...] 数组。
 * 用于"批量添加属性 / 差分"对话框。
 *  - 支持换行分隔与逗号分隔
 *  - 兼容空白
 *  - 自动忽略空行
 */
function parseBatchEntries(text: string): { key: string; value: string }[] {
  const result: { key: string; value: string }[] = [];
  if (!text) return result;
  // 先按行分割，每行再按逗号分割（兼容多行 + 单行逗号）
  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    for (const seg of trimmedLine.split(',')) {
      const segTrim = seg.trim();
      if (!segTrim) continue;
      // 第一个冒号分隔 key/value
      const colonIdx = segTrim.indexOf(':');
      if (colonIdx <= 0) continue;  // 必须有冒号且 key 非空
      const key = segTrim.slice(0, colonIdx).trim();
      const value = segTrim.slice(colonIdx + 1).trim();
      if (!key) continue;
      result.push({ key, value });
    }
  }
  return result;
}

// ============================================================
// 通用
// ============================================================

function EmptyHint({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      className="rounded-2xl p-12 text-center"
      style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-color)' }}
    >
      <div className="text-3xl mb-3">📦</div>
      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-xl w-full max-w-lg p-6"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md"
            style={{ color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
