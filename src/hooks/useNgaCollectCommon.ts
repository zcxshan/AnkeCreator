// ============================================================
// useNgaCollectCommon：安价/安科收集共享逻辑 hook
// 高内聚低耦合：提取两页真正共享的"管道"逻辑（非 UI），参数化模式差异
// - URL 解析 / authorid 自动检测 / 进度订阅 / 暂停/取消/决策 / 失败页状态
// - 各页只负责传入 mode + active + 处理自己的收集 API 结果
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useSettingStore } from '../store/settingStore';
import { useToastStore } from '../store/toastStore';
import { parseThreadUrl } from '../utils/ngaCrawler';

export interface NgaDecisionState {
  open: boolean;
  taskId: number;
  message: string;
  failedPages: number[];
}

export interface UseNgaCollectCommonOptions {
  /** 收集模式：安价 / 安科（保留以备未来分派，目前管道逻辑一致） */
  mode: 'anjia' | 'anke';
  /** 是否处于活跃抓取/重试状态（控制进度订阅） */
  active: boolean;
}

export function useNgaCollectCommon({ mode, active }: UseNgaCollectCommonOptions) {
  void mode; // 当前管道逻辑对 anjia/anke 一致，保留参数便于未来扩展
  const cookies = useSettingStore((s) => s.ngaCookies);
  const showToast = useToastStore((s) => s.showToast);

  // 表单状态
  const [url, setUrl] = useState('');
  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('20');
  const [endFloorManuallyEdited, setEndFloorManuallyEdited] = useState(false);
  const [detecting, setDetecting] = useState(false);

  // 抓取进度状态
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [progressMessage, setProgressMessage] = useState('');
  const [paused, setPaused] = useState(false);

  // 失败页状态
  const [failedPages, setFailedPages] = useState<number[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [failedPagesExpanded, setFailedPagesExpanded] = useState(false);

  // 抓取异常决策
  const [decision, setDecision] = useState<NgaDecisionState>({
    open: false,
    taskId: 0,
    message: '',
    failedPages: [],
  });
  const [currentTaskId, setCurrentTaskId] = useState(0);

  // 订阅实时进度事件（仅活跃时）
  useEffect(() => {
    if (!active) return;
    if (!window.electronAPI?.onNgaCollectProgress) return;
    const unsub = window.electronAPI.onNgaCollectProgress((p: any) => {
      setProgress({ current: p.current, total: p.total });
      setProgressMessage(p.message);
      if (p.taskId) setCurrentTaskId(p.taskId);
      if (p.phase === 'paused') {
        setPaused(true);
        if (p.needsUserDecision && p.failedPages) {
          setDecision({
            open: true,
            taskId: p.taskId,
            message: p.message,
            failedPages: p.failedPages,
          });
        }
      } else if (p.phase === 'fetching' || p.phase === 'starting' || p.phase === 'filtering') {
        setPaused(false);
      }
      if (p.phase === 'done' || p.phase === 'cancelled' || p.phase === 'error') {
        setPaused(false);
      }
    });
    return unsub;
  }, [active]);

  // 从 URL 自动解析 authorid
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

  /** 自动检测总楼层（不覆盖用户已手动改过的 endFloor） */
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
        cookies || undefined,
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
        if (!endFloorManuallyEdited) {
          setEndFloor(String(res.totalFloors));
        }
      } else {
        showToast(
          `已检测到 ${res.totalPages} 页，请手动输入末尾楼层`,
          'success',
        );
      }
    } catch (e) {
      showToast(`检测失败：${(e as Error).message}`, 'error');
    } finally {
      setDetecting(false);
    }
  };

  /** 暂停/恢复抓取 */
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

  /** 取消抓取 */
  const handleCancel = async () => {
    if (!window.electronAPI?.cancelNgaCollect) {
      showToast('当前环境不支持取消', 'error');
      return;
    }
    try {
      const res: any = await window.electronAPI.cancelNgaCollect();
      if (res?.ok === false) {
        showToast(`取消失败：${res?.error ?? '未知错误'}`, 'error');
        return;
      }
      showToast('已请求取消', 'info');
    } catch (e) {
      showToast(`取消失败：${(e as Error).message}`, 'error');
    }
  };

  /** 决策弹窗：continue/stop/skip */
  const handleDecide = async (d: 'continue' | 'stop' | 'skip') => {
    if (decision.taskId) {
      await window.electronAPI?.decideNgaCollect?.(decision.taskId, d);
    }
    setDecision((prev) => ({ ...prev, open: false }));
  };

  return {
    // 共享依赖
    cookies,
    showToast,
    // 表单状态
    url,
    setUrl,
    startFloor,
    setStartFloor,
    endFloor,
    setEndFloor,
    endFloorManuallyEdited,
    setEndFloorManuallyEdited,
    detecting,
    // 进度状态
    progress,
    setProgress,
    progressMessage,
    setProgressMessage,
    paused,
    setPaused,
    // 失败页状态
    failedPages,
    setFailedPages,
    retrying,
    setRetrying,
    failedPagesExpanded,
    setFailedPagesExpanded,
    // 决策状态
    decision,
    setDecision,
    currentTaskId,
    setCurrentTaskId,
    // authorid
    parsedAuthorid,
    clearAuthorid,
    // 共享 handlers
    handleAutoDetect,
    handleTogglePause,
    handleCancel,
    handleDecide,
  };
}

export type UseNgaCollectCommonReturn = ReturnType<typeof useNgaCollectCommon>;
