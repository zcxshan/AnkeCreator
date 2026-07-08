// ============================================================
// AnjiaCollectPage：收集安价（独立页面）
// 高内聚：本页自包含安价收集的全部 UI + 安价专属状态/handlers
// 低耦合：共享管道逻辑通过 useNgaCollectCommon hook 接入
// - 表单：NGA 链接 / 起始楼层 / 末尾楼层 / 匹配文本（可留空 = 全部）
// - 可选 authorid（从 URL 的 ?authorid=XXX 自动解析）
// - 进度 / 取消 / 暂停 / 失败页重试 / 结果列表 / 历史记录
// ============================================================
import { useState, useEffect } from 'react';
import {
  formatForClipboard,
  formatAsNGABBCode,
  type AnjiaItem,
  type MatchMode,
} from '../../utils/ngaCrawler';
import {
  loadHistory,
  saveToHistory,
  deleteFromHistory,
  formatHistoryTime,
  type AnjiaHistoryEntry,
} from '../../utils/anjiaHistory';
import { isCapacitor } from '../../utils/platform';
import { CollectDecisionDialog } from '../common/CollectDecisionDialog';
import { useNgaCollectCommon } from '../../hooks/useNgaCollectCommon';

interface AnjiaCollectPageProps {
  onBack: () => void;
}

type Status = 'idle' | 'collecting' | 'done' | 'error';

const MAX_FLOOR_RANGE = 1000; // 一次最多 1000 楼（50 页）
const WARN_FLOOR_RANGE = 200; // 超过 200 楼给提示

