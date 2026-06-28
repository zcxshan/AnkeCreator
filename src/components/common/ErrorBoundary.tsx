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
          style={{
            position: 'fixed',
            inset: 0,
            padding: 24,
            background: '#1f2937',
            color: '#fca5a5',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            overflow: 'auto',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              marginBottom: 12,
              color: '#fee2e2',
            }}
          >
            ⚠️ 界面崩溃
          </div>
          <div
            style={{
              color: '#ffffff',
              marginBottom: 12,
              padding: 12,
              background: '#7f1d1d',
              borderRadius: 4,
            }}
          >
            {this.state.error.message || '(无错误信息)'}
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              color: '#fbbf24',
              fontSize: 12,
              margin: 0,
            }}
          >
            {this.state.error.stack}
          </pre>
          <button
            onClick={this.reset}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
