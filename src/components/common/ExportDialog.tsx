import { useState, useMemo, useEffect } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useMetaStore } from '../../store/metaStore';
import { exportSectionToNGA } from '../../utils/ngaExporter';
import * as db from '../../db/database';
import type { Section } from '../../types';

interface ExportDialogProps {
  onClose: () => void;
  /** 当前激活节 id（由 EditorPage 同步过来）；空则提示"无节" */
  activeSectionId: string | null;
}

export function ExportDialog({ onClose, activeSectionId }: ExportDialogProps) {
  const { activeStoryId, stories } = useStoryStore();
  const characters = useMetaStore((s) => s.characters);
  const [copied, setCopied] = useState<string | null>(null);

  const story = stories.find((s) => s.id === activeStoryId);

  // 从数据库拉当前节：复用 getStoryWithAll 找到对应 section（数据量小）
  const [sectionRow, setSectionRow] = useState<Section | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeStoryId || !activeSectionId) {
      setSectionRow(null);
      return;
    }
    db.getStoryWithAll(activeStoryId).then((full) => {
      if (cancelled) return;
      if (!full) {
        setSectionRow(null);
        return;
      }
      for (const ch of full.chapters) {
        for (const sec of ch.sections) {
          if (sec.id === activeSectionId) {
            setSectionRow(sec);
            return;
          }
        }
      }
      setSectionRow(null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeStoryId, activeSectionId]);

  const result = useMemo(() => {
    if (!story || !sectionRow) return null;
    return exportSectionToNGA(story, sectionRow, {
      mark_characters: true,
      characters,
    });
  }, [story, sectionRow, characters]);

  const code = result?.code ?? '';
  const title = result?.title ?? '';

  // 可编辑副本：用户可在保存/复制前手动修改 BBCode
  const [editableCode, setEditableCode] = useState(code);
  useEffect(() => {
    setEditableCode(code);
  }, [code]);
  const isDirty = editableCode !== code;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(label);
        setTimeout(() => setCopied(null), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const saveAsTxt = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.txt') ? filename : `${filename}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const safeFilename = (name: string, fallback: string): string => {
    const base = (name || fallback).replace(/[\\/:*?"<>|]/g, '_').trim();
    return base || fallback;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="w-[960px] max-w-full h-[800px] max-h-full rounded-lg shadow-2xl flex flex-col"
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div>
            <div className="text-sm font-semibold">📋 导出当前节为 NGA 代码</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {story
                ? `故事：${story.title} · 节：${title || '未选择节'}（${editableCode.length} 字符${isDirty ? ' · 已修改' : ''}）`
                : '未选择故事'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none w-6 h-6 flex items-center justify-center rounded transition"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        {/* 工具栏 */}
        <div
          className="px-4 py-2 flex items-center gap-2"
          style={{
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-sidebar)',
          }}
        >
          <div className="flex-1" />
          {code && (
            <div className="flex items-center gap-1">
              {isDirty && (
                <button
                  onClick={() => {
                    setEditableCode(code);
                    setCopied('已恢复原始内容');
                    setTimeout(() => setCopied(null), 1500);
                  }}
                  className="text-xs px-3 py-1 rounded transition"
                  style={{
                    background: 'var(--bg-hover)',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--border-color)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  title="放弃当前修改，回到系统导出的原始内容"
                >
                  ↶ 恢复原始
                </button>
              )}
              <button
                onClick={() =>
                  saveAsTxt(
                    editableCode,
                    `${safeFilename(
                      (story?.title ?? 'nga-post') + '-' + (title || 'section'),
                      'nga-post',
                    )}`,
                  )
                }
                className="text-xs px-3 py-1 rounded transition"
                style={{
                  background: 'var(--bg-hover)',
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--border-color)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
              >
                保存为 .txt
              </button>
              <button
                onClick={() => copy(editableCode, '已复制本节')}
                className="text-xs px-3 py-1 rounded transition"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--text-on-accent)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--accent)';
                }}
              >
                {copied === '已复制本节' ? '✓ 已复制' : '复制本节'}
              </button>
            </div>
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {!story && (
            <div
              className="h-full flex flex-col items-center justify-center text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <div className="text-5xl mb-3 opacity-40">📖</div>
              <div>请先从左侧选择或创建一个故事</div>
            </div>
          )}

          {story && !sectionRow && (
            <div
              className="h-full flex flex-col items-center justify-center text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <div className="text-5xl mb-3 opacity-40">📝</div>
              <div>请先在左侧选择一个节</div>
              <div className="text-[10px] mt-1">导出对话框只显示当前节的内容</div>
            </div>
          )}

          {story && sectionRow && (
            <div>
              <div
                className="text-[10px] mb-2 font-mono"
                style={{ color: 'var(--text-secondary)' }}
              >
                本节内容（{editableCode.length} 字符{isDirty ? ' · 已修改' : ''}）
              </div>
              <textarea
      value={editableCode}
      onChange={(e) => setEditableCode(e.target.value)}
      placeholder="（当前节没有内容）"
      className="text-xs rounded p-3 font-mono"
      style={{
        background: 'var(--bg-sidebar)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
        flex: 1,
        minHeight: '520px',
        lineHeight: '1.6',
        resize: 'none',
        width: '100%',
        outline: 'none',
      }}
    />
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div
          className="px-4 py-2 flex items-center justify-between"
          style={{
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-sidebar)',
            color: 'var(--text-secondary)',
            fontSize: '10px',
          }}
        >
          <span>提示：导出的 BBCode 包含当前节的文字样式、图片、骰子、差分图片等</span>
          {copied && <span style={{ color: 'var(--success)' }}>✓ {copied}</span>}
        </div>
      </div>
    </div>
  );
}