export function AnjiaCollectPage({ onBack }: AnjiaCollectPageProps) {
  // 安价专属表单状态
  const [prefix, setPrefix] = useState('安价'); // 默认匹配文本设为"安价"
  const [matchMode, setMatchMode] = useState<MatchMode>('prefix');

  // 安价专属抓取状态
  const [status, setStatus] = useState<Status>('idle');
  const [items, setItems] = useState<AnjiaItem[]>([]);
  const [error, setError] = useState<string>('');
  const [warnings, setWarnings] = useState<string>('');
  const [actualMaxFloor, setActualMaxFloor] = useState<number | null>(null);

  // 删除栈（撤销）
  const [deletedStack, setDeletedStack] = useState<
    { item: AnjiaItem; index: number }[]
  >([]);

  // 历史
  const [history, setHistory] = useState<AnjiaHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);

  // 共享管道逻辑
  const {
    cookies: ngaCookies,
    showToast,
    url,
    setUrl,
    startFloor,
    setStartFloor,
    endFloor,
    setEndFloor,
    setEndFloorManuallyEdited,
    detecting,
    progress,
    setProgress,
    progressMessage,
    setProgressMessage,
    paused,
    setPaused,
    failedPages,
    setFailedPages,
    retrying,
    setRetrying,
    failedPagesExpanded,
    setFailedPagesExpanded,
    decision,
    setDecision,
    parsedAuthorid,
    clearAuthorid,
    handleAutoDetect,
    handleTogglePause,
    handleCancel,
    handleDecide,
  } = useNgaCollectCommon({ mode: 'anjia', active: status === 'collecting' });

  // 移动端（Capacitor）且无 Electron API 时，展示不支持提示卡片
  const isMobileUnsupported = isCapacitor && !window.electronAPI?.collectNga;

  // 启动时加载历史
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  /** 校验表单 */
  const validate = (): { ok: boolean; message?: string } => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return { ok: false, message: '请输入 NGA 主题帖链接' };
    if (!/[?&]tid=\d+/i.test(trimmedUrl)) {
      return { ok: false, message: '链接格式无效，请检查是否包含 tid=XXX 参数' };
    }
    const start = parseInt(startFloor, 10);
    const end = parseInt(endFloor, 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < 1) {
      return { ok: false, message: '楼层数必须为正整数' };
    }
    if (end < start) {
      return { ok: false, message: '末尾楼层必须 >= 起始楼层' };
    }
    if (end - start + 1 > MAX_FLOOR_RANGE) {
      return {
        ok: false,
        message: `范围过大（最多 ${MAX_FLOOR_RANGE} 楼），请缩小范围以避免触发 NGA 限流`,
      };
    }
    return { ok: true };
  };

  const handleCollect = async () => {
    const v = validate();
    if (!v.ok) {
      showToast(v.message || '参数错误', 'error');
      return;
    }

    const start = parseInt(startFloor, 10);
    const end = parseInt(endFloor, 10);
    const range = end - start + 1;

    if (range > WARN_FLOOR_RANGE) {
      showToast(
        `范围 ${range} 楼，抓取可能需要 ${Math.ceil(range / 20) * 0.3} 秒以上`,
        'info',
      );
    }

    setStatus('collecting');
    setItems([]);
    setError('');
    setWarnings('');
    setFailedPages([]);
    setActualMaxFloor(null);
    setPaused(false);
    setProgressMessage('准备抓取...');
    setDeletedStack([]); // 重新抓取清空撤销栈
    setLastSavedId(null);
    const totalPages = Math.ceil(end / 20) - Math.ceil(start / 20) + 1;
    setProgress({ current: 0, total: totalPages });

    try {
      if (!window.electronAPI?.collectNga) {
        if (isCapacitor) return; // 移动端用户看到提示卡片，不抛错
        throw new Error('安价收集仅支持 Electron 应用，请在桌面端运行');
      }
      const res = await window.electronAPI.collectNga({
        url: url.trim(),
        startFloor: start,
        endFloor: end,
        prefix: prefix.trim(),
        matchMode,
        authorid: parsedAuthorid,
        cookies: ngaCookies || undefined,
      });
      if (!res.ok) {
        setStatus('error');
        setError(res.error || '抓取失败');
        return;
      }
      setProgress({ current: res.totalPages, total: res.totalPages });
      setItems(res.items);
      setFailedPages(res.failedPages || []);
      setActualMaxFloor(res.actualMaxFloor ?? null);
      if (res.items.length === 0) {
        setStatus('done');
        const prefixDesc = prefix.trim() ? `以 "${prefix}" 开头` : '匹配';
        setWarnings(
          `未找到${prefixDesc}的楼层。请确认：\n` +
            `1. 起始/末尾楼层是否正确\n` +
            `2. 匹配文本是否与帖子中的文字一致（含空格/标点）\n` +
            (ngaCookies
              ? `3. 当前 Cookie 已配置但仍无结果，请检查 Cookie 是否过期`
              : `3. 如帖子需登录，请在设置中粘贴 NGA Cookie 后重试`),
        );
        showToast('未找到匹配楼层', 'info');
      } else {
        setStatus('done');
        const hasFailures = (res.failedPages || []).length > 0;
        if (hasFailures) {
          showToast(`已收集 ${res.items.length} 条（${res.failedPages!.length} 页失败，可重试）`, 'warning');
        } else {
          showToast(`已收集 ${res.items.length} 条`, 'success');
        }
      }
    } catch (e) {
      setStatus('error');
      setError((e as Error).message || '抓取失败');
    }
  };

  // 重试失败页：只抓取 failedPages 中的页码，合并到现有 items
  const handleRetryFailedPages = async () => {
    if (failedPages.length === 0) return;
    if (!window.electronAPI?.collectNga) return;

    const start = parseInt(startFloor, 10);
    const end = parseInt(endFloor, 10);

    setRetrying(true);
    setFailedPages([]); // 清空，重试后用新结果覆盖
    setStatus('collecting');
    setProgressMessage(`正在重试 ${failedPages.length} 个失败页...`);
    setProgress({ current: 0, total: failedPages.length });

    try {
      const res = await window.electronAPI.collectNga({
        url: url.trim(),
        startFloor: start,
        endFloor: end,
        prefix: prefix.trim(),
        matchMode,
        authorid: parsedAuthorid,
        cookies: ngaCookies || undefined,
        retryPages: failedPages,
      });
      if (!res.ok) {
        setStatus('error');
        setError(res.error || '重试失败');
        setRetrying(false);
        return;
      }
      // 合并：按 floor 去重，重试结果覆盖已有
      const newItems = [...items];
      for (const newItem of res.items) {
        const idx = newItems.findIndex((it) => it.floor === newItem.floor);
        if (idx >= 0) {
          newItems[idx] = newItem;
        } else {
          newItems.push(newItem);
        }
      }
      newItems.sort((a, b) => a.floor - b.floor);
      setItems(newItems);
      setFailedPages(res.failedPages || []);
      setStatus('done');
      const stillFailed = (res.failedPages || []).length;
      if (stillFailed > 0) {
        showToast(`重试完成，仍有 ${stillFailed} 页失败`, 'warning');
      } else {
        showToast(`重试完成，已补齐 ${res.items.length} 条`, 'success');
      }
    } catch (e) {
      setStatus('error');
      setError((e as Error).message || '重试失败');
    } finally {
      setRetrying(false);
    }
  };

  const handleSkipFailedPages = () => {
    setFailedPages([]);
    showToast('已跳过失败页，使用当前结果', 'info');
  };

  const handleReset = () => {
    setStatus('idle');
    setItems([]);
    setError('');
    setWarnings('');
    setFailedPages([]);
    setActualMaxFloor(null);
    setRetrying(false);
    setProgress({ current: 0, total: 0 });
    setProgressMessage('');
    setPaused(false);
    setDeletedStack([]);
    setLastSavedId(null);
  };

  // 删除单条 + 撤销
  const handleDelete = (item: AnjiaItem, index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDeletedStack((prev) => [...prev, { item, index }]);
    showToast(`已删除 ${item.floor}楼 ${item.author}`, 'info', {
      undo: () => {
        setItems((prev) => {
          const next = [...prev];
          const at = Math.min(index, next.length);
          next.splice(at, 0, item);
          return next;
        });
        setDeletedStack((prev) => prev.slice(0, -1));
      },
    });
  };

  const copyNGABBCode = async () => {
    if (items.length === 0) return;
    const text = formatAsNGABBCode(items);
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 NGA 格式（${items.length} 条）`, 'success');
    } catch {
      fallbackCopy(text);
      showToast(`已复制 NGA 格式（${items.length} 条）`, 'success');
    }
  };

  const copyAll = async () => {
    if (items.length === 0) return;
    const text = formatForClipboard(items);
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 ${items.length} 条到剪贴板`, 'success');
    } catch {
      fallbackCopy(text);
      showToast(`已复制 ${items.length} 条到剪贴板`, 'success');
    }
  };

  const copyOne = async (item: AnjiaItem) => {
    const text = `${item.floor}楼 ${item.author}：${item.content}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 ${item.floor}楼`, 'success');
    } catch {
      fallbackCopy(text);
      showToast(`已复制 ${item.floor}楼`, 'success');
    }
  };

  const handleSaveToHistory = () => {
    if (items.length === 0) return;
    const start = parseInt(startFloor, 10);
    const end = parseInt(endFloor, 10);
    if (isNaN(start) || isNaN(end)) return;
    const entry = saveToHistory({
      url: url.trim(),
      startFloor: start,
      endFloor: end,
      prefix: prefix.trim(),
      authorid: parsedAuthorid,
      items,
    });
    setLastSavedId(entry.id);
    setHistory(loadHistory());
    showToast('已保存到历史', 'success');
  };

  const handleLoadHistory = (entry: AnjiaHistoryEntry) => {
    setUrl(entry.url);
    setStartFloor(String(entry.startFloor));
    setEndFloor(String(entry.endFloor));
    setPrefix(entry.prefix);
    setEndFloorManuallyEdited(true);
    setItems(entry.items);
    setDeletedStack([]);
    setStatus('done');
    setError('');
    setWarnings('');
    setHistoryOpen(false);
    showToast(`已加载历史：${entry.label}`, 'success');
  };

  const handleDeleteHistory = (id: string) => {
    deleteFromHistory(id);
    setHistory(loadHistory());
    if (lastSavedId === id) setLastSavedId(null);
  };

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* 顶栏 */}
      <div
        className="flex items-center gap-3 px-6 py-4 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          ← 返回
        </button>
        <h1
          className="text-lg font-semibold flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <span>📜</span> 收集安价
        </h1>
        <div className="ml-auto flex items-center gap-2 relative">
          {/* 历史按钮 */}
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{
              background: historyOpen ? 'var(--bg-hover)' : 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = historyOpen
                ? 'var(--bg-hover)'
                : 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            📂 历史{history.length > 0 ? ` (${history.length})` : ''}
          </button>
          <div
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            抓取 NGA 主题帖中"以指定文本开头"的楼层
          </div>
          {/* 历史下拉 */}
          {historyOpen && (
            <div
              className="absolute top-full right-0 mt-2 w-96 max-h-96 overflow-y-auto rounded-lg shadow-lg z-10"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
              }}
            >
              {history.length === 0 ? (
                <div
                  className="px-4 py-6 text-center text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  暂无历史
                </div>
              ) : (
                <div className="p-1">
                  {history.map((entry) => (
                    <div
                      key={entry.id}
                      className="px-3 py-2 rounded transition-colors"
                      style={{
                        background:
                          lastSavedId === entry.id
                            ? 'var(--accent-bg)'
                            : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background =
                          lastSavedId === entry.id
                            ? 'var(--accent-bg)'
                            : 'transparent';
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-xs truncate"
                            style={{ color: 'var(--text-primary)' }}
                            title={entry.label}
                          >
                            {entry.label}
                          </div>
                          <div
                            className="text-xs mt-0.5"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {formatHistoryTime(entry.createdAt)} · {entry.items.length} 条
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleLoadHistory(entry)}
                            className="px-2 py-1 rounded text-xs transition-colors"
                            style={{
                              color: 'var(--accent)',
                              background: 'var(--accent-bg)',
                              border: '1px solid var(--accent)',
                            }}
                            title="加载此历史"
                          >
                            加载
                          </button>
                          <button
                            onClick={() => handleDeleteHistory(entry.id)}
                            className="px-2 py-1 rounded text-xs transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color =
                                'var(--danger, #dc2626)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'var(--text-muted)';
                            }}
                            title="删除此历史"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isMobileUnsupported ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-6">
          <div className="max-w-4xl mx-auto">
            <section
              className="rounded-2xl p-8 text-center"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
            >
              <div className="text-4xl mb-4">💻</div>
              <h2
                className="text-lg font-semibold mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                移动端暂不支持收集
              </h2>
              <p
                className="text-sm mb-4"
                style={{ color: 'var(--text-secondary)' }}
              >
                收集安价功能需要在桌面端（Electron）使用。请在电脑上安装安科作者助手后使用此功能。
              </p>
              <button
                onClick={() => showToast('请访问官网下载桌面版', 'info')}
                className="px-4 py-2 rounded-lg text-sm transition-colors"
                style={{
                  border: '1px solid var(--accent)',
                  background: 'transparent',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                }}
              >
                了解桌面版
              </button>
            </section>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-6">
            <div className="max-w-4xl mx-auto space-y-4 md:space-y-5">
              {/* 表单卡片 */}
              <section
                className="rounded-2xl p-5"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
              >
                <h2
                  className="text-sm font-semibold mb-4"
                  style={{ color: 'var(--text-primary)' }}
                >
                  抓取条件
                </h2>

                <div className="space-y-4">
                  {/* URL + 自动检测 */}
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      NGA 主题帖链接
                    </label>
                    <div className="flex items-stretch gap-2">
                      <input
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://nga.178.com/read.php?tid=12345（可加 &authorid=XXX 仅收集该用户）"
                        disabled={status === 'collecting'}
                        className="flex-1 px-3.5 py-2 text-sm rounded-lg outline-none transition-all disabled:opacity-50"
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                        }}
                      />
                      <button
                        onClick={handleAutoDetect}
                        disabled={status === 'collecting' || detecting}
                        className="px-3 py-2 text-xs rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                        style={{
                          background: 'var(--bg-hover)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)',
                        }}
                        onMouseEnter={(e) => {
                          if (status !== 'collecting' && !detecting) {
                            e.currentTarget.style.borderColor = 'var(--accent)';
                            e.currentTarget.style.color = 'var(--accent)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                          e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                        title="自动检测主题帖总页数"
                      >
                        {detecting ? (
                          <>
                            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                            检测中
                          </>
                        ) : (
                          <>🔍 自动检测</>
                        )}
                      </button>
                    </div>
                    {/* authorid 徽章 */}
                    {parsedAuthorid && (
                      <div
                        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                        style={{
                          background: 'var(--accent-bg)',
                          color: 'var(--accent)',
                          border: '1px solid var(--accent)',
                        }}
                        title="仅收集该用户的回复"
                      >
                        <span>🎯</span>
                        <span>仅收集用户 uid={parsedAuthorid} 的回复</span>
                        <button
                          onClick={clearAuthorid}
                          disabled={status === 'collecting'}
                          className="ml-0.5 px-1 rounded transition-colors disabled:opacity-50"
                          style={{ color: 'var(--accent)' }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0,0,0,0.08)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                          title="清除用户筛选（恢复全员）"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 楼层范围 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        className="block text-xs font-medium mb-1.5"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        起始楼层
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={startFloor}
                        onChange={(e) => setStartFloor(e.target.value)}
                        disabled={status === 'collecting'}
                        className="w-full px-3.5 py-2 text-sm rounded-lg outline-none transition-all disabled:opacity-50"
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                        }}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1.5"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        末尾楼层
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={endFloor}
                        onChange={(e) => {
                          setEndFloor(e.target.value);
                          setEndFloorManuallyEdited(true);
                        }}
                        disabled={status === 'collecting'}
                        className="w-full px-3.5 py-2 text-sm rounded-lg outline-none transition-all disabled:opacity-50"
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                        }}
                      />
                    </div>
                  </div>

                  {/* 匹配文本 + 匹配模式 */}
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      匹配文本（可留空）
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        placeholder={
                          matchMode === 'regex'
                            ? '正则表达式，如 ^安价\\d+'
                            : '留空则匹配所有楼层'
                        }
                        disabled={status === 'collecting'}
                        className="flex-1 px-3.5 py-2 text-sm rounded-lg outline-none transition-all disabled:opacity-50"
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                        }}
                      />
                      <select
                        value={matchMode}
                        onChange={(e) => setMatchMode(e.target.value as MatchMode)}
                        disabled={status === 'collecting'}
                        className="px-3 py-2 text-sm rounded-lg outline-none transition-all disabled:opacity-50"
                        style={{
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                        title="匹配模式"
                      >
                        <option value="prefix">前缀匹配</option>
                        <option value="contains">包含匹配</option>
                        <option value="regex">正则匹配</option>
                      </select>
                    </div>
                  </div>

                  {/* 提示信息 */}
                  <div
                    className="text-xs flex items-start gap-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span>💡</span>
                    <div>
                      {ngaCookies ? (
                        <span style={{ color: 'var(--success, #10b981)' }}>
                          已配置 NGA Cookie（可访问登录受限内容）
                        </span>
                      ) : (
                        <span>
                          未配置 NGA Cookie，登录受限的帖子可能无法抓取（在「设置」中粘贴）
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 按钮组 */}
                  <div className="flex items-center gap-2 pt-2 flex-wrap">
                    {status === 'collecting' ? (
                      <>
                        <button
                          disabled
                          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium opacity-60"
                          style={{
                            background: 'var(--accent-bg)',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent)',
                          }}
                        >
                          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          {paused ? '已暂停' : '抓取中…'}
                        </button>
                        <button
                          onClick={handleTogglePause}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          style={{
                            background: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          {paused ? '▶ 恢复' : '⏸ 暂停'}
                        </button>
                        <button
                          onClick={handleCancel}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          style={{
                            background: 'transparent',
                            color: 'var(--danger, #dc2626)',
                            border: '1px solid var(--danger, #dc2626)',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(220,38,38,0.1)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={handleCollect}
                          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all"
                          style={{
                            background: 'var(--accent-bg)',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent)',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--accent)';
                            e.currentTarget.style.color = 'var(--text-on-accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--accent-bg)';
                            e.currentTarget.style.color = 'var(--accent)';
                          }}
                        >
                          开始收集
                        </button>
                        {status !== 'idle' && (
                          <button
                            onClick={handleReset}
                            className="px-4 py-2 rounded-lg text-sm transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--bg-hover)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            清空
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </section>

              {/* 进度 */}
              {status === 'collecting' && (
                <div>
                  <ProgressBar current={progress.current} total={progress.total} label={progressMessage} />
                </div>
              )}

              {/* 错误 */}
              {status === 'error' && error && <ErrorBox message={error} />}

              {/* 警告 */}
              {status === 'done' && warnings && <WarningBox message={warnings} />}

              {/* 楼层超范围提示 */}
              {status === 'done' && actualMaxFloor && parseInt(endFloor, 10) > actualMaxFloor && (
                <section
                  className="rounded-2xl p-4"
                  style={{
                    background: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.3)',
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span style={{ color: '#f59e0b' }}>⚠</span>
                    <div>
                      <div className="text-sm font-medium" style={{ color: '#f59e0b' }}>
                        楼层超出范围
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {failedPages.length > 0
                          ? `已爬到 ${actualMaxFloor} 楼，但还有 ${failedPages.length} 页抓取失败未补齐，实际帖子可能更长`
                          : `帖子实际最高楼为 ${actualMaxFloor} 楼，已爬取所有存在的内容（您指定的 ${endFloor} 楼超出范围）`}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* 失败页重试卡片 */}
              {status === 'done' && failedPages.length > 0 && (
                <section
                  className="rounded-2xl p-4"
                  style={{
                    background: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.3)',
                  }}
                >
                  <div className="flex items-start gap-2 mb-3">
                    <span style={{ color: '#f59e0b', fontSize: 20, lineHeight: 1 }}>⚠</span>
                    <div className="flex-1">
                      <div className="text-sm font-semibold" style={{ color: '#f59e0b' }}>
                        {failedPages.length} 个页面抓取失败
                      </div>
                      <div className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                        可选择重试这些页面（自动补齐到 JSON），或跳过使用当前已收集的结果。
                      </div>
                      {(() => {
                        const SHOW = 10;
                        const visible = failedPagesExpanded ? failedPages : failedPages.slice(0, SHOW);
                        const hasMore = failedPages.length > SHOW;
                        return (
                          <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <span style={{ fontWeight: 500 }}>失败页码：</span>
                            <span style={{ wordBreak: 'break-all' }}>
                              {visible.join(', ')}
                              {hasMore && !failedPagesExpanded && ` 等 ${failedPages.length} 页`}
                            </span>
                            {hasMore && (
                              <button
                                onClick={() => setFailedPagesExpanded((v) => !v)}
                                className="ml-2 underline"
                                style={{ color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                              >
                                {failedPagesExpanded ? '收起' : '展开全部'}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleRetryFailedPages}
                      disabled={retrying}
                      className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                      style={{
                        background: '#f59e0b',
                        color: '#fff',
                        border: '1px solid #f59e0b',
                      }}
                    >
                      {retrying ? `重试中…（${failedPages.length} 页）` : `⚠ 重试 ${failedPages.length} 个失败页（建议操作）`}
                    </button>
                    <button
                      onClick={handleSkipFailedPages}
                      disabled={retrying}
                      className="px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                      style={{
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      ⏭ 跳过失败页，使用当前结果
                    </button>
                  </div>
                </section>
              )}

              {/* 结果 */}
              {status === 'done' && items.length > 0 && (
                <ResultsList
                  items={items}
                  onCopyOne={copyOne}
                  onCopyAll={copyAll}
                  onCopyNGA={copyNGABBCode}
                  onDelete={handleDelete}
                  onSaveToHistory={handleSaveToHistory}
                  saved={!!lastSavedId}
                />
              )}
            </div>
          </div>

          <CollectDecisionDialog
            open={decision.open}
            message={decision.message}
            failedPages={decision.failedPages}
            onContinue={() => handleDecide('continue')}
            onStop={() => handleDecide('stop')}
            onSkip={() => handleDecide('skip')}
          />
        </>
      )}
    </div>
  );
}

/** 进度条 */
function ProgressBar({ current, total, label }: { current: number; total: number; label?: string }) {
  const indeterminate = total <= 0;
  const percent = !indeterminate ? Math.round((current / total) * 100) : 0;
  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
    >
      <div
        className="flex items-center justify-between mb-2 text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span className="truncate mr-2">{label || '正在抓取 NGA 页面…'}</span>
        <span className="shrink-0">
          {indeterminate ? `${current} 页` : `${current}/${total} (${percent}%)`}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-hover)' }}
      >
        {indeterminate ? (
          <div
            className="h-full animate-pulse"
            style={{ width: '30%', background: 'var(--accent)' }}
          />
        ) : (
          <div
            className="h-full transition-all"
            style={{
              width: `${percent}%`,
              background: 'var(--accent)',
              transition: 'width 0.3s ease',
            }}
          />
        )}
      </div>
    </section>
  );
}

/** 错误提示 */
function ErrorBox({ message }: { message: string }) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{
        background: 'rgba(220,38,38,0.08)',
        border: '1px solid rgba(220,38,38,0.3)',
      }}
    >
      <div className="flex items-start gap-2">
        <span style={{ color: 'var(--danger, #dc2626)' }}>⚠</span>
        <div>
          <div
            className="text-sm font-medium"
            style={{ color: 'var(--danger, #dc2626)' }}
          >
            抓取失败
          </div>
          <div
            className="text-xs mt-1 whitespace-pre-wrap"
            style={{ color: 'var(--text-secondary)' }}
          >
            {message}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 警告提示 */
function WarningBox({ message }: { message: string }) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.3)',
      }}
    >
      <div className="flex items-start gap-2">
        <span style={{ color: '#f59e0b' }}>⚠</span>
        <div
          className="text-xs whitespace-pre-wrap"
          style={{ color: 'var(--text-secondary)' }}
        >
          {message}
        </div>
      </div>
    </section>
  );
}

/** 结果列表 */
function ResultsList({
  items,
  onCopyOne,
  onCopyAll,
  onCopyNGA,
  onDelete,
  onSaveToHistory,
  saved,
}: {
  items: AnjiaItem[];
  onCopyOne: (it: AnjiaItem) => void;
  onCopyAll: () => void;
  onCopyNGA: () => void;
  onDelete: (it: AnjiaItem, index: number) => void;
  onSaveToHistory: () => void;
  saved: boolean;
}) {
  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2
          className="text-sm font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          找到 {items.length} 条
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onSaveToHistory}
            disabled={saved}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{
              background: saved ? 'var(--bg-hover)' : 'var(--bg-input)',
              color: saved ? 'var(--text-muted)' : 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
            onMouseEnter={(e) => {
              if (!saved) {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.color = 'var(--accent)';
              }
            }}
            onMouseLeave={(e) => {
              if (!saved) {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }
            }}
            title={saved ? '已保存' : '保存到抓取历史'}
          >
            {saved ? '✓ 已保存' : '💾 保存到历史'}
          </button>
          <button
            onClick={onCopyNGA}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            title="复制为 NGA BBCode 格式（标题加粗，可直接贴到 NGA 编辑器）"
          >
            📋 复制 NGA 格式
          </button>
          <button
            onClick={onCopyAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.color = 'var(--text-on-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent-bg)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
          >
            📋 复制全部
          </button>
        </div>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {items.map((item, index) => (
          <ResultItem
            key={item.floor}
            item={item}
            onCopy={onCopyOne}
            onDelete={onDelete}
            index={index}
          />
        ))}
      </div>
    </section>
  );
}

/** 单条结果 */
function ResultItem({
  item,
  onCopy,
  onDelete,
  index,
}: {
  item: AnjiaItem;
  onCopy: (it: AnjiaItem) => void;
  onDelete: (it: AnjiaItem, index: number) => void;
  index: number;
}) {
  return (
    <div
      className="rounded-lg p-3 transition-colors"
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-color)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)';
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className="text-sm font-semibold flex-shrink-0"
            style={{ color: 'var(--accent)' }}
          >
            {item.floor}楼
          </span>
          <span
            className="text-xs truncate"
            style={{ color: 'var(--text-secondary)' }}
            title={item.author}
          >
            {item.author}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onCopy(item)}
            className="px-2.5 py-1 rounded text-xs transition-colors"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title={`复制 ${item.floor}楼 到剪贴板`}
          >
            📋 复制
          </button>
          <button
            onClick={() => onDelete(item, index)}
            className="px-2.5 py-1 rounded text-xs transition-colors"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--danger, #dc2626)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title={`删除 ${item.floor}楼（可撤销）`}
          >
            🗑 删除
          </button>
        </div>
      </div>
      <div
        className="mt-1.5 text-sm whitespace-pre-wrap break-words"
        style={{ color: 'var(--text-primary)' }}
      >
        {item.content}
      </div>
    </div>
  );
}

/** 兜底复制 */
function fallbackCopy(text: string) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) {
    console.error('复制失败：', e);
  }
}
