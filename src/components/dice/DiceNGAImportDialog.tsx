// ============================================================
// DiceNGAImportDialog - 从 NGA 文本导入选项
// ------------------------------------------------------------
// 用途：
//   - 接收用户粘贴的 "1楼 用户名：内容" 格式文本
//   - 解析为选项列表（displayValue=序号, content=内容）
//   - 确认后调 onConfirm 回调（由调用方传给 DiceConfigDialog 预填）
//
// 适用场景：
//   - 用户在「收集安价」页面抓取了 NGA 帖子
//   - 点击「复制 NGA 格式」得到 BBCode 文本
//   - 在编辑器里点击「📥 导入安价」→ 粘贴 → 生成对应选项骰子
// ============================================================

import { useEffect, useState } from 'react';
import { Icon } from '../common/Icon';

export interface DiceNGAOption {
  displayValue: string;
  content: string;
  ok: boolean;
}

interface DiceNGAImportDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: { displayValue: string; content: string }[]) => void;
}

/**
 * 解析 NGA 文本为选项数组
 * - 按行分割
 * - 每行尝试匹配 "N楼 用户名：内容" 或 "N楼 用户名: 内容"
 * - 匹配成功：content = 冒号后的内容
 * - 匹配失败：整行作为 content（兜底，不会失败）
 */
function parseNgaTextToOptions(text: string): DiceNGAOption[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line, i) => {
    const m = line.match(/^\d+楼\s+([^：:]+)[：:]\s*(.+)$/);
    if (m) {
      return { displayValue: String(i + 1), content: m[2].trim(), ok: true };
    }
    // 兜底：整行作为 content
    return { displayValue: String(i + 1), content: line, ok: true };
  });
}

export function DiceNGAImportDialog({
  open,
  onClose,
  onConfirm,
}: DiceNGAImportDialogProps) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<DiceNGAOption[]>([]);

  // 打开时清空状态
  useEffect(() => {
    if (open) {
      setText('');
      setParsed([]);
    }
  }, [open]);

  if (!open) return null;

  const handleParse = () => {
    const result = parseNgaTextToOptions(text);
    setParsed(result);
  };

  const handleConfirm = () => {
    if (parsed.length === 0) {
      // 没有解析结果时直接解析当前文本
      const result = parseNgaTextToOptions(text);
      if (result.length === 0) {
        return;
      }
      onConfirm(result.map((o) => ({ displayValue: o.displayValue, content: o.content })));
    } else {
      onConfirm(parsed.map((o) => ({ displayValue: o.displayValue, content: o.content })));
    }
    onClose();
  };

  const handlePasteSample = () => {
    setText('1楼 用户A：选项一的内容描述\n2楼 用户B：选项二的内容描述\n3楼 用户C：选项三的内容描述');
    setParsed([]);
  };

  return (
    <div
      className="fixed inset-0 bg-[var(--scrim)] flex items-center justify-center z-[1000]"
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          width: 'min(640px, 92vw)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div
          className="border-[color:var(--border-color)] px-6 py-4 border-b"
        >
          <h2
            className="text-[var(--text-primary)] text-base font-semibold flex items-center gap-2"
          >
            <span className="inline-flex items-center"><Icon name="download" size={14} /></span> 从 NGA 文本导入选项
          </h2>
          <p
            className="text-[var(--text-muted)] text-xs mt-1"
          >
            粘贴 <code className="bg-[var(--bg-hover)] py-[1px] px-[4px] rounded-[var(--radius-chip)]">1楼 用户名：内容</code> 格式文本（每行一个选项）
          </p>
        </div>

        {/* 主体 */}
        <div
          className="min-h-[0px] px-6 py-4 overflow-y-auto flex-1"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label
                className="text-[var(--text-secondary)] text-xs font-medium"
              >
                NGA 文本
              </label>
              <button
                onClick={handlePasteSample}
                className="text-[var(--text-muted)] bg-[var(--bg-hover)] text-xs px-2 py-0.5 rounded transition-colors"
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                填入示例
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`1楼 用户A：选项一的内容\n2楼 用户B：选项二的内容\n3楼 用户C：选项三的内容`}
              rows={10}
              className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] min-h-[180px] w-full px-3 py-2 text-sm rounded-lg outline-none resize-y font-mono"
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            />

            <div className="flex items-center justify-between">
              <button
                onClick={handleParse}
                disabled={!text.trim()}
                className="bg-[var(--bg-input)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                onMouseEnter={(e) => {
                  if (text.trim()) {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.color = 'var(--accent)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
              >
                <span className="inline-flex items-center gap-1"><Icon name="search" size={12} /> 解析</span>
              </button>
              <span
                className="text-[var(--text-muted)] text-xs"
              >
                {parsed.length > 0 ? `已解析 ${parsed.length} 个选项` : text.trim() ? '点击解析' : '请粘贴文本'}
              </span>
            </div>

            {/* 预览列表 */}
            {parsed.length > 0 && (
              <div
                className="bg-[var(--bg-base)] border border-[color:var(--border-color)] rounded-lg p-3 space-y-1.5 max-h-60 overflow-y-auto"
              >
                <div
                  className="text-[var(--text-secondary)] text-xs font-medium mb-1"
                >
                  预览
                </div>
                {parsed.map((opt, i) => (
                  <div
                    key={i}
                    className="flex items-baseline gap-2 text-sm"
                  >
                    <span
                      className="text-[var(--accent)] flex-shrink-0 w-6 text-right"
                    >
                      {opt.displayValue}.
                    </span>
                    <span
                      className="text-[var(--text-primary)] break-words"
                    >
                      {opt.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div
          className="border-[color:var(--border-color)] px-6 py-3 flex items-center justify-end gap-2 border-t"
        >
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] px-4 py-1.5 rounded-lg text-sm transition-colors"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!text.trim()}
            className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            onMouseEnter={(e) => {
              if (text.trim()) {
                e.currentTarget.style.background = 'var(--accent)';
                e.currentTarget.style.color = 'var(--text-on-accent)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent-bg)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
          >
            导入到骰子
          </button>
        </div>
      </div>
    </div>
  );
}
