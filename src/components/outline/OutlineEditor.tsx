import { useEffect, useState, useMemo } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { parseOutlineContent } from '../../types';

/** 尝试从可能是 TipTap JSON 的 body 里提取纯文本；若不是 JSON，原样返回 */
function extractPlainText(body: string): string {
  if (!body) return '';
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return body;
  try {
    const obj = JSON.parse(trimmed);
    if (!obj || typeof obj !== 'object') return body;
    // 常见的 old 结构: { type: 'doc', content: [...] } 或 { body: 'xxx' }
    if (typeof obj.body === 'string') return obj.body;
    const texts: string[] = [];
    const walk = (node: any) => {
      if (!node) return;
      if (typeof node.text === 'string') texts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
      if (Array.isArray(node.nodes)) node.nodes.forEach(walk);
    };
    walk(obj);
    if (texts.length > 0) return texts.join('\n');
    return body;
  } catch {
    return body;
  }
}

export function OutlineEditor() {
  const { stories, activeStoryId, volumes, chapters, outlines, activeOutlineId, updateOutline } =
    useStoryStore();

  const [localBody, setLocalBody] = useState<string>('');
  const [savedFlash, setSavedFlash] = useState(false);

  const story = stories.find((s) => s.id === activeStoryId);
  const outline = outlines.find((o) => o.id === activeOutlineId);
  const payload = outline ? parseOutlineContent(outline.content) : null;

  // 大纲标题：基于 outline 自身 + 父卷 outline 派生
  // 之前错误：linkedVolume/linkedChapter 在 volumes/chapters 数组里查，但 target_id 实际指向 outlines 数组
  const displayTitle = useMemo(() => {
    if (!payload) return story?.title || '大纲';

    const parentOutline =
      payload.target_type === 'chapter' && payload.parent_outline_id
        ? outlines.find((o) => o.id === payload.parent_outline_id)
        : null;
    const parentTitle = parentOutline
      ? parseOutlineContent(parentOutline.content).title || '未命名卷'
      : '';
    const currentTitle = payload.title || '未命名';

    if (payload.target_type === 'volume') {
      return currentTitle;
    }
    if (payload.target_type === 'chapter') {
      return `${parentTitle ? parentTitle + ' · ' : ''}${currentTitle}`;
    }
    return story?.title || '大纲';
  }, [payload, outlines, story]);

  // 切条目时载入 body：
  //  - 旧 TipTap JSON → 提取纯文本；
  //  - 普通文本 → 原样；
  //  - 空 → 空。
  useEffect(() => {
    if (outline && payload) {
      const raw = payload.body || '';
      const plain = extractPlainText(raw);
      setLocalBody(plain);
    } else {
      setLocalBody('');
    }
  }, [outline?.id]);

  // 防抖自动保存：500ms
  useEffect(() => {
    if (!outline) return;
    const handler = window.setTimeout(() => {
      updateOutline(outline.id, { body: localBody });
    }, 500);
    return () => window.clearTimeout(handler);
  }, [localBody, outline, updateOutline]);

  const handleSave = () => {
    if (!outline) return;
    updateOutline(outline.id, { body: localBody });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  };

  const handleBlur = () => {
    if (!outline) return;
    updateOutline(outline.id, { body: localBody });
  };

  const wordCount = useMemo(() => localBody.replace(/\s/g, '').length, [localBody]);
  const lineCount = useMemo(() => (localBody ? localBody.split(/\r?\n/).length : 0), [localBody]);

  if (!outline || !payload) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center p-8"
        style={{ background: 'var(--bg-page)' }}
      >
        <div className="text-6xl mb-4 opacity-30">📝</div>
        <div className="text-sm font-medium text-slate-600">选择左侧目录开始编写大纲</div>
        <div className="text-xs text-slate-400 mt-1">点击卷或章即可编辑对应的大纲描述</div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-page)' }}
    >
      {/* 顶部标题栏 */}
      <header
        className="shrink-0 flex items-center gap-3 px-6 py-4 border-b"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
      >
        <span className="shrink-0 text-lg">
          {payload.target_type === 'volume' ? '📑' : '📄'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{displayTitle}</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {payload.target_type === 'volume'
              ? '本卷概述、核心剧情、重要角色等'
              : '本章概要、关键事件、角色互动等'}
          </div>
        </div>
      </header>

      {/* 编辑区 */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[780px] mx-auto px-8 py-6">
            <textarea
              value={localBody}
              onChange={(e) => setLocalBody(e.target.value)}
              onBlur={handleBlur}
              placeholder="在这里编写卷/章的大纲描述...&#10;&#10;示例：&#10;# 核心主题&#10;- 角色目标与冲突&#10;- 关键事件推进&#10;1. 开篇&#10;2. 冲突"
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: '52vh',
                resize: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '24px 28px',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: 14,
                lineHeight: 1.75,
                outline: 'none',
                boxShadow: '0 1px 2px var(--shadow)',
              }}
            />
          </div>
        </div>
      </main>

      {/* 底部状态栏 */}
      <footer
        className="shrink-0 flex items-center justify-between px-4 py-2 border-t"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            保存
          </button>
          {savedFlash && <span className="text-[10px] text-emerald-600">已保存</span>}
        </div>
        <div className="text-[10px] text-slate-400">
          {wordCount} 字 · {lineCount} 行 · 停止输入 500ms 自动保存
        </div>
      </footer>
    </div>
  );
}
