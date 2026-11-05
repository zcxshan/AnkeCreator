import { useId } from 'react';
import { Icon } from '../common/Icon';
import { Modal as BaseModal } from '../common/Modal';

/**
 * 解析 "key:value" 多行/逗号输入，返回 [{ key, value }, ...] 数组。
 * 用于"批量添加属性 / 差分"对话框。
 *  - 支持换行分隔与逗号分隔
 *  - 兼容空白
 *  - 自动忽略空行
 */
export function parseBatchEntries(text: string): { key: string; value: string }[] {
  const result: { key: string; value: string }[] = [];
  if (!text) return result;
  // 先按行分割，每行再按逗号分割（兼容多行 + 单行逗号）
  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    for (const seg of trimmedLine.split(',')) {
      const segTrim = seg.trim();
      if (!segTrim) continue;
      // 第一个冒号分隔 key/value
      const colonIdx = segTrim.indexOf(':');
      if (colonIdx <= 0) continue;  // 必须有冒号且 key 非空
      const key = segTrim.slice(0, colonIdx).trim();
      const value = segTrim.slice(colonIdx + 1).trim();
      if (!key) continue;
      result.push({ key, value });
    }
  }
  return result;
}

// ============================================================
// 通用
// ============================================================

export function EmptyHint({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      className="bg-[var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl p-12 text-center"
    >
      <div className="flex justify-center mb-3"><Icon name="box" size={36} /></div>
      <p className="text-[var(--text-primary)] font-medium">{title}</p>
      <p className="text-[var(--text-secondary)] text-sm mt-1">{desc}</p>
    </div>
  );
}

/** 页面内弹窗外壳：委托给统一 Modal 原语（portal / 焦点陷阱 / Esc / 滚动锁） */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <BaseModal
      open
      onClose={onClose}
      labelledBy={titleId}
      contentStyle={{ maxWidth: 512, width: '100%', padding: 24, borderRadius: 'var(--radius-xl)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 id={titleId} className="text-[var(--text-primary)] text-base font-semibold">{title}</h3>
        <button
          onClick={onClose}
          className="text-[var(--text-secondary)] w-7 h-7 flex items-center justify-center rounded-md"
          aria-label="关闭"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      {children}
    </BaseModal>
  );
}
