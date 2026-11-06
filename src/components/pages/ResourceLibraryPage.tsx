// ============================================================
// ResourceLibraryPage：资源库（外壳页面）
// 高内聚：本页只负责顶栏 + 顶部 Tab 切换 + 渲染对应子面板
// 低耦合：不侵入图片库/模板库内部逻辑，仅组合现有面板
//
// 3 个顶级 Tab：
// - 🖼️ 图片         → ImageLibraryPanel
// - 📋 人物模板     → TemplatesPanel
// - 🔍 寻找素材     → FindMaterialPanel（素材网站推荐，增删改查）
// ============================================================

import { useState } from 'react';
import { Icon, type IconName } from '../common/Icon';
import { ImageLibraryPanel } from './ImageLibraryPage';
import { TemplatesPanel } from './TemplatesPage';
import { FindMaterialPanel } from './FindMaterialPanel';

interface ResourceLibraryPageProps {
  onBack: () => void;
  onShowAuthor?: () => void;
}

type ResourceTab = 'image' | 'template' | 'material';

const TABS: { key: ResourceTab; label: string; icon: IconName }[] = [
  { key: 'image', label: '图片', icon: 'bookText' },
  { key: 'template', label: '人物模板', icon: 'copy' },
  { key: 'material', label: '寻找素材', icon: 'search' },
];

export function ResourceLibraryPage({ onBack, onShowAuthor }: ResourceLibraryPageProps) {
  const [activeTab, setActiveTab] = useState<ResourceTab>('image');

  return (
    <div
      className="an-page text-[var(--an-ink)] h-full w-full flex flex-col"
    >
      {/* 顶栏（非 sticky，随 body 滚动） */}
      <div
        className="bg-[var(--an-paper-2)] flex items-center justify-between gap-3 px-6 py-4"
        style={{ borderBottom: '3px solid var(--an-ink)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="an-pill"
          >
            <span className="inline-flex items-center gap-1"><Icon name="back" size={16} /> 返回</span>
          </button>
          <h1
            className="text-[var(--an-ink)] flex items-center gap-2"
            style={{ fontFamily: 'var(--an-font-display)', fontSize: 22 }}
          >
            <Icon name="folder" size={20} /> 资源库
          </h1>
        </div>
      </div>

      {/* 顶部主 Tab 切换（3 个：图片 / 人物模板 / 寻找素材） */}
      <div
        className="flex items-center gap-2 px-6 py-3"
        style={{ borderBottom: '3px solid var(--an-ink)', background: 'var(--an-paper)' }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`an-pill px-5 h-9 ${active ? 'is-active' : ''}`}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden px-4 md:px-6 py-5" style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}>
        <div className="anke-card h-full w-full overflow-hidden">
          {activeTab === 'image' && <ImageLibraryPanel />}
          {activeTab === 'template' && <TemplatesPanel onShowAuthor={onShowAuthor} />}
          {activeTab === 'material' && <FindMaterialPanel />}
        </div>
      </div>
    </div>
  );
}
