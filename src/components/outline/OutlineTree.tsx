import { useState, useEffect, useMemo } from 'react';
import { useStoryStore } from '../../store/storyStore';
import type { OutlinePayload } from '../../types';
import { parseOutlineContent } from '../../types';

interface OutlineTreeProps {
  onJumpToChapter?: (chapterId: string) => void;
}

export function OutlineTree({ onJumpToChapter }: OutlineTreeProps) {
  const {
    stories,
    activeStoryId,
    outlines,
    activeOutlineId,
    setActiveOutline,
    createOutlineVolume,
    createOutlineChapter,
    renameOutline,
    deleteOutline,
  } = useStoryStore();

  const story = stories.find((s) => s.id === activeStoryId);

  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; outlineId: string; type: 'volume' | 'chapter' } | null>(null);

  const parsedOutlines = useMemo(
    () =>
      outlines
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map((o) => ({
          outline: o,
          payload: parseOutlineContent(o.content),
        })),
    [outlines],
  );

  const volumes = useMemo(
    () =>
      parsedOutlines.filter(
        (x) => x.payload.target_type === 'volume',
      ),
    [parsedOutlines],
  );

  const chaptersByParent = useMemo(() => {
    const map: Record<string, { outline: any; payload: OutlinePayload }[]> = {};
    parsedOutlines
      .filter((x) => x.payload.target_type === 'chapter')
      .forEach((x) => {
        const key = x.payload.parent_outline_id || '__orphan__';
        if (!map[key]) map[key] = [];
        map[key].push(x);
      });
    return map;
  }, [parsedOutlines]);

  const orphanChapters = chaptersByParent['__orphan__'] || [];

  useEffect(() => {
    const next: Record<string, boolean> = {};
    volumes.forEach((v) => (next[v.outline.id] = true));
    setExpandedVolumes(next);
  }, [volumes.length]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctxMenu]);

  const startEdit = (outlineId: string, title: string) => {
    setEditingId(outlineId);
    setEditingText(title);
  };

  const commitEdit = () => {
    if (editingId && editingText.trim()) {
      renameOutline(editingId, editingText.trim());
    }
    setEditingId(null);
    setEditingText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };

  const handleDelete = (outlineId: string) => {
    const outline = outlines.find((o) => o.id === outlineId);
    if (!outline) return;
    const payload = parseOutlineContent(outline.content);
    const isVolume = payload.target_type === 'volume';
    const label = isVolume ? '卷' : '章';
    const childCount = isVolume
      ? (chaptersByParent[outlineId]?.length || 0)
      : 0;

    let confirmText = `确定删除此${label}「${payload.title}」？`;
    if (childCount > 0) {
      confirmText += `\n\n同时会删除其下的 ${childCount} 章。`;
    }
    if (payload.body && payload.body.trim()) {
      confirmText += '\n\n其大纲描述文本也会丢失。';
    }
    if (!confirm(confirmText)) return;

    if (isVolume) {
      const children = chaptersByParent[outlineId] || [];
      children.forEach((ch) => deleteOutline(ch.outline.id));
    }
    deleteOutline(outlineId);
  };

  const handleCreateVolume = () => {
    const volCount = volumes.length + 1;
    createOutlineVolume(`第${volCount}卷`);
  };

  const handleCreateChapter = (parentOutlineId: string) => {
    const siblings = chaptersByParent[parentOutlineId] || [];
    createOutlineChapter(parentOutlineId, `第${siblings.length + 1}章`);
    setExpandedVolumes((prev) => ({ ...prev, [parentOutlineId]: true }));
  };

  const handleSelect = (outlineId: string, payload: OutlinePayload) => {
    setActiveOutline(outlineId);
    if (payload.target_type === 'chapter' && payload.parent_outline_id) {
      setExpandedVolumes((prev) => ({
        ...prev,
        [String(payload.parent_outline_id)]: true,
      }));
    }
    if (onJumpToChapter && payload.target_id) {
    }
  };

  const totalVolumes = volumes.length;
  const totalChapters = parsedOutlines.filter(
    (x) => x.payload.target_type === 'chapter',
  ).length;

  return (
    <aside
      className="shrink-0 w-64 flex flex-col border-r overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-toolbar)' }}
      >
        <div>
          <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>大纲目录</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {totalVolumes} 卷 · {totalChapters} 章
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {parsedOutlines.length === 0 && (
          <div className="px-6 py-8 text-xs text-slate-400 text-center italic leading-relaxed">
            还没有大纲内容。<br />
            点击下方「+ 新增卷」开始。
          </div>
        )}

        <div className="space-y-0.5 px-1.5">
          {volumes.map((v, vIdx) => {
            const vChapters = chaptersByParent[v.outline.id] || [];
            const vExpanded = expandedVolumes[v.outline.id];
            const vActive = activeOutlineId === v.outline.id;
            const vHasBody = v.payload.body && v.payload.body.trim().length > 0 && v.payload.body !== '{}' && v.payload.body !== 'null';
            const vLinked = v.payload.target_id;

            return (
              <div key={v.outline.id} className="mb-0.5">
                <div
                  className={[
                    'flex items-center gap-1 px-1.5 py-1.5 rounded-md group transition-colors',
                    vActive
                      ? 'bg-emerald-50 border-l-2 border-emerald-500 rounded-l-none'
                      : 'border-l-2 border-transparent hover:bg-slate-50',
                  ].join(' ')}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, outlineId: v.outline.id, type: 'volume' });
                  }}
                >
                  <button
                    className="shrink-0 w-4 h-4 flex items-center justify-center text-xs text-slate-400 hover:text-slate-700"
                    onClick={() =>
                      setExpandedVolumes((prev) => ({
                        ...prev,
                        [v.outline.id]: !vExpanded,
                      }))
                    }
                    title={vExpanded ? '折叠' : '展开'}
                  >
                    {vExpanded ? '▾' : '▸'}
                  </button>

                  <button
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                    onClick={() => handleSelect(v.outline.id, v.payload)}
                  >
                    <span className="shrink-0 text-sm">📑</span>
                    {editingId === v.outline.id ? (
                      <input
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-xs font-semibold rounded px-1.5 py-0.5 border outline-none"
                        style={{
                          color: 'var(--text-primary)',
                          background: 'var(--bg-card)',
                          borderColor: 'var(--border-color)',
                        }}
                      />
                    ) : (
                      <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        第{vIdx + 1}卷 · {v.payload.title}
                      </div>
                    )}
                    {vHasBody && editingId !== v.outline.id && (
                      <span className="shrink-0 text-[10px]" style={{ color: 'var(--accent)' }}>✓</span>
                    )}
                    {vLinked && editingId !== v.outline.id && (
                      <span className="shrink-0 text-[9px]" style={{ color: 'var(--border-color)' }}>🔗</span>
                    )}
                  </button>

                  <div className="shrink-0 flex items-center gap-1">
                    <button
                      className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateChapter(v.outline.id);
                      }}
                      title="在该卷下新增章"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                    {editingId !== v.outline.id && (
                      <button
                        className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(v.outline.id, v.payload.title);
                        }}
                        title="重命名"
                        style={{ color: 'var(--text-secondary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                    <button
                      className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(v.outline.id);
                      }}
                      title="删除"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--danger)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {vExpanded && vChapters.length > 0 && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-1.5" style={{ borderColor: 'var(--border-color)' }}>
                    {vChapters.map((c, cIdx) => {
                      const cActive = activeOutlineId === c.outline.id;
                      const cHasBody = c.payload.body && c.payload.body.trim().length > 0 && c.payload.body !== '{}' && c.payload.body !== 'null';
                      const cLinked = c.payload.target_id;

                      return (
                        <div
                          key={c.outline.id}
                          className={[
                            'flex items-center gap-1 px-1.5 py-1 rounded-md group transition-colors',
                            cActive
                              ? 'bg-emerald-50 border-l-2 border-emerald-500 rounded-l-none'
                              : 'border-l-2 border-transparent hover:bg-slate-50',
                          ].join(' ')}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCtxMenu({ x: e.clientX, y: e.clientY, outlineId: c.outline.id, type: 'chapter' });
                          }}
                        >
                          <button
                            className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                            onClick={() => handleSelect(c.outline.id, c.payload)}
                          >
                            <span className="shrink-0 text-sm">📄</span>
                            {editingId === c.outline.id ? (
                              <input
                                autoFocus
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitEdit();
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 text-xs rounded px-1.5 py-0.5 border outline-none"
                                style={{
                                  color: 'var(--text-primary)',
                                  background: 'var(--bg-card)',
                                  borderColor: 'var(--border-color)',
                                }}
                              />
                            ) : (
                              <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                                第{cIdx + 1}章 · {c.payload.title}
                              </div>
                            )}
                            {cHasBody && editingId !== c.outline.id && (
                              <span className="shrink-0 text-[10px]" style={{ color: 'var(--accent)' }}>✓</span>
                            )}
                            {cLinked && editingId !== c.outline.id && (
                              <span className="shrink-0 text-[9px]" style={{ color: 'var(--border-color)' }}>🔗</span>
                            )}
                          </button>

                          <div className="shrink-0 flex items-center gap-1">
                            {editingId !== c.outline.id && (
                              <button
                                className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(c.outline.id, c.payload.title);
                                }}
                                title="重命名"
                                style={{ color: 'var(--text-secondary)' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            )}
                            <button
                              className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(c.outline.id);
                              }}
                              title="删除"
                              style={{ color: 'var(--text-secondary)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--danger)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {orphanChapters.length > 0 && (
            <div className="mt-3">
              <div className="px-2 py-1 text-[10px] text-slate-400 uppercase">未归卷</div>
              {orphanChapters.map((c) => {
                const cActive = activeOutlineId === c.outline.id;
                return (
                  <div
                    key={c.outline.id}
                    className={[
                      'flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors',
                      cActive
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <span>📄</span>
                    <button
                      className="flex-1 min-w-0 text-xs text-left truncate"
                      onClick={() => handleSelect(c.outline.id, c.payload)}
                    >
                      {c.payload.title}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-t"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-toolbar)' }}
      >
        <button
          onClick={handleCreateVolume}
          className="px-2 py-1 text-xs rounded-md transition-colors"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          + 新增卷
        </button>
        <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{story?.title || ''}</div>
      </div>

      {ctxMenu && (
        <div
          className="fixed z-50 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
          }}
        >
          <ContextMenuItem
            label="重命名"
            onClick={() => {
              const o = outlines.find((x) => x.id === ctxMenu.outlineId);
              if (o) startEdit(o.id, parseOutlineContent(o.content).title);
              setCtxMenu(null);
            }}
          />
          {ctxMenu.type === 'volume' && (
            <ContextMenuItem
              label="新增章"
              onClick={() => {
                handleCreateChapter(ctxMenu.outlineId);
                setCtxMenu(null);
              }}
            />
          )}
          <div className="my-1 border-t" style={{ borderColor: 'var(--border-color)' }} />
          <ContextMenuItem
            label={ctxMenu.type === 'volume' ? '删除卷' : '删除章'}
            danger
            onClick={() => {
              handleDelete(ctxMenu.outlineId);
              setCtxMenu(null);
            }}
          />
        </div>
      )}
    </aside>
  );
}

function ContextMenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-xs transition-colors"
      style={{
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--danger-soft)' : 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {label}
    </button>
  );
}