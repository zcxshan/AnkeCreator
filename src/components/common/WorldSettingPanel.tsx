import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorldSetting, WorldSettingTemplate, TextStyles } from '../../types';
import { useMetaStore } from '../../store/metaStore';
import { useStoryStore } from '../../store/storyStore';
import {
  WORD_FONT_SIZES,
  WORD_FONTS,
  WORD_DEFAULT_SIZE_PT,
  ptToPx,
  translateColorToCSS,
  translateFontToCSS,
} from '../../types';

/**
 * 世界观设定面板（浅色风格）
 *
 *  - 左侧列表：所有世界观条目卡片
 *  - 右侧编辑区：标题 + 富文本内容
 */
export function WorldSettingPanel() {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const worldSettings = useMetaStore((s) => s.worldSettings);
  const editingWorldId = useMetaStore((s) => s.editingWorldId);
  const createWorldSetting = useMetaStore((s) => s.createWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const editing = worldSettings.find((w) => w.id === editingWorldId) ?? null;

  return (
    <div className="flex-1 flex overflow-hidden" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* 左侧列表 */}
      <aside
        className="w-[280px] flex flex-col shrink-0"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)' }}
      >
        <div
          className="flex items-center justify-between px-3 py-2 gap-1"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-sidebar-header)' }}
        >
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>🌍 世界观设定</div>
          <div className="flex items-center gap-1">
            <ImportTemplateButton />
            <button
              onClick={() => activeStoryId && createWorldSetting(activeStoryId)}
              disabled={!activeStoryId}
              className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              title="新建世界观条目"
            >
              + 新建
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {!activeStoryId && (
            <div className="text-xs italic px-2 py-4" style={{ color: 'var(--text-secondary)' }}>
              请先选择或创建一个故事
            </div>
          )}
          {activeStoryId && worldSettings.length === 0 && (
            <div className="text-xs italic px-2 py-4" style={{ color: 'var(--text-secondary)' }}>
              暂无条目，点击上方"新建"
            </div>
          )}

          {worldSettings.map((ws) => (
            <WorldSettingCard
              key={ws.id}
              setting={ws}
              isActive={ws.id === editingWorldId}
              onClick={() => setEditingWorldId(ws.id)}
            />
          ))}
        </div>
      </aside>

      {/* 右侧编辑区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {editing ? (
          <WorldSettingEditor key={editing.id} setting={editing} />
        ) : (
          <EmptyHint storyId={activeStoryId} onCreate={() => activeStoryId && createWorldSetting(activeStoryId)} />
        )}
      </main>
    </div>
  );
}

function EmptyHint({ storyId, onCreate }: { storyId: string | null; onCreate: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="text-5xl mb-4 opacity-40">📜</div>
      <div className="text-lg mb-2" style={{ color: 'var(--text-primary)' }}>世界观设定</div>
      <div className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        {storyId ? '左侧选择条目，或点击下方按钮新建一条设定' : '请先选择一个故事'}
      </div>
      {storyId && (
        <button
          onClick={onCreate}
          className="text-sm px-3 py-1.5 rounded"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          + 新建世界观设定
        </button>
      )}
    </div>
  );
}

function WorldSettingCard({
  setting,
  isActive,
  onClick,
}: {
  setting: WorldSetting;
  isActive: boolean;
  onClick: () => void;
}) {
  const preview = (setting.content || '').replace(/\s+/g, ' ').trim();
  const shortPreview = preview.length > 50 ? preview.slice(0, 50) + '...' : preview || '（暂无内容）';

  const activeBg = isActive ? 'var(--accent-bg)' : 'var(--bg-card)';
  const activeBorder = isActive ? 'var(--accent)' : 'var(--border-color)';
  const activeColor = isActive ? 'var(--accent)' : 'var(--text-primary)';
  const subtitleColor = isActive ? 'var(--text-primary)' : 'var(--text-secondary)';

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded border p-2 transition"
      style={{ background: activeBg, borderColor: activeBorder, color: activeColor }}
    >
      <div className="text-sm font-semibold truncate">{setting.title}</div>
      <div className="text-xs mt-1 line-clamp-3" style={{ color: subtitleColor }}>
        {shortPreview}
      </div>
    </button>
  );
}

/** 世界观设定编辑器（标题 + 富文本内容区 + 删除） */
function WorldSettingEditor({ setting }: { setting: WorldSetting }) {
  const updateWorldSetting = useMetaStore((s) => s.updateWorldSetting);
  const deleteWorldSetting = useMetaStore((s) => s.deleteWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const [title, setTitle] = useState(setting.title);
  const [styles, setStyles] = useState<TextStyles>({
    size: WORD_DEFAULT_SIZE_PT,
    font: 'simsun',
  });
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(setting.title);
    if (contentRef.current) {
      contentRef.current.innerText = setting.content || '';
    }
  }, [setting.id]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== setting.title) {
      updateWorldSetting(setting.id, { title: trimmed });
    }
  };

  const commitContent = () => {
    const text = contentRef.current?.innerText ?? '';
    if (text !== setting.content) {
      updateWorldSetting(setting.id, { content: text });
    }
  };

  const applyStyle = (command: 'bold' | 'italic' | 'underline') => {
    document.execCommand(command, false);
  };

  const handleColor = (color: string) => {
    setStyles((s) => ({ ...s, color: s.color === color ? undefined : color }));
  };

  const handleDelete = () => {
    if (window.confirm(`删除"${setting.title}"？`)) {
      deleteWorldSetting(setting.id);
      setEditingWorldId(null);
    }
  };

  const cssStyle: React.CSSProperties = {
    fontFamily: translateFontToCSS(styles.font),
    fontSize: `${ptToPx(styles.size ?? WORD_DEFAULT_SIZE_PT)}px`,
    fontWeight: styles.bold ? 700 : 400,
    fontStyle: styles.italic ? 'italic' : 'normal',
    textDecoration: styles.underline ? 'underline' : 'none',
    color: translateColorToCSS(styles.color) ?? 'var(--text-primary)',
    lineHeight: 1.75,
  };

  const toolbarStyle = { background: 'var(--bg-toolbar)', borderBottom: '1px solid var(--border-color)' };
  const buttonStyle = { background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' } as React.CSSProperties;
  const selectStyle = { background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' } as React.CSSProperties;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={toolbarStyle}>
        <button
          onClick={() => applyStyle('bold')}
          className="px-2 py-1 text-xs rounded border"
          style={buttonStyle}
        >
          <strong>B</strong>
        </button>
        <button
          onClick={() => applyStyle('italic')}
          className="px-2 py-1 text-xs rounded border"
          style={buttonStyle}
        >
          <em>I</em>
        </button>
        <button
          onClick={() => applyStyle('underline')}
          className="px-2 py-1 text-xs rounded border"
          style={buttonStyle}
        >
          <u>U</u>
        </button>

        <div className="h-6 w-px" style={{ background: 'var(--border-color)' }} />

        <select
          value={styles.size ?? WORD_DEFAULT_SIZE_PT}
          onChange={(e) => setStyles((s) => ({ ...s, size: parseFloat(e.target.value) }))}
          className="border rounded text-xs px-2 py-1"
          style={selectStyle}
          title="字号"
        >
          {WORD_FONT_SIZES.map((s) => (
            <option key={s.label} value={s.pt ?? WORD_DEFAULT_SIZE_PT}>
              {s.label} ({s.pt}pt)
            </option>
          ))}
        </select>

        <select
          value={styles.font ?? 'simsun'}
          onChange={(e) => setStyles((s) => ({ ...s, font: e.target.value }))}
          className="border rounded text-xs px-2 py-1"
          style={selectStyle}
          title="字体"
        >
          {WORD_FONTS.map((f) => (
            <option key={f.label} value={f.value ?? 'simsun'}>
              {f.label}
            </option>
          ))}
        </select>

        <div className="flex gap-1 items-center" title="文字颜色">
          {['red', 'blue', 'green', 'orange', 'purple', 'skyblue', 'pink', 'yellow'].map((c) => (
            <button
              key={c}
              onClick={() => handleColor(c)}
              className="w-4 h-4 rounded border transition"
              style={{
                backgroundColor: translateColorToCSS(c),
                borderColor: styles.color === c ? 'var(--accent)' : 'var(--border-color)',
                transform: styles.color === c ? 'scale(1.1)' : 'scale(1)',
              }}
              title={c}
            />
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={commitContent}
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          保存
        </button>
        <button
          onClick={() => {
            const name = prompt('将该世界观保存为模板的标题：', setting.title);
            if (name == null) return;
            const text = contentRef.current?.innerText ?? setting.content ?? '';
            useMetaStore.getState().createWorldSettingTemplate({ title: name, content: text });
            alert('已保存为模板');
          }}
          className="text-xs px-2 py-1 rounded border"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
          title="把当前设定保存为模板"
        >
          存为模板
        </button>
        <button
          onClick={handleDelete}
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          删除
        </button>
      </div>

      {/* 标题 & 正文编辑区 */}
      <div className="flex-1 overflow-y-auto p-6 max-w-[900px] w-full mx-auto">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder="世界观设定标题..."
          className="w-full text-2xl font-bold bg-transparent outline-none py-2 mb-4"
          style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
        />

        <div
          ref={contentRef}
          contentEditable
          suppressContentEditableWarning
          onBlur={commitContent}
          defaultValue={setting.content || ''}
          className="min-h-[400px] border rounded p-4 outline-none whitespace-pre-wrap"
          style={{ ...cssStyle, background: 'var(--bg-editor)', borderColor: 'var(--border-color)' }}
          data-placeholder="在这里编写世界观设定..."
        />
        <div className="text-xs mt-2 font-mono" style={{ color: 'var(--text-secondary)' }}>
          {setting.content?.length ?? 0} 字 · 已保存
        </div>
      </div>
    </div>
  );
}

/** "从模板导入" 按钮：弹模态选模板 → 在当前 story 创建一条同内容的世界观条目 */
function ImportTemplateButton() {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const templates = useMetaStore((s) => s.worldSettingTemplates);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // 计算弹窗位置
  const updatePos = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
  };

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    updatePos();
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && btnRef.current.contains(e.target as Node)
      ) return;
      if (
        dropdownRef.current && dropdownRef.current.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const importOne = (t: WorldSettingTemplate) => {
    if (!activeStoryId) return;
    const id = useMetaStore.getState().createWorldSetting(activeStoryId, t.title, t.content);
    useMetaStore.getState().setEditingWorldId(id);
    setOpen(false);
    setSearch('');
  };

  const filtered = search.trim()
    ? templates.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : templates;
  const presetTemplates = filtered.filter((t) => t.is_preset);
  const customTemplates = filtered.filter((t) => !t.is_preset);

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
      {/* 搜索框 */}
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
      {/* 模板列表 */}
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
              {presetTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => importOne(t)}
                  className="w-full text-left px-3 py-2 text-xs transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                    {(t.content || '').replace(/<[^>]+>/g, '').slice(0, 50) || '（无内容）'}
                  </div>
                </button>
              ))}
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
              {customTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => importOne(t)}
                  className="w-full text-left px-3 py-2 text-xs transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                    {(t.content || '').replace(/<[^>]+>/g, '').slice(0, 50) || '（无内容）'}
                  </div>
                </button>
              ))}
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
        title="从模板库导入世界观"
      >
        导入模板
      </button>
      {open && createPortal(dropdownContent, document.body)}
    </>
  );
}
