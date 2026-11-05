// ============================================================
// AnkeCollectPage：收集安科（统一页面，含 NGA + 骨碌碌两个 Tab）
// 高内聚：本页自包含安科收集的全部 UI + 安科专属状态/handlers
// 低耦合：共享管道逻辑通过 useNgaCollectCommon hook 接入
// - 顶部 Tab 切换：📖 NGA 安科 / 📕 骨碌碌安科
// - NGA Tab：NGA 链接 / 起始楼层 / 末尾楼层 / 切分模式 / 每 N 楼 / 作品标题
// - NGA Tab 可选 authorid / 高级格式（自定义卷/章/节结构）
// - NGA Tab：进度 / 取消 / 暂停 / 失败页重试 / 保存为 .anke.json
// - 骨碌碌 Tab：复用 GululuCollectPanel 组件
// ============================================================
import { useState } from 'react';
import { Icon } from '../common/Icon';
import {
  collectAnkeToWorkJson,
  type SectionMode,
  type ManualFormatConfig,
} from '../../utils/ankeCollect';
import { AdvancedFormatSection } from '../anke/AdvancedFormatSection';
import { AnkeProgressBar } from './AnkeProgressBar';
import { GululuCollectPanel } from './GululuCollectPage';
import { webSaveStoryAsFile } from '../../utils/storyFileIO';
import { isCapacitor, isElectron } from '../../utils/platform';
import { CollectDecisionDialog } from '../common/CollectDecisionDialog';
import { useNgaCollectCommon } from '../../hooks/useNgaCollectCommon';

interface AnkeCollectPageProps {
  onBack: () => void;
}

type CollectTab = 'nga' | 'gululu';

