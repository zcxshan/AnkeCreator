import { useMemo } from 'react';
import { useSettingStore } from '../../store/settingStore';
import type { UploadProgressEvent } from '../../utils/uploadImage';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface UploadProgressDialogProps {
  open: boolean;
  /** 任务列表（可变的，由调用方更新） */
  tasks: UploadProgressEvent[];
  /** 用户点关闭 / ESC */
  onClose: () => void;
  /** 用户点"重试失败项"（可选） */
  onRetryFailed?: () => void;
}

/**
 * 上传/保存进度窗口
 * - 居中 Modal，最大宽度 480px
 * - 显示当前模式（远端图床 / 本地保存）+ 总数 N（成功 X / 失败 Y）
 * - 每项显示：文件图标 + 文件名 + 进度条 + 状态文字
 * - ESC 关闭
 * - 失败时显示"重试失败项"按钮
 */
export function UploadProgressDialog({
  open,
  tasks,
  onClose,
  onRetryFailed,
}: UploadProgressDialogProps) {
  const mode = useSettingStore((s) => s.imageStoreMode);

  const stats = useMemo(() => {
    const total = tasks.length;
    const success = tasks.filter((t) => t.status === 'success').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    const inProgress = tasks.filter(
      (t) => t.status === 'pending' || t.status === 'uploading',
    ).length;
    const allDone = total > 0 && inProgress === 0;
    return { total, success, failed, inProgress, allDone };
  }, [tasks]);

  if (!open) return null;

  const modeLabel = mode === 'local' ? '本地保存' : '远端图床';

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="upload-progress-dialog-title"
      contentClassName="w-[90vw] max-w-[480px] min-w-[380px] max-h-[70vh] flex flex-col px-6 pt-5 pb-4"
    >
      {/* 标题 */}
      <div className="flex items-center justify-between mb-1">
        <h3
          id="upload-progress-dialog-title"
          className="m-0 text-[15px] font-semibold text-[var(--text-primary)]"
        >
          图片上传进度
        </h3>
        <button
          aria-label="关闭"
          onClick={onClose}
          title="关闭"
          className="w-6 h-6 flex items-center justify-center text-base bg-transparent border-0 rounded-[var(--radius-sm)] text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--bg-hover)]"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* 副标题：模式 + 统计 */}
      <div className="text-xs text-[var(--text-secondary)] mb-3">
        模式：<span className="font-semibold">{modeLabel}</span>
        {stats.total > 0 && (
          <>
            {' · '}
            总数 {stats.total}（成功 {stats.success} / 失败 {stats.failed}
            {stats.inProgress > 0 ? ` / 进行中 ${stats.inProgress}` : ''}）
          </>
        )}
      </div>

      {/* 任务列表 */}
      <div
        className={`flex-1 overflow-y-auto min-h-[60px] max-h-[360px] border border-[var(--border-color)] rounded-[var(--radius-control)] ${tasks.length > 0 ? 'p-2' : 'p-0'}`}
      >
        {tasks.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] text-xs py-6">
            暂无任务
          </div>
        ) : (
          tasks.map((task) => (
            <TaskItem key={task.taskId} task={task} />
          ))
        )}
      </div>

      {/* 底部按钮 */}
      <div className="flex justify-end gap-2 mt-3.5">
        {stats.failed > 0 && onRetryFailed && (
          <button
            onClick={onRetryFailed}
            className="px-4 py-[7px] text-xs rounded-[var(--radius-control)] border border-[color:var(--accent)] bg-transparent text-[var(--accent)] cursor-pointer hover:bg-[var(--accent-bg)]"
          >
            重试失败项
          </button>
        )}
        <button
          onClick={onClose}
          disabled={stats.inProgress > 0}
          className={`px-[18px] py-[7px] text-xs font-semibold rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-primary)] ${stats.inProgress > 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          {stats.allDone ? '完成' : '关闭'}
        </button>
      </div>
    </Modal>
  );
}

/** 单个任务行 */
function TaskItem({ task }: { task: UploadProgressEvent }) {
  const isSuccess = task.status === 'success';
  const isFailed = task.status === 'failed';
  const isUploading = task.status === 'uploading' || task.status === 'pending';

  // 进度条颜色
  const barColor = isSuccess
    ? 'var(--success)'
    : isFailed
      ? 'var(--danger)'
      : 'var(--accent)';

  // 状态文字
  let statusText: string;
  if (isSuccess) statusText = '成功';
  else if (isFailed) statusText = `失败：${task.error || '未知错误'}`;
  else if (task.status === 'uploading') statusText = `上传中 ${task.progress}%`;
  else statusText = '等待中';

  const statusColor = isSuccess
    ? 'var(--success)'
    : isFailed
      ? 'var(--danger)'
      : 'var(--text-secondary)';

  const iconBg = isSuccess
    ? 'var(--tone-success-soft)'
    : isFailed
      ? 'var(--tone-danger-veil)'
      : 'var(--tone-info-veil)';

  return (
    <div className="flex items-center gap-2.5 px-1.5 py-2 border-b border-[var(--border-color)]">
      {/* 图标 */}
      <div
        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-[var(--radius-sm)] text-sm"
        style={{ background: iconBg, color: barColor }}
      >
        {isSuccess ? <Icon name="check" size={16} /> : isFailed ? <Icon name="x" size={16} /> : <Icon name="hourglass" size={16} />}
      </div>

      {/* 文件名 + 进度条 + 状态 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span
            className="text-xs text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0"
            title={task.fileName}
          >
            {task.fileName}
          </span>
          <span
            className="text-[11px] shrink-0"
            style={{ color: statusColor }}
          >
            {statusText}
          </span>
        </div>
        {/* 进度条 */}
        <div className="h-1 bg-[var(--bg-hover)] rounded-[var(--radius-tight)] overflow-hidden">
          <div
            className="h-full"
            style={{
              width: `${task.progress}%`,
              background: barColor,
              transition: isUploading ? 'width 0.3s ease' : 'none',
            }}
          />
        </div>
        {isSuccess && task.host && (
          <div className="text-[10px] text-[var(--text-muted)] mt-1">
            目标：{task.host}
          </div>
        )}
      </div>
    </div>
  );
}
