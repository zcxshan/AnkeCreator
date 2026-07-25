import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Character } from '../../types';
import { useMetaStore } from '../../store/metaStore';
import { useStoryStore } from '../../store/storyStore';
import { CharacterCard } from './CharacterCard';
import { AttributeTable } from './AttributeTable';
import type { RichTextEditorCommands } from '../editor/RichTextEditor';
import { NGA_DEFAULT_IMAGE_SIZE } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { InputDialog } from '../common/InputDialog';
import { UploadProgressDialog } from '../common/UploadProgressDialog';
import { useToastStore } from '../../store/toastStore';
import { useSettingStore } from '../../store/settingStore';
import { uploadImagesWithProgress, ensureLocalWarning, type UploadProgressEvent } from '../../utils/uploadImage';
import { addImageLibraryItem, ensureCharacterFolder } from '../../db/imageLibrary';

export function CharacterPanel({
  richTextEditorCommandsRef,
}: {
  richTextEditorCommandsRef?: React.MutableRefObject<RichTextEditorCommands | null>;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const characters = useMetaStore((s) => s.characters);
  const createCharacter = useMetaStore((s) => s.createCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);
  const setEditingCharacter = useMetaStore((s) => s.setEditingCharacter);
  const editingCharacterId = useMetaStore((s) => s.editingCharacterId);
  const showEditor = useMetaStore((s) => s.showCharacterEditor);
  const toggleCharacterEditor = useMetaStore((s) => s.toggleCharacterEditor);
  const reorderCharacters = useMetaStore((s) => s.reorderCharacters);

  const editing = characters.find((c) => c.id === editingCharacterId) ?? null;
  const [pendingDeleteCharacter, setPendingDeleteCharacter] = useState<{ id: string; name: string } | null>(null);

  // 多选 + 拖动状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<{
    ids: string[];
    names: string[];
  } | null>(null);

  // 按 story 过滤 + order_index 排序（编辑中的项保留在列表，用 isActive 高亮）
  const filtered = activeStoryId
    ? characters
        .filter((c) => c.story_id === activeStoryId)
        .slice()
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    : [];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBatchDelete = async () => {
    if (!pendingBatchDelete) return;
    const target = pendingBatchDelete;
    setPendingBatchDelete(null);
    let deleted = 0;
    for (const id of target.ids) {
      await deleteCharacter(id);
      deleted++;
    }
    useToastStore.getState().showToast(`已批量删除 ${deleted} 个角色`, 'success');
    setSelectedIds(new Set());
  };

  const handleDrop = (dropTargetId: string) => {
    if (!dragId || !activeStoryId || dragId === dropTargetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const ids = filtered.map((c) => c.id);
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
    reorderCharacters(activeStoryId, next);
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>👤 人物角色</div>
        <div className="flex items-center gap-1">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                已选 {selectedIds.size}
              </span>
              <button
                onClick={() => {
                  const names = filtered
                    .filter((c) => selectedIds.has(c.id))
                    .map((c) => c.name);
                  setPendingBatchDelete({ ids: Array.from(selectedIds), names });
                }}
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'var(--danger)', color: '#fff' }}
                title="删除所选"
              >
                🗑 批量删除
              </button>
              <button
                onClick={clearSelection}
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              >
                取消
              </button>
            </>
          ) : (
            <>
              {filtered.length > 0 && (
                <button
                  onClick={selectAll}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                  title="全选"
                >
                  全选
                </button>
              )}
              <ImportCharacterTemplateButton />
              <button
                onClick={() => activeStoryId && createCharacter(activeStoryId)}
                disabled={!activeStoryId}
                className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--success)', color: 'var(--text-on-accent)' }}
              >
                + 新建角色
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!activeStoryId && (
          <div className="text-xs italic py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
            请先选择或创建一个故事
          </div>
        )}
        {activeStoryId && filtered.length === 0 && (
          <div className="text-xs italic py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
            暂无角色，点击右上角"新建角色"
          </div>
        )}

        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {filtered.map((ch) => (
            <CharacterCard
              key={ch.id}
              character={ch}
              isActive={ch.id === editingCharacterId}
              selected={selectedIds.has(ch.id)}
              isDragOver={dragOverId === ch.id && dragId !== ch.id}
              onClick={() => setEditingCharacter(ch.id)}
              onEdit={() => setEditingCharacter(ch.id)}
              onDelete={() => {
                setPendingDeleteCharacter({ id: ch.id, name: ch.name });
              }}
              onToggleSelect={() => toggleSelect(ch.id)}
              onDragStart={() => setDragId(ch.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragId && dragId !== ch.id) setDragOverId(ch.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOverId(null);
              }}
              onDrop={() => handleDrop(ch.id)}
            />
          ))}
        </div>
      </div>

      {showEditor && editing && (
        <CharacterEditorModal
          character={editing}
          onClose={() => toggleCharacterEditor(false)}
          richTextEditorCommandsRef={richTextEditorCommandsRef}
        />
      )}

      {pendingDeleteCharacter && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除角色"${pendingDeleteCharacter.name}"？此操作不可撤销。`}
          danger
          onConfirm={() => {
            deleteCharacter(pendingDeleteCharacter.id);
            useToastStore.getState().showToast('已删除', 'success');
            setPendingDeleteCharacter(null);
          }}
          onCancel={() => setPendingDeleteCharacter(null)}
        />
      )}

      {pendingBatchDelete && (
        <ConfirmDialog
          open={true}
          title="批量删除角色"
          message={`确定删除以下 ${pendingBatchDelete.ids.length} 个角色？${pendingBatchDelete.names.length <= 5 ? `\n• ${pendingBatchDelete.names.join('\n• ')}` : ''}\n此操作不可撤销。`}
          danger
          onConfirm={handleBatchDelete}
          onCancel={() => setPendingBatchDelete(null)}
        />
      )}
    </div>
  );
}

/** "从模板导入" 人物 */
function ImportCharacterTemplateButton() {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const templates = useMetaStore((s) => s.characterTemplates);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const updatePos = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const dropdownWidth = 320;
      const dropdownMaxHeight = 480;
      let top = rect.bottom + 4;
      let left = rect.left;
      // 视口检测：右侧溢出则左对齐到按钮右边缘
      if (left + dropdownWidth > window.innerWidth - 8) {
        left = Math.max(8, rect.right - dropdownWidth);
      }
      // 下方溢出则向上弹出
      if (top + dropdownMaxHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - dropdownMaxHeight - 4);
      }
      setDropdownPos({ top, left });
    }
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const handler = (e: MouseEvent) => {
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const importOne = async (t: { name: string; avatar?: string; personality?: string; attributes?: Record<string, string | number>; notes?: string; variants?: { id: string; name: string; url: string }[] }) => {
    if (!activeStoryId) return;
    const state = useMetaStore.getState();
    const baseName = (t.name || '角色').trim();
    let finalName = baseName;
    const existsName = (n: string): boolean => {
      return !!state.characters.find((c) => c.name.toLowerCase() === n.toLowerCase());
    };
    if (existsName(finalName)) {
      let idx = 2;
      while (existsName(`${baseName}(${idx})`)) idx++;
      finalName = `${baseName}(${idx})`;
    }
    const id = await state.createCharacter(activeStoryId, finalName, true);
    state.updateCharacter(id, {
      avatar: t.avatar || '',
      personality: t.personality || '',
      notes: t.notes || '',
      attributes: t.attributes,
    });
    if (t.variants && t.variants.length > 0) {
      for (const v of t.variants) {
        state.addCharacterVariant(id, { name: v.name, url: v.url });
      }
    }
    setOpen(false);
    setSearch('');
  };

  const filtered = search.trim()
    ? templates.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : templates;

  const renderTemplateItem = (t: { id: string; name: string; avatar?: string; personality?: string }) => (
    <button
      key={t.id}
      onClick={() => importOne(t as any)}
      className="w-full text-left px-3 py-2 transition-colors"
      style={{ color: 'var(--text-primary)', borderRadius: 6 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-bg)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        {t.avatar ? (
          <img src={t.avatar} alt="" className="w-6 h-6 rounded-md object-cover shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-[11px]"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {(t.name || '?').slice(0, 1)}
          </div>
        )}
        <span className="truncate font-bold" style={{ fontSize: 12 }}>
          🗂️ {t.name}
        </span>
      </div>
      {t.personality && (
        <div className="mt-0.5 ml-8" style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {t.personality.slice(0, 60)}
        </div>
      )}
    </button>
  );

  const dropdownContent = (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: dropdownPos.top,
        left: dropdownPos.left,
        minWidth: 320,
        maxHeight: 'min(480px, calc(100vh - 80px))',
        zIndex: 9999,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="px-2 pt-2 pb-1 shrink-0">
        <input
          autoFocus
          placeholder="搜索模板..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded border outline-none"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
        />
      </div>
      {templates.length === 0 ? (
        <div className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          <div className="text-2xl mb-2 opacity-40">🗂️</div>
          <div className="text-xs">暂无模板，先到首页的「模板库」创建</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          <div className="text-2xl mb-2 opacity-40">🔍</div>
          <div className="text-xs">没有找到匹配的模板</div>
        </div>
      ) : (
        <div className="overflow-y-auto pb-1 px-1" style={{ maxHeight: 380 }}>
          {filtered.map(renderTemplateItem)}
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
        disabled={!activeStoryId}
        className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
      >
        导入模板
      </button>
      {open && createPortal(dropdownContent, document.body)}
    </>
  );
}

function CharacterEditorModal({
  character,
  onClose,
  richTextEditorCommandsRef,
}: {
  character: Character;
  onClose: () => void;
  richTextEditorCommandsRef?: React.MutableRefObject<RichTextEditorCommands | null>;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const updateCharacter = useMetaStore((s) => s.updateCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);

  const [name, setName] = useState(character.name);
  const [avatar, setAvatar] = useState(character.avatar || '');
  const [personality, setPersonality] = useState(character.personality || '');
  const [notes, setNotes] = useState(character.notes || '');
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<{ id: string; name: string } | null>(null);
  const [batchVariantOpen, setBatchVariantOpen] = useState(false);
  const [batchAttrOpen, setBatchAttrOpen] = useState(false);

  /**
   * 解析批量输入文本。每行以 "key:value" 形式，相邻多对用逗号或换行分隔。
   * 返回 [{key, value}]，自动忽略空行/无效行。
   */
  const parseBatchEntries = (text: string): { key: string; value: string }[] => {
    return text
      .split(/[\n;,，；;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        if (idx < 0) return null;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) return null;
        return { key, value };
      })
      .filter((x): x is { key: string; value: string } => !!x);
  };

  useEffect(() => {
    setName(character.name);
    setAvatar(character.avatar || '');
    setPersonality(character.personality || '');
    setNotes(character.notes || '');
  }, [character.id]);

  const addVariant = useMetaStore((s) => s.addCharacterVariant);
  const updateVariant = useMetaStore((s) => s.updateCharacterVariant);
  const deleteVariant = useMetaStore((s) => s.deleteCharacterVariant);
  const reorderVariants = useMetaStore((s) => s.reorderCharacterVariants);

  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantUrl, setNewVariantUrl] = useState('');
  const newVariantFileRef = useRef<HTMLInputElement | null>(null);
  const batchUploadRef = useRef<HTMLInputElement | null>(null);

  // 订阅本地上传总开关：关闭时把"上传"按钮置灰
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const localUploadDisabledReason = '本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传';
  const isLocalUploadDisabled = !localUploadEnabled;

  // 上传进度弹窗状态
  const [uploadTasks, setUploadTasks] = useState<UploadProgressEvent[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const handleAddVariant = () => {
    const url = newVariantUrl.trim();
    if (!url) return;
    const vname = newVariantName.trim() || `差分 ${(character.variants || []).length + 1}`;
    addVariant(character.id, { name: vname, url });
    setNewVariantName('');
    setNewVariantUrl('');
  };

  const handleVariantFile = async (file: File) => {
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
      // 默认差分名 = 图片文件名（去后缀）
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
        .showToast(`图片上传失败：${res.error || '未知错误'}，请检查网络后重新选择`, 'error');
    }
  };

  const handleBatchUpload = async (files: FileList) => {
    const fileArray = Array.from(files).slice(0, 50);
    if (fileArray.length === 0) return;
    // 本地模式才检查本地上传总开关（远端模式直接放行）
    if (useSettingStore.getState().imageStoreMode === 'local' && !useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks(
      fileArray.map((f, i) => ({
        taskId: `${Date.now()}_${i}`,
        fileName: f.name || `image_${i}`,
        status: 'pending',
        progress: 0,
      })),
    );
    setUploadDialogOpen(true);
    const results = await uploadImagesWithProgress(fileArray, (e) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
      );
    });
    const items: { name: string; url: string }[] = [];
    let successCount = 0;
    let failCount = 0;
    results.forEach((r, i) => {
      if (r.ok && r.url) {
        const url = r.url;
        const name = fileArray[i]?.name?.replace(/\.[^.]+$/, '') || `差分 ${i + 1}`;
        items.push({ name, url });
        successCount++;
        // 入库到图片库人物文件夹（失败不影响编辑器正常使用）
        const fname = fileArray[i]?.name || `image_${i}`;
        ensureCharacterFolder()
          .then((folderId) => addImageLibraryItem({ folderId, url, filename: fname, source: 'local' }))
          .catch(() => {});
      } else {
        failCount++;
      }
    });
    if (items.length > 0) {
      if (window.dbAPI?.createCharacterVariantsBatch) {
        await window.dbAPI.createCharacterVariantsBatch(character.id, items);
      } else {
        const state = useMetaStore.getState();
        for (const item of items) {
          state.addCharacterVariant(character.id, { name: item.name, url: item.url });
        }
      }
      if (activeStoryId) {
        useMetaStore.getState().loadMetaForStory(activeStoryId);
      }
    }
    if (failCount === 0) {
      useToastStore
        .getState()
        .showToast(`已批量添加 ${successCount} 个差分`, 'success');
    } else {
      useToastStore
        .getState()
        .showToast(
          `部分失败：成功 ${successCount}，失败 ${failCount}。失败项未保存，请检查网络后重新上传。`,
          'warning',
        );
    }
  };

  const moveVariant = (id: string, dir: -1 | 1) => {
    const list = [...(character.variants || [])];
    const i = list.findIndex((v) => v.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    reorderVariants(character.id, list.map((v) => v.id));
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      useToastStore.getState().showToast('姓名不能为空', 'error');
      return;
    }
    // 检查名称唯一性（排除自身）
    const state = useMetaStore.getState();
    const duplicate = state.characters.find(
      (c) => c.id !== character.id && c.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      useToastStore.getState().showToast(`已存在同名角色"${duplicate.name}"，请使用不同的名称`, 'error');
      return;
    }
    updateCharacter(character.id, {
      name: trimmed,
      avatar: avatar.trim(),
      personality,
      notes,
      attributes: character.attributes || {},
    });
    onClose();
  };

  const handleDelete = () => {
    setPendingDelete(true);
  };

  const handleAttrChange = (next: Record<string, string>) => {
    updateCharacter(character.id, { attributes: next });
  };

  /**
   * 批量添加属性：解析"key:value"多行输入，合并到现有 attributes 中。
   * 已存在的 key 会被覆盖。值统一存为 string（不再做 number 转换）。
   */
  const handleBatchAddAttributes = (text: string) => {
    const entries = parseBatchEntries(text);
    if (entries.length === 0) {
      useToastStore.getState().showToast('没有解析到有效属性', 'warning');
      setBatchAttrOpen(false);
      return;
    }
    const merged: Record<string, string> = { ...(character.attributes as Record<string, string> || {}) };
    let added = 0;
    for (const { key, value } of entries) {
      merged[key] = value;
      added++;
    }
    updateCharacter(character.id, { attributes: merged });
    useToastStore.getState().showToast(`已批量添加 ${added} 条属性`, 'success');
    setBatchAttrOpen(false);
  };

  /**
   * 批量添加差分：解析"差分名:url"多行输入，校验 URL 后逐条新增 variant。
   */
  const handleBatchAddVariants = (text: string) => {
    const entries = parseBatchEntries(text);
    if (entries.length === 0) {
      useToastStore.getState().showToast('没有解析到有效差分', 'warning');
      setBatchVariantOpen(false);
      return;
    }
    const urlRe = /^https?:\/\//i;
    const accepted: { key: string; value: string }[] = [];
    const skipped: string[] = [];
    for (const { key, value } of entries) {
      if (!urlRe.test(value)) {
        skipped.push(key || '(空)');
        continue;
      }
      accepted.push({ key, value });
    }
    const state = useMetaStore.getState();
    for (const { key, value } of accepted) {
      state.addCharacterVariant(character.id, { name: key, url: value });
    }
    if (accepted.length > 0) {
      if (activeStoryId) {
        state.loadMetaForStory(activeStoryId);
      }
      useToastStore.getState().showToast(`已批量添加 ${accepted.length} 个差分`, 'success');
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

  const handleAvatarFromFile = async (file: File) => {
    // 本地模式才检查本地上传总开关（远端模式直接放行）
    if (useSettingStore.getState().imageStoreMode === 'local' && !useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks([
      {
        taskId: `${Date.now()}_0`,
        fileName: file.name || 'avatar',
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
      setAvatar(res.url);
      useToastStore.getState().showToast('头像已更新', 'success');
      // 入库到图片库人物文件夹（失败不影响编辑器正常使用）
      try {
        const folderId = await ensureCharacterFolder();
        await addImageLibraryItem({ folderId, url: res.url, filename: file.name, source: 'local' });
      } catch {}
    } else {
      useToastStore
        .getState()
        .showToast(`图片上传失败：${res.error || '未知错误'}，请检查网络后重新选择`, 'error');
    }
  };

  const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' } as React.CSSProperties;
  const labelColor = 'var(--text-secondary)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--bg-overlay)' }}>
      <div
        className="w-[90%] max-w-[720px] max-h-[90vh] overflow-y-auto rounded-lg shadow-2xl flex flex-col"
        style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>✎ 编辑角色</div>
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
                onBlur={() => {
                  // 即时保存头像 URL，让图片立即生效
                  if (avatar.trim()) {
                    updateCharacter(character.id, { avatar: avatar.trim() });
                  }
                }}
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
                className="text-[10px] px-2 py-0.5 rounded whitespace-nowrap"
                style={{
                  background: 'var(--bg-sidebar)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                }}
                title="批量添加属性"
              >
                批量添加
              </button>
            </div>
            <AttributeTable
              attributes={character.attributes || {}}
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
                  共 {(character.variants || []).length} 个
                </span>
                <button
                  onClick={() => setBatchVariantOpen(true)}
                  className="text-[10px] px-2 py-0.5 rounded whitespace-nowrap"
                  style={{
                    background: 'var(--bg-sidebar)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                  }}
                  title="批量添加差分（差分名:url，每行一个）"
                >
                  批量添加
                </button>
              </div>
            </div>

            {/* 现有差分列表 */}
            <div className="space-y-1 mb-2">
              {(character.variants || []).map((v, idx) => (
                <div
                  key={v.id}
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
                      onError={async (e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        // v36: 与 ImageLibraryPage 一致,local:// 协议失败时通过 IPC 读 dataUrl 兜底
                        if (v.url.startsWith('local://') && !img.dataset.fallbackTried) {
                          img.dataset.fallbackTried = '1';
                          try {
                            const res = await window.electronAPI?.readAsDataUrl?.(v.url);
                            if (res?.ok && res.dataUrl) {
                              img.src = res.dataUrl;
                              return;  // 兜底成功,不显示 fallback
                            }
                          } catch {}
                        }
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
                    onChange={(e) => updateVariant(v.id, { name: e.target.value })}
                    placeholder="差分名称"
                    className="flex-1 border rounded px-2 py-1 outline-none text-xs"
                    style={inputStyle}
                  />
                  <input
                    value={v.url}
                    onChange={(e) => updateVariant(v.id, { url: e.target.value })}
                    onBlur={() => {
                      // 即时保存差分 URL
                      if (v.url.trim()) updateVariant(v.id, { url: v.url.trim() });
                    }}
                    placeholder="图片 URL"
                    className="flex-1 border rounded px-2 py-1 outline-none text-xs"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => moveVariant(v.id, -1)}
                    disabled={idx === 0}
                    className="text-xs px-1.5 py-0.5 rounded disabled:opacity-30"
                    style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveVariant(v.id, 1)}
                    disabled={idx === (character.variants || []).length - 1}
                    className="text-xs px-1.5 py-0.5 rounded disabled:opacity-30"
                    style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                    title="下移"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => {
                      if (richTextEditorCommandsRef?.current) {
                        richTextEditorCommandsRef.current.insertImage(v.url, NGA_DEFAULT_IMAGE_SIZE);
                      }
                    }}
                    disabled={!richTextEditorCommandsRef?.current}
                    className="text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-30"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                    title="插入到编辑器"
                  >
                    插入
                  </button>
                  <button
                    onClick={() => {
                      setPendingDeleteVariant({ id: v.id, name: v.name });
                    }}
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(character.variants || []).length === 0 && (
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
              <button
                onClick={() => {
                  if (isLocalUploadDisabled) {
                    useToastStore.getState().showToast(localUploadDisabledReason, 'error');
                    return;
                  }
                  batchUploadRef.current?.click();
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
                title={isLocalUploadDisabled ? localUploadDisabledReason : '批量上传差分（最多50张）'}
              >
                📂 批量上传
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
              <input
                ref={batchUploadRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) handleBatchUpload(files);
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
            onClick={handleDelete}
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
            删除此角色
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const tplName = (name || '未命名角色').trim();
                save();
                useMetaStore.getState().createCharacterTemplate({
                  name: tplName,
                  avatar,
                  personality,
                  notes,
                  attributes: character.attributes || {},
                  variants: character.variants || [],
                });
              }}
              className="text-xs px-3 py-1 rounded transition-colors"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
              title="把当前角色保存为模板（包括差分）"
            >
              存为模板
            </button>
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

      {pendingDelete && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除角色"${character.name}"？此操作不可撤销。`}
          danger
          onConfirm={() => {
            deleteCharacter(character.id);
            useToastStore.getState().showToast('已删除', 'success');
            setPendingDelete(false);
            onClose();
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}

      {pendingDeleteVariant && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除差分"${pendingDeleteVariant.name}"？`}
          danger
          onConfirm={() => {
            deleteVariant(pendingDeleteVariant.id);
            setPendingDeleteVariant(null);
          }}
          onCancel={() => setPendingDeleteVariant(null)}
        />
      )}

      <InputDialog
        open={batchAttrOpen}
        title="批量添加属性"
        placeholder={'姓名:李华,\n年龄:18,\nHP:100'}
        defaultValue=""
        multiline
        confirmText="添加"
        onConfirm={handleBatchAddAttributes}
        onCancel={() => setBatchAttrOpen(false)}
      />

      <InputDialog
              open={batchVariantOpen}
              title="批量添加差分"
              placeholder={'差分1:https://example.com/1.png,\n差分2:https://example.com/2.png'}
              defaultValue=""
              multiline
              rows={10}
              maxLength={10000}
              confirmText="添加"
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
