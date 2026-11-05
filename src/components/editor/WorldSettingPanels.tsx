import { useState, useMemo, useEffect } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useMetaStore } from '../../store/metaStore';
import { useToastStore } from '../../store/toastStore';
import { Icon } from '../common/Icon';
import { ConfirmDialog } from '../common/ConfirmDialog';
import type { WorldSetting } from '../../types';

// ========== 紧凑型世界观设定面板 ==========

export function CompactWorldSettingPanel({
  onShowToast,
}: {
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const worldSettings = useMetaStore((s) => s.worldSettings);
  const editingWorldId = useMetaStore((s) => s.editingWorldId);
  const createWorldSetting = useMetaStore((s) => s.createWorldSetting);
  const deleteWorldSetting = useMetaStore((s) => s.deleteWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const editing = worldSettings.find((w) => w.id === editingWorldId) ?? null;

  // 多选状态（紧凑面板不显示拖动）
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<{ ids: string[]; names: string[] } | null>(null);

  // useMemo: 缓存过滤+排序结果，避免每次 render 都重算（条目多时卡顿）
  const filtered = useMemo(
    () =>
      activeStoryId
        ? worldSettings
            .filter((w) => w.story_id === activeStoryId)
            .slice()
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
        : [],
    [activeStoryId, worldSettings],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const clearSelection = () => setSelectedIds([]);
  const handleBatchDelete = async () => {
    if (!pendingBatchDelete) return;
    const target = pendingBatchDelete;
    setPendingBatchDelete(null);
    let deleted = 0;
    for (const id of target.ids) {
      await deleteWorldSetting(id);
      deleted++;
    }
    useToastStore.getState().showToast(`已批量删除 ${deleted} 条世界观`, 'success');
    clearSelection();
  };

  return (
    <div className="bg-[var(--bg-card)] flex flex-col h-full">
      {/* 顶部工具条 */}
      <div
        className="bg-[var(--bg-toolbar)] border-[color:var(--border-color)] shrink-0 flex items-center justify-between px-3 py-2 border-b"
      >
        <div className="text-[var(--text-primary)] text-xs font-semibold">世界观设定</div>
        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-secondary)] text-[10px]">已选 {selectedIds.length}</span>
            <button
              onClick={() => {
                const names = filtered.filter((w) => selectedIds.includes(w.id)).map((w) => w.title || '未命名');
                setPendingBatchDelete({ ids: [...selectedIds], names });
              }}
              className="text-[10px] px-2 py-1 rounded transition-colors ancke-btn ancke-btn-danger"
              title="删除所选"
            >
              <span className="inline-flex items-center gap-1">
                <Icon name="trash" size={12} />
                批量删除
              </span>
            </button>
            <button
              onClick={clearSelection}
              className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] text-[10px] px-2 py-1 rounded transition-colors"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => activeStoryId && createWorldSetting(activeStoryId)}
            disabled={!activeStoryId}
            className="bg-[var(--accent)] text-[var(--text-on-accent)] text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + 新建
          </button>
        )}
      </div>

      {/* 条目列表 */}
      <div className="border-[color:var(--border-color)] shrink-0 p-2 border-b max-h-40 overflow-y-auto space-y-1">
        {!activeStoryId && (
          <div className="text-[var(--text-secondary)] text-[10px] italic px-2 py-3 text-center">请先选择一个故事</div>
        )}
        {activeStoryId && filtered.length === 0 && (
          <div className="text-[var(--text-secondary)] text-[10px] italic px-2 py-3 text-center">
            暂无条目，点击上方"新建"
          </div>
        )}
        {activeStoryId && filtered.length > 0 && (
          <div className="space-y-1">
            {filtered.map((ws) => {
              const isActive = ws.id === editingWorldId;
              const isSel = selectedIds.includes(ws.id);
              return (
                <div
                  key={ws.id}
                  className="w-full text-left px-2 py-1.5 text-xs rounded transition-colors border flex items-start gap-1"
                  style={{
                    background: isSel
                      ? 'var(--accent-bg)'
                      : isActive
                      ? 'var(--accent-soft)'
                      : 'transparent',
                    color: isSel || isActive ? 'var(--accent)' : 'var(--text-primary)',
                    borderColor: isSel || isActive ? 'var(--accent)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel && !isActive) e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel && !isActive) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleSelect(ws.id)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    className="mt-[2px] cursor-pointer"
                    title="勾选以加入批量删除"
                  />
                  <button
                    onClick={() => setEditingWorldId(isActive ? null : ws.id)}
                    className="flex-1 text-left"
                  >
                    <div className="font-medium truncate">{ws.title || '未命名'}</div>
                    <div className="text-[var(--text-secondary)] text-[10px] truncate">
                      {(ws.content || '').slice(0, 50)}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <WorldSettingEditorInline setting={editing} onShowToast={onShowToast} />
        ) : (
          <div className="p-6">
            <div className="anke-card flex flex-col items-center gap-2 px-6 py-10 text-center" style={{ borderStyle: 'dashed' }}>
              <Icon name="scroll" size={48} className="opacity-40" />
              <div className="text-[var(--text-secondary)] text-xs">选择或新建一个世界观条目</div>
              <div className="text-[var(--text-secondary)] text-[10px]">点击上方列表中的条目进行编辑</div>
            </div>
          </div>
        )}
      </div>

      {pendingBatchDelete && (
        <ConfirmDialog
          open={true}
          title="批量删除世界观"
          message={`确定删除以下 ${pendingBatchDelete.ids.length} 条世界观？${pendingBatchDelete.names.length <= 5 ? `\n• ${pendingBatchDelete.names.join('\n• ')}` : ''}\n此操作不可撤销。`}
          danger
          onConfirm={handleBatchDelete}
          onCancel={() => setPendingBatchDelete(null)}
        />
      )}
    </div>
  );
}

// 简易内嵌版世界观编辑器（文本标题 + 富文本内容）
function WorldSettingEditorInline({ setting, onShowToast }: { setting: WorldSetting; onShowToast?: (msg: string) => void }) {
  const updateWorldSetting = useMetaStore((s) => s.updateWorldSetting);
  const deleteWorldSetting = useMetaStore((s) => s.deleteWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const [title, setTitle] = useState(setting.title || '');
  const [content, setContent] = useState(setting.content || '');
  const [pendingDelete, setPendingDelete] = useState(false);

  useEffect(() => {
    setTitle(setting.title || '');
    setContent(setting.content || '');
  }, [setting.id]);

  const handleSave = () => {
    updateWorldSetting(setting.id, { title, content });
  };

  const handleDelete = () => {
    setPendingDelete(true);
  };

  return (
    <div className="bg-[var(--bg-card)] p-3 space-y-3">
      <div>
        <label className="text-[var(--text-secondary)] block text-[10px] font-medium mb-1">标题</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSave}
          className="border-[color:var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] w-full px-2 py-1.5 text-xs rounded-md border outline-none"
          placeholder="例如：主要角色设定"
        />
      </div>
      <div>
        <label className="text-[var(--text-secondary)] block text-[10px] font-medium mb-1">内容</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleSave}
          rows={12}
          className="border-[color:var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] w-full px-2 py-2 text-xs rounded-md border outline-none resize-y leading-relaxed"
          placeholder="在此编辑世界观设定..."
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => {
            const tplName = (title || '未命名世界观模板').trim();
            handleSave();
            useMetaStore.getState().createWorldSettingTemplate({
              title: tplName,
              content,
            });
          }}
          className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-2 py-1 text-[10px] rounded-md transition-colors"
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
          title="把当前世界观设定保存为模板"
        >
          存为模板
        </button>
        <button
          onClick={handleDelete}
          className="bg-[var(--danger-soft)] text-[var(--danger)] px-2 py-1 text-[10px] rounded-md transition-colors"
        >
          删除条目
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除"${title || '未命名'}"？此操作不可撤销。`}
          danger
          onConfirm={() => {
            deleteWorldSetting(setting.id);
            setEditingWorldId(null);
            useToastStore.getState().showToast('已删除', 'success');
            setPendingDelete(false);
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </div>
  );
}
