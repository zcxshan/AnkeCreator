import { useState } from 'react';
import { useSettingStore } from '../../store/settingStore';
import { Icon } from './Icon';

/**
 * 编辑区顶部常驻警告横幅
 * - 当 imageStoreMode === 'local' 且 localUploadEnabled === true 时持续显示
 * - 黄色警告色（var(--tone-warn) 渐变到 var(--tone-warn-ink)）+ 白字
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
        background: 'var(--gradient-warn)',
        color: 'var(--text-on-accent)',
        padding: 'calc(8px + env(safe-area-inset-top, 0px)) 12px 8px',
        fontSize: 12,
        lineHeight: 1.6,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        position: 'relative',
        zIndex: 50,
        boxShadow: 'var(--shadow-sm)',
        flexShrink: 0,
      }}
    >
      <Icon name="alert" size={16} className="shrink-0 mt-0.5" />
      <div className="flex-[1] min-w-[0px]">
        <div className="font-semibold mb-[2px]">本地保存模式已开启</div>
        <div className="opacity-[0.95]">
          本应用免费图片托管平台
          <b>限时</b>
          ，远端 URL 可能在数月后失效
          <br />
          本地保存的图片（路径）
          <b>无法被 NGA 论坛识别</b>
          ，导出时自动替换为占位符
          <br />
          <b>最推荐：</b>切到「远端图床」或手动上传 NGA 后复制链接
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="关闭横幅"
        title="关闭（本次会话内不再显示）"
        className="bg-transparent border-none text-[var(--text-on-accent)] cursor-pointer text-[16px] p-[4px] leading-[1] shrink-0"
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
