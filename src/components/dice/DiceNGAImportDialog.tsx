// ============================================================
// DiceNGAImportDialog - 从 NGA 文本导入选项
// ------------------------------------------------------------
// 用途：
//   - 一个粘贴文本框：接收 "1楼 用户名：内容" 格式文本
//   - 文本框上方「收集安价」按钮：内联展开收集面板，复用应用的
//     收集安价管道（默认帖子 = 当前安科作品关联帖），结果回填文本框
//   - 确认后解析为选项列表（displayValue=序号, content=内容）并回调 onConfirm
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../common/Icon';
import { saveToHistory } from '../../utils/anjiaHistory';
import { useNgaCollectCommon } from '../../hooks/useNgaCollectCommon';
import { useStoryStore } from '../../store/storyStore';
import { CollectDecisionDialog } from '../common/CollectDecisionDialog';

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

/** 把收集结果格式化为可回填到文本框的文本（内容空白折叠） */
function formatCollectedText(items: { floor: number; author: string; content: string }[]): string {
  return items
    .map((item) => `${item.floor}楼 ${item.author}：${item.content.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
}

export function DiceNGAImportDialog({
  open,
  onClose,
  onConfirm,
}: DiceNGAImportDialogProps) {
  const [text, setText] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState('');
  const [collectSummary, setCollectSummary] = useState('');
  const activeStoryId = useStoryStore((s) => s.activeStoryId);

  const {
    url,
    setUrl,
    startFloor,
    setStartFloor,
    endFloor,
    setEndFloor,
    setEndFloorManuallyEdited,
    detecting,
    cookies,
    progress,
    progressMessage,
    paused,
    decision,
    handleAutoDetect,
    handleTogglePause,
    handleCancel,
    handleDecide,
  } = useNgaCollectCommon({ mode: 'anjia', active: collecting });

  // 打开时重置状态，并把默认帖子链接设为当前作品关联帖
  useEffect(() => {
    if (!open) return;
    setText('');
    setPanelOpen(false);
    setCollecting(false);
    setCollectError('');
    setCollectSummary('');
    setUrl('');
    setStartFloor('0');
    setEndFloor('20');
    setEndFloorManuallyEdited(false);
    if (activeStoryId && window.electronAPI?.ngaGetStoryLink) {
      void window.electronAPI
        .ngaGetStoryLink(activeStoryId)
        .then((res: { ok: boolean; link?: unknown }) => {
          const link = res?.link as { thread?: { url?: string } } | null;
          if (res?.ok && link?.thread?.url) setUrl(link.thread.url);
        })
        .catch(() => {
          /* 没有关联帖子时保持为空，用户可手动填写 */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeStoryId]);

  if (!open) return null;

  // 识别条数（非空行）
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  const canConfirm = lineCount > 0;

  const handleStartCollect = async () => {
    setCollectError('');
    setCollectSummary('');
    const threadUrl = url.trim();
    if (!threadUrl) {
      setCollectError('请填写 NGA 帖子链接');
      return;
    }
    if (!/[?&]tid=\d+/i.test(threadUrl)) {
      setCollectError('链接格式无效，需包含 tid=XXX 参数');
      return;
    }
    if (!window.electronAPI?.collectNga) {
      setCollectError('收集仅支持桌面版');
      return;
    }
    const start = Math.max(0, Number.parseInt(startFloor, 10) || 0);
    let end = Number.parseInt(endFloor, 10);
    setCollecting(true);
    try {
      // 末尾楼层留空 / 小于起始楼层时自动检测
      if (!Number.isFinite(end) || end < start) {
        const info = await window.electronAPI.fetchNgaThreadInfo?.(threadUrl, cookies || undefined);
        if (info?.ok && typeof info.totalFloors === 'number' && info.totalFloors >= start) {
          end = info.totalFloors;
          setEndFloor(String(end));
        } else {
          setCollectError('无法自动检测楼层，请手动填写末尾楼层');
          return;
        }
      }
      const res = await window.electronAPI.collectNga({
        url: threadUrl,
        startFloor: start,
        endFloor: end,
        prefix: '',
        cookies: cookies || undefined,
      });
      if (!res.ok) {
        setCollectError(res.error || '收集失败');
        return;
      }
      const items = (res.items ?? []) as { floor: number; author: string; content: string }[];
      if (items.length === 0) {
        setCollectError('未收集到楼层，请检查楼层范围或登录 Cookie');
        return;
      }
      setText(formatCollectedText(items));
      setCollectSummary(`已收集 ${items.length} 条，已填入下方文本框`);
      // 与「收集安价」共用同一份历史记录
      saveToHistory({ url: threadUrl, startFloor: start, endFloor: end, prefix: '', items });
    } catch (e) {
      setCollectError((e as Error).message || '收集失败');
    } finally {
      setCollecting(false);
    }
  };

  const handleConfirm = () => {
    const options = parseNgaTextToOptions(text);
    if (options.length === 0) return;
    onConfirm(options.map((o) => ({ displayValue: o.displayValue, content: o.content })));
    onClose();
  };

  const inputClass =
    'w-full bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] px-3 py-2 text-xs rounded-lg outline-none font-mono focus:border-[var(--accent)] transition-colors';

  return (
    <div
      className="fixed inset-0 bg-[var(--scrim)] flex items-center justify-center z-[1000] p-4"
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          width: 'min(680px, 94vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="px-6 pt-4 pb-3 border-b border-[color:var(--border-color)]">
          <h2 className="text-[var(--text-primary)] text-base font-semibold flex items-center gap-2">
            <span className="inline-flex items-center"><Icon name="download" size={14} /></span> 导入安价选项
          </h2>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            从当前作品关联的帖子收集，或直接粘贴 NGA 文本，确认后生成对应选项。
          </p>
        </div>

        {/* 主体 */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
          {/* 收集入口 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--accent)] hover:text-[var(--text-on-accent)] disabled:opacity-50"
              disabled={collecting}
            >
              <Icon name={panelOpen ? 'chevronDown' : 'download'} size={13} />
              收集安价
            </button>
            <span className="text-[var(--text-muted)] text-xs">
              默认使用当前作品关联的帖子
            </span>
          </div>

          {/* 内联收集面板 */}
          {panelOpen && (
            <div className="rounded-xl border border-[color:var(--border-color)] bg-[var(--bg-base)] p-3 space-y-2.5">
              <label className="block text-[var(--text-secondary)] text-xs font-medium">
                NGA 帖子链接
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://ngabbs.com/read.php?tid=123456"
                  className={`mt-1 ${inputClass}`}
                />
              </label>

              <div className="flex items-end gap-2 flex-wrap">
                <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  起始楼层
                  <input
                    type="number"
                    min={0}
                    value={startFloor}
                    onChange={(e) => setStartFloor(e.target.value)}
                    className="w-20 bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] px-2 py-1 rounded-lg outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  末尾楼层
                  <input
                    type="number"
                    min={0}
                    value={endFloor}
                    placeholder="自动检测"
                    onChange={(e) => {
                      setEndFloor(e.target.value);
                      setEndFloorManuallyEdited(true);
                    }}
                    className="w-24 bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] px-2 py-1 rounded-lg outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <button
                  onClick={() => void handleAutoDetect()}
                  disabled={detecting || collecting}
                  className="text-[var(--text-secondary)] bg-[var(--bg-hover)] px-2.5 py-1 rounded-lg text-xs transition-colors hover:text-[var(--accent)] disabled:opacity-50"
                >
                  {detecting ? '检测中…' : '自动检测'}
                </button>
                <button
                  onClick={() => void handleStartCollect()}
                  disabled={collecting}
                  className="ml-auto inline-flex items-center gap-1 bg-[var(--accent)] text-[var(--text-on-accent)] px-3.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  <Icon name="download" size={12} /> {collecting ? '收集中…' : '开始收集'}
                </button>
              </div>

              {!cookies && (
                <div className="text-[var(--text-muted)] text-[11px]">
                  提示：需要登录的帖子请先在设置里粘贴 NGA Cookie。
                </div>
              )}

              {collecting && (
                <div className="space-y-1.5">
                  <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] transition-all"
                      style={{
                        width: `${
                          progress.total > 0
                            ? Math.min(100, Math.round((progress.current / progress.total) * 100))
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <span className="truncate">
                      {progressMessage || '正在收集…'}
                      {progress.total > 0 ? `（${progress.current}/${progress.total}）` : ''}
                    </span>
                    <button
                      onClick={() => void handleTogglePause()}
                      className="ml-auto text-[var(--text-secondary)] hover:text-[var(--accent)]"
                    >
                      {paused ? '继续' : '暂停'}
                    </button>
                    <button
                      onClick={() => void handleCancel()}
                      className="text-[var(--text-secondary)] hover:text-[var(--danger)]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {collectError && <div className="text-[var(--danger)] text-xs">{collectError}</div>}
              {collectSummary && !collectError && (
                <div className="text-[var(--success)] text-xs inline-flex items-center gap-1">
                  <Icon name="check" size={12} /> {collectSummary}
                </div>
              )}
            </div>
          )}

          {/* 粘贴文本 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[var(--text-secondary)] text-xs font-medium">NGA 文本</label>
              <span className="text-[var(--text-muted)] text-xs">
                {lineCount > 0 ? `已识别 ${lineCount} 条` : '每行一条，如 1楼 用户A：内容'}
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`1楼 用户A：选项一的内容\n2楼 用户B：选项二的内容\n3楼 用户C：选项三的内容`}
              className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] min-h-[220px] w-full px-3 py-2 text-sm rounded-lg outline-none resize-y font-mono focus:border-[var(--accent)] transition-colors"
            />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-3 flex items-center justify-end gap-2 border-t border-[color:var(--border-color)]">
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] px-4 py-1.5 rounded-lg text-sm transition-colors hover:bg-[var(--bg-hover)]"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-4 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--accent)] hover:text-[var(--text-on-accent)] disabled:opacity-50 disabled:hover:bg-[var(--accent-bg)] disabled:hover:text-[var(--accent)]"
          >
            导入到骰子
          </button>
        </div>
      </div>

      <CollectDecisionDialog
        open={decision.open}
        message={decision.message}
        failedPages={decision.failedPages}
        onContinue={() => void handleDecide('continue')}
        onStop={() => void handleDecide('stop')}
        onSkip={() => void handleDecide('skip')}
      />
    </div>
  );
}
