import { useEffect, useRef, useState } from 'react';
import { useImageWarningStore } from '../../store/imageWarningStore';
import { Icon } from './Icon';
import { Modal } from './Modal';

const DISMISSED_KEY = 'anke-creator-image-warning-dismissed';

/**
 * 本地上传图片前的提示弹窗（全局唯一，App 顶层挂载）
 * - 状态由 useImageWarningStore 集中管理
 * - 任何上传入口调用 showImageWarning() 即弹出
 * - 每次本地上传（除非已勾选「不再提示」）都会弹
 * - 勾选「不再提示」+ 确认 → 写入 localStorage（跨会话免打扰）
 * - 用户可手动清除 localStorage 的 `anke-creator-image-warning-dismissed` 重置
 */
export function LocalImageWarningDialog() {
  const open = useImageWarningStore((s) => s.open);
  const resolve = useImageWarningStore((s) => s.resolve);
  const [dontShow, setDontShow] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setDontShow(false);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleConfirm = () => {
    if (dontShow) {
      try {
        localStorage.setItem(DISMISSED_KEY, '1');
      } catch {
        // ignore
      }
    }
    resolve(true);
  };

  return (
    <Modal
      open={open}
      onClose={() => resolve(false)}
      initialFocusRef={confirmBtnRef}
      labelledBy="local-image-warning-dialog-title"
      contentStyle={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-toolbar)',
        boxShadow: 'var(--shadow-modal)',
        padding: '24px 28px 20px',
        minWidth: 360,
        maxWidth: 480,
        animation: 'modalSlideIn 0.18s ease-out',
        border: '1px solid var(--border-color)',
      }}
    >
        <div className="flex items-center gap-[8px] mb-[14px]">
          <Icon name="lightbulb" size={20} />
          <h3
            id="local-image-warning-dialog-title"
            className="m-[0px] text-[15px] font-semibold text-[var(--text-primary)]"
          >
            图片保存提示
          </h3>
        </div>

        <div
          className="mb-[14px] py-[12px] px-[14px] text-[12px] leading-[1.8] text-[var(--text-primary)] bg-[var(--bg-toolbar)] rounded-[var(--radius-control)] border border-[color:var(--border-color)]"
        >
          本应用使用的免费图片托管平台是
          <b className="text-[var(--danger)]">限时的</b>
          ，图片可能在数月/数年后失效
          <br />
          本地保存的图片（路径）在 NGA 论坛
          <b className="text-[var(--danger)]">无法被识别</b>
          ，导出时自动替换为占位符
          <br />
          <b>最推荐：</b>把图片上传到 NGA 后，复制 NGA 的图片 URL 直接粘贴到编辑器
        </div>

        <label
          className="flex items-center gap-[6px] mb-[16px] text-[12px] text-[var(--text-secondary)] cursor-pointer select-none"
        >
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
          />
          <span>不再提示（清除 localStorage 的 anke-creator-image-warning-dismissed 可重置）</span>
        </label>

        <div className="flex justify-end gap-[8px]">
          <button
            onClick={() => resolve(false)}
            className="py-[8px] px-[18px] text-[13px] border border-[color:var(--border-color)] rounded-[var(--radius-control)] bg-transparent text-[var(--text-primary)] cursor-pointer"
          >
            取消
          </button>
          <button
            ref={confirmBtnRef}
            onClick={handleConfirm}
            className="py-[8px] px-[18px] text-[13px] font-semibold border border-[color:var(--tone-info-border)] rounded-[var(--radius-control)] bg-[var(--tone-info-soft)] text-[var(--tone-info)] cursor-pointer"
          >
            我知道了，继续上传
          </button>
        </div>
    </Modal>
  );
}

export const LOCAL_IMAGE_WARNING_DISMISSED_KEY = DISMISSED_KEY;
