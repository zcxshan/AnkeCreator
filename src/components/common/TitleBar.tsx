import { useEffect, useState } from 'react';
import { useThemeStore } from '../../store/themeStore';
import { AuthorInfo } from './AuthorInfo';
import { SettingsDialog } from './SettingsDialog';

/**
 * 自定义标题栏（无边框窗口专用） - 支持日间/夜间主题
 *
 *  - 左侧为可拖拽区域（drag-region），显示应用名 + 当前故事/节
 *  - 右侧为 主题切换按钮 + Windows 风格的最小化/最大化/关闭按钮
 *  - 在非 Electron 环境下（纯 web 预览）窗口控制按钮将优雅降级
 */
export function TitleBar({
  storyTitle,
  sectionTitle,
}: {
  storyTitle?: string;
  sectionTitle?: string;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showAuthorInfo, setShowAuthorInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { mode, toggle } = useThemeStore();

  useEffect(() => {
    if (!window.electronAPI) return;
    // 订阅主进程推送的 maximize / unmaximize 状态变化
    // 关键：用户拖动窗口边缘/标题栏取消最大化时，renderer 端无法自行感知状态，
    // 必须由 main 主动推送（main.ts 已挂 win.on('maximize'/'unmaximize')）
    const api = window.electronAPI as unknown as {
      onMaximizeStateChange?: (cb: (isMaximized: boolean) => void) => () => void
    }
    if (typeof api.onMaximizeStateChange !== 'function') return;
    const unsubscribe = api.onMaximizeStateChange((isMax) => {
      setIsMaximized(isMax)
    })
    return () => {
      unsubscribe()
    }
  }, []);

  const hasElectron = !!window.electronAPI;

  const handleToggleMaximize = () => {
    if (hasElectron) {
      // 不再本地乐观更新 setIsMaximized((v) => !v)
      // 状态由 onMaximizeStateChange 回调统一更新，避免与 main 推送的状态不一致
      window.electronAPI?.toggleMaximize();
    }
  };

  return (
    <div
      className="h-9 flex items-center justify-between select-none px-1"
      style={{
        background: 'var(--an-paper-2)',
        borderBottom: '2px solid var(--an-ink)',
        WebkitAppRegion: 'drag',
        color: 'var(--an-ink)',
      } as React.CSSProperties}
    >
      {/* 左侧：应用名 + 当前故事/节 */}
      <div className="flex items-center px-2 text-xs overflow-hidden gap-2">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0"
          style={{
            background: 'var(--an-pink)',
            border: '2px solid var(--an-ink)',
            boxShadow: '0 2px 0 var(--an-ink)',
            fontFamily: 'var(--an-font-display)',
            color: '#fff',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.6 6.2L21 9l-4.8 4.4L17.5 21 12 17.5 6.5 21l1.3-7.6L3 9l6.4-.8z" />
          </svg>
          安科作者助手
        </span>
        {storyTitle && (
          <>
            <span className="text-[var(--an-ink-faint)] mx-1">—</span>
            <span className="text-[var(--an-ink-soft)] truncate">
              {storyTitle}
            </span>
            {sectionTitle && (
              <>
                <span className="text-[var(--an-ink-faint)] mx-1">/</span>
                <span className="text-[var(--an-ink-soft)] truncate">
                  {sectionTitle}
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* 右侧：设置 + 主题切换 + 窗口控制按钮 */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center"
      >
        {/* 设置 */}
        <button
          onClick={() => setShowSettings(true)}
          title="设置"
          className="text-[var(--an-ink-soft)] w-10 h-9 flex items-center justify-center transition-colors rounded-[10px]"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--an-pink-soft)';
            e.currentTarget.style.color = 'var(--an-ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--an-ink-soft)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* 主题切换 */}
        <button
          onClick={toggle}
          title={mode === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
          className="text-[var(--an-ink-soft)] w-10 h-9 flex items-center justify-center transition-colors rounded-[10px]"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--an-pink-soft)';
            e.currentTarget.style.color = 'var(--an-ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--an-ink-soft)';
          }}
        >
          {mode === 'dark' ? (
            // 月亮 -> 表示当前处于夜间模式，点击会切换到日间
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
            </svg>
          ) : (
            // 太阳
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
              <line x1="4.2" y1="4.2" x2="6.3" y2="6.3" />
              <line x1="17.7" y1="17.7" x2="19.8" y2="19.8" />
              <line x1="4.2" y1="19.8" x2="6.3" y2="17.7" />
              <line x1="17.7" y1="6.3" x2="19.8" y2="4.2" />
            </svg>
          )}
        </button>

        {/* 作者信息 */}
        <button
          onClick={() => setShowAuthorInfo(true)}
          title="关于作者"
          className="text-[var(--an-ink-soft)] w-10 h-9 flex items-center justify-center transition-colors rounded-[10px]"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--an-pink-soft)';
            e.currentTarget.style.color = 'var(--an-ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--an-ink-soft)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="10" r="3" />
            <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
          </svg>
        </button>

        {/* 最小化 */}
        <button
          onClick={() => window.electronAPI?.minimize()}
          disabled={!hasElectron}
          title="最小化"
          className="text-[var(--an-ink-soft)] w-10 h-9 flex items-center justify-center transition-colors disabled:opacity-60 rounded-[10px]"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--an-pink-soft)';
            e.currentTarget.style.color = 'var(--an-ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--an-ink-soft)';
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line
              x1="2"
              y1="6"
              x2="10"
              y2="6"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>

        {/* 最大化 / 还原 */}
        <button
          onClick={handleToggleMaximize}
          disabled={!hasElectron}
          title={isMaximized ? '还原' : '最大化'}
          className="text-[var(--an-ink-soft)] w-10 h-9 flex items-center justify-center transition-colors disabled:opacity-60 rounded-[10px]"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--an-pink-soft)';
            e.currentTarget.style.color = 'var(--an-ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--an-ink-soft)';
          }}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="3"
                y="1"
                width="8"
                height="8"
                stroke="currentColor"
                strokeWidth="1"
              />
              <rect
                x="1"
                y="3"
                width="8"
                height="8"
                stroke="currentColor"
                strokeWidth="1"
                fill="var(--bg-card)"
              />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="2"
                y="2"
                width="8"
                height="8"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          )}
        </button>

        {/* 关闭 */}
        <button
          onClick={() => window.electronAPI?.close()}
          disabled={!hasElectron}
          title="关闭"
          className="text-[var(--an-ink-soft)] w-10 h-9 flex items-center justify-center transition-colors disabled:opacity-60 rounded-[10px]"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--an-pink)';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--an-ink-soft)';
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line
              x1="2"
              y1="2"
              x2="10"
              y2="10"
              stroke="currentColor"
              strokeWidth="1"
            />
            <line
              x1="10"
              y1="2"
              x2="2"
              y2="10"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
      </div>

      {showAuthorInfo && <AuthorInfo onClose={() => setShowAuthorInfo(false)} />}
      {showSettings && <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
