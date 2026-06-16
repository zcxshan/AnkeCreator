import { useEffect, useState, useRef } from 'react';
import { useMetaStore } from '../../store/metaStore';
import { useStoryStore } from '../../store/storyStore';
import type {
  WorldSettingTemplate,
  CharacterTemplate,
} from '../../types';
import { AttributeTable } from '../character/AttributeTable';
import type { AttributeType } from '../character/AttributeTable';

interface TemplatesPageProps {
  onBack: () => void;
  onShowAuthor?: () => void;
}

type TabKey = 'world' | 'character';

/**
 * 模板页面：两个 Tab（世界观 / 人物），CRUD + 复制为草稿。
 * 在首页入口进入、独立于具体作品。
 */
export function TemplatesPage({ onBack, onShowAuthor }: TemplatesPageProps) {
  const loadTemplates = useMetaStore((s) => s.loadTemplates);
  const [tab, setTab] = useState<TabKey>('world');

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            ← 返回首页
          </button>
          <h1 className="text-lg font-semibold">模板库</h1>
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
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          独立于具体作品，可被任意作品引用
        </div>
      </header>

      <div
        className="flex items-center gap-1 px-6 py-2"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <TabBtn label="🌐 世界观模板" active={tab === 'world'} onClick={() => setTab('world')} />
        <TabBtn label="🧑 人物模板" active={tab === 'character'} onClick={() => setTab('character')} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'world' ? <WorldTemplatesPanel /> : <CharacterTemplatesPanel />}
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

function WorldTemplatesPanel() {
  const templates = useMetaStore((s) => s.worldSettingTemplates);
  const create = useMetaStore((s) => s.createWorldSettingTemplate);
  const update = useMetaStore((s) => s.updateWorldSettingTemplate);
  const remove = useMetaStore((s) => s.deleteWorldSettingTemplate);

  const [editing, setEditing] = useState<WorldSettingTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = () => {
    const id = create({ title: '新的世界观模板', content: '' });
    const t = useMetaStore.getState().worldSettingTemplates.find((x) => x.id === id);
    if (t) setEditing(t);
    setCreating(false);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          共 {templates.length} 条世界观模板
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-1.5 text-sm rounded-md transition-colors"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
        >
          + 新建模板
        </button>
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
              onEdit={() => setEditing(t)}
              onDelete={() => {
                if (confirm(`确认删除模板「${t.title}」？`)) remove(t.id);
              }}
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
    </div>
  );
}

function WorldTemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: WorldSettingTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isPreset = !!template.is_preset;
  return (
    <div
      className="rounded-xl p-4 transition-shadow hover:shadow-md"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
    >
      <div className="flex items-center gap-2">
        <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {template.title}
        </div>
        {isPreset && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
          >
            预置
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs line-clamp-3" style={{ color: 'var(--text-secondary)' }}>
        {(template.content || '').replace(/<[^>]+>/g, '').slice(0, 120) || '（无内容）'}
      </div>
      <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        更新于 {new Date(template.updated_at).toLocaleString()}
      </div>
      {!isPreset && (
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
      )}
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

function CharacterTemplatesPanel() {
  const templates = useMetaStore((s) => s.characterTemplates);
  const create = useMetaStore((s) => s.createCharacterTemplate);
  const update = useMetaStore((s) => s.updateCharacterTemplate);
  const remove = useMetaStore((s) => s.deleteCharacterTemplate);

  const [editing, setEditing] = useState<CharacterTemplate | null>(null);

  const handleCreate = () => {
    const id = create({ name: '新人物模板' });
    const t = useMetaStore.getState().characterTemplates.find((x) => x.id === id);
    if (t) setEditing(t);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          共 {templates.length} 个人物模板
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-1.5 text-sm rounded-md transition-colors"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
        >
          + 新建模板
        </button>
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
              onEdit={() => setEditing(t)}
              onDelete={() => {
                if (confirm(`确认删除模板「${t.name}」？`)) remove(t.id);
              }}
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
    </div>
  );
}

function CharacterTemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: CharacterTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isPreset = !!template.is_preset;
  return (
    <div
      className="rounded-xl p-4 transition-shadow hover:shadow-md"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
    >
      <div className="flex items-center gap-3">
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
            {isPreset && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
              >
                预置
              </span>
            )}
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {template.personality || '（无性格描述）'}
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        更新于 {new Date(template.updated_at).toLocaleString()}
      </div>
      {!isPreset && (
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
      )}
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
  const [attrTypes, setAttrTypes] = useState<Record<string, AttributeType>>(() => {
    const t: Record<string, AttributeType> = {};
    for (const [k, v] of Object.entries(template.attributes || {})) {
      if (typeof v === 'number') t[k] = 'number';
      else t[k] = 'text';
    }
    return t;
  });

  const [variants, setVariants] = useState<{ id?: string; name: string; url: string }[]>(
    (template.variants || []).map((v) => ({ id: v.id, name: v.name, url: v.url }))
  );
  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantUrl, setNewVariantUrl] = useState('');
  const newVariantFileRef = useRef<HTMLInputElement | null>(null);

  const handleAddVariant = () => {
    const url = newVariantUrl.trim();
    if (!url) return;
    const vname = newVariantName.trim() || `差分 ${variants.length + 1}`;
    setVariants([...variants, { name: vname, url }]);
    setNewVariantName('');
    setNewVariantUrl('');
  };

  const handleVariantFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setNewVariantUrl(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const updateVariant = (index: number, updates: { name?: string; url?: string }) => {
    const next = [...variants];
    next[index] = { ...next[index], ...updates };
    setVariants(next);
  };

  const deleteVariant = (index: number) => {
    if (window.confirm(`删除差分"${variants[index].name}"？`)) {
      setVariants(variants.filter((_, i) => i !== index));
    }
  };

  const moveVariant = (index: number, dir: -1 | 1) => {
    const list = [...variants];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    setVariants(list);
  };

  const handleAvatarFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatar(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleAttrChange = (
    next: Record<string, string | number>,
    nextTypes: Record<string, AttributeType>,
  ) => {
    setAttrTypes(nextTypes);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      alert('姓名不能为空');
      return;
    }
    onSave({
      name: trimmed,
      avatar: avatar.trim(),
      personality,
      notes,
      attributes: template.attributes || {},
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
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>✎ 编辑人物模板</div>
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
              attributes={template.attributes || {}}
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
                共 {variants.length} 个
              </span>
            </div>

            {/* 现有差分列表 */}
            <div className="space-y-1 mb-2">
              {variants.map((v, idx) => (
                <div
                  key={v.id || `new_${idx}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}
                >
                  <img
                    src={v.url}
                    alt={v.name}
                    className="w-10 h-10 rounded object-cover shrink-0"
                    style={{ background: 'var(--bg-base)' }}
                  />
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
            onClick={() => {
              if (window.confirm(`删除模板"${template.name}"？`)) {
                useMetaStore.getState().deleteCharacterTemplate(template.id);
                onClose();
              }
            }}
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
    </div>
  );
}

function parseAttrText(s: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  s.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!m) return;
    const k = m[1].trim();
    const v = m[2].trim();
    if (!k) return;
    const num = Number(v);
    out[k] = !isNaN(num) && v !== '' && /^-?\d+(\.\d+)?$/.test(v) ? num : v;
  });
  return out;
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
