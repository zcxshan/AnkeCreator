// ============================================================
// 作品列表页级弹窗（新建作品 / 重命名 / 导入进度）
// 从 WorksListPage 抽出，页面只保留状态与业务回调
// ============================================================

import { useId, useState } from 'react';
import { Icon } from '../common/Icon';
import { Modal as BaseModal } from '../common/Modal';
import type { WorkSummary } from '../common/WorkCard';

interface DialogShellProps {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}

/** 弹窗外壳：委托给统一 Modal 原语（portal / 焦点陷阱 / Esc / 滚动锁） */
function DialogShell({ children, onClose, title }: DialogShellProps) {
  const titleId = useId();
  return (
    <BaseModal
      open
      onClose={onClose}
      labelledBy={titleId}
      contentStyle={{ maxWidth: 448, width: '100%', padding: 24, borderRadius: 'var(--radius-xl)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 id={titleId} className="text-[var(--text-primary)] text-lg font-semibold">
          {title}
        </h3>
        <button
          onClick={onClose}
          className="text-[var(--text-secondary)] w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          aria-label="关闭"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {children}
    </BaseModal>
  );
}

export interface NewStoryDialogProps {
  open: boolean;
  onClose: () => void;
  /** 标题可能为空字符串，由调用方决定兜底文案 */
  onCreate: (title: string, description: string) => void;
}

/** 新建作品：标题 + 简介 */
export function NewStoryDialog({ open, onClose, onCreate }: NewStoryDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  if (!open) return null;

  const handleSubmit = () => {
    onCreate(title.trim(), description.trim());
    setTitle('');
    setDescription('');
  };

  return (
    <DialogShell title="新建安科作品" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label
            className="text-[var(--text-secondary)] block text-sm font-medium mb-1.5"
          >
            作品标题
          </label>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="给你的安科起个名字"
            className="bg-[var(--bg-input)] border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
        </div>
        <div>
          <label
            className="text-[var(--text-secondary)] block text-sm font-medium mb-1.5"
          >
            作品简介（可选）
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话介绍这个安科世界…"
            className="bg-[var(--bg-input)] border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all resize-y"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-4 py-2 text-sm rounded-lg transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="bg-[var(--accent)] text-[var(--text-on-accent)] px-4 py-2 text-sm rounded-lg transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            创建并进入
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

export interface RenameStoryDialogProps {
  work: WorkSummary;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
}

/** 重命名作品：输入框初始值取当前标题 */
export function RenameStoryDialog({ work, onClose, onRename }: RenameStoryDialogProps) {
  const [value, setValue] = useState(work.title);

  const handleSubmit = () => {
    const next = value.trim();
    if (next) onRename(work.id, next);
    onClose();
  };

  return (
    <DialogShell title={`重命名「${work.title}」`} onClose={onClose}>
      <div className="space-y-4">
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="作品标题"
          className="bg-[var(--bg-input)] border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-4 py-2 text-sm rounded-lg transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="bg-[var(--accent)] text-[var(--text-on-accent)] px-4 py-2 text-sm rounded-lg transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            保存
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

export interface ImportProgress {
  current: number;
  total: number;
  message: string;
}

/** 导入作品进度（不可关闭，导入完成后由页面关闭） */
export function ImportProgressDialog({ progress }: { progress: ImportProgress | null }) {
  if (!progress) return null;
  const percent =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div
      className="bg-[var(--scrim)] fixed inset-0 z-50 flex items-center justify-center"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="正在导入作品"
    >
      <div
        className="bg-[var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl p-6 w-96 max-w-[90vw]"
      >
        <div className="text-[var(--text-primary)] text-sm font-medium mb-3">
          正在导入作品...
        </div>
        <div className="text-[var(--text-secondary)] text-xs mb-3">
          {progress.message}
        </div>
        <div
          className="bg-[var(--bg-hover)] h-2 rounded-full overflow-hidden mb-2"
        >
          <div
            className="h-full transition-all"
            style={{ width: `${percent}%`, background: 'var(--accent)' }}
          />
        </div>
        <div className="text-[var(--text-secondary)] text-xs text-right">
          {progress.current}/{progress.total}
        </div>
      </div>
    </div>
  );
}
