// ============================================================
// NGA「更新」弹窗：按作品已关联的帖子自动检测楼层 → 选范围/切分方式
// → 复用「收集安科」链路爬取 → 由父组件追加到作品末尾
// ============================================================
import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { Icon } from '../common/Icon';
import { AnkeProgressBar } from '../pages/AnkeProgressBar';
import { useNgaCollectCommon } from '../../hooks/useNgaCollectCommon';
import { collectAnkeToWorkJson, type SectionMode } from '../../utils/ankeCollect';
import {
  extractSectionsFromCollectJson,
  type IncomingSection,
} from '../../utils/ngaAppendSections';

export interface NgaUpdateMeta {
  totalFloors: number;
  failedPages: number[];
  actualMaxFloor?: number;
}

export interface NgaUpdateDialogProps {
  open: boolean;
  onClose: () => void;
  /** 作品已关联的 NGA 帖子 URL；为空时只提示去关联 */
  threadUrl: string | null;
  cookies: string;
  /** 追加到作品末尾；返回是否成功（成功才自动关闭） */
  onAppend: (sections: IncomingSection[], meta: NgaUpdateMeta) => Promise<boolean>;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  marginBottom: 6,
  color: 'var(--text-secondary)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
};

export function NgaUpdateDialog(props: NgaUpdateDialogProps) {
  const { open, onClose, threadUrl, cookies, onAppend } = props;

  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('');
  const [sectionMode, setSectionMode] = useState<Extract<SectionMode, 'single' | 'every-n'>>('every-n');
  const [floorsPerSection, setFloorsPerSection] = useState('10');
  const [detecting, setDetecting] = useState(false);
  const [totalFloors, setTotalFloors] = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  // 复用「收集安价/安科」的进度、暂停、取消管道
  const { progress, progressMessage, paused, handleTogglePause, handleCancel } =
    useNgaCollectCommon({ mode: 'anke', active: running });

  // 打开时重置并自动检测楼层数
  useEffect(() => {
    if (!open) return;
    setStartFloor('1');
    setEndFloor('');
    setSectionMode('every-n');
    setFloorsPerSection('10');
    setTotalFloors(null);
    setTotalPages(null);
    setError('');
    setRunning(false);

    if (!threadUrl || !window.electronAPI?.fetchNgaThreadInfo) return;
    let cancelled = false;
    setDetecting(true);
    window.electronAPI
      .fetchNgaThreadInfo(threadUrl, cookies || undefined)
      .then(
        (res: { ok: boolean; totalPages?: number; totalFloors?: number; error?: string }) => {
          if (cancelled) return;
          if (res?.ok) {
            const floors = res.totalFloors && res.totalFloors > 0 ? res.totalFloors : null;
            setTotalFloors(floors);
            setTotalPages(res.totalPages ?? null);
            if (floors) setEndFloor(String(floors));
          } else {
            setError(res?.error || '未能检测楼层数，请手动填写终止楼层');
          }
        },
      )
      .catch((e: unknown) => {
        if (!cancelled) setError(`检测失败：${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, threadUrl, cookies]);

  const handleStart = async () => {
    if (running) return;
    if (!threadUrl) {
      setError('当前作品还没有关联 NGA 帖子');
      return;
    }
    const startF = parseInt(startFloor, 10);
    const endF = parseInt(endFloor, 10);
    if (isNaN(startF) || isNaN(endF) || startF < 0 || endF < startF) {
      setError('楼层范围不合法');
      return;
    }
    setError('');
    setRunning(true);
    try {
      const result = await collectAnkeToWorkJson({
        url: threadUrl,
        startFloor: startF,
        endFloor: endF,
        workTitle: '',
        sectionMode,
        floorsPerSection: Math.max(1, parseInt(floorsPerSection, 10) || 10),
        cookies: cookies || undefined,
      });
      if (!result.ok) {
        setError(result.error || '抓取失败');
        return;
      }
      const sections = extractSectionsFromCollectJson(result.jsonData);
      if (sections.length === 0) {
        setError('指定范围内没有可追加的内容');
        return;
      }
      const appended = await onAppend(sections, {
        totalFloors: result.stats?.totalFloors ?? 0,
        failedPages: result.failedPages ?? [],
        actualMaxFloor: result.actualMaxFloor,
      });
      if (appended) onClose();
    } catch (e) {
      setError(`抓取失败：${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!running) onClose();
      }}
      closeOnOverlayClick={!running}
      closeOnEscape={!running}
      labelledBy="nga-update-title"
      contentStyle={{ width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)' }}
    >
      <div className="flex flex-col max-h-[inherit]">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[color:var(--border-color)]">
          <h2
            id="nga-update-title"
            className="text-sm font-semibold flex items-center gap-2 text-[var(--text-primary)]"
          >
            <Icon name="refresh" size={16} />
            从 NGA 更新作品
          </h2>
          <button
            onClick={() => !running && onClose()}
            disabled={running}
            className="w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
            title="关闭"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="text-xs text-[var(--text-secondary)] break-all">
            {threadUrl ? `目标帖子：${threadUrl}` : '尚未关联 NGA 帖子，请先在编辑器顶部关联。'}
          </div>

          {detecting && (
            <div className="text-xs text-[var(--text-secondary)] inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              正在检测帖子楼层…
            </div>
          )}
          {!detecting && totalFloors !== null && (
            <div className="text-xs text-[var(--accent)] inline-flex items-center gap-1.5">
              <Icon name="check" size={13} />
              已检测到约 {totalFloors} 楼{totalPages ? `（${totalPages} 页）` : ''}
            </div>
          )}

          <div className="flex gap-[8px] flex-wrap">
            <div className="flex-[1_1_120px]">
              <label style={labelStyle}>起始楼层（含）</label>
              <input
                type="number"
                min={0}
                value={startFloor}
                onChange={(e) => setStartFloor(e.target.value)}
                disabled={running}
                style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
              />
            </div>
            <div className="flex-[1_1_120px]">
              <label style={labelStyle}>终止楼层（含）</label>
              <input
                type="number"
                min={0}
                value={endFloor}
                onChange={(e) => setEndFloor(e.target.value)}
                placeholder={totalFloors ? String(totalFloors) : '请输入'}
                disabled={running}
                style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
              />
            </div>
            <div className="flex-[1_1_140px]">
              <label style={labelStyle}>切分方式</label>
              <select
                value={sectionMode}
                onChange={(e) => setSectionMode(e.target.value as 'single' | 'every-n')}
                disabled={running}
                style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
              >
                <option value="every-n">按 N 楼一节</option>
                <option value="single">全部一节</option>
              </select>
            </div>
            {sectionMode === 'every-n' && (
              <div className="flex-[1_1_100px]">
                <label style={labelStyle}>每 N 楼</label>
                <input
                  type="number"
                  min={1}
                  value={floorsPerSection}
                  onChange={(e) => setFloorsPerSection(e.target.value)}
                  disabled={running}
                  style={{ ...inputStyle, opacity: running ? 0.5 : 1 }}
                />
              </div>
            )}
          </div>

          <div className="text-xs text-[var(--text-muted)] inline-flex items-start gap-1.5">
            <Icon name="lightbulb" size={13} className="shrink-0 mt-[1px]" />
            <span>
              爬取完成后会自动追加到作品最后一章末尾，不会覆盖已有内容。建议起始楼层从上次结束的下一楼开始。
            </span>
          </div>

          {error && (
            <div className="text-xs text-[var(--error)] bg-[var(--tone-danger-soft,var(--bg-hover))] rounded-lg px-3 py-2 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {running && (
            <AnkeProgressBar
              current={progress.current}
              total={progress.total}
              label={progressMessage || '正在爬取 NGA 帖子…'}
            />
          )}
        </div>

        <div className="px-5 py-4 border-t border-[color:var(--border-color)] flex items-center justify-end gap-2 flex-wrap">
          {running && (
            <>
              <button
                onClick={handleTogglePause}
                className="h-9 px-4 rounded-lg text-sm border border-[color:var(--border-color)] text-[var(--text-primary)] inline-flex items-center gap-1.5"
              >
                {paused ? <><Icon name="play" size={13} /> 恢复</> : <><Icon name="pause" size={13} /> 暂停</>}
              </button>
              <button
                onClick={handleCancel}
                className="h-9 px-4 rounded-lg text-sm border border-[color:var(--error)] text-[var(--error)]"
              >
                取消
              </button>
            </>
          )}
          {!running && (
            <button
              onClick={onClose}
              className="h-9 px-4 rounded-lg text-sm border border-[color:var(--border-color)] text-[var(--text-secondary)]"
            >
              关闭
            </button>
          )}
          <button
            onClick={handleStart}
            disabled={running || !threadUrl}
            className="h-9 px-5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            {running ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {paused ? '已暂停' : '爬取中…'}
              </>
            ) : (
              <>
                <Icon name="download" size={14} />
                爬取并追加
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
