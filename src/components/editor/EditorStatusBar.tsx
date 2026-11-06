import { memo, type CSSProperties } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Icon } from '../common/Icon';

interface BottomStatusBarProps {
  editorMode: 'visual' | 'bbcode';
  onSwitchMode: (mode: 'visual' | 'bbcode') => void;
}

// ========== 节编辑区上方面包屑（卷·章·节路径） ==========
// 性能优化:memo 包裹,避免父组件 re-render 时无谓刷新
export const EditorBreadcrumb = memo(function EditorBreadcrumb({
  volumeIdx,
  volumeTitle,
  chapterIdx,
  chapterTitle,
  sectionTitle,
}: {
  volumeIdx: number;
  volumeTitle: string;
  chapterIdx: number;
  chapterTitle: string;
  sectionTitle: string;
}) {
  return (
    <div
      className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 text-[12px] flex-wrap"
      style={{ background: 'var(--an-paper-2)', borderBottom: '2px solid var(--an-ink)', color: 'var(--an-ink-soft)' }}
    >
      <span className="text-[var(--an-ink)] font-semibold">
        {volumeTitle || '未命名卷'}
      </span>
      <span className="text-[var(--an-ink-faint)]">›</span>
      <span className="text-[var(--an-ink)] font-semibold">
        {chapterTitle || '未命名章'}
      </span>
      <span className="text-[var(--an-ink-faint)]">›</span>
      <span className="text-[var(--an-pink)] font-bold">
        {sectionTitle || '未命名节'}
      </span>
    </div>
  );
});

export function BottomStatusBar({
  editorMode,
  onSwitchMode,
}: BottomStatusBarProps) {
  const selectionStats = useEditorStore((s) => s.selectionStats);
  const cursorStyles = useEditorStore((s) => s.cursorStyles) ?? {};
  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    border: `2px solid ${active ? 'var(--an-ink)' : 'transparent'}`,
    borderRadius: '999px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    background: active ? 'var(--an-pink)' : 'transparent',
    color: active ? '#2a1a33' : 'var(--an-ink-soft)',
  });

  // 解析当前样式为标签文字（Word 风格格式查看器）
  const styleLabels: string[] = [];
  if (cursorStyles.bold) styleLabels.push('粗');
  if (cursorStyles.italic) styleLabels.push('斜');
  if (cursorStyles.underline) styleLabels.push('下划');
  if (cursorStyles.strike) styleLabels.push('删');
  if (cursorStyles.sup) styleLabels.push('上标');
  if (cursorStyles.sub) styleLabels.push('下标');
  // 字体名（去掉引号，截短）
  const fontName = cursorStyles.fontFamily
    ? cursorStyles.fontFamily.replace(/['"]/g, '').split(',')[0]?.trim() || ''
    : '';
  // 字号（去掉 px/pt）
  const fontSize = cursorStyles.fontSize
    ? cursorStyles.fontSize.replace(/px|pt|%/g, '').trim()
    : '';
  // 颜色（短写：#ff0000 → 红 / 标签）
  const colorLabel = (() => {
    const c = cursorStyles.color;
    if (!c) return '';
    if (c === '#000000' || c === 'rgb(0, 0, 0)' || c === 'black') return '黑';
    if (c === '#ff0000' || c === 'red') return '红';
    if (c === '#0000ff' || c === 'blue') return '蓝';
    if (c === '#008000' || c === 'green') return '绿';
    if (c === '#ffff00' || c === 'yellow') return '黄';
    if (c === '#ffa500' || c === 'orange') return '橙';
    if (c === '#800080' || c === 'purple') return '紫';
    if (c === '#ffffff' || c === 'white') return '白';
    return c;
  })();
  const hasAnyStyle = styleLabels.length > 0 || fontName || fontSize || colorLabel;
  const hasSelection = !!selectionStats;

  return (
    <footer
      className="shrink-0 flex items-center justify-between px-4 py-2 text-xs"
      style={{ background: 'var(--an-paper-2)', borderTop: '2px solid var(--an-ink)', color: 'var(--an-ink-soft)' }}
    >
      {/* 左侧：视图切换 */}
      <div
        className="flex items-center gap-1 p-0.5 rounded-full"
        style={{ background: 'var(--an-paper)', border: '2px solid var(--an-ink-faint)' }}
      >
        <button
          onClick={() => onSwitchMode('visual')}
          style={tabStyle(editorMode === 'visual')}
          onMouseEnter={(e) => {
            if (editorMode !== 'visual') {
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (editorMode !== 'visual') {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="palette" size={14} />
            可视化编辑
          </span>
        </button>
        <button
          onClick={() => onSwitchMode('bbcode')}
          style={tabStyle(editorMode === 'bbcode')}
          onMouseEnter={(e) => {
            if (editorMode !== 'bbcode') {
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (editorMode !== 'bbcode') {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="pen" size={14} />
            BBcode编辑
          </span>
        </button>
      </div>

      {/* 右侧：当前视图模式提示 + 快捷提示 */}
      <div className="flex items-center gap-3" style={{ color: 'var(--an-ink-soft)' }}>
        {selectionStats && (
          <span style={{ color: 'var(--an-pink)' }}>
            选中：{selectionStats.words} 字{selectionStats.dice > 0 ? ` · ${selectionStats.dice} 原子块` : ''}
          </span>
        )}
        {/* 当前样式（Word 风格格式查看器） */}
        {hasAnyStyle && (
          <span
            style={{
              color: 'var(--an-ink)',
              background: 'var(--an-lemon-soft)',
              border: '2px solid var(--an-ink)',
              padding: '2px 8px',
              borderRadius: '999px',
              maxWidth: 360,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={hasSelection ? '选区起点处的样式' : '光标处样式'}
          >
            {hasSelection ? '选区样式' : '光标样式'}：
            {styleLabels.length > 0 && (
              <span style={{ color: 'var(--an-pink)' }}>[{styleLabels.join('/')}]</span>
            )}
            {fontName && <span> {fontName}</span>}
            {fontSize && <span> {fontSize}px</span>}
            {colorLabel && <span> {colorLabel}</span>}
          </span>
        )}
        <span className="hidden md:inline">
          {editorMode === 'visual' ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="lightbulb" size={14} />
              可直接使用工具栏富文本编辑
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Icon name="lightbulb" size={14} />
              BBCode 与可视化共用同一份正文，编辑后会自动同步；BBCode 无法表达的格式以可视化视图为准
            </span>
          )}
        </span>
      </div>
    </footer>
  );
}
