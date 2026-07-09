// ============================================================
// ResourceLibraryPage：资源库（外壳页面）
// 高内聚：本页只负责顶栏 + 顶部 Tab 切换 + 渲染对应子面板
// 低耦合：不侵入图片库/模板库内部逻辑，仅组合现有面板
//
// 2 个顶级 Tab（#3 美化）：
// - 🖼️ 图片         → ImageLibraryPanel
// - 📋 模板         → TemplatesPanel（内部子 Tab：世界观 / 人物）
// ============================================================

import { useState } from 'react';
import { ImageLibraryPanel } from './ImageLibraryPage';
import { TemplatesPanel } from './TemplatesPage';

interface ResourceLibraryPageProps {
  onBack: () => void;
  onShowAuthor?: () => void;
}

type ResourceTab = 'image' | 'template';
type TemplateSubTab = 'world' | 'character';

const TABS: { key: ResourceTab; label: string; icon: string }[] = [
  { key: 'image', label: '图片', icon: '🖼️' },
  { key: 'template', label: '模板', icon: '📋' },
];

export function ResourceLibraryPage({ onBack, onShowAuthor }: ResourceLibraryPageProps) {
  const [activeTab, setActiveTab] = useState<ResourceTab>('image');
  // 记住用户在「模板」Tab 下选中的子 Tab，切走再切回不重置（#3）
  const [templateSubTab, setTemplateSubTab] = useState<TemplateSubTab>('world');

  return (
    <div
      className="min-h-full w-full flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* 顶栏（sticky 在 TitleBar 下方 32px 处，z-40） */}
      <div
        className="flex items-center gap-3 px-6 py-4 border-b sticky top-8 z-40"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-base)' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          ← 返回
        </button>
        <h1
          className="text-lg font-semibold flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <span>🗂️</span> 资源库
        </h1>
        <div className="flex-1" />
      </div>

      {/* 顶部主 Tab 切换（2 个：图片 / 模板） */}
      <div
        className="flex items-center gap-2 px-6 py-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="px-5 py-2 text-sm rounded-lg transition-all flex items-center gap-2"
              style={{
                background: active ? 'var(--accent-bg)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color)'}`,
                fontWeight: active ? 600 : 400,
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <span style={{ fontSize: 15 }}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'image' && <ImageLibraryPanel />}
        {activeTab === 'template' && (
          <TemplatesPanel
            initialTab={templateSubTab}
            onTabChange={(sub) => setTemplateSubTab(sub)}
            onShowAuthor={onShowAuthor}
          />
        )}
      </div>
    </div>
  );
}
