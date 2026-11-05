// ============================================================
// GululuCollectPanel：收集骨碌碌安科（子面板，被 AnkeCollectPage 引入）
// 改造自独立页面：移除独立顶栏，改为由父级提供顶栏
// - 表单：骨碌碌链接 / 起始楼层 / 末尾楼层 / 切分模式 / 每 N 节 / 作品标题
// - 进度 / 取消 / 失败楼层重试 / 保存为 .anke.json
// - 可选 onClose：传入时面板顶部右侧显示"✕ 关闭"按钮
// ============================================================
import { useEffect, useState } from 'react';
import {
  collectGululuToWorkJson,
  parseGululuUrl,
  type GululuRawPost,
} from '../../utils/gululuCollect';
import type { ManualFormatConfig, SectionMode } from '../../utils/ankeCollect';
import { AdvancedFormatSection } from '../anke/AdvancedFormatSection';
import { AnkeProgressBar } from './AnkeProgressBar';
import { webSaveStoryAsFile } from '../../utils/storyFileIO';
import { isElectron } from '../../utils/platform';
import { Icon } from '../common/Icon';

interface GululuCollectPanelProps {
  /** 可选关闭回调：传入时面板顶部右侧显示"✕ 关闭"按钮（用于在父级中关闭该面板） */
  onClose?: () => void;
}

