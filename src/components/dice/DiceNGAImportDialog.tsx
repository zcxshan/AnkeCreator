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
import {
  formatHistoryTime,
  loadHistory,
  saveToHistory,
  type AnjiaHistoryEntry,
} from '../../utils/anjiaHistory';
import { useSettingStore } from '../../store/settingStore';
import { useStoryStore } from '../../store/storyStore';

export interface DiceNGAOption {
  displayValue: string;
  content: string;
  ok: boolean;
}

type ImportSource = 'fetch' | 'paste' | 'history';

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
  const [source, setSource] = useState<ImportSource>('fetch');
  const [history, setHistory] = useState<AnjiaHistoryEntry[]>([]);
  // 在线抓取（复用「收集安价」）：帖子链接默认取当前作品关联的 NGA 帖子
  const [threadUrl, setThreadUrl] = useState('');
  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const ngaCookies = useSettingStore((s) => s.ngaCookies);
  const activeStoryId = useStoryStore((s) => s.activeStoryId);

  // 打开时清空状态，并读取「收集安价」保存的抓取历史
  useEffect(() => {
    if (!open) return;
    setText('');
    setParsed([]);
    setSource('fetch');
    setHistory(loadHistory());
    setFetchError('');
    setThreadUrl('');
    // 默认帖子链接 = 当前安科作品关联的 NGA 主题帖
    if (activeStoryId && window.electronAPI?.ngaGetStoryLink) {
      void window.electronAPI
        .ngaGetStoryLink(activeStoryId)
        .then((res: { ok: boolean; link?: unknown }) => {
          const link = res?.link as { thread?: { url?: string } } | null;
          if (res?.ok && link?.thread?.url) setThreadUrl(link.thread.url);
        })
        .catch(() => {
          /* 没有关联帖子时保持为空，用户可手动填写 */
        });
    }
  }, [open, activeStoryId]);

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

  /** 从「收集安价」历史载入：同时填充文本框与预览，便于二次编辑 */
  const handlePickHistory = (entry: AnjiaHistoryEntry) => {
    setParsed(
      entry.items.map((item, i) => ({
        displayValue: String(i + 1),
        content: item.content,
        ok: true,
      })),
    );
    setText(
      entry.items
        .map((item) => `${item.floor}楼 ${item.author}：${item.content.replace(/\s+/g, ' ')}`)
        .join('\n'),
    );
    setSource('paste');
  };

  /** 在线抓取：复用「收集安价」的 collectNga 管道，抓完直接生成选项 */
  const handleFetch = async () => {
    setFetchError('');
    const url = threadUrl.trim();
    if (!url) {
      setFetchError('请填写 NGA 帖子链接');
      return;
    }
    if (!/[?&]tid=\d+/i.test(url)) {
      setFetchError('链接格式无效，需包含 tid=XXX 参数');
      return;
    }
    if (!window.electronAPI?.collectNga) {
      setFetchError('在线抓取仅支持桌面版');
      return;
    }
    const start = Math.max(0, Number.parseInt(startFloor, 10) || 0);
    let end = Number.parseInt(endFloor, 10);
    setFetching(true);
    try {
      // 未填写末尾楼层时先自动检测总楼层
      if (!Number.isFinite(end) || end < start) {
        const info = await window.electronAPI.fetchNgaThreadInfo?.(url, ngaCookies || undefined);
        if (info?.ok && typeof info.totalFloors === 'number' && info.totalFloors >= start) {
          end = info.totalFloors;
          setEndFloor(String(end));
        } else {
          setFetchError('无法自动检测楼层，请手动填写末尾楼层');
          return;
        }
      }
      const res = await window.electronAPI.collectNga({
        url,
        startFloor: start,
        endFloor: end,
        prefix: '',
        cookies: ngaCookies || undefined,
      });
      if (!res.ok) {
        setFetchError(res.error || '抓取失败');
        return;
      }
      const items = (res.items ?? []) as { floor: number; author: string; content: string }[];
      const options: DiceNGAOption[] = items.map((item, i) => ({
        displayValue: String(i + 1),
        content: item.content,
        ok: true,
      }));
      setParsed(options);
      setText(
        items
          .map((item) => `${item.floor}楼 ${item.author}：${item.content.replace(/\s+/g, ' ')}`)
          .join('\n'),
      );
      setHistory(loadHistory());
      if (options.length === 0) {
        setFetchError('未抓取到楼层，请检查楼层范围或登录 Cookie');
      } else {
        // 与「收集安价」共用同一份历史记录
        saveToHistory({
          url,
          startFloor: start,
          endFloor: end,
          prefix: '',
          items,
        });
        setHistory(loadHistory());
      }
    } catch (e) {
      setFetchError((e as Error).message || '抓取失败');
    } finally {
      setFetching(false);
    }
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
            <span className="inline-flex items-center"><Icon name="download" size={14} /></span> 从 NGA 导入安价选项
          </h2>
          <p
            className="text-[var(--text-muted)] text-xs mt-1"
          >
            直接抓取当前作品关联的 NGA 主题帖，也可以粘贴文本或从「收集安价」历史载入
          </p>
        </div>

        {/* 主体 */}
        <div
          className="min-h-[0px] px-6 py-4 overflow-y-auto flex-1"
        >
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setSource('fetch')}
              className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
              style={
                source === 'fetch'
                  ? { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }
                  : { background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid transparent' }
              }
            >
              在线抓取
            </button>
            <button
              onClick={() => setSource('paste')}
              className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
              style={
                source === 'paste'
                  ? { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }
                  : { background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid transparent' }
              }
            >
              粘贴文本
            </button>
            <button
              onClick={() => setSource('history')}
              className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
              style={
                source === 'history'
                  ? { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }
                  : { background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid transparent' }
              }
            >
              收集历史{history.length > 0 ? `（${history.length}）` : ''}
            </button>
          </div>
          {source === 'fetch' && (
            <div className="space-y-3">
              <label className="block text-[var(--text-secondary)] text-xs font-medium">
                NGA 帖子链接（默认当前作品关联的主题帖）
                <input
                  value={threadUrl}
                  onChange={(e) => setThreadUrl(e.target.value)}
                  placeholder="https://ngabbs.com/read.php?tid=123456"
                  className="mt-1 w-full bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] px-3 py-2 text-xs rounded-lg outline-none font-mono focus:border-[var(--accent)]"
                />
              </label>
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <label className="flex items-center gap-1">
                  起始楼层
                  <input
                    type="number"
                    min={0}
                    value={startFloor}
                    onChange={(e) => setStartFloor(e.target.value)}
                    className="w-20 bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] px-2 py-1 rounded-lg outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="flex items-center gap-1">
                  末尾楼层
                  <input
                    type="number"
                    min={0}
                    value={endFloor}
                    onChange={(e) => setEndFloor(e.target.value)}
                    placeholder="留空自动检测"
                    className="w-28 bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] px-2 py-1 rounded-lg outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <button
                  onClick={handleFetch}
                  disabled={fetching}
                  className="ml-auto bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-3.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon name="download" size={12} /> {fetching ? '抓取中…' : '抓取并生成选项'}
                  </span>
                </button>
              </div>
              {!ngaCookies && (
                <div className="text-[var(--text-muted)] text-[11px]">
                  提示：需要登录的帖子请先在设置里粘贴 NGA Cookie。
                </div>
              )}
              {fetchError && (
                <div className="text-[var(--danger)] text-xs">{fetchError}</div>
              )}
              {parsed.length > 0 && (
                <div className="bg-[var(--bg-base)] border border-[color:var(--border-color)] rounded-lg p-3 space-y-1.5 max-h-60 overflow-y-auto">
                  <div className="text-[var(--text-secondary)] text-xs font-medium mb-1">
                    已抓取 {parsed.length} 个选项
                  </div>
                  {parsed.map((opt, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-sm">
                      <span className="text-[var(--accent)] flex-shrink-0 w-6 text-right">
                        {opt.displayValue}.
                      </span>
                      <span className="text-[var(--text-primary)] break-words">{opt.content}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {source === 'history' && (
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="text-[var(--text-muted)] text-sm py-8 text-center">
                  还没有收集记录。先到「收集安价」抓取楼层，结果会自动出现在这里。
                </div>
              ) : (
                history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => handlePickHistory(entry)}
                    className="w-full text-left bg-[var(--bg-base)] border border-[color:var(--border-color)] rounded-lg px-3 py-2 transition-colors"
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  >
                    <div className="text-[var(--text-primary)] text-sm">{entry.label}</div>
                    <div className="text-[var(--text-muted)] text-xs mt-0.5">
                      {formatHistoryTime(entry.createdAt)} · {entry.items.length} 条
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
          {source === 'paste' && (
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
          )}
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
            disabled={!text.trim() && parsed.length === 0}
            className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            onMouseEnter={(e) => {
              if (text.trim() || parsed.length > 0) {
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
