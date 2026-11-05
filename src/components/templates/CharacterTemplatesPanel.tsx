import { useState, useEffect, useRef } from 'react';
import { useMetaStore } from '../../store/metaStore';
import { useToastStore } from '../../store/toastStore';
import { useSettingStore } from '../../store/settingStore';
import type { CharacterTemplate } from '../../types';
import { AttributeTable } from '../character/AttributeTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { InputDialog } from '../common/InputDialog';
import { UploadProgressDialog } from '../common/UploadProgressDialog';
import { Icon } from '../common/Icon';
import {
  uploadImagesWithProgress,
  ensureLocalWarning,
  type UploadProgressEvent,
} from '../../utils/uploadImage';
import { addImageLibraryItem, ensureCharacterFolder } from '../../db/imageLibrary';
import { EmptyHint, parseBatchEntries } from './shared';

// ============================================================
// 人物模板
// ============================================================

export function CharacterTemplatesPanel({ onSelectionChange }: { onSelectionChange?: (ids: string[]) => void } = {}) {
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
        <div className="text-[var(--text-secondary)] text-sm flex items-center gap-3">
          <span>共 {templates.length} 个人物模板</span>
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
                const names = templates.filter((t) => selectedIds.includes(t.id)).map((t) => t.name);
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

      <div className="flex items-center gap-3" style={{ paddingLeft: isDraggable ? 48 : 24 }}>
        <div
          className="bg-[var(--bg-hover)] w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
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
            <div className="text-[var(--text-secondary)] w-full h-full flex items-center justify-center text-sm">
              {(template.name || '?').slice(0, 1)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[var(--text-primary)] font-medium truncate">
              {template.name}
            </div>
          </div>
          <div className="text-[var(--text-secondary)] text-xs truncate">
            {template.personality || '（无性格描述）'}
          </div>
        </div>
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
    // attributes 允许 number，UI 统一按 string 编辑
    setLiveAttributes(
      Object.fromEntries(
        Object.entries(template.attributes || {}).map(([k, v]) => [k, String(v)]),
      ),
    );
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
    <div className="bg-[var(--bg-overlay)] fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="bg-[var(--bg-base)] text-[var(--text-primary)] border border-[color:var(--border-color)] w-[90%] max-w-[720px] max-h-[90vh] overflow-y-auto rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="border-b border-b-[color:var(--border-color)] flex items-center justify-between px-4 py-2"
        >
          <div className="flex items-center gap-3">
            <div className="text-[var(--text-primary)] text-sm font-semibold inline-flex items-center gap-1.5"><Icon name="pen" size={14} /> 编辑人物模板</div>
          </div>
          <button aria-label="关闭"
            onClick={onClose}
            className="text-sm transition-colors"
            style={{ color: labelColor }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = labelColor)}
            title="关闭"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1">
          <div className="flex gap-4 items-start">
            <div className="flex flex-col items-center gap-2">
              <div
                className="bg-[var(--bg-sidebar)] border border-[color:var(--border-color)] w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-5xl"
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
                  <span className="text-[var(--text-secondary)] flex items-center justify-center">{name?.slice(0, 1) || <Icon name="user" size={36} />}</span>
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
                className="bg-[var(--bg-sidebar)] text-[var(--text-primary)] border border-[color:var(--border-color)] text-[10px] px-2 py-0.5 rounded"
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
                  className="bg-[var(--bg-sidebar)] text-[var(--text-primary)] border border-[color:var(--border-color)] text-[10px] px-2 py-0.5 rounded"
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
                  <span className="inline-flex items-center gap-1"><Icon name="folder" size={13} /> 批量上传</span>
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
                  className="border-[color:var(--border-color)] bg-[var(--bg-sidebar)] flex items-center gap-2 px-2 py-1.5 rounded border"
                >
                  <div
                    className="bg-[var(--bg-base)] border border-[color:var(--border-color)] w-10 h-10 rounded shrink-0 relative overflow-hidden"
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
                      className="text-[var(--text-muted)] img-fallback absolute inset-0 hidden items-center justify-center text-xs font-semibold"
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
                    className="bg-[var(--bg-base)] text-[var(--text-secondary)] border border-[color:var(--border-color)] text-xs px-1.5 py-0.5 rounded disabled:opacity-30"
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveVariant(idx, 1)}
                    disabled={idx === variants.length - 1}
                    className="bg-[var(--bg-base)] text-[var(--text-secondary)] border border-[color:var(--border-color)] text-xs px-1.5 py-0.5 rounded disabled:opacity-30"
                    title="下移"
                  >
                    ↓
                  </button>
                  <button aria-label="删除"
                    onClick={() => deleteVariant(idx)}
                    className="bg-[var(--danger-soft)] text-[var(--danger)] text-xs px-1.5 py-0.5 rounded"
                    title="删除"
                  >
                    <Icon name="x" size={13} />
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
                <span className="inline-flex items-center gap-1"><Icon name="folder" size={13} /> 上传</span>
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
                className="bg-[var(--success)] text-[var(--text-on-accent)] text-xs px-2 py-1 rounded whitespace-nowrap disabled:opacity-40"
              >
                + 添加
              </button>
            </div>
          </div>
        </div>

        <div
          className="border-t border-t-[color:var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between px-4 py-3"
        >
          <button
            onClick={() => setPendingDeleteTemplate(true)}
            className="bg-[var(--danger-soft)] text-[var(--danger)] text-xs px-2 py-1 rounded transition-colors"
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
              className="bg-[var(--bg-sidebar)] text-[var(--text-primary)] border border-[color:var(--border-color)] text-xs px-3 py-1 rounded transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-sidebar)')}
            >
              取消
            </button>
            <button
              onClick={save}
              className="bg-[var(--success)] text-[var(--text-on-accent)] text-xs px-3 py-1 rounded transition-colors"
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
