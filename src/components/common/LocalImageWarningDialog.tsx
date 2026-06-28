import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useImageWarningStore } from '../../store/imageWarningStore';

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
      if (e.key === 'Escape') {
        e.stopPropagation();
        resolve(false);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    setTimeout(() => confirmBtnRef.current?.focus(), 10);
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

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        animation: 'modalFade 0.15s ease-out',
      }}
      onClick={() => resolve(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          padding: '24px 28px 20px',
          minWidth: 360,
          maxWidth: 480,
          animation: 'modalSlideIn 0.18s ease-out',
          border: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>💡</span>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary, #111)',
            }}
          >
            图片保存提示
          </h3>
        </div>

        <div
          style={{
            marginBottom: 14,
            padding: '12px 14px',
            fontSize: 12,
            lineHeight: 1.8,
            color: 'var(--text-primary, #111)',
            background: 'var(--bg-toolbar, #f5f5f5)',
            borderRadius: 6,
            border: '1px solid var(--border-color, #e5e7eb)',
          }}
        >
          ⚠️ 本应用使用的免费图片托管平台是
          <b style={{ color: 'var(--danger, #dc2626)' }}>限时的</b>
          ，图片可能在数月/数年后失效
          <br />
          ⚠️ 本地保存的图片（路径）在 NGA 论坛
          <b style={{ color: 'var(--danger, #dc2626)' }}>无法被识别</b>
          ，导出时自动替换为占位符
          <br />
          💡 <b>最推荐：</b>把图片上传到 NGA 后，复制 NGA 的图片 URL 直接粘贴到编辑器
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 16,
            fontSize: 12,
            color: 'var(--text-secondary, #555)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
          />
          <span>不再提示（清除 localStorage 的 anke-creator-image-warning-dismissed 可重置）</span>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => resolve(false)}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-primary, #111)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            ref={confirmBtnRef}
            onClick={handleConfirm}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid #2563eb33',
              borderRadius: 6,
              background: 'rgba(37,99,235,0.08)',
              color: '#2563eb',
              cursor: 'pointer',
            }}
          >
            我知道了，继续上传
          </button>
        </div>
      </div>
      <style>
        {`
          @keyframes modalFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes modalSlideIn {
            from { opacity: 0; transform: translateY(-8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}
      </style>
    </div>,
    document.body,
  );
}

export const LOCAL_IMAGE_WARNING_DISMISSED_KEY = DISMISSED_KEY;