export function AnkeCollectPage({ onBack }: AnkeCollectPageProps) {
  // Tab 状态：默认 NGA，骨碌碌作为子 Tab
  const [tab, setTab] = useState<CollectTab>('nga');

  // 安科专属表单状态
  const [floorsPerSection, setFloorsPerSection] = useState('10');
  const [sectionMode, setSectionMode] = useState<SectionMode>('every-n');
  const [workTitle, setWorkTitle] = useState('');

  // 安科专属抓取状态
  const [running, setRunning] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [ankeWarnings, setAnkeWarnings] = useState<string[]>([]);
  const [ankeCollectedItems, setAnkeCollectedItems] = useState<unknown[]>([]);
  const [manualFormat, setManualFormat] = useState<ManualFormatConfig>({
    enabled: false,
    volumes: [],
  });
  // ankeRetrying 在本地声明（而非从 useNgaCollectCommon 解构），
  // 因为 active: running || ankeRetrying 需要在调用 hook 前引用 ankeRetrying，
  // 若从 hook 返回值解构会导致 TDZ（Cannot access 'X' before initialization）。
  const [ankeRetrying, setAnkeRetrying] = useState(false);

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
    progressMessage: progressMsg,
    setProgressMessage: setProgressMsg,
    paused,
    setPaused,
    failedPages: ankeFailedPages,
    setFailedPages: setAnkeFailedPages,
    failedPagesExpanded: ankeFailedPagesExpanded,
    setFailedPagesExpanded: setAnkeFailedPagesExpanded,
    decision: ankeDecision,
    handleAutoDetect,
    handleTogglePause,
    handleCancel,
    handleDecide,
    parsedAuthorid,
    clearAuthorid,
  } = useNgaCollectCommon({ mode: 'anke', active: running || ankeRetrying });

  // 非 Electron 桌面端（Web 浏览器 / Capacitor 无 IPC）时，展示不支持提示卡片
  const isMobileUnsupported = (!isElectron && !isCapacitor) || (isCapacitor && !window.electronAPI?.collectNga);

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
    if (isNaN(startF) || isNaN(endF) || startF < 0 || endF < startF) {
      showToast('楼层范围不合法', 'error');
      return;
    }

    setRunning(true);
    setPaused(false);
    setProgressMsg('正在爬取 NGA 帖子…');
    setResultMsg('');
    setAnkeWarnings([]);
    setAnkeFailedPages([]);
    setAnkeFailedPagesExpanded(false);
    setAnkeCollectedItems([]);
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
        manualFormat,
      });
      if (!result.ok) {
        showToast(`收集失败：${result.error}`, 'error');
        setRunning(false);
        setProgressMsg('');
        return;
      }

      // 加固空值守卫：所有 result.xxx 字段加默认值，避免 undefined 访问
      const items = result.items ?? [];
      const failedPages = result.failedPages ?? [];
      const stats = result.stats ?? { totalFloors: 0, sectionCount: 0 };
      if (items.length > 0) {
        setAnkeCollectedItems(items);
      }
      if (failedPages.length > 0) {
        setAnkeFailedPages(failedPages);
      }

      const warns: string[] = [];
      if (failedPages.length > 0) {
        warns.push(`${failedPages.length} 页抓取失败（页码：${failedPages.join(', ')}），已跳过这些页的内容`);
      }
      if (result.actualMaxFloor && endF > result.actualMaxFloor) {
        if (failedPages.length > 0) {
          warns.push(`已爬到 ${result.actualMaxFloor} 楼，但还有 ${failedPages.length} 页抓取失败未补齐，实际帖子可能更长`);
        } else {
          warns.push(`帖子实际最高楼为 ${result.actualMaxFloor} 楼，已爬取所有存在的内容（您指定的 ${endF} 楼超出范围）`);
        }
      }
      if (warns.length > 0) setAnkeWarnings(warns);

      setProgressMsg(
        `已收集 ${stats.totalFloors} 楼，分 ${stats.sectionCount} 节`,
      );

      // 保存：优先 Electron 系统对话框，回退 Web 下载
      if (window.electronAPI?.saveStoryAsFile) {
        const res = await window.electronAPI.saveStoryAsFile(
          result.jsonData,
          result.fileName,
        );
        if (!res) {
          showToast('保存失败：IPC 返回为空', 'error');
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
          setRunning(false);
          setProgressMsg('');
          return;
        }
        showToast(`已保存：${res.filePath}`, 'success');
        setResultMsg(
          `已保存 ${stats.totalFloors} 楼（${stats.sectionCount} 节）到：${res.filePath}\n请到「我的作品 → 导入作品」选此 JSON 还原。`,
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
          `已下载 ${stats.totalFloors} 楼（${stats.sectionCount} 节）：${res.fileName}\n请到「我的作品 → 导入作品」选此 JSON 还原。`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`收集失败：${msg}`, 'error');
      setProgressMsg('');
    } finally {
      setRunning(false);
    }
  };

  const handleRetryFailedAnkePages = async () => {
    if (ankeFailedPages.length === 0 || ankeRetrying) return;
    const urlTrim = url.trim();
    if (!urlTrim) return;
    const startF = parseInt(startFloor, 10);
    const endF = parseInt(endFloor, 10);
    const fps = Math.max(1, parseInt(floorsPerSection, 10) || 10);

    setAnkeRetrying(true);
    setProgressMsg(`正在重试 ${ankeFailedPages.length} 个失败页...`);
    setProgress({ current: 0, total: ankeFailedPages.length });

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
        manualFormat,
        retryPages: ankeFailedPages,
        existingItems: ankeCollectedItems as any,
      });
      if (!result.ok) {
        showToast(`重试失败：${result.error}`, 'error');
        setAnkeFailedPages(ankeFailedPages);
        return;
      }
      // 加固空值守卫：所有 result.xxx 字段加默认值
      const items = result.items ?? [];
      const newFailed = result.failedPages ?? [];
      const stats = result.stats ?? { totalFloors: 0, sectionCount: 0 };
      if (items.length > 0) {
        setAnkeCollectedItems(items);
      }
      setAnkeFailedPages(newFailed);
      setAnkeFailedPagesExpanded(false);
      if (newFailed.length > 0) {
        showToast(
          `已补齐 ${stats.totalFloors} 楼，仍有 ${newFailed.length} 页未成功`,
          'warning',
        );
      } else {
        showToast(`全部 ${stats.totalFloors} 楼已补齐`, 'success');
        setAnkeWarnings([]);
      }
      setProgressMsg(
        `已收集 ${stats.totalFloors} 楼，分 ${stats.sectionCount} 节`,
      );
      if (window.electronAPI?.saveStoryAsFile) {
        const res = await window.electronAPI.saveStoryAsFile(
          result.jsonData,
          result.fileName,
        );
        if (!res) {
          showToast('保存失败：IPC 返回为空', 'error');
        } else if (!res.canceled && (res.filePath || res.fileName)) {
          setResultMsg(
            `已重试并保存 ${stats.totalFloors} 楼（${stats.sectionCount} 节）：${res.filePath || res.fileName}\n请到「我的作品 → 导入作品」选此 JSON 还原。`,
          );
        } else if (!res.ok && !res.canceled) {
          showToast(`保存失败：${res.error || '未知错误'}`, 'error');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`重试失败：${msg}`, 'error');
      setAnkeFailedPages(ankeFailedPages);
    } finally {
      setAnkeRetrying(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const handleSkipFailedAnkePages = () => {
    setAnkeFailedPages([]);
    setAnkeFailedPagesExpanded(false);
    showToast('已接受当前结果', 'success');
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
    borderRadius: 'var(--radius-md)',
    outline: 'none',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
  };

  if (isMobileUnsupported) {
    return (
      <div
        className="bg-[var(--bg-base)] text-[var(--text-primary)] min-h-full w-full flex flex-col"
      >
        <div
          className="border-[color:var(--border-color)] bg-[var(--bg-base)] flex items-center gap-3 px-6 py-4 border-b sticky top-8 z-40"
        >
          <button
            onClick={onBack}
            className="text-[var(--text-secondary)] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <span className="inline-flex items-center gap-1"><Icon name="back" size={16} /> 返回</span>
          </button>
          <h1 className="text-[var(--text-primary)] text-lg font-semibold flex items-center gap-2">
            <span className="inline-flex items-center gap-1"><Icon name="bookText" size={20} /> 收集安科</span>
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-3"><Icon name="bot" size={48} /></div>
            <p className="text-[var(--text-primary)] font-medium">移动端暂不支持收集安科</p>
            <p className="text-[var(--text-secondary)] text-sm mt-1">请在桌面端（Electron）使用此功能</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-[var(--bg-base)] text-[var(--text-primary)] min-h-full w-full flex flex-col"
    >
      {/* 顶栏 */}
      <div
        className="border-[color:var(--border-color)] flex items-center gap-3 px-6 py-4 border-b flex-wrap"
      >
        <button
          onClick={onBack}
          className="text-[var(--text-secondary)] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <span className="inline-flex items-center gap-1"><Icon name="back" size={16} /> 返回</span>
        </button>
        <h1
          className="text-[var(--text-primary)] text-lg font-semibold flex items-center gap-2"
        >
          <span className="inline-flex items-center gap-1"><Icon name="bookText" size={20} /> 收集安科</span>
        </h1>
        {/* Tab 切换：NGA / 骨碌碌 */}
        <div
          className="bg-[var(--bg-card)] border border-[color:var(--border-color)] inline-flex items-center gap-1 p-1 rounded-xl"
          role="tablist"
        >
          <button
            onClick={() => setTab('nga')}
            role="tab"
            aria-selected={tab === 'nga'}
            className="px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              background: tab === 'nga' ? 'var(--accent)' : 'transparent',
              color: tab === 'nga' ? 'var(--text-on-accent)' : 'var(--text-primary)',
              fontWeight: tab === 'nga' ? 600 : 400,
            }}
          >
            <span className="inline-flex items-center gap-1"><Icon name="bookText" size={14} /> NGA 安科</span>
          </button>
          <button
            onClick={() => setTab('gululu')}
            role="tab"
            aria-selected={tab === 'gululu'}
            className="px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              background: tab === 'gululu' ? 'var(--accent)' : 'transparent',
              color: tab === 'gululu' ? 'var(--text-on-accent)' : 'var(--text-primary)',
              fontWeight: tab === 'gululu' ? 600 : 400,
            }}
          >
            <span className="inline-flex items-center gap-1"><Icon name="book" size={14} />骨碌碌安科</span>
          </button>
        </div>
      </div>

      {/* Tab 内容区：条件渲染 NGA 或 骨碌碌 */}
      {tab === 'nga' ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-6">
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-5">
          <section
            className="bg-[var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl p-5"
          >
            <h2
              className="text-sm font-semibold mb-4 inline-flex items-center gap-1"
              style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}
            >
              <Icon name="settings" size={14} />
              收集条件
            </h2>

            <div className="flex flex-col gap-[12px]">
              {/* NGA 帖子 URL + 自动检测 */}
              <div>
                <label style={labelStyle}>NGA 主题帖链接</label>
                <div className="flex items-stretch gap-[8px]">
                  <input
                    className="anke-input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://nga.178.com/read.php?tid=12345（可加 &authorid=XXX 仅收集该用户）"
                    disabled={running}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      opacity: running ? 0.5 : 1,
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  />
                  <button
                    onClick={handleAutoDetect}
                    disabled={running || detecting}
                    className="bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3 py-2 text-xs rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap anke-btn"
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
                      <><Icon name="search" size={14} /> 自动检测</>
                    )}
                  </button>
                </div>
                {parsedAuthorid && (
                  <div
                    className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                    title="仅收集该用户的回复"
                  >
                    <Icon name="target" size={14} />
                    <span>仅收集用户 uid={parsedAuthorid} 的回复</span>
                    <button
                      onClick={clearAuthorid}
                      disabled={running}
                      className="text-[var(--accent)] ml-0.5 px-1 rounded transition-colors disabled:opacity-50"
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--scrim-soft)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      title="清除用户筛选（恢复全员）"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>

              {/* 楼层范围 + 切分模式 */}
              <div className="flex gap-[8px] flex-wrap">
                <div className="flex-[1_1_120px]">
                  <label style={labelStyle}>
                    起始楼层 <span className="text-[var(--text-secondary)] text-[11px]">（NGA 含 0 楼）</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={startFloor}
                    onChange={(e) => setStartFloor(e.target.value)}
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  />
                </div>
                <div className="flex-[1_1_120px]">
                  <label style={labelStyle}>终止楼层</label>
                  <input
                    type="number"
                    min={0}
                    value={endFloor}
                    onChange={(e) => {
                      setEndFloor(e.target.value);
                      setEndFloorManuallyEdited(true);
                    }}
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  />
                </div>
                <div className="flex-[1_1_120px]">
                  <label style={labelStyle}>切分模式</label>
                  <select
                    value={sectionMode}
                    onChange={(e) => setSectionMode(e.target.value as SectionMode)}
                    disabled={running}
                    style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  >
                    <option value="single">整段一节</option>
                    <option value="one-per-floor">每楼一节</option>
                    <option value="every-n">每 N 楼一节</option>
                  </select>
                </div>
                {sectionMode === 'every-n' && (
                  <div className="flex-[1_1_120px]">
                    <label style={labelStyle}>每 N 楼一节</label>
                    <input
                      type="number"
                      min={1}
                      value={floorsPerSection}
                      onChange={(e) => setFloorsPerSection(e.target.value)}
                      disabled={running}
                      style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
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
                  className="anke-input"
                  value={workTitle}
                  onChange={(e) => setWorkTitle(e.target.value)}
                  placeholder="例如：安科-2026"
                  disabled={running}
                  style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                />
              </div>

              {/* 高级格式设置（折叠面板） */}
              <AdvancedFormatSection
                value={manualFormat}
                onChange={setManualFormat}
                maxFloor={Number(endFloor) || undefined}
                disabled={running}
              />

              {/* 提示 */}
              <div
                className="text-[var(--text-muted)] text-xs flex items-start gap-1.5"
              >
                <Icon name="lightbulb" size={14} className="shrink-0" />
                <div>
                  收集完成后会下载一个 <code>.anke.json</code> 文件。
                  到「我的作品」页面点「<span className="inline-flex items-center gap-0.5 align-middle"><Icon name="download" size={12} />导入作品</span>」选这个 JSON 即可还原为安科作品。
                </div>
              </div>

              {/* 按钮 */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleStart}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all anke-btn-primary"
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
                    <><Icon name="download" size={14} /> 确认收集</>
                  )}
                </button>
                {running && (
                  <>
                    <button
                      type="button"
                      onClick={handleTogglePause}
                      className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all anke-btn"
                    >
                      <span className="inline-flex items-center gap-1">{paused ? <><Icon name="play" size={13} /> 恢复</> : <><Icon name="pause" size={13} /> 暂停</>}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="bg-[var(--bg-card)] text-[var(--error)] border border-[color:var(--error)] cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all anke-btn"
                    >
                      取消
                    </button>
                  </>
                )}
              </div>

              {(running || ankeRetrying) && (
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
              className="bg-[var(--bg-card)] border border-[color:var(--accent)] rounded-2xl p-5"
            >
              <div
                className="text-[var(--accent)] text-sm font-semibold mb-2 flex items-center gap-1"
              >
                <Icon name="check" size={14} className="shrink-0" />
                收集完成
              </div>
              <div
                className="text-[var(--text-primary)] text-sm whitespace-pre-wrap"
              >
                {resultMsg}
              </div>
            </section>
          )}

          {/* 失败页/楼层超范围警告 */}
          {ankeWarnings.length > 0 && !running && (
            <section
              className="bg-[var(--tone-warn-soft)] border border-[color:var(--tone-warn-border)] rounded-2xl p-4"
            >
              <div className="flex items-start gap-2">
                <span className="text-[var(--tone-warn)]"><Icon name="alert" size={14} className="shrink-0" /></span>
                <div className="flex-1">
                  {ankeWarnings.map((w, i) => (
                    <div
                      key={i}
                      className="text-[var(--text-secondary)] text-xs mt-1 first:mt-0"
                    >
                      {w}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* 失败页重试卡片 */}
          {!running && ankeFailedPages.length > 0 && (
            <section
              className="bg-[var(--tone-warn-soft)] border border-[color:var(--tone-warn-border)] rounded-2xl p-4"
            >
              <div className="flex items-start gap-2 mb-3">
                <span className="text-[var(--tone-warn)]"><Icon name="alert" size={14} className="shrink-0" /></span>
                <div className="flex-1">
                  <div className="text-[var(--tone-warn)] text-sm font-semibold">
                    {ankeFailedPages.length} 个页面抓取失败
                  </div>
                  <div className="text-[var(--text-secondary)] text-xs mt-1.5">
                    可选择重试这些页面（自动补齐到 JSON），或跳过使用当前已收集的结果。
                  </div>
                  {(() => {
                    const SHOW = 10;
                    const visible = ankeFailedPagesExpanded ? ankeFailedPages : ankeFailedPages.slice(0, SHOW);
                    const hasMore = ankeFailedPages.length > SHOW;
                    return (
                      <div className="text-[var(--text-secondary)] mt-2 text-xs">
                        <span className="font-medium">失败页码：</span>
                        <span className="break-all">
                          {visible.join(', ')}
                          {hasMore && !ankeFailedPagesExpanded && ` 等 ${ankeFailedPages.length} 页`}
                        </span>
                        {hasMore && (
                          <button
                            onClick={() => setAnkeFailedPagesExpanded((v) => !v)}
                            className="text-[var(--tone-warn)] bg-transparent border-none cursor-pointer p-[0px] ml-2 underline"
                          >
                            {ankeFailedPagesExpanded ? '收起' : '展开全部'}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleRetryFailedAnkePages}
                  disabled={ankeRetrying}
                  className="bg-[var(--tone-warn)] text-[var(--text-on-accent)] border border-[color:var(--tone-warn)] px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 anke-btn"
                >
                  {ankeRetrying ? (
                    `重试中…（${ankeFailedPages.length} 页）`
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="alert" size={14} />
                      重试 {ankeFailedPages.length} 个失败页（建议操作）
                    </span>
                  )}
                </button>
                <button
                  onClick={handleSkipFailedAnkePages}
                  disabled={ankeRetrying}
                  className="bg-transparent text-[var(--text-secondary)] border border-[color:var(--border-color)] px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 anke-btn"
                >
                  ⏭ 跳过失败页，使用当前结果
                </button>
              </div>
            </section>
          )}

          <CollectDecisionDialog
            open={ankeDecision.open}
            message={ankeDecision.message}
            failedPages={ankeDecision.failedPages}
            onContinue={() => handleDecide('continue')}
            onStop={() => handleDecide('stop')}
            onSkip={() => handleDecide('skip')}
          />
        </div>
        </div>
      ) : (
        <GululuCollectPanel onClose={() => setTab('nga')} />
      )}
    </div>
  );
}
