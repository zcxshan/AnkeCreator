// ============================================================
// 移动端底部导航栏（仅 Android / iOS Capacitor 平台显示）
// - 5 Tab：首页 / 作品 / 编辑 / 模板 / 更多
// - "更多" 弹 BottomSheet 收纳次要功能（找安价/收集安价/教程/关于作者）
// - 编辑 Tab 在没有活动作品时禁用
// - 桌面端（isElectron / isWeb）整个组件不渲染
// ============================================================

import { useState } from 'react';
import { isCapacitor } from '../../utils/platform';

type Route = 'home' | 'works' | 'editor' | 'templates' | 'tutorial' | 'anjia' | 'find-anke';

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
  { key: 'editor', label: '编辑', icon: '✏️' },
  { key: 'templates', label: '模板', icon: '📦' },
  { key: 'more', label: '更多', icon: '⋯' },
];

const MORE_ITEMS: Array<{ key: 'anjia' | 'find-anke' | 'tutorial' | 'author'; label: string; icon: string }> = [
  { key: 'anjia', label: '收集安价', icon: '📮' },
  { key: 'find-anke', label: '寻找安科', icon: '🔍' },
  { key: 'tutorial', label: '使用教程', icon: '📖' },
  { key: 'author', label: '关于作者', icon: '👤' },
];

export function MobileBottomNav({ route, onChangeRoute, onShowAuthor, hasActiveStory }: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

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

  const handleMoreItem = (key: 'anjia' | 'find-anke' | 'tutorial' | 'author') => {
    setMoreOpen(false);
    if (key === 'author') {
      onShowAuthor();
    } else {
      onChangeRoute(key);
    }
  };

  const isActive = (key: Route | 'more') => {
    if (key === 'more') {
      return moreOpen || route === 'tutorial' || route === 'anjia' || route === 'find-anke';
    }
    if (key === 'editor') {
      return route === 'editor';
    }
    return route === key;
  };

  const isDisabled = (key: Route) => key === 'editor' && !hasActiveStory;

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
        </div>
      )}

      {/* 底部导航栏（仅移动端） */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden"
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
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 active:opacity-70 disabled:opacity-30"
              style={{
                color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
                minHeight: 56,
              }}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="text-[10px] leading-none">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
