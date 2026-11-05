import { useEffect, useRef } from 'react';
import { Modal } from './Modal';

interface CollectDecisionDialogProps {
  open: boolean;
  title?: string;
  message: string;
  failedPages: number[];
  onContinue: () => void;
  onStop: () => void;
  onSkip: () => void;
}

/**
 * 收集任务决策对话框：连续抓取失败时让用户选择
 * - 继续尝试：reset 失败计数，继续抓
 * - 停止抓取：取消任务
 * - 跳过失败页并保存：把已抓结果保存，结束任务
 */
export function CollectDecisionDialog({
  open,
  title = '抓取异常',
  message,
  failedPages,
  onContinue,
  onStop,
  onSkip,
}: CollectDecisionDialogProps) {
  const continueBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        onContinue();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onContinue]);

  if (!open) return null;

  const displayPages = failedPages.slice(0, 20);
  const overflow = failedPages.length - displayPages.length;

  return (
    <Modal
      open={open}
      onClose={onStop}
      closeOnOverlayClick={false}
      initialFocusRef={continueBtnRef}
      labelledBy="collect-decision-dialog-title"
      contentStyle={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-toolbar)',
        boxShadow: 'var(--shadow-modal)',
        padding: '24px 28px 20px',
        minWidth: 360,
        maxWidth: 520,
        animation: 'modalSlideIn 0.18s ease-out',
        border: '1px solid var(--border-color)',
      }}
    >
        <h3
          id="collect-decision-dialog-title"
          className="m-[0px] mb-[12px] text-[16px] font-semibold text-[var(--text-primary)]"
        >
          {title}
        </h3>
        <p
          className="m-[0px] mb-[8px] text-[13px] leading-[1.6] text-[var(--text-secondary)] whitespace-pre-wrap"
        >
          {message}
        </p>
        {failedPages.length > 0 && (
          <div
            className="mt-[0px] mr-[0px] mb-[16px] ml-[0px] py-[8px] px-[12px] text-[12px] leading-[1.7] text-[var(--text-secondary)] bg-[var(--bg-hover)] rounded-[var(--radius-control)] border border-[color:var(--border-color)]"
          >
            <div className="font-semibold mb-[4px] text-[var(--text-primary)]">
              失败页码（{failedPages.length} 页）
            </div>
            <div className="break-all">
              {displayPages.join(', ')}
              {overflow > 0 && <span className="text-[var(--text-secondary)]"> 等 {overflow} 页</span>}
            </div>
          </div>
        )}
        <div
          className="flex justify-end gap-[8px] flex-wrap"
        >
          <button
            onClick={onStop}
            className="py-[8px] px-[14px] text-[13px] border border-[color:var(--tone-danger-border)] rounded-[var(--radius-control)] bg-[var(--tone-danger-soft)] text-[var(--tone-danger)] cursor-pointer"
          >
            停止抓取
          </button>
          <button
            onClick={onSkip}
            className="py-[8px] px-[14px] text-[13px] border border-[color:var(--border-color)] rounded-[var(--radius-control)] bg-transparent text-[var(--text-primary)] cursor-pointer"
          >
            跳过失败页并保存
          </button>
          <button
            ref={continueBtnRef}
            onClick={onContinue}
            className="py-[8px] px-[18px] text-[13px] font-semibold border border-[color:var(--tone-info-border)] rounded-[var(--radius-control)] bg-[var(--tone-info-soft)] text-[var(--tone-info)] cursor-pointer"
          >
            继续尝试
          </button>
        </div>
    </Modal>
  );
}
