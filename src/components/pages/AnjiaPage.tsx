// 安价收集页面
// - 表单：NGA 链接 / 起始楼层 / 末尾楼层 / 匹配文本（可留空 = 全部）
// - 可选 authorid（从 URL 的 ?authorid=XXX 自动解析）：仅收集该用户回复
// - 进度：抓取中 X/Y + 取消按钮
// - 结果列表：单条删除（可撤销）/ 单条复制 / 全部复制 / 复制 NGA 格式
// - 自动检测总楼层 / 保存到历史 / 历史下拉
import { useState, useEffect, useMemo } from 'react';
import { useSettingStore } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';
import {
  formatForClipboard,
  formatAsNGABBCode,
  parseThreadUrl,
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
import {
  collectAnkeToWorkJson,
  DEFAULT_FORMAT_SETTINGS,
  type SectionMode,
  type FormatSettings,
} from '../../utils/ankeCollect';
import { AnkeProgressBar } from './AnkeProgressBar';
import { webSaveStoryAsFile } from '../../utils/storyFileIO';
import { isCapacitor } from '../../utils/platform';

interface AnjiaPageProps {
  onBack: () => void;
}

type Status = 'idle' | 'collecting' | 'done' | 'error';
type Tab = 'anjia' | 'anke';

const MAX_FLOOR_RANGE = 1000; // 一次最多 1000 楼（50 页）
const WARN_FLOOR_RANGE = 200; // 超过 200 楼给提示

export function AnjiaPage({ onBack }: AnjiaPageProps) {
  const ngaCookies = useSettingStore((s) => s.ngaCookies);
  const showToast = useToastStore((s) => s.showToast);

  // Tab 切换（收集安价 / 收集安科）
  const [tab, setTab] = useState<Tab>('anjia');

  // 表单状态
  const [url, setUrl] = useState('');
  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('20');
  const [prefix, setPrefix] = useState('安价'); // 默认匹配文本设为"安价"
  const [matchMode, setMatchMode] = useState<MatchMode>('prefix'); // 匹配模式：前缀/包含/正则
  /** 标记末尾楼层是否被用户手动改过（auto-detect 时不覆盖） */
  const [endFloorManuallyEdited, setEndFloorManuallyEdited] = useState(false);
  const [detecting, setDetecting] = useState(false); // 自动检测进行中

  // 抓取状态
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [progressMessage, setProgressMessage] = useState('');
  const [paused, setPaused] = useState(false);
  const [items, setItems] = useState<AnjiaItem[]>([]);
  const [error, setError] = useState<string>('');
  const [warnings, setWarnings] = useState<string>('');
  const [failedPages, setFailedPages] = useState<number[]>([]);
  const [actualMaxFloor, setActualMaxFloor] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  // 订阅实时进度事件
  useEffect(() => {
    if (status !== 'collecting') return;
    if (!window.electronAPI?.onNgaCollectProgress) return;
    const unsub = window.electronAPI.onNgaCollectProgress((p) => {
      setProgress({ current: p.current, total: p.total });
      setProgressMessage(p.message);
      if (p.phase === 'paused') {
        setPaused(true);
      } else if (p.phase === 'fetching' || p.phase === 'starting' || p.phase === 'filtering') {
        setPaused(false);
      }
      if (p.phase === 'done' || p.phase === 'cancelled' || p.phase === 'error') {
        setPaused(false);
      }
    });
    return unsub;
  }, [status]);

  // ① 删除栈（用于撤销）
  const [deletedStack, setDeletedStack] = useState<
    { item: AnjiaItem; index: number }[]
  >([]);

  // ⑤ 历史
  const [history, setHistory] = useState<AnjiaHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);

  // 移动端（Capacitor）且无 Electron API 时，展示不支持提示卡片
  const isMobileUnsupported = isCapacitor && !window.electronAPI?.collectNga;

  // 启动时加载历史
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // 从 URL 自动解析 authorid（可选）
  const parsedAuthorid = useMemo(() => {
    const parsed = parseThreadUrl(url);
    return parsed?.authorid;
  }, [url]);

  /** 清除 URL 中的 authorid 参数 */
  const clearAuthorid = () => {
    const parsed = parseThreadUrl(url);
    if (!parsed) return;
    // 重建 URL：去掉 &authorid=... 或 ?authorid=...& 这种参数
    const u = url.trim();
    const cleaned = u.replace(/([?&])authorid=\d+/i, '').replace(/[?&]$/, '');
    setUrl(cleaned);
  };

  /** 校验表单（② 移除 prefix 必填检查） */
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
    setDeletedStack([]); // ① 关键：重新抓取清空撤销栈（不可穿越）
    setLastSavedId(null);
    // 估算总页数
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
      // 读取后端返回的失败页和实际最高楼
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
      // 更新失败页（重试后可能仍有失败）
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

  // 跳过失败页：接受当前结果
  const handleSkipFailedPages = () => {
    setFailedPages([]);
    showToast('已跳过失败页，使用当前结果', 'info');
  };

  // ③ 取消抓取
  const handleCancel = async () => {
    if (!window.electronAPI?.cancelNgaCollect) return;
    try {
      await window.electronAPI.cancelNgaCollect();
      showToast('已请求取消', 'info');
    } catch (e) {
      console.warn('取消失败：', e);
    }
  };

  // 暂停/恢复抓取
  const handleTogglePause = async () => {
    if (!window.electronAPI?.pauseNgaCollect) return;
    try {
      const res = await window.electronAPI.pauseNgaCollect();
      setPaused(res.paused);
      showToast(res.paused ? '已暂停' : '已恢复', 'info');
    } catch (e) {
      console.warn('暂停/恢复失败：', e);
    }
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

  // ① 删除单条 + 撤销
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

  // ⑥ 复制 NGA BBCode
  const copyNGABBCode = async () => {
    if (items.length === 0) return;
    const text = formatAsNGABBCode(items);
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 NGA 格式（${items.length} 条）`, 'success');
    } catch (e) {
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
    } catch (e) {
      fallbackCopy(text);
      showToast(`已复制 ${items.length} 条到剪贴板`, 'success');
    }
  };

  const copyOne = async (item: AnjiaItem) => {
    const text = `${item.floor}楼 ${item.author}：${item.content}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 ${item.floor}楼`, 'success');
    } catch (e) {
      fallbackCopy(text);
      showToast(`已复制 ${item.floor}楼`, 'success');
    }
  };

  // ④ 自动检测总楼层
  const handleAutoDetect = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      showToast('请先输入 NGA 主题帖链接', 'error');
      return;
    }
    if (!/[?&]tid=\d+/i.test(trimmedUrl)) {
      showToast('链接格式无效，请检查是否包含 tid=XXX 参数', 'error');
      return;
    }
    if (!window.electronAPI?.fetchNgaThreadInfo) {
      showToast('自动检测仅支持 Electron 应用', 'error');
      return;
    }
    setDetecting(true);
    try {
      const res = await window.electronAPI.fetchNgaThreadInfo(
        trimmedUrl,
        ngaCookies || undefined,
      );
      if (!res.ok || !res.totalPages) {
        showToast(res.error || '自动检测失败', 'error');
        return;
      }
      if (res.totalFloors && res.totalFloors > 0) {
        showToast(
          `已检测到 ${res.totalPages} 页（约 ${res.totalFloors} 楼）`,
          'success',
        );
        // 普通模式：不覆盖用户已手动改过的 endFloor
        if (!endFloorManuallyEdited) {
          setEndFloor(String(res.totalFloors));
        }
      } else {
        // authorid 模式：totalFloors=0，不覆盖 endFloor，提示用户手动输入
        showToast(
          `已检测到 ${res.totalPages} 页作者回复，请手动输入末尾楼层`,
          'success',
        );
      }
    } catch (e) {
      showToast(`检测失败：${(e as Error).message}`, 'error');
    } finally {
      setDetecting(false);
    }
  };

  // ⑤ 保存到历史
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

  // ⑤ 加载历史
  const handleLoadHistory = (entry: AnjiaHistoryEntry) => {
    setUrl(entry.url);
    setStartFloor(String(entry.startFloor));
    setEndFloor(String(entry.endFloor));
    setPrefix(entry.prefix);
    setEndFloorManuallyEdited(true); // 视为已编辑，避免被 auto-detect 覆盖
    setItems(entry.items);
    setDeletedStack([]); // 加载历史清空撤销栈（避免穿越）
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
      className="h-full w-full flex flex-col overflow-hidden"
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
          <span>📜</span> 收集安价/安科
        </h1>
        {tab === 'anjia' && (
        <div className="ml-auto flex items-center gap-2 relative">
          {/* ⑤ 历史按钮 */}
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
          {/* ⑤ 历史下拉 */}
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
        )}
      </div>

      {/* Tab 切换器 */}
      <div
        className="flex items-center gap-1 px-6 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <button
          onClick={() => setTab('anjia')}
          className="px-4 py-2.5 text-sm font-medium transition-all relative"
          style={{
            background: 'transparent',
            border: 'none',
            color: tab === 'anjia' ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom:
              tab === 'anjia'
                ? '2px solid var(--accent)'
                : '2px solid transparent',
            marginBottom: '-1px',
            cursor: 'pointer',
          }}
        >
          📮 收集安价
        </button>
        <button
          onClick={() => setTab('anke')}
          className="px-4 py-2.5 text-sm font-medium transition-all relative"
          style={{
            background: 'transparent',
            border: 'none',
            color: tab === 'anke' ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom:
              tab === 'anke'
                ? '2px solid var(--accent)'
                : '2px solid transparent',
            marginBottom: '-1px',
            cursor: 'pointer',
          }}
        >
          📖 收集安科
        </button>
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
                收集安价/安科功能需要在桌面端（Electron）使用。请在电脑上安装安科作者助手后使用此功能。
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
      ) : tab === 'anjia' ? (
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
                  {/* ④ 自动检测按钮 */}
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
                {/* authorid 徽章：当 URL 包含 authorid 时显示当前用户筛选状态 */}
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

              {/* 匹配文本（② 改为可留空） + 匹配模式（Fix #4） */}
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
                    {/* 暂停/恢复按钮 */}
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
                    {/* ③ 取消按钮 */}
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

          {/* 警告（未找到匹配等） */}
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
                    帖子实际最高楼为 {actualMaxFloor} 楼，已爬取所有存在的内容（您指定的 {endFloor} 楼超出范围）
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
                <span style={{ color: '#f59e0b' }}>⚠</span>
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ color: '#f59e0b' }}>
                    {failedPages.length} 页抓取失败
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    失败页码：{failedPages.join(', ')}
                    <br />
                    可选择重试这些页面，或跳过使用当前已收集的结果。
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleRetryFailedPages}
                  disabled={retrying}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--text-on-accent)',
                    border: '1px solid var(--accent)',
                  }}
                >
                  {retrying ? '重试中…' : '🔄 重试失败页'}
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
                  ✓ 跳过，使用当前结果
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
      ) : (
        <AnkeTab />
      )}
    </div>
  );
}

// ============================================================
// AnkeTab：收集安科
// - 输入：NGA 帖子 URL（可加 &authorid=XXX 仅收集该作者）+ 起始/终止楼层 + 每 N 楼一节 + 作品标题
// - 自动检测：URL 旁 🔍 按钮 → 自动填入终止楼层（不覆盖用户已改的）
// - 流程：调 collectAnkeToWorkJson 拼作品 JSON → 调系统保存对话框或 Web 下载
// - 复用现有 anke-creator-export 格式，可在"我的作品"通过"📥 导入作品"还原
// ============================================================
export function AnkeTab() {
  const showToast = useToastStore((s) => s.showToast);
  const ngaCookies = useSettingStore((s) => s.ngaCookies);

  const [url, setUrl] = useState('');
  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('20');
  const [floorsPerSection, setFloorsPerSection] = useState('10');
  const [sectionMode, setSectionMode] = useState<SectionMode>('every-n');
  const [workTitle, setWorkTitle] = useState('');
  const [running, setRunning] = useState(false);
  const [detecting, setDetecting] = useState(false);
  /** 标记 endFloor 是否被用户手动改过（auto-detect 时不覆盖） */
  const [endFloorManuallyEdited, setEndFloorManuallyEdited] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');
  /** 收集安科的失败页/楼层超范围警告 */
  const [ankeWarnings, setAnkeWarnings] = useState<string[]>([]);
  /** 收集进度（current=已抓页数, total=总页数） */
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  /**
   * JSON 格式详细设置（卷名/章名/节名/节内容范围标记模板）。
   * 默认值在 handleStart 合并时填入 DEFAULT_FORMAT_SETTINGS。
   * 用户在折叠面板里改时实时更新。
   */
  const [formatSettings, setFormatSettings] = useState<FormatSettings>({
    ...DEFAULT_FORMAT_SETTINGS,
  });

  // 订阅实时进度事件
  useEffect(() => {
    if (!running) return;
    if (!window.electronAPI?.onNgaCollectProgress) return;
    const unsub = window.electronAPI.onNgaCollectProgress((p) => {
      setProgress({ current: p.current, total: p.total });
      setProgressMsg(p.message);
      if (p.phase === 'paused') {
        setPaused(true);
      } else if (p.phase === 'fetching' || p.phase === 'starting' || p.phase === 'filtering') {
        setPaused(false);
      }
      if (p.phase === 'done' || p.phase === 'cancelled' || p.phase === 'error') {
        setPaused(false);
      }
    });
    return unsub;
  }, [running]);

  // URL 包含 &authorid=XXX 时显示作者筛选徽章
  const parsedAuthorid = useMemo(() => {
    const parsed = parseThreadUrl(url);
    return parsed?.authorid;
  }, [url]);

  /** 清除 URL 中的 authorid 参数 */
  const clearAuthorid = () => {
    const u = url.trim();
    const cleaned = u.replace(/([?&])authorid=\d+/i, '').replace(/[?&]$/, '');
    setUrl(cleaned);
  };

  /** 自动检测总楼层（与 AnjiaPage 一致） */
  const handleAutoDetect = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      showToast('请先输入 NGA 帖子 URL', 'error');
      return;
    }
    if (!/[?&]tid=\d+/i.test(trimmedUrl)) {
      showToast('链接格式无效，请检查是否包含 tid=XXX 参数', 'error');
      return;
    }
    if (!window.electronAPI?.fetchNgaThreadInfo) {
      showToast('自动检测仅支持 Electron 应用', 'error');
      return;
    }
    setDetecting(true);
    try {
      const res = await window.electronAPI.fetchNgaThreadInfo(
        trimmedUrl,
        ngaCookies || undefined,
      );
      if (!res.ok || !res.totalFloors) {
        showToast(res.error || '自动检测失败', 'error');
        return;
      }
      showToast(
        `已检测到 ${res.totalPages} 页（约 ${res.totalFloors} 楼）`,
        'success',
      );
      if (!endFloorManuallyEdited) {
        setEndFloor(String(res.totalFloors));
      }
    } catch (e) {
      showToast(`检测失败：${(e as Error).message}`, 'error');
    } finally {
      setDetecting(false);
    }
  };

  const handleStart = async () => {
    if (running) return;
    const urlTrim = url.trim();
    if (!urlTrim) {
      showToast('请输入 NGA 帖子 URL', 'error');
      return;
    }
    const startF = parseInt(startFloor, 10);
    const endF = parseInt(endFloor, 10);
    const fps = Math.max(1, parseInt(floorsPerSection, 10) || 10);
    if (
      isNaN(startF) ||
      isNaN(endF) ||
      startF < 1 ||
      endF < startF
    ) {
      showToast('楼层范围不合法', 'error');
      return;
    }

    setRunning(true);
    setPaused(false);
    setProgressMsg('正在爬取 NGA 帖子…');
    setResultMsg('');
    setAnkeWarnings([]);
    setProgress({ current: 0, total: 0 });

    try {
      const result = await collectAnkeToWorkJson({
        url: urlTrim,
        startFloor: startF,
        endFloor: endF,
        workTitle: workTitle.trim(),
        sectionMode,
        floorsPerSection: fps,
        cookies: ngaCookies || undefined,
        authorid: parsedAuthorid,
        formatSettings, // 透传用户自定义格式模板
      });
      if (!result.ok) {
        showToast(`收集失败：${result.error}`, 'error');
        setRunning(false);
        setProgressMsg('');
        return;
      }

      // 收集失败页/楼层超范围警告
      const warns: string[] = [];
      if (result.failedPages && result.failedPages.length > 0) {
        warns.push(`⚠ ${result.failedPages.length} 页抓取失败（页码：${result.failedPages.join(', ')}），已跳过这些页的内容`);
      }
      if (result.actualMaxFloor && endF > result.actualMaxFloor) {
        warns.push(`⚠ 帖子实际最高楼为 ${result.actualMaxFloor} 楼，已爬取所有存在的内容（您指定的 ${endF} 楼超出范围）`);
      }
      if (warns.length > 0) setAnkeWarnings(warns);

      setProgressMsg(
        `已收集 ${result.stats!.totalFloors} 楼，分 ${result.stats!.sectionCount} 节`,
      );

      // 保存：优先 Electron 系统对话框，回退 Web 下载
      if (window.electronAPI?.saveStoryAsFile) {
        const res = await window.electronAPI.saveStoryAsFile(
          result.jsonData,
          result.fileName,
        );
        if (res.canceled) {
          setRunning(false);
          setProgressMsg('');
          return;
        }
        if (!res.ok) {
          showToast(`保存失败：${res.error}`, 'error');
          setRunning(false);
          setProgressMsg('');
          return;
        }
        showToast(`已保存：${res.filePath}`, 'success');
        setResultMsg(
          `已保存 ${result.stats!.totalFloors} 楼（${result.stats!.sectionCount} 节）到：${res.filePath}\n请到「我的作品 → 📥 导入作品」选此 JSON 还原。`,
        );
      } else {
        const res = await webSaveStoryAsFile(result.jsonData, result.fileName);
        if (!res.ok) {
          showToast(`保存失败：${res.error}`, 'error');
          setRunning(false);
          setProgressMsg('');
          return;
        }
        showToast(`已下载：${res.fileName}`, 'success');
        setResultMsg(
          `已下载 ${result.stats!.totalFloors} 楼（${result.stats!.sectionCount} 节）：${res.fileName}\n请到「我的作品 → 📥 导入作品」选此 JSON 还原。`,
        );
      }
    } catch (e) {
      showToast(`收集失败：${(e as Error).message}`, 'error');
      setProgressMsg('');
    } finally {
      setRunning(false);
    }
  };

  /** 跑中手动取消：通知主进程停止爬取 */
  const handleCancelAnke = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.cancelNgaCollect) {
      showToast('当前环境不支持取消', 'error');
      return;
    }
    try {
      const res = await window.electronAPI.cancelNgaCollect();
      if (res?.ok) {
        showToast('已发送取消指令，爬取将在收到响应后停止', 'info');
      } else {
        showToast(`取消失败：${res?.error ?? '未知错误'}`, 'error');
      }
    } catch (e) {
      showToast(`取消失败：${(e as Error).message}`, 'error');
    }
  };

  /** 暂停/恢复 */
  const handleTogglePauseAnke = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.pauseNgaCollect) return;
    try {
      const res = await window.electronAPI.pauseNgaCollect();
      setPaused(res.paused);
      showToast(res.paused ? '已暂停' : '已恢复', 'info');
    } catch (e) {
      console.warn('暂停/恢复失败：', e);
    }
  };

  // 共享样式
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    marginBottom: 6,
    color: 'var(--text-secondary)',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 14px',
    fontSize: 14,
    borderRadius: 8,
    outline: 'none',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-6">
      <div className="max-w-4xl mx-auto space-y-4 md:space-y-5">
        <section
          className="rounded-2xl p-5"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <h2
            className="text-sm font-semibold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            收集条件
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* NGA 帖子 URL + 自动检测 */}
            <div>
              <label style={labelStyle}>NGA 主题帖链接</label>
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://nga.178.com/read.php?tid=12345（可加 &authorid=XXX 仅收集该用户）"
                  disabled={running}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    opacity: running ? 0.5 : 1,
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                />
                {/* 🔍 自动检测按钮 */}
                <button
                  onClick={handleAutoDetect}
                  disabled={running || detecting}
                  className="px-3 py-2 text-xs rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  style={{
                    background: 'var(--bg-hover)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                  }}
                  onMouseEnter={(e) => {
                    if (!running && !detecting) {
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
                      <span
                        className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1"
                        style={{ verticalAlign: '-2px' }}
                      />
                      检测中
                    </>
                  ) : (
                    <>🔍 自动检测</>
                  )}
                </button>
              </div>
              {/* authorid 徽章：URL 包含 authorid 时显示当前用户筛选状态 */}
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
                    disabled={running}
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

            {/* 楼层范围 + 每 N 楼一节 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 120px' }}>
                <label style={labelStyle}>起始楼层</label>
                <input
                  type="number"
                  min={1}
                  value={startFloor}
                  onChange={(e) => setStartFloor(e.target.value)}
                  disabled={running}
                  style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label style={labelStyle}>终止楼层</label>
                <input
                  type="number"
                  min={1}
                  value={endFloor}
                  onChange={(e) => {
                    setEndFloor(e.target.value);
                    setEndFloorManuallyEdited(true);
                  }}
                  disabled={running}
                  style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label style={labelStyle}>切分模式</label>
                <select
                  value={sectionMode}
                  onChange={(e) => setSectionMode(e.target.value as SectionMode)}
                  disabled={running}
                  style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                >
                  <option value="single">整段一节</option>
                  <option value="one-per-floor">每楼一节</option>
                  <option value="every-n">每 N 楼一节</option>
                </select>
              </div>
              {sectionMode === 'every-n' && (
                <div style={{ flex: '1 1 120px' }}>
                  <label style={labelStyle}>每 N 楼一节</label>
                  <input
                    type="number"
                    min={1}
                    value={floorsPerSection}
                    onChange={(e) => setFloorsPerSection(e.target.value)}
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                    }}
                  />
                </div>
              )}
            </div>

            {/* 作品标题 */}
            <div>
              <label style={labelStyle}>
                作品标题（留空则用「安科-{'{tid}'}」）
              </label>
              <input
                value={workTitle}
                onChange={(e) => setWorkTitle(e.target.value)}
                placeholder="例如：安科-2026"
                disabled={running}
                style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              />
            </div>

            {/* 高级格式设置（折叠面板） */}
            <details
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '4px 12px',
                background: 'var(--bg-card-secondary, transparent)',
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  padding: '8px 0',
                  userSelect: 'none',
                  listStyle: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                ⚙ 高级格式设置（可选，定义卷/章/节命名与节内容范围标记）
              </summary>
              <div style={{ padding: '8px 0 12px', display: 'grid', gap: 10 }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  占位符：{'{volIndex}'}（卷号）/ {'{chapterIndex}'}（章号）/ {'{startFloor}'}（节起始楼）/ {'{endFloor}'}（节结束楼）
                </div>
                <div>
                  <label style={labelStyle}>卷名格式</label>
                  <input
                    value={formatSettings.volumeTitleFormat}
                    onChange={(e) =>
                      setFormatSettings((s) => ({ ...s, volumeTitleFormat: e.target.value }))
                    }
                    placeholder="第一卷"
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>章名格式</label>
                  <input
                    value={formatSettings.chapterTitleFormat}
                    onChange={(e) =>
                      setFormatSettings((s) => ({ ...s, chapterTitleFormat: e.target.value }))
                    }
                    placeholder="第一章"
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>节名格式</label>
                  <input
                    value={formatSettings.sectionTitleFormat}
                    onChange={(e) =>
                      setFormatSettings((s) => ({ ...s, sectionTitleFormat: e.target.value }))
                    }
                    placeholder="第 {startFloor}-{endFloor} 楼"
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>节内容范围标记（留空 = 不加）</label>
                  <input
                    value={formatSettings.sectionContentRangeFormat}
                    onChange={(e) =>
                      setFormatSettings((s) => ({
                        ...s,
                        sectionContentRangeFormat: e.target.value,
                      }))
                    }
                    placeholder="这节内容是{startFloor}楼到{endFloor}楼的内容"
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setFormatSettings({ ...DEFAULT_FORMAT_SETTINGS })}
                  disabled={running}
                  className="text-xs px-3 py-1.5 rounded-md self-start"
                  style={{
                    background: 'var(--bg-hover)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    cursor: running ? 'not-allowed' : 'pointer',
                    opacity: running ? 0.5 : 1,
                  }}
                >
                  🔄 恢复默认
                </button>
              </div>
            </details>
            {/* 提示 */}
            <div
              className="text-xs flex items-start gap-1.5"
              style={{ color: 'var(--text-muted)' }}
            >
              <span>💡</span>
              <div>
                收集完成后会下载一个 <code>.anke.json</code> 文件。
                到「我的作品」页面点「📥 导入作品」选这个 JSON 即可还原为安科作品。
              </div>
            </div>

            {/* 按钮 */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleStart}
                disabled={running}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  cursor: running ? 'not-allowed' : 'pointer',
                  opacity: running ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!running) {
                    e.currentTarget.style.background = 'var(--accent)';
                    e.currentTarget.style.color = 'var(--text-on-accent)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!running) {
                    e.currentTarget.style.background = 'var(--accent-bg)';
                    e.currentTarget.style.color = 'var(--accent)';
                  }
                }}
              >
                {running ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    {paused ? '已暂停' : (progressMsg || '处理中…')}
                  </>
                ) : (
                  <>📥 确认收集</>
                )}
              </button>
              {/* 跑中显示"暂停/恢复"和"取消"按钮 */}
              {running && (
                <>
                  <button
                    type="button"
                    onClick={handleTogglePauseAnke}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                    }}
                  >
                    {paused ? '▶ 恢复' : '⏸ 暂停'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelAnke}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{
                      background: 'var(--bg-card)',
                      color: 'var(--error, #e53935)',
                      border: '1px solid var(--error, #e53935)',
                      cursor: 'pointer',
                    }}
                  >
                    取消
                  </button>
                </>
              )}
            </div>

            {running && (
              <AnkeProgressBar
                current={progress.current}
                total={progress.total}
                label={progressMsg || '正在爬取 NGA 帖子…'}
              />
            )}
          </div>
        </section>

        {/* 结果提示 */}
        {resultMsg && !running && (
          <section
            className="rounded-2xl p-5"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--accent)',
            }}
          >
            <div
              className="text-sm font-semibold mb-2"
              style={{ color: 'var(--accent)' }}
            >
              ✅ 收集完成
            </div>
            <div
              className="text-sm whitespace-pre-wrap"
              style={{ color: 'var(--text-primary)' }}
            >
              {resultMsg}
            </div>
          </section>
        )}

        {/* 收集安科：失败页/楼层超范围警告 */}
        {ankeWarnings.length > 0 && !running && (
          <section
            className="rounded-2xl p-4"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.3)',
            }}
          >
            <div className="flex items-start gap-2">
              <span style={{ color: '#f59e0b' }}>⚠</span>
              <div className="flex-1">
                {ankeWarnings.map((w, i) => (
                  <div
                    key={i}
                    className="text-xs mt-1 first:mt-0"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {w}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** 进度条 */
function ProgressBar({ current, total, label }: { current: number; total: number; label?: string }) {
  const indeterminate = total <= 0
  const percent = !indeterminate ? Math.round((current / total) * 100) : 0
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
  )
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
          {/* ⑤ 保存到历史 */}
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
          {/* ⑥ NGA 格式复制 */}
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
          {/* 复制全部 */}
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

/** 单条结果（① 加删除按钮） */
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
          {/* ① 删除按钮 */}
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

/** 兜底复制（兼容非 HTTPS 或旧浏览器） */
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
