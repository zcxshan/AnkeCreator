import { useState } from 'react';
import { useSettingStore } from '../../store/settingStore';

/**
 * 编辑区顶部常驻警告横幅
 * - 当 imageStoreMode === 'local' 且 localUploadEnabled === true 时持续显示
 * - 黄色警告色（#f59e0b 渐变到 #d97706）+ 白字
 * - 含三条警告信息（与 LocalImageWarningDialog 内容一致）
 * - 右上角 ✕ 关闭：关闭后本次会话内不再显示
 *   - 刷新页面 / 切到远端再切回本地 → 横幅重新出现
 * - zIndex 50（高于内容，低于 modal）
 */
export function LocalModeBanner() {
  const mode = useSettingStore((s) => s.imageStoreMode);
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const [dismissed, setDismissed] = useState(false);

  // 总开关关闭时永远不显示
  if (!localUploadEnabled) return null;
  if (mode !== 'local' || dismissed) return null;

  return (
    <div
      role="alert"
      style={{
        background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
        color: '#fff',
        padding: 'calc(8px + env(safe-area-inset-top, 0px)) 12px 8px',
        fontSize: 12,
        lineHeight: 1.6,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        position: 'relative',
        zIndex: 50,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1.6 }}>⚠️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>本地保存模式已开启</div>
        <div style={{ opacity: 0.95 }}>
          ⚠️ 本应用免费图片托管平台
          <b>限时</b>
          ，远端 URL 可能在数月后失效
          <br />
          ⚠️ 本地保存的图片（路径）
          <b>无法被 NGA 论坛识别</b>
          ，导出时自动替换为占位符
          <br />
          💡 <b>最推荐：</b>切到「远端图床」或手动上传 NGA 后复制链接
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="关闭横幅"
        title="关闭（本次会话内不再显示）"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 16,
          padding: 4,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
