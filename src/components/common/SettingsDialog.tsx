import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingStore, type ImageStoreMode } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 设置弹窗
 * - 图片存储模式：远端图床 / 本地保存
 * - 远端：catbox / sm.ms / 0x0.st / telegra.ph 兜底链（需要联网）
 * - 本地：保存到 userData/images/，通过 local:// 协议访问；NGA 导出时占位符
 * - 提供"打开本地图片目录"按钮（仅 Electron 环境有效）
 * - NGA 登录态：粘贴 Cookie 后可访问登录受限帖子
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const mode = useSettingStore((s) => s.imageStoreMode);
  const setMode = useSettingStore((s) => s.setImageStoreMode);
  const ngaCookies = useSettingStore((s) => s.ngaCookies);
  const setNgaCookies = useSettingStore((s) => s.setNgaCookies);
  const clearNgaCookies = useSettingStore((s) => s.clearNgaCookies);
  const [cookieDraft, setCookieDraft] = useState('');
  const [openFolderHint, setOpenFolderHint] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // 打开弹窗时初始化 cookie 输入框
  useEffect(() => {
    if (open) {
      setCookieDraft(ngaCookies);
    }
  }, [open, ngaCookies]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    setTimeout(() => closeBtnRef.current?.focus(), 10);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleOpenFolder = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.openImageFolder) {
      setOpenFolderHint('当前环境不支持打开本地目录（仅 Electron 应用可用）');
      return;
    }
    setOpenFolderHint(null);
    const res = await window.electronAPI.openImageFolder();
    if (!res.ok) {
      setOpenFolderHint(res.error || '打开失败');
    }
  };

  const handleModeChange = (next: ImageStoreMode) => {
    setMode(next);
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
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          padding: '20px 24px 16px',
          minWidth: 420,
          maxWidth: 520,
          width: '90vw',
          animation: 'modalSlideIn 0.18s ease-out',
          border: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        {/* 标题 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary, #111)',
            }}
          >
            设置
          </h3>
          <button
            onClick={onClose}
            ref={closeBtnRef}
            style={{
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              color: 'var(--text-secondary, #666)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover, rgba(0,0,0,0.05))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* 分组：图片存储模式 */}
        <Section title="图片存储模式">
          <RadioRow
            label="远端图床"
            description="上传到 uguu.se 公开图床（匿名/免费、需联网）。NGA 导出时直接使用返回的 URL。"
            checked={mode === 'remote'}
            onChange={() => handleModeChange('remote')}
          />
          {mode === 'remote' && (
            <div
              style={{
                padding: '4px 6px 8px',
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--text-muted, #999)',
              }}
            >
              💡 uguu.se 是匿名/免费图床，无 SLA；如需长期/重要图片，建议切到「本地保存」模式
              <br />
              💡 也可把图片上传到 NGA 后，复制 NGA 的图片 URL 直接粘贴到编辑器
            </div>
          )}
          <RadioRow
            label="本地保存"
            description="保存到本地 userData/images/，通过 local:// 协议访问。无需联网；NGA 导出时自动替换为占位符。"
            checked={mode === 'local'}
            onChange={() => handleModeChange('local')}
          />
          {mode === 'local' && (
            <div
              style={{
                padding: '4px 6px 8px',
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--text-muted, #999)',
              }}
            >
              ⚠️ 本地模式保存的图片（local:// 协议）在 NGA 论坛
              <b style={{ color: 'var(--danger, #dc2626)' }}>无法被识别</b>
              ，导出时自动替换为占位符
              <br />
              ⚠️ 远端图床（uguu.se 等）有
              <b style={{ color: 'var(--danger, #dc2626)' }}>时限限制</b>
              ，图片可能在数月/数年后失效
              <br />
              💡 推荐：把图片上传到 NGA 后，复制 NGA 的图片 URL 直接粘贴到编辑器
            </div>
          )}
          {/* 重置图片警告标记（用户曾勾「不再提示」时可恢复） */}
          {mode === 'local' && (
            <div
              style={{
                padding: '4px 6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('anke-creator-image-warning-dismissed');
                    useToastStore.getState().showToast('已重置图片警告，下次本地上传会重新提示', 'success');
                  } catch {
                    useToastStore.getState().showToast('重置失败', 'error');
                  }
                }}
                className="text-[10px] px-2 py-1 rounded transition-colors"
                style={{
                  background: 'var(--bg-card)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                }}
                title="清除 anke-creator-image-warning-dismissed 标记，下次本地上传重新弹警告"
              >
                🔄 重置图片警告
              </button>
              <span className="text-[10px]" style={{ color: 'var(--text-muted, #999)' }}>
                如果之前勾过「不再提示」，点此恢复
              </span>
            </div>
          )}
        </Section>

        {/* 分组：本地图片目录 */}
        <Section title="本地图片目录">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={handleOpenFolder}
              style={{
                padding: '7px 14px',
                fontSize: 12,
                fontWeight: 500,
                border: '1px solid var(--border-color, #e5e7eb)',
                borderRadius: 6,
                background: 'var(--bg-hover, rgba(0,0,0,0.04))',
                color: 'var(--text-primary, #111)',
                cursor: 'pointer',
              }}
            >
              打开本地图片目录
            </button>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted, #999)',
              }}
            >
              路径：userData/images/
            </span>
          </div>
          {openFolderHint && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--danger, #dc2626)',
                marginTop: 6,
              }}
            >
              {openFolderHint}
            </div>
          )}
        </Section>

        {/* 分组：NGA 登录态（可选） */}
        <Section title="NGA 登录态（可选）">
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                marginBottom: 6,
                lineHeight: 1.5,
              }}
            >
              粘贴 NGA Cookie 后，可访问"饼干/扣扣"等登录受限内容。
              <br />
              获取方式：浏览器登录 NGA → DevTools → Network → 任意请求 → 复制 Cookie。
            </div>
            <textarea
              rows={3}
              value={cookieDraft}
              onChange={(e) => setCookieDraft(e.target.value)}
              placeholder="ngaPassportCid=xxx; ngaPassportUid=xxx; ngaPassportToken=xxx"
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 11,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                borderRadius: 4,
                background: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                resize: 'vertical',
                outline: 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
              }}
            >
              <button
                onClick={() => setNgaCookies(cookieDraft)}
                disabled={cookieDraft === ngaCookies}
                style={{
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 500,
                  border: '1px solid var(--accent, #2563eb)55',
                  borderRadius: 5,
                  background: 'rgba(37,99,235,0.08)',
                  color: 'var(--accent, #2563eb)',
                  cursor: cookieDraft === ngaCookies ? 'not-allowed' : 'pointer',
                  opacity: cookieDraft === ngaCookies ? 0.5 : 1,
                }}
              >
                保存 Cookie
              </button>
              <button
                onClick={() => {
                  clearNgaCookies();
                  setCookieDraft('');
                }}
                disabled={!ngaCookies}
                style={{
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 500,
                  border: '1px solid var(--border-color)',
                  borderRadius: 5,
                  background: 'var(--bg-hover, rgba(0,0,0,0.04))',
                  color: 'var(--text-primary)',
                  cursor: !ngaCookies ? 'not-allowed' : 'pointer',
                  opacity: !ngaCookies ? 0.5 : 1,
                }}
              >
                清除
              </button>
              {ngaCookies && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--success, #10b981)',
                  }}
                >
                  ✓ 已配置
                </span>
              )}
            </div>
          </div>
        </Section>

        {/* 底部按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '7px 18px',
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid var(--accent, #2563eb)33',
              borderRadius: 6,
              background: 'rgba(37,99,235,0.08)',
              color: 'var(--accent, #2563eb)',
              cursor: 'pointer',
            }}
          >
            完成
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary, #666)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: 'var(--bg-base, #fafafa)',
          border: '1px solid var(--border-color, #e5e7eb)',
          borderRadius: 6,
          padding: 10,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function RadioRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 6px',
        borderRadius: 4,
        cursor: 'pointer',
        background: checked ? 'rgba(37,99,235,0.06)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!checked) e.currentTarget.style.background = 'var(--bg-hover, rgba(0,0,0,0.04))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = checked
          ? 'rgba(37,99,235,0.06)'
          : 'transparent';
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        style={{ marginTop: 2, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-primary, #111)',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-secondary, #666)',
            lineHeight: 1.5,
            marginTop: 2,
          }}
        >
          {description}
        </div>
      </div>
    </label>
  );
}
