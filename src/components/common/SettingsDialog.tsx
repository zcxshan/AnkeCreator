import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingStore, type ImageStoreMode } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';
import { isElectron } from '../../utils/platform';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 设置弹窗
 * - 图片存储模式：远端图床 / 本地保存
 * - 远端：catbox / sm.ms / 0x0.st / telegra.ph 兜底链（需要联网）
 * - 本地：保存到 [安装路径]/data/images/，通过 local:// 协议访问；NGA 导出时占位符
 *   （dev 模式：%APPDATA%\com.shanshian.ankecreator\images\）
 * - NGA 登录态：粘贴 Cookie 后可访问登录受限帖子
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const mode = useSettingStore((s) => s.imageStoreMode);
  const setMode = useSettingStore((s) => s.setImageStoreMode);
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const setLocalUploadEnabled = useSettingStore((s) => s.setLocalUploadEnabled);
  const ngaCookies = useSettingStore((s) => s.ngaCookies);
  const setNgaCookies = useSettingStore((s) => s.setNgaCookies);
  const clearNgaCookies = useSettingStore((s) => s.clearNgaCookies);
  const soundEnabled = useSettingStore((s) => s.soundEnabled);
  const setSoundEnabled = useSettingStore((s) => s.setSoundEnabled);
  const diceSoundName = useSettingStore((s) => s.diceSoundName);
  const setDiceSoundName = useSettingStore((s) => s.setDiceSoundName);
  const availableDiceSounds = useSettingStore((s) => s.availableDiceSounds);
  const showToast = useToastStore((s) => s.showToast);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cookieDraft, setCookieDraft] = useState('');
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // 重新扫描音效列表（上传/删除后调用）
  const refreshSounds = async () => {
    if (!isElectron || !window.electronAPI?.listDiceSounds) return;
    try {
      const list = await window.electronAPI.listDiceSounds();
      useSettingStore.getState().setAvailableDiceSounds(list);
    } catch (e) {
      console.error('刷新音效列表失败:', e);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 清空 value，允许选同一文件
    e.target.value = '';
    if (!file) return;
    if (!isElectron || !window.electronAPI?.uploadDiceSound) {
      showToast('上传音效仅在桌面端支持', 'error');
      return;
    }
    if (!/\.mp3$/i.test(file.name)) {
      showToast('仅支持 .mp3 格式', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast(`文件过大（限制 5MB，当前 ${(file.size / 1024 / 1024).toFixed(2)}MB）`, 'error');
      return;
    }
    try {
      // FileReader 读为 base64（去掉 data URL 前缀）
      const buffer = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await window.electronAPI.uploadDiceSound({
        filename: file.name,
        buffer,
        mimeType: 'audio/mpeg',
      });
      if (res.ok) {
        showToast(`已上传：${res.name || file.name}`, 'success');
        await refreshSounds();
      } else {
        showToast(`上传失败：${res.error || '未知错误'}`, 'error');
      }
    } catch (err) {
      showToast(`读取文件失败：${(err as Error)?.message || err}`, 'error');
    }
  };

  const handleDeleteSound = async (name: string) => {
    if (!isElectron || !window.electronAPI?.deleteDiceSound) return;
    if (name.toLowerCase() === 'dice-roll.mp3') {
      showToast('内置音效不可删除', 'error');
      return;
    }
    if (!window.confirm(`确定删除「${name}」？\n此操作不可恢复。`)) return;
    try {
      const res = await window.electronAPI.deleteDiceSound(name);
      if (res.ok) {
        showToast(`已删除：${name}`, 'success');
        // 如果删除的是当前选中的，回退到 dice-roll.mp3
        if (useSettingStore.getState().diceSoundName === name) {
          useSettingStore.getState().setDiceSoundName('dice-roll.mp3');
        }
        await refreshSounds();
      } else {
        showToast(`删除失败：${res.error || '未知错误'}`, 'error');
      }
    } catch (err) {
      showToast(`删除失败：${(err as Error)?.message || err}`, 'error');
    }
  };

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
          width: 'min(90vw, 520px)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
            padding: '20px 24px 4px',
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

        {/* 内容区（可滚动） */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 24px 8px' }}>
        {/* 分组：图片存储模式 */}
        <Section title="图片存储模式">
          {/* 本地上传总开关（统一控制 4 个上传入口） */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '4px 6px 10px',
              borderBottom: '1px dashed var(--border-color)',
              marginBottom: 10,
            }}
          >
            <ToggleSwitch
              label="📁 启用本地上传"
              checked={localUploadEnabled}
              onChange={setLocalUploadEnabled}
            />
            <span
              style={{
                fontSize: 11,
                color: localUploadEnabled ? 'var(--accent, #2563eb)' : 'var(--text-muted, #999)',
              }}
            >
              {localUploadEnabled ? '已开启' : '默认关闭'}
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-muted, #999)',
                marginLeft: 'auto',
              }}
            >
              控制编辑器/角色/模板页的本地上传
            </span>
          </div>

          <RadioRow
            label="本地保存"
            description="保存到本地 安装路径/data/images/，通过 local:// 协议访问。无需联网；NGA 导出时自动替换为占位符。需先在上方开启「本地上传」开关。"
            checked={mode === 'local'}
            onChange={() => handleModeChange('local')}
            disabled={!localUploadEnabled}
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
              <SettingsBtn
                variant="ghost"
                onClick={() => {
                  try {
                    localStorage.removeItem('anke-creator-image-warning-dismissed');
                    useToastStore.getState().showToast('已重置图片警告，下次本地上传会重新提示', 'success');
                  } catch {
                    useToastStore.getState().showToast('重置失败', 'error');
                  }
                }}
                title="清除 anke-creator-image-warning-dismissed 标记，下次本地上传重新弹警告"
              >
                🔄 重置图片警告
              </SettingsBtn>
              <span className="text-[10px]" style={{ color: 'var(--text-muted, #999)' }}>
                如果之前勾过「不再提示」，点此恢复
              </span>
            </div>
          )}
        </Section>

        {/* 分组：音效 */}
        <Section title="音效">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '4px 6px 10px',
              borderBottom: '1px dashed var(--border-color)',
              marginBottom: 10,
            }}
          >
            <ToggleSwitch
              label="🔊 启用掷骰音效"
              checked={soundEnabled}
              onChange={setSoundEnabled}
            />
            <span
              style={{
                fontSize: 11,
                color: soundEnabled ? 'var(--accent, #2563eb)' : 'var(--text-muted, #999)',
              }}
            >
              {soundEnabled ? '已开启' : '已关闭'}
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-muted, #999)',
                marginLeft: 'auto',
              }}
            >
              关闭后掷骰不再发出声音
            </span>
          </div>

          {/* 音效选择器 + 上传/删除 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              padding: '4px 6px 6px',
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-primary, #111)',
              }}
            >
              🎵 音效选择
            </span>
            <select
              value={diceSoundName}
              onChange={(e) => setDiceSoundName(e.target.value)}
              disabled={!soundEnabled}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-color, #e5e7eb)',
                background: 'var(--bg-input, #fff)',
                color: 'var(--text-primary, #111)',
                cursor: soundEnabled ? 'pointer' : 'not-allowed',
                opacity: soundEnabled ? 1 : 0.5,
              }}
            >
              {availableDiceSounds.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <SettingsBtn
              variant="primary"
              onClick={handleUploadClick}
              disabled={!isElectron}
              title={isElectron ? '选择本地 mp3 文件上传' : '上传音效仅在桌面端支持'}
            >
              📤 上传 mp3
            </SettingsBtn>
            {diceSoundName.toLowerCase() !== 'dice-roll.mp3' && (
              <SettingsBtn
                variant="ghost"
                onClick={() => handleDeleteSound(diceSoundName)}
                title="删除当前选中的音效"
              >
                🗑 删除当前
              </SettingsBtn>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,audio/mpeg"
              style={{ display: 'none' }}
              onChange={handleFileSelected}
            />
          </div>
          {/* 已加载音效列表（带删除按钮） */}
          {isElectron && availableDiceSounds.length > 0 && (
            <div
              style={{
                padding: '0 6px 10px',
                maxHeight: 140,
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted, #999)',
                  marginBottom: 4,
                }}
              >
                已加载 {availableDiceSounds.length} 个音效（点击切换，右侧🗑删除用户上传的）
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {availableDiceSounds.map((name) => {
                  const isBuiltin = name.toLowerCase() === 'dice-roll.mp3';
                  const isSelected = name === diceSoundName;
                  return (
                    <div
                      key={name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 6px',
                        borderRadius: 4,
                        background: isSelected ? 'var(--accent-bg, rgba(37,99,235,0.08))' : 'transparent',
                        fontSize: 11,
                      }}
                    >
                      <button
                        onClick={() => setDiceSoundName(name)}
                        disabled={!soundEnabled}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          cursor: soundEnabled ? 'pointer' : 'not-allowed',
                          color: isSelected ? 'var(--accent, #2563eb)' : 'var(--text-primary)',
                          fontWeight: isSelected ? 600 : 400,
                          padding: 0,
                          fontSize: 11,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isSelected ? '▶ ' : '  '}{name}
                        {isBuiltin && <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 4 }}>(内置)</span>}
                      </button>
                      {!isBuiltin && (
                        <button
                          onClick={() => handleDeleteSound(name)}
                          title={`删除 ${name}`}
                          style={{
                            fontSize: 11,
                            padding: '1px 6px',
                            border: '1px solid var(--border-color)',
                            borderRadius: 3,
                            background: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--danger, #dc2626)',
                          }}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted, #999)',
              padding: '0 6px 10px',
              lineHeight: 1.6,
            }}
          >
            💡 上传的 mp3 存于本地数据目录 <code style={{ background: 'var(--bg-hover)', padding: '0 4px', borderRadius: 3 }}>sounds/</code> 子目录，重启应用后保留。
            <br />
            💡 仅支持 .mp3 格式，文件 ≤ 5MB，内置 dice-roll.mp3 不可覆盖/删除。
          </div>
        </Section>

        {/* 分组：数据管理（说明文字） */}
        <Section title="数据管理">
          <div
            style={{
              padding: '4px 6px',
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
            }}
          >
            <b>卸载行为：</b>应用卸载时会先询问「是否已导出重要数据」，确认后再询问「是否同时清空个人数据」。
            <br />
            <b>更新行为：</b>覆盖安装（更新版本）时，所有数据自动保留在原位置，无需重新导出。
            <br />
            💡 主动清空所有本地数据的功能（设置按钮）已移除。如需清空，请到安装目录下手动删除 <code style={{ background: 'var(--bg-input)', padding: '0 4px', borderRadius: 3 }}>data/</code> 文件夹。
          </div>
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
              <SettingsBtn
                variant="primary"
                onClick={() => {
                  if (cookieDraft === ngaCookies) return;
                  setNgaCookies(cookieDraft);
                }}
                style={{
                  cursor: cookieDraft === ngaCookies ? 'not-allowed' : 'pointer',
                  opacity: cookieDraft === ngaCookies ? 0.5 : 1,
                }}
              >
                保存 Cookie
              </SettingsBtn>
              <SettingsBtn
                variant="ghost"
                onClick={() => {
                  if (!ngaCookies) return;
                  clearNgaCookies();
                  setCookieDraft('');
                }}
                style={{
                  cursor: !ngaCookies ? 'not-allowed' : 'pointer',
                  opacity: !ngaCookies ? 0.5 : 1,
                }}
              >
                清除
              </SettingsBtn>
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
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 24px 16px',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <SettingsBtn variant="primary" onClick={onClose}>
            完成
          </SettingsBtn>
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
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary, #666)',
          marginBottom: 8,
          letterSpacing: '0.02em',
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: 'var(--bg-base, #fafafa)',
          border: '1px solid var(--border-color, #e5e7eb)',
          borderLeft: '3px solid var(--accent, #2563eb)',
          borderRadius: 6,
          padding: 14,
          transition: 'border-color 0.15s',
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
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 10px 10px 8px',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent-bg, rgba(37,99,235,0.08))' : 'transparent',
        borderLeft: checked ? '3px solid var(--accent, #2563eb)' : '3px solid transparent',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (!checked) e.currentTarget.style.background = 'var(--bg-hover, rgba(0,0,0,0.04))';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = checked
          ? 'var(--accent-bg, rgba(37,99,235,0.08))'
          : 'transparent';
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={disabled ? undefined : onChange}
        disabled={disabled}
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

function SettingsBtn({ variant = 'ghost', onClick, children, title, style, disabled }: {
  variant?: 'primary' | 'danger' | 'ghost';
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
    border: '1px solid var(--border-color, #e5e7eb)',
    opacity: disabled ? 0.5 : 1,
    ...style,
  };
  const variantStyle = variant === 'primary'
    ? { background: 'rgba(37,99,235,0.08)', borderColor: 'rgba(37,99,235,0.4)', color: 'var(--accent, #2563eb)' }
    : variant === 'danger'
    ? { background: 'rgba(220,38,38,0.08)', borderColor: 'rgba(220,38,38,0.4)', color: 'var(--danger, #dc2626)' }
    : { background: 'var(--bg-hover, transparent)', color: 'var(--text-primary, #111)' };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{ ...baseStyle, ...variantStyle }}
    >
      {children}
    </button>
  );
}

function ToggleSwitch({ checked, onChange, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10,
          background: checked ? 'var(--accent, #2563eb)' : 'var(--bg-hover, #e5e7eb)',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
    </label>
  );
}
