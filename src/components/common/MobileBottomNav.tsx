// ============================================================
// 移动端底部导航栏（仅 Android / iOS Capacitor 平台显示）
// - 4 Tab：首页 / 作品 / 资源 / 更多
// - "更多" 弹 BottomSheet 收纳次要功能（找安价/收集安价/教程/关于作者/设置/主题）
// - 桌面端（isElectron / isWeb）整个组件不渲染
// - 编辑入口已分离到 WorksListPage：用户先点"作品" tab → 点开作品 → 进入编辑区
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { isCapacitor } from '../../utils/platform';
import { useThemeStore } from '../../store/themeStore';
import { SettingsDialog } from './SettingsDialog';

type Route = 'home' | 'works' | 'editor' | 'reader' | 'resource-library' | 'tutorial' | 'anjia-collect' | 'anke-collect' | 'find-anke' | 'dice-playground';

interface MobileBottomNavProps {
  route: Route;
  onChangeRoute: (route: Route) => void;
  onShowAuthor: () => void;
  hasActiveStory: boolean;
}

interface TabItem {
  key: Route | 'more';
  label: string;
  icon: string;
}

const TABS: TabItem[] = [
  { key: 'home', label: '首页', icon: '🏠' },
  { key: 'works', label: '作品', icon: '📚' },
  { key: 'resource-library', label: '资源', icon: '🗂️' },
  { key: 'more', label: '更多', icon: '⋯' },
];

type MoreItemKey = 'anjia-collect' | 'anke-collect' | 'find-anke' | 'tutorial' | 'author' | 'settings';
type ThemeChoice = 'light' | 'dark' | 'system';

const MORE_ITEMS: Array<{ key: MoreItemKey; label: string; icon: string }> = [
  { key: 'anjia-collect', label: '收集安价', icon: '📜' },
  { key: 'anke-collect', label: '收集安科', icon: '📖' },
  { key: 'find-anke', label: '寻找安科', icon: '🔍' },
  { key: 'tutorial', label: '使用教程', icon: '📖' },
  { key: 'author', label: '关于作者', icon: '👤' },
  { key: 'settings', label: '设置', icon: '⚙️' },
];

const THEME_OPTIONS: Array<{ key: ThemeChoice; label: string; icon: string }> = [
  { key: 'light', label: '亮色', icon: '☀️' },
  { key: 'dark', label: '暗色', icon: '🌙' },
  { key: 'system', label: '跟随系统', icon: '🖥️' },
];

// 记录用户的主题选择意图（与 themeStore 的 'anke:theme-mode' 分开存）
const THEME_CHOICE_KEY = 'anke:theme-choice';

