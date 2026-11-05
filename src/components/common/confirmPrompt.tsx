import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  'title' | 'message' | 'confirmText' | 'cancelText' | 'danger'
>;

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

let current: PendingConfirm | null = null;
const listeners = new Set<() => void>();
let nextZIndex = 9500;

function emit() {
  for (const listener of listeners) listener();
}

function settle(confirmed: boolean) {
  const pending = current;
  current = null;
  emit();
  pending?.resolve(confirmed);
}

/**
 * 命令式二次确认：返回 Promise<boolean>，替代原生 window.confirm。
 *
 *   if (!(await askConfirm({ message: '确定删除？', danger: true }))) return;
 *
 * 若已有确认框未关闭，旧的会被视为取消（避免队列堆积和误确认）。
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { options, resolve };
    emit();
  });
}

/** 全局确认框宿主，需在应用根节点挂载一次 */
export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(current);
  const [zIndex] = useState(() => {
    nextZIndex += 10;
    return nextZIndex;
  });

  useEffect(() => {
    const update = () => setPending(current);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
      // 宿主卸载时把未决的确认按“取消”处理，避免调用方永久 await
      if (current) {
        const pending = current;
        current = null;
        pending.resolve(false);
      }
    };
  }, []);

  const handleConfirm = useCallback(() => settle(true), []);
  const handleCancel = useCallback(() => settle(false), []);

  return (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.options.title}
      message={pending?.options.message ?? ''}
      confirmText={pending?.options.confirmText}
      cancelText={pending?.options.cancelText}
      danger={pending?.options.danger}
      zIndex={zIndex}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
