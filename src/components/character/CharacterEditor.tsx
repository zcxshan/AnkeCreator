import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Character } from '../../types';
import type { AttributeType } from './AttributeTable';
import { useMetaStore } from '../../store/metaStore';
import { useStoryStore } from '../../store/storyStore';
import { CharacterCard } from './CharacterCard';
import { AttributeTable } from './AttributeTable';
import type { RichTextEditorCommands } from '../editor/RichTextEditor';
import { NGA_DEFAULT_IMAGE_SIZE } from '../../types';

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

  const editing = characters.find((c) => c.id === editingCharacterId) ?? null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>👤 人物角色</div>
        <div className="flex items-center gap-1">
          <ImportCharacterTemplateButton />
          <button
            onClick={() => activeStoryId && createCharacter(activeStoryId)}
            disabled={!activeStoryId}
            className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--success)', color: 'var(--text-on-accent)' }}
          >
            + 新建角色
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!activeStoryId && (
          <div className="text-xs italic py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
            请先选择或创建一个故事
          </div>
        )}
        {activeStoryId && characters.length === 0 && (
          <div className="text-xs italic py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
            暂无角色，点击右上角"新建角色"
          </div>
        )}

        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {characters.map((ch) => (
            <CharacterCard
              key={ch.id}
              character={ch}
              isActive={ch.id === editingCharacterId}
              onClick={() => setEditingCharacter(ch.id)}
              onEdit={() => setEditingCharacter(ch.id)}
              onDelete={() => {
                if (window.confirm(`删除角色"${ch.name}"？`)) {
                  deleteCharacter(ch.id);
                }
              }}
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
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
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

  const importOne = (t: { name: string; avatar?: string; personality?: string; attributes?: Record<string, string | number>; notes?: string; variants?: { id: string; name: string; url: string }[] }) => {
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
    const id = state.createCharacter(activeStoryId, finalName, true);
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
  const presetTemplates = filtered.filter((t) => t.is_preset);
  const customTemplates = filtered.filter((t) => !t.is_preset);

  const renderTemplateItem = (t: { id: string; name: string; avatar?: string; personality?: string; is_preset?: number }) => (
    <button
      key={t.id}
      onClick={() => importOne(t as any)}
      className="w-full text-left px-3 py-2 text-xs transition-colors"
      style={{ color: 'var(--text-primary)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        {t.avatar ? (
          <img src={t.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px]"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {(t.name || '?').slice(0, 1)}
          </div>
        )}
        <span className="truncate font-medium">{t.name}</span>
      </div>
      {t.personality && (
        <div className="text-[10px] truncate mt-0.5 ml-7" style={{ color: 'var(--text-secondary)' }}>
          {t.personality.slice(0, 40)}
        </div>
      )}
    </button>
  );

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="rounded-md shadow-lg"
      style={{
        position: 'fixed',
        top: dropdownPos.top,
        left: dropdownPos.left,
        minWidth: 260,
        maxHeight: 'min(400px, calc(100vh - 40px))',
        zIndex: 9999,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
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
        <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          暂无模板，先到首页的「模板库」创建
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          无匹配结果
        </div>
      ) : (
        <div className="overflow-y-auto pb-1" style={{ maxHeight: 320 }}>
          {presetTemplates.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                预置模板
              </div>
              {presetTemplates.map(renderTemplateItem)}
            </>
          )}
          {customTemplates.length > 0 && (
            <>
              {presetTemplates.length > 0 && (
                <div className="mx-3 my-1" style={{ borderTop: '1px solid var(--border-color)' }} />
              )}
              <div className="px-3 py-1 text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                自定义模板
              </div>
              {customTemplates.map(renderTemplateItem)}
            </>
          )}
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
  const updateCharacter = useMetaStore((s) => s.updateCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);

  const [name, setName] = useState(character.name);
  const [avatar, setAvatar] = useState(character.avatar || '');
  const [personality, setPersonality] = useState(character.personality || '');
  const [notes, setNotes] = useState(character.notes || '');
  const [attrTypes, setAttrTypes] = useState<Record<string, AttributeType>>(() => {
    const t: Record<string, AttributeType> = {};
    for (const [k, v] of Object.entries(character.attributes || {})) {
      if (typeof v === 'number') t[k] = 'number';
      else t[k] = 'text';
    }
    return t;
  });

  useEffect(() => {
    setName(character.name);
    setAvatar(character.avatar || '');
    setPersonality(character.personality || '');
    setNotes(character.notes || '');
    const t: Record<string, AttributeType> = {};
    for (const [k, v] of Object.entries(character.attributes || {})) {
      t[k] = typeof v === 'number' ? 'number' : 'text';
    }
    setAttrTypes(t);
  }, [character.id]);

  const addVariant = useMetaStore((s) => s.addCharacterVariant);
  const updateVariant = useMetaStore((s) => s.updateCharacterVariant);
  const deleteVariant = useMetaStore((s) => s.deleteCharacterVariant);
  const reorderVariants = useMetaStore((s) => s.reorderCharacterVariants);

  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantUrl, setNewVariantUrl] = useState('');
  const newVariantFileRef = useRef<HTMLInputElement | null>(null);

  const handleAddVariant = () => {
    const url = newVariantUrl.trim();
    if (!url) return;
    const vname = newVariantName.trim() || `差分 ${(character.variants || []).length + 1}`;
    addVariant(character.id, { name: vname, url });
    setNewVariantName('');
    setNewVariantUrl('');
  };

  const handleVariantFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      // 尝试保存到本地文件系统（Electron 环境），避免 base64 超长
      if (window.electronAPI?.saveImage) {
        const savedPath = await window.electronAPI.saveImage(dataUrl);
        setNewVariantUrl(savedPath || dataUrl);
      } else {
        setNewVariantUrl(dataUrl);
      }
    };
    reader.readAsDataURL(file);
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
      alert('姓名不能为空');
      return;
    }
    // 检查名称唯一性（排除自身）
    const state = useMetaStore.getState();
    const duplicate = state.characters.find(
      (c) => c.id !== character.id && c.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      alert(`已存在同名角色"${duplicate.name}"，请使用不同的名称`);
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
    if (window.confirm(`删除角色"${character.name}"？`)) {
      deleteCharacter(character.id);
      onClose();
    }
  };

  const handleAttrChange = (
    next: Record<string, string | number>,
    nextTypes: Record<string, AttributeType>,
  ) => {
    setAttrTypes(nextTypes);
    updateCharacter(character.id, { attributes: next });
  };

  const handleAvatarFromFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      // 尝试保存到本地文件系统（Electron 环境），避免 base64 超长
      if (window.electronAPI?.saveImage) {
        const savedPath = await window.electronAPI.saveImage(dataUrl);
        setAvatar(savedPath || dataUrl);
      } else {
        setAvatar(dataUrl);
      }
    };
    reader.readAsDataURL(file);
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
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>✎ 编辑角色</div>
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
                style={{ background: 'var(--bg-sidebar)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-sidebar)';
                }}
              >
                上传图片
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
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
            <label className="text-xs block mb-1" style={{ color: labelColor }}>属性表</label>
            <AttributeTable
              attributes={character.attributes || {}}
              valueTypes={attrTypes}
              onChange={handleAttrChange}
            />
          </div>

          {/* 差分管理 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs" style={{ color: labelColor }}>
                人物差分（表情/姿势/服饰等图片变体）
              </label>
              <span className="text-[10px]" style={{ color: labelColor }}>
                共 {(character.variants || []).length} 个
              </span>
            </div>

            {/* 现有差分列表 */}
            <div className="space-y-1 mb-2">
              {(character.variants || []).map((v, idx) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}
                >
                  <img
                    src={v.url}
                    alt={v.name}
                    className="w-10 h-10 rounded object-cover shrink-0"
                    style={{ background: 'var(--bg-base)' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
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
                      if (window.confirm(`删除差分"${v.name}"？`)) deleteVariant(v.id);
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
                onClick={() => newVariantFileRef.current?.click()}
                className="text-xs px-2 py-1 rounded whitespace-nowrap"
                style={{ background: 'var(--bg-sidebar)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                title="从本地上传"
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
    </div>
  );
}