function readThemeChoice(): ThemeChoice {
  try {
    if (typeof localStorage === 'undefined') return 'system';
    const v = localStorage.getItem(THEME_CHOICE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    // 没有显式 choice 时：若 store 已写入具体 mode（桌面端 toggle 留下的），沿用之
    const mode = localStorage.getItem('anke:theme-mode');
    if (mode === 'light' || mode === 'dark') return mode;
  } catch {
    // ignore
  }
  return 'system';
}

export function MobileBottomNav({ route, onChangeRoute, onShowAuthor, hasActiveStory }: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readThemeChoice);
  const { setMode } = useThemeStore();

  // "跟随系统" 时监听系统主题变化，自动跟随
  useEffect(() => {
    if (themeChoice !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setMode(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, [themeChoice, setMode]);

  // 安卓版过滤掉"收集安价/收集安科/寻找安科"（依赖 Electron IPC，桌面端专属）
  const visibleMoreItems = useMemo(
    () => MORE_ITEMS.filter((it) => it.key !== 'anjia-collect' && it.key !== 'anke-collect' && it.key !== 'find-anke'),
    [],
  );

  // 桌面端不渲染
  if (!isCapacitor) return null;

  const handleTabClick = (key: Route | 'more') => {
    if (key === 'more') {
      setMoreOpen((v) => !v);
      return;
    }
    setMoreOpen(false);
    onChangeRoute(key);
  };

  const handleMoreItem = (key: MoreItemKey) => {
    if (key === 'settings') {
      setMoreOpen(false);
      setShowSettings(true);
      return;
    }
    setMoreOpen(false);
    if (key === 'author') {
      onShowAuthor();
    } else {
      onChangeRoute(key);
    }
  };

  const handleThemeChoice = (choice: ThemeChoice) => {
    setThemeChoice(choice);
    try {
      localStorage.setItem(THEME_CHOICE_KEY, choice);
    } catch {
      // ignore
    }
    if (choice === 'system') {
      // 清除显式 mode，让主题跟随系统；用当前系统偏好写入一次以同步 store
      try {
        localStorage.removeItem('anke:theme-mode');
      } catch {
        // ignore
      }
      const sysDark =
        typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
          : false;
      setMode(sysDark ? 'dark' : 'light');
    } else {
      setMode(choice);
    }
  };

  const isActive = (key: Route | 'more') => {
    if (key === 'more') {
      return moreOpen || route === 'tutorial' || route === 'anjia-collect' || route === 'anke-collect' || route === 'find-anke';
    }
    return route === key;
  };

  // 所有 tab 都可点：编辑入口已从 tabbar 移除，用户从"作品" tab 进入编辑区
  const isDisabled = (_key: Route) => false;

  return (
    <>
      {/* BottomSheet 遮罩（仅"更多"打开时） */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* BottomSheet 内容 */}
      {moreOpen && (
        <div
          className="fixed left-0 right-0 bottom-[64px] z-40 mx-2 mb-2 rounded-2xl p-3 shadow-2xl md:hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <div className="text-xs text-center mb-2" style={{ color: 'var(--text-secondary)' }}>
            更多功能
          </div>
          <div
            className="overflow-y-auto"
            style={{ maxHeight: '60vh', WebkitOverflowScrolling: 'touch' }}
          >
            <div className="grid grid-cols-2 gap-2">
              {MORE_ITEMS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => handleMoreItem(item.key)}
                  className="flex flex-col items-center gap-1 py-3 rounded-lg active:opacity-70"
                  style={{ background: 'var(--bg-input)' }}
                >
                  <span className="text-2xl">{item.icon}</span>
                  <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>

            {/* 主题切换 */}
            <div className="mt-3">
              <div
                className="text-[11px] mb-1.5 px-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                主题
              </div>
              <div className="grid grid-cols-3 gap-2">
                {THEME_OPTIONS.map((opt) => {
                  const active = themeChoice === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => handleThemeChoice(opt.key)}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-lg active:opacity-70 transition-colors"
                      style={{
                        background: active ? 'var(--accent-color)' : 'var(--bg-input)',
                        border: active
                          ? '1px solid var(--accent-color)'
                          : '1px solid transparent',
                      }}
                    >
                      <span className="text-xl">{opt.icon}</span>
                      <span
                        className="text-[11px]"
                        style={{
                          color: active ? '#fff' : 'var(--text-primary)',
                        }}
                      >
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 底部导航栏（仅移动端） */}
      <nav
        className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-40 flex md:hidden"
        style={{
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border-color)',
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
      >
        {TABS.map((tab) => {
          const active = isActive(tab.key);
          const disabled = tab.key !== 'more' && isDisabled(tab.key as Route);
          return (
            <button
              key={tab.key}
              onClick={() => !disabled && handleTabClick(tab.key)}
              disabled={disabled}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 active:scale-90 active:opacity-70 disabled:opacity-30 transition-transform"
              style={{
                color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
                minHeight: 56,
                paddingTop: 4,
                borderTop: active ? '2px solid var(--accent-color)' : '2px solid transparent',
              }}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="text-[10px] leading-none">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 设置弹窗（复用桌面端 TitleBar 的 SettingsDialog） */}
      {showSettings && <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />}
    </>
  );
}
