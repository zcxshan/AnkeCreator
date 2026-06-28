import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSettingStore } from '../../store/settingStore';
import type { UploadProgressEvent } from '../../utils/uploadImage';

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

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

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
          minWidth: 380,
          maxWidth: 480,
          width: '90vw',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
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
            图片上传进度
          </h3>
          <button
            onClick={onClose}
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

        {/* 副标题：模式 + 统计 */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary, #666)',
            marginBottom: 12,
          }}
        >
          模式：<span style={{ fontWeight: 600 }}>{modeLabel}</span>
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
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 60,
            maxHeight: 360,
            border: '1px solid var(--border-color, #e5e7eb)',
            borderRadius: 6,
            padding: tasks.length > 0 ? '8px' : 0,
          }}
        >
          {tasks.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-muted, #999)',
                fontSize: 12,
                padding: '24px 0',
              }}
            >
              暂无任务
            </div>
          ) : (
            tasks.map((task) => (
              <TaskItem key={task.taskId} task={task} />
            ))
          )}
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 14,
          }}
        >
          {stats.failed > 0 && onRetryFailed && (
            <button
              onClick={onRetryFailed}
              style={{
                padding: '7px 16px',
                fontSize: 12,
                border: '1px solid var(--accent, #2563eb)55',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--accent, #2563eb)',
                cursor: 'pointer',
              }}
            >
              重试失败项
            </button>
          )}
          <button
            onClick={onClose}
            disabled={stats.inProgress > 0}
            style={{
              padding: '7px 18px',
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'var(--bg-hover, rgba(0,0,0,0.04))',
              color: 'var(--text-primary, #111)',
              cursor: stats.inProgress > 0 ? 'not-allowed' : 'pointer',
              opacity: stats.inProgress > 0 ? 0.5 : 1,
            }}
          >
            {stats.allDone ? '完成' : '关闭'}
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

/** 单个任务行 */
function TaskItem({ task }: { task: UploadProgressEvent }) {
  const isSuccess = task.status === 'success';
  const isFailed = task.status === 'failed';
  const isUploading = task.status === 'uploading' || task.status === 'pending';

  // 进度条颜色
  const barColor = isSuccess
    ? 'var(--success, #10b981)'
    : isFailed
      ? 'var(--danger, #dc2626)'
      : 'var(--accent, #2563eb)';

  // 状态文字
  let statusText: string;
  if (isSuccess) statusText = '成功';
  else if (isFailed) statusText = `失败：${task.error || '未知错误'}`;
  else if (task.status === 'uploading') statusText = `上传中 ${task.progress}%`;
  else statusText = '等待中';

  const statusColor = isSuccess
    ? 'var(--success, #10b981)'
    : isFailed
      ? 'var(--danger, #dc2626)'
      : 'var(--text-secondary, #666)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 6px',
        borderBottom: '1px solid var(--border-color, rgba(0,0,0,0.05))',
      }}
    >
      {/* 图标 */}
      <div
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          background: isSuccess
            ? 'rgba(16,185,129,0.1)'
            : isFailed
              ? 'rgba(220,38,38,0.1)'
              : 'rgba(37,99,235,0.1)',
          color: barColor,
          fontSize: 14,
        }}
      >
        {isSuccess ? '✓' : isFailed ? '✕' : '⏳'}
      </div>

      {/* 文件名 + 进度条 + 状态 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-primary, #111)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={task.fileName}
          >
            {task.fileName}
          </span>
          <span
            style={{
              fontSize: 11,
              color: statusColor,
              flexShrink: 0,
            }}
          >
            {statusText}
          </span>
        </div>
        {/* 进度条 */}
        <div
          style={{
            height: 4,
            background: 'var(--bg-hover, rgba(0,0,0,0.08))',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${task.progress}%`,
              height: '100%',
              background: barColor,
              transition: isUploading ? 'width 0.3s ease' : 'none',
            }}
          />
        </div>
        {isSuccess && task.host && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted, #999)',
              marginTop: 3,
            }}
          >
            目标：{task.host}
          </div>
        )}
      </div>
    </div>
  );
}
