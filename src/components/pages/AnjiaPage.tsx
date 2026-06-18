// 安价收集页面
// - 表单：NGA 链接 / 起始楼层 / 末尾楼层 / 匹配文本（可留空 = 全部）
// - 进度：抓取中 X/Y + 取消按钮
// - 结果列表：单条删除（可撤销）/ 单条复制 / 全部复制 / 复制 NGA 格式
// - 自动检测总楼层 / 保存到历史 / 历史下拉
import { useState, useEffect } from 'react';
import { useSettingStore } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';
import {
  formatForClipboard,
  formatAsNGABBCode,
  type AnjiaItem,
} from '../../utils/ngaCrawler';
import {
  loadHistory,
  saveToHistory,
  deleteFromHistory,
  formatHistoryTime,
  type AnjiaHistoryEntry,
} from '../../utils/anjiaHistory';

interface AnjiaPageProps {
  onBack: () => void;
}

type Status = 'idle' | 'collecting' | 'done' | 'error';

const MAX_FLOOR_RANGE = 1000; // 一次最多 1000 楼（50 页）
const WARN_FLOOR_RANGE = 200; // 超过 200 楼给提示

export function AnjiaPage({ onBack }: AnjiaPageProps) {
  const ngaCookies = useSettingStore((s) => s.ngaCookies);
  const showToast = useToastStore((s) => s.showToast);

  // 表单状态
  const [url, setUrl] = useState('');
  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('20');
  const [prefix, setPrefix] = useState('安价'); // 默认匹配文本设为"安价"
  /** 标记末尾楼层是否被用户手动改过（auto-detect 时不覆盖） */
  const [endFloorManuallyEdited, setEndFloorManuallyEdited] = useState(false);
  const [detecting, setDetecting] = useState(false); // 自动检测进行中

  // 抓取状态
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [items, setItems] = useState<AnjiaItem[]>([]);
  const [error, setError] = useState<string>('');
  const [warnings, setWarnings] = useState<string>('');

  // ① 删除栈（用于撤销）
  const [deletedStack, setDeletedStack] = useState<
    { item: AnjiaItem; index: number }[]
  >([]);

  // ⑤ 历史
  const [history, setHistory] = useState<AnjiaHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);

  // 启动时加载历史
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

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
    setDeletedStack([]); // ① 关键：重新抓取清空撤销栈（不可穿越）
    setLastSavedId(null);
    // 估算总页数
    const totalPages = Math.ceil(end / 20) - Math.ceil(start / 20) + 1;
    setProgress({ current: 0, total: totalPages });

    try {
      if (!window.electronAPI?.collectNga) {
        throw new Error('安价收集仅支持 Electron 应用，请在桌面端运行');
      }
      const res = await window.electronAPI.collectNga({
        url: url.trim(),
        startFloor: start,
        endFloor: end,
        prefix: prefix.trim(),
        cookies: ngaCookies || undefined,
      });
      if (!res.ok) {
        setStatus('error');
        setError(res.error || '抓取失败');
        return;
      }
      setProgress({ current: res.totalPages, total: res.totalPages });
      setItems(res.items);
      if (res.items.length === 0) {
        setStatus('done');
        const prefixDesc = prefix.trim() ? `以 "${prefix}" 开头` : '匹配';
        setWarnings(
          `未找到${prefixDesc}的楼层。请确认：\n` +
            `1. 起始/末尾楼层是否正确\n` +
            `2. 匹配文本是否与帖子中的文字一致（含空格/标点）\n` +
            `3. 如帖子需登录，请在设置中粘贴 NGA Cookie 后重试`,
        );
        showToast('未找到匹配楼层', 'info');
      } else {
        setStatus('done');
        if (res.error) {
          setWarnings(`部分页面抓取失败：${res.error}`);
          showToast(`已收集 ${res.items.length} 条（部分页面失败）`, 'warning');
        } else {
          showToast(`已收集 ${res.items.length} 条`, 'success');
        }
      }
    } catch (e) {
      setStatus('error');
      setError((e as Error).message || '抓取失败');
    }
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

  const handleReset = () => {
    setStatus('idle');
    setItems([]);
    setError('');
    setWarnings('');
    setProgress({ current: 0, total: 0 });
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
      if (!res.ok || !res.totalFloors) {
        showToast(res.error || '自动检测失败', 'error');
        return;
      }
      showToast(
        `已检测到 ${res.totalPages} 页（约 ${res.totalFloors} 楼）`,
        'success',
      );
      // 不覆盖用户已手动改过的 endFloor
      if (!endFloorManuallyEdited) {
        setEndFloor(String(res.totalFloors));
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
          <span>📜</span> 收集安价
        </h1>
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
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-5">
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
                    placeholder="https://nga.178.com/read.php?tid=12345"
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

              {/* 匹配文本（② 改为可留空） */}
              <div>
                <label
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  匹配文本（可留空）
                </label>
                <input
                  type="text"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="留空则匹配所有楼层"
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
              <div className="flex items-center gap-2 pt-2">
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
                      抓取中…
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
          {status === 'collecting' && progress.total > 0 && (
            <ProgressBar current={progress.current} total={progress.total} />
          )}

          {/* 错误 */}
          {status === 'error' && error && <ErrorBox message={error} />}

          {/* 警告（部分页面失败） */}
          {status === 'done' && warnings && <WarningBox message={warnings} />}

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
    </div>
  );
}

/** 进度条 */
function ProgressBar({ current, total }: { current: number; total: number }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
    >
      <div
        className="flex items-center justify-between mb-2 text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span>正在抓取 NGA 页面…</span>
        <span>
          {current}/{total} ({percent}%)
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-hover)' }}
      >
        <div
          className="h-full transition-all"
          style={{
            width: `${percent}%`,
            background: 'var(--accent)',
            transition: 'width 0.3s ease',
          }}
        />
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