export function GululuCollectPanel({ onClose }: GululuCollectPanelProps) {
  // 表单状态
  const [url, setUrl] = useState('');
  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('10');
  const [floorsPerSection, setFloorsPerSection] = useState('10');
  const [sectionMode, setSectionMode] = useState<SectionMode>('every-n');
  const [workTitle, setWorkTitle] = useState('');
  const [manualFormat, setManualFormat] = useState<ManualFormatConfig>({
    enabled: false,
    volumes: [],
  });

  // 抓取状态
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [progressMsg, setProgressMsg] = useState('');
  const [resultMsg, setResultMsg] = useState('');
  // 页面内可见的错误态（toast 一闪而过，失败后用户需要能重来）
  const [errorMsg, setErrorMsg] = useState('');
  const [failedFloors, setFailedFloors] = useState<number[]>([]);
  const [collectedItems, setCollectedItems] = useState<GululuRawPost[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  // 进度监听
  useEffect(() => {
    if (!running) return;
    const off = (window as any).electronAPI?.onGululuCollectProgress?.((p: any) => {
      setProgress({ current: p.current, total: p.total });
      setProgressMsg(p.message);
    });
    return () => { off?.(); };
  }, [running]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type });
  };

  const handleAutoDetect = async () => {
    const urlTrim = url.trim();
    if (!urlTrim) {
      showToast('请先输入骨碌碌作品链接', 'error');
      return;
    }
    if (!parseGululuUrl(urlTrim)) {
      showToast('链接格式不正确，应为 https://www.gululu.world/book/数字', 'error');
      return;
    }
    setDetecting(true);
    try {
      const res = await (window as any).electronAPI?.fetchGululuBookInfo?.(urlTrim);
      if (!res || !res.ok) {
        showToast(`检测失败：${res?.error || '主进程不可用'}`, 'error');
        return;
      }
      if (res.totalFloors && res.totalFloors > 0) {
        setEndFloor(String(res.totalFloors));
        showToast(`检测到共 ${res.totalFloors} 节${res.title ? `：${res.title}` : ''}`, 'success');
      } else {
        showToast('未检测到楼层数', 'error');
      }
    } catch (e) {
      showToast(`检测失败：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setDetecting(false);
    }
  };

  const handleCancel = () => {
    (window as any).electronAPI?.cancelGululuCollect?.();
  };

  const handleStart = async () => {
    if (running) return;
    const urlTrim = url.trim();
    if (!urlTrim) {
      showToast('请输入骨碌碌作品链接', 'error');
      return;
    }
    if (!parseGululuUrl(urlTrim)) {
      showToast('链接格式不正确，应为 https://www.gululu.world/book/数字', 'error');
      return;
    }
    const startF = parseInt(startFloor, 10);
    const endF = parseInt(endFloor, 10);
    const fps = Math.max(1, parseInt(floorsPerSection, 10) || 10);
    if (isNaN(startF) || isNaN(endF) || startF < 1 || endF < startF) {
      showToast('楼层范围不合法', 'error');
      return;
    }

    setRunning(true);
    setProgressMsg('正在爬取骨碌碌作品…');
    setResultMsg('');
    setErrorMsg('');
    setFailedFloors([]);
    setCollectedItems([]);
    setProgress({ current: 0, total: 0 });

    try {
      const result = await collectGululuToWorkJson({
        url: urlTrim,
        startFloor: startF,
        endFloor: endF,
        workTitle: workTitle.trim(),
        sectionMode,
        floorsPerSection: fps,
        manualFormat,
      });
      if (!result.ok) {
        showToast(`收集失败：${result.error}`, 'error');
        setErrorMsg(result.error || '收集失败');
        setRunning(false);
        setProgressMsg('');
        return;
      }

      const items = result.items ?? [];
      const failed = result.failedFloorNums ?? [];
      const stats = result.stats ?? { totalFloors: 0, sectionCount: 0 };
      if (items.length > 0) setCollectedItems(items);
      if (failed.length > 0) setFailedFloors(failed);

      setProgressMsg(`已收集 ${stats.totalFloors} 节，分 ${stats.sectionCount} 节`);

      // 保存
      if ((window as any).electronAPI?.saveStoryAsFile) {
        const res = await (window as any).electronAPI.saveStoryAsFile(
          result.jsonData,
          result.fileName,
        );
        if (!res) {
          showToast('保存失败：IPC 返回为空', 'error');
          setErrorMsg('保存失败：IPC 返回为空');
          setRunning(false);
          setProgressMsg('');
          return;
        }
        if (res.canceled) {
          setRunning(false);
          setProgressMsg('');
          return;
        }
        if (!res.ok) {
          showToast(`保存失败：${res.error}`, 'error');
          setErrorMsg(`保存失败：${res.error}`);
          setRunning(false);
          setProgressMsg('');
          return;
        }
        showToast(`已保存：${res.filePath}`, 'success');
        setResultMsg(
          `已保存 ${stats.totalFloors} 节（${stats.sectionCount} 节）到：${res.filePath}\n请到「我的作品 → 导入作品」选此 JSON 还原。`,
        );
      } else {
        const res = await webSaveStoryAsFile(result.jsonData, result.fileName);
        if (!res.ok) {
          showToast(`保存失败：${res.error}`, 'error');
          setErrorMsg(`保存失败：${res.error}`);
          setRunning(false);
          setProgressMsg('');
          return;
        }
        showToast(`已下载：${res.fileName}`, 'success');
        setResultMsg(
          `已下载 ${stats.totalFloors} 节（${stats.sectionCount} 节）：${res.fileName}\n请到「我的作品 → 导入作品」选此 JSON 还原。`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`收集失败：${msg}`, 'error');
      setErrorMsg(msg);
      setProgressMsg('');
    } finally {
      setRunning(false);
    }
  };

  const handleRetryFailed = async () => {
    if (failedFloors.length === 0 || retrying) return;
    const urlTrim = url.trim();
    if (!urlTrim) return;
    const startF = parseInt(startFloor, 10);
    const endF = parseInt(endFloor, 10);
    const fps = Math.max(1, parseInt(floorsPerSection, 10) || 10);

    setRetrying(true);
    setProgressMsg(`正在重试 ${failedFloors.length} 个失败楼层...`);
    setProgress({ current: 0, total: failedFloors.length });

    try {
      const result = await collectGululuToWorkJson({
        url: urlTrim,
        startFloor: startF,
        endFloor: endF,
        workTitle: workTitle.trim(),
        sectionMode,
        floorsPerSection: fps,
        manualFormat,
        retryFloorNums: failedFloors,
        existingItems: collectedItems,
      });
      if (!result.ok) {
        showToast(`重试失败：${result.error}`, 'error');
        return;
      }
      const items = result.items ?? [];
      const newFailed = result.failedFloorNums ?? [];
      const stats = result.stats ?? { totalFloors: 0, sectionCount: 0 };
      if (items.length > 0) setCollectedItems(items);
      setFailedFloors(newFailed);
      if (newFailed.length > 0) {
        showToast(`已补齐 ${stats.totalFloors} 节，仍有 ${newFailed.length} 节未成功`, 'info');
      } else {
        showToast(`全部 ${stats.totalFloors} 节已补齐`, 'success');
      }
      setProgressMsg(`已收集 ${stats.totalFloors} 节，分 ${stats.sectionCount} 节`);
      if ((window as any).electronAPI?.saveStoryAsFile) {
        const res = await (window as any).electronAPI.saveStoryAsFile(
          result.jsonData,
          result.fileName,
        );
        if (res && !res.canceled && (res.filePath || res.fileName)) {
          setResultMsg(
            `已重试并保存 ${stats.totalFloors} 节（${stats.sectionCount} 节）：${res.filePath || res.fileName}\n请到「我的作品 → 导入作品」选此 JSON 还原。`,
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`重试失败：${msg}`, 'error');
    } finally {
      setRetrying(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const handleSkipFailed = () => {
    setFailedFloors([]);
    showToast('已接受当前结果', 'success');
  };

  // 共享样式（统一走 token 类名）
  const labelClass = 'block text-xs font-medium mb-1.5 text-[var(--text-secondary)]';
  const inputClass =
    'w-full px-3.5 py-2 text-sm rounded-lg outline-none transition-all bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] focus:border-[var(--accent)] disabled:opacity-50';

  // 非 Electron 桌面端不支持
  if (!isElectron) {
    return (
      <div className="min-h-full w-full flex flex-col items-center justify-center p-8 bg-[var(--bg-base)] text-[var(--text-primary)]">
        <div className="text-center max-w-sm">
          <div className="flex justify-center mb-3"><Icon name="smartphone" size={40} /></div>
          <p className="font-medium text-[var(--text-primary)]">移动端暂不支持收集骨碌碌安科</p>
          <p className="text-sm mt-1 text-[var(--text-secondary)]">请在桌面端（Electron）使用此功能</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* 顶栏（仅在 onClose 存在时显示"✕ 关闭"按钮） */}
      {onClose && (
        <div className="flex items-center justify-end px-3 py-2 border-b border-[var(--border-color)]">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="关闭骨碌碌面板"
          >
            <Icon name="x" size={13} /> 关闭
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-6">
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-5">
          <section className="rounded-2xl p-5 bg-[var(--bg-card)] border border-[var(--border-color)]">
            <h2 className="text-sm font-semibold mb-4 text-[var(--text-primary)]">
              收集条件
            </h2>

            <div className="flex flex-col gap-3">
              {/* 骨碌碌作品链接 + 自动检测 */}
              <div>
                <label className={labelClass}>骨碌碌作品链接</label>
                <div className="flex items-stretch gap-2">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.gululu.world/book/1285"
                    disabled={running}
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    onClick={handleAutoDetect}
                    disabled={running || detecting}
                    className="px-3 py-2 text-xs rounded-lg transition-colors whitespace-nowrap bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-color)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                    title="自动检测作品总楼层数"
                  >
                    {detecting ? (
                      <>
                        <span
                          className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1 align-[-2px]"
                        />
                        检测中
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1"><Icon name="search" size={13} /> 自动检测</span>
                    )}
                  </button>
                </div>
              </div>

              {/* 楼层范围 + 切分模式 */}
              <div className="flex flex-wrap gap-2">
                <div className="flex-[1_1_120px]">
                  <label className={labelClass}>起始楼层</label>
                  <input
                    type="number"
                    min={1}
                    value={startFloor}
                    onChange={(e) => setStartFloor(e.target.value)}
                    disabled={running}
                    className={inputClass}
                  />
                </div>
                <div className="flex-[1_1_120px]">
                  <label className={labelClass}>终止楼层</label>
                  <input
                    type="number"
                    min={1}
                    value={endFloor}
                    onChange={(e) => setEndFloor(e.target.value)}
                    disabled={running}
                    className={inputClass}
                  />
                </div>
                <div className="flex-[1_1_120px]">
                  <label className={labelClass}>切分模式</label>
                  <select
                    value={sectionMode}
                    onChange={(e) => setSectionMode(e.target.value as SectionMode)}
                    disabled={running}
                    className={inputClass}
                  >
                    <option value="single">整段一节</option>
                    <option value="one-per-floor">每楼一节</option>
                    <option value="every-n">每 N 楼一节</option>
                  </select>
                </div>
                {sectionMode === 'every-n' && (
                  <div className="flex-[1_1_120px]">
                    <label className={labelClass}>每 N 楼一节</label>
                    <input
                      type="number"
                      min={1}
                      value={floorsPerSection}
                      onChange={(e) => setFloorsPerSection(e.target.value)}
                      disabled={running}
                      className={inputClass}
                    />
                  </div>
                )}
              </div>

              {/* 高级格式设置（折叠面板，与 NGA Tab 共享 AdvancedFormatSection） */}
              <AdvancedFormatSection
                value={manualFormat}
                onChange={setManualFormat}
                maxFloor={Number(endFloor) || undefined}
                disabled={running}
              />

              {/* 作品标题 */}
              <div>
                <label className={labelClass}>
                  作品标题（留空则用作品名或「骨碌碌-{'{opusId}'}」）
                </label>
                <input
                  value={workTitle}
                  onChange={(e) => setWorkTitle(e.target.value)}
                  placeholder="例如：安科-2026"
                  disabled={running}
                  className={inputClass}
                />
              </div>

              {/* 提示 */}
              <div className="text-xs flex items-start gap-1.5 text-[var(--text-muted)]">
                <Icon name="lightbulb" size={14} className="mt-0.5 shrink-0" />
                <div>
                  收集完成后会下载一个 <code>.anke.json</code> 文件。
                  到「我的作品」页面点「导入作品」选这个 JSON 即可还原为安科作品。
                </div>
              </div>

              {/* 按钮 */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleStart}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all bg-[var(--accent-bg)] text-[var(--accent)] border border-[var(--accent)] enabled:hover:bg-[var(--accent)] enabled:hover:text-[var(--text-on-accent)] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {running ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      {progressMsg || '处理中…'}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5"><Icon name="download" size={14} /> 确认收集</span>
                  )}
                </button>
                {running && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all bg-[var(--bg-card)] text-[var(--error)] border border-[var(--error)] cursor-pointer"
                  >
                    取消
                  </button>
                )}
              </div>

              {(running || retrying) && (
                <AnkeProgressBar
                  current={progress.current}
                  total={progress.total}
                  label={progressMsg || '正在爬取骨碌碌作品…'}
                />
              )}
            </div>
          </section>

          {/* 结果提示 */}
          {resultMsg && !running && (
            <section className="rounded-2xl p-5 bg-[var(--bg-card)] border border-[var(--accent)]">
              <div className="text-sm font-semibold mb-2 text-[var(--accent)]">
                <span className="inline-flex items-center gap-1.5 text-[var(--accent)]">
                  <Icon name="check" size={14} /> 收集完成
                </span>
              </div>
              <div className="text-sm whitespace-pre-wrap text-[var(--text-primary)]">
                {resultMsg}
              </div>
            </section>
          )}

          {/* 收集失败提示（页面内可见，可重新提交） */}
          {errorMsg && !running && (
            <section
              role="alert"
              className="rounded-2xl p-5 bg-[var(--tone-danger-veil)] border border-[var(--tone-danger-border)]"
            >
              <div className="text-sm font-semibold mb-1 text-[var(--tone-danger)]">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="alert" size={14} /> 收集失败
                </span>
              </div>
              <div className="text-sm whitespace-pre-wrap text-[var(--text-primary)]">{errorMsg}</div>
              <div className="text-xs mt-2 text-[var(--text-secondary)]">
                请检查链接与楼层范围后，修改上方参数并重新点击「确认收集」。
              </div>
            </section>
          )}

          {/* 失败楼层重试卡片 */}
          {!running && failedFloors.length > 0 && (
            <section className="rounded-2xl p-4 bg-[var(--tone-warn-soft)] border border-[var(--tone-warn-border)]">
              <div className="flex items-start gap-2 mb-3">
                <span className="text-[var(--tone-warn)]"><Icon name="alert" size={20} className="block" /></span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-[var(--tone-warn)]">
                    {failedFloors.length} 个楼层抓取失败
                  </div>
                  <div className="text-xs mt-1.5 text-[var(--text-secondary)]">
                    可选择重试这些楼层（自动补齐到 JSON），或跳过使用当前已收集的结果。
                  </div>
                  <div className="mt-2 text-xs text-[var(--text-secondary)]">
                    <span className="font-medium">失败楼层：</span>
                    <span className="break-all">
                      {failedFloors.join(', ')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleRetryFailed}
                  disabled={retrying}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 bg-[var(--tone-warn)] text-[var(--text-on-accent)] border border-[var(--tone-warn)]"
                >
                  <span className="inline-flex items-center gap-1">
                    {retrying
                      ? `重试中…（${failedFloors.length} 层）`
                      : <><Icon name="alert" size={14} /> 重试 {failedFloors.length} 个失败楼层（建议操作）</>}
                  </span>
                </button>
                <button
                  onClick={handleSkipFailed}
                  disabled={retrying}
                  className="px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 bg-transparent text-[var(--text-secondary)] border border-[var(--border-color)]"
                >
                  ⏭ 跳过失败楼层，使用当前结果
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
            toast.type === 'info'
              ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)]'
              : `border-none text-[var(--text-on-accent)] ${toast.type === 'success' ? 'bg-[var(--accent)]' : 'bg-[var(--error)]'}`
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
