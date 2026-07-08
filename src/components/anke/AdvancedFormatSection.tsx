// ============================================================
// AdvancedFormatSection：高级格式设置共享组件
// 高内聚：只负责"高级格式设置"折叠面板的 UI（details + checkbox + ManualFormatEditor）
// 低耦合：与 NGA / 骨碌碌 / 安价 等收集源无关，可被任意 collect 页面复用
// ============================================================
import type { ManualFormatConfig } from '../../utils/ankeCollect';
import { ManualFormatEditor } from './ManualFormatEditor';

interface AdvancedFormatSectionProps {
  value: ManualFormatConfig;
  onChange: (v: ManualFormatConfig) => void;
  maxFloor?: number;
  /** 是否禁用（抓取进行中时禁用，避免修改后状态不一致） */
  disabled?: boolean;
}

export function AdvancedFormatSection({
  value,
  onChange,
  maxFloor,
  disabled,
}: AdvancedFormatSectionProps) {
  return (
    <details
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: '4px 12px',
        background: 'var(--bg-card-secondary, transparent)',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          padding: '8px 0',
          userSelect: 'none',
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        ⚙ 高级格式设置（可选，自定义卷/章/节结构 + 楼号范围）
      </summary>
      <div style={{ padding: '8px 0 12px', display: 'grid', gap: 10 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
            disabled={disabled}
            style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            启用自定义卷/章/节结构
          </span>
        </label>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          启用后爬取数据按你指定的卷/章/节 + 楼号范围切分。未启用则按「每 N 楼一节」自动切分。
        </div>
        {value.enabled && (
          <ManualFormatEditor
            value={value}
            onChange={onChange}
            maxFloor={maxFloor}
          />
        )}
      </div>
    </details>
  );
}
