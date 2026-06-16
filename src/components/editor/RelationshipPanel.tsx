// ============================================================
// RelationshipPanel
//
// 编辑页右侧"人物关系"面板：查看 / 新建 / 编辑 / 删除作品内人物之间的关系
// 字段：源角色 + 关系名 + 目标角色 + 备注
// ============================================================

import { useMemo, useState } from 'react';
import { useMetaStore } from '../../store/metaStore';
import type { CharacterRelation } from '../../types';

interface Props {
  storyId: string;
}

export function RelationshipPanel({ storyId }: Props) {
  const characters = useMetaStore((s) => s.characters);
  const relations = useMetaStore((s) => s.relations);
  const createRelation = useMetaStore((s) => s.createRelation);
  const updateRelation = useMetaStore((s) => s.updateRelation);
  const deleteRelation = useMetaStore((s) => s.deleteRelation);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<{
    source_id: string;
    target_id: string;
    relation: string;
    note: string;
  }>({ source_id: '', target_id: '', relation: '', note: '' });

  const charMap = useMemo(() => {
    const m: Record<string, { name: string; avatar: string }> = {};
    characters.forEach((c) => {
      m[c.id] = { name: c.name || '（未命名）', avatar: c.avatar || '' };
    });
    return m;
  }, [characters]);

  const sortedRelations = useMemo(
    () => relations.slice().sort((a, b) => a.order_index - b.order_index),
    [relations],
  );

  const resetDraft = () => {
    setDraft({ source_id: '', target_id: '', relation: '', note: '' });
  };

  const startCreate = () => {
    resetDraft();
    setEditingId(null);
    setIsCreating(true);
  };

  const startEdit = (r: CharacterRelation) => {
    setEditingId(r.id);
    setIsCreating(false);
    setDraft({
      source_id: r.source_id,
      target_id: r.target_id,
      relation: r.relation,
      note: r.note || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsCreating(false);
    resetDraft();
  };

  const handleSave = () => {
    if (!draft.source_id || !draft.target_id) return;
    const rel = draft.relation.trim() || '未知';
    if (isCreating) {
      createRelation({
        story_id: storyId,
        source_id: draft.source_id,
        target_id: draft.target_id,
        relation: rel,
        note: draft.note.trim() || undefined,
      });
    } else if (editingId) {
      updateRelation(editingId, {
        source_id: draft.source_id,
        target_id: draft.target_id,
        relation: rel,
        note: draft.note.trim() || undefined,
      });
    }
    cancelEdit();
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('确定删除该关系？')) return;
    deleteRelation(id);
    if (editingId === id) cancelEdit();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部操作栏 */}
      <div
        className="px-3 py-2 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          人物关系
        </div>
        <button
          onClick={startCreate}
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          + 新建
        </button>
      </div>

      {/* 编辑/新建表单 */}
      {(isCreating || editingId) && (
        <div
          className="px-3 py-2 flex flex-col gap-2 text-xs"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-base)' }}
        >
          <div>
            <div className="mb-1" style={{ color: 'var(--text-secondary)' }}>源角色</div>
            <select
              value={draft.source_id}
              onChange={(e) => setDraft((d) => ({ ...d, source_id: e.target.value }))}
              className="w-full px-2 py-1 rounded"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            >
              <option value="">（请选择）</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name || '（未命名）'}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1" style={{ color: 'var(--text-secondary)' }}>关系名</div>
            <input
              type="text"
              value={draft.relation}
              onChange={(e) => setDraft((d) => ({ ...d, relation: e.target.value }))}
              placeholder="如：朋友、兄妹、师徒"
              className="w-full px-2 py-1 rounded"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            />
          </div>
          <div>
            <div className="mb-1" style={{ color: 'var(--text-secondary)' }}>目标角色</div>
            <select
              value={draft.target_id}
              onChange={(e) => setDraft((d) => ({ ...d, target_id: e.target.value }))}
              className="w-full px-2 py-1 rounded"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            >
              <option value="">（请选择）</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name || '（未命名）'}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1" style={{ color: 'var(--text-secondary)' }}>备注（可选）</div>
            <textarea
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              rows={2}
              className="w-full px-2 py-1 rounded"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!draft.source_id || !draft.target_id}
              className="flex-1 px-2 py-1 rounded disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              保存
            </button>
            <button
              onClick={cancelEdit}
              className="flex-1 px-2 py-1 rounded"
              style={{ background: 'var(--bg-button)', color: 'var(--text-primary)' }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 关系列表 */}
      <div className="flex-1 overflow-y-auto">
        {characters.length === 0 ? (
          <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
            请先添加人物角色
          </div>
        ) : sortedRelations.length === 0 ? (
          <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
            还没有关系，点击"+ 新建"开始
          </div>
        ) : (
          <ul className="flex flex-col">
            {sortedRelations.map((r) => {
              const src = charMap[r.source_id];
              const dst = charMap[r.target_id];
              const isEditing = editingId === r.id;
              return (
                <li
                  key={r.id}
                  className="px-3 py-2 text-xs"
                  style={{ borderBottom: '1px solid var(--border-color)' }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ color: 'var(--text-primary)' }}>
                      {src?.name || '（已删除的角色）'}
                    </span>
                    <span style={{ color: 'var(--accent)' }}>—{r.relation}→</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {dst?.name || '（已删除的角色）'}
                    </span>
                    <div className="ml-auto flex gap-1">
                      <button
                        onClick={() => (isEditing ? cancelEdit() : startEdit(r))}
                        className="px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg-button)', color: 'var(--text-secondary)' }}
                      >
                        {isEditing ? '取消' : '编辑'}
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg-button)', color: 'var(--text-secondary)' }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  {r.note && (
                    <div className="mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {r.note}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
