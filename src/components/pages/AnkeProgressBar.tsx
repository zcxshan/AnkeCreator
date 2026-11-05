/**
 * AnkeTab 收集进度条
 *
 * - `current` / `total` 都是 0 → 显示 0%（初始/未启动）
 * - `total > 0` → 按比例计算 percent
 * - 不依赖主进程进度事件；未来要做分页进度时，
 *   从主进程 collectNga:onProgress 推过来更新 current 即可
 */
interface AnkeProgressBarProps {
  current: number;
  total: number;
  label?: string;
}

export function AnkeProgressBar({
  current,
  total,
  label = '正在处理…',
}: AnkeProgressBarProps) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const safeCurrent = total > 0 ? current : 0;
  const safeTotal = total > 0 ? total : 0;
  return (
    <section
      className="bg-[var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl p-4"
    >
      <div
        className="text-[var(--text-secondary)] flex items-center justify-between mb-2 text-xs"
      >
        <span>{label}</span>
        <span>
          {safeCurrent}/{safeTotal} ({percent}%)
        </span>
      </div>
      <div
        className="bg-[var(--bg-hover)] h-2 rounded-full overflow-hidden"
      >
        <div
          data-testid="anke-progress-fill"
          className="h-full"
          style={{
            width: `${percent}%`,
            background: 'var(--accent)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </section>
  );
}
