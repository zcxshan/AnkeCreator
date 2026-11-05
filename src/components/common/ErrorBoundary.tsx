// ============================================================
// ErrorBoundary —— React 错误边界
//
// 作用：
//   - 捕获子组件树任意位置的渲染错误 / 同步抛错
//   - 阻止错误冒泡到根导致整个应用卸载（白屏）
//   - 在界面上以红色面板显示错误信息和 stack trace
//
// 何时使用：
//   - 包裹页面级组件（如 EditorPage、HomePage）
//   - 包裹可能因为异步数据未就绪而抛错的复杂子树
//
// 注意：
//   - 不会捕获异步事件（如 onClick）中的错误
//   - 不会捕获子组件的 useEffect / setTimeout 抛错（React 18+）
//   - 这些场景需在事件处理器内显式 try/catch
// ============================================================

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  /** 自定义错误 UI；若不提供则使用默认的红色面板 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    // 下一次渲染时切到错误 UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 红色 console.error 让 devtools 立即可见
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div
          className="crash-screen"
          style={{
            position: 'fixed',
            inset: 0,
            padding: 24,
            background: 'var(--crash-bg)',
            color: 'var(--crash-danger)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            overflow: 'auto',
            zIndex: 9999,
          }}
        >
          <div
            className="font-bold text-[16px] mb-[12px] text-[var(--crash-ink)]"
          >
            <span className="inline-flex items-center gap-2"><Icon name="alert" size={18} /> 界面崩溃</span>
          </div>
          <div
            className="text-[var(--text-on-accent)] mb-[12px] p-[12px] bg-[var(--crash-action-danger)] rounded-[var(--radius-sm)]"
          >
            {this.state.error.message || '(无错误信息)'}
          </div>
          <pre
            className="whitespace-pre-wrap text-[var(--crash-warn)] text-[12px] m-[0px]"
          >
            {this.state.error.stack}
          </pre>
          <button
            onClick={this.reset}
            className="mt-[16px] py-[8px] px-[16px] bg-[var(--tone-info)] text-[var(--text-on-accent)] border-none rounded-[var(--radius-control)] cursor-pointer text-[13px] font-semibold"
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
