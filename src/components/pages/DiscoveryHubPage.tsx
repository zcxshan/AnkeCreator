import { Icon, type IconName } from '../common/Icon';
import { useStoryStore } from '../../store/storyStore';

interface DiscoveryHubPageProps {
  onBack: () => void;
  onOpenAnjiaCollect: () => void;
  onOpenAnkeCollect: () => void;
  onOpenFindAnke: () => void;
}

const CARDS: Array<{
  key: 'anjia' | 'anke' | 'find';
  title: string;
  desc: string;
  icon: IconName;
  tint: string;
}> = [
  {
    key: 'anjia',
    title: '收集安价',
    desc: '从 NGA 主题帖抓取安价楼层，整理为结构化素材。',
    icon: 'scroll',
    tint: 'var(--an-pink-soft)',
  },
  {
    key: 'anke',
    title: '收集安科',
    desc: '从 NGA / 骨碌碌抓取整篇安科，生成可导入的单个 JSON 文件。',
    icon: 'download',
    tint: 'var(--an-sky-soft)',
  },
  {
    key: 'find',
    title: '搜索安科',
    desc: '按关键词检索 NGA 安科主题帖，快速找到想读的作品。',
    icon: 'search',
    tint: 'var(--an-mint-soft)',
  },
];

/** 「发现」模块：把收集安科 / 收集安价 / 搜索安科整合为统一入口 */
export function DiscoveryHubPage({
  onBack,
  onOpenAnjiaCollect,
  onOpenAnkeCollect,
  onOpenFindAnke,
}: DiscoveryHubPageProps) {
  const handlers = {
    anjia: onOpenAnjiaCollect,
    anke: onOpenAnkeCollect,
    find: onOpenFindAnke,
  };

  const stories = useStoryStore((s) => s.stories);
  const totalCount = stories.length;
  const weekCount = stories.filter((s) => {
    const time = s.updated_at ?? s.created_at;
    if (!time) return false;
    return Date.now() - new Date(time).getTime() <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="an-page text-[var(--text-primary)] h-full w-full flex flex-col">
      <div
        className="flex items-center justify-between gap-3 px-6 py-4"
        style={{ background: 'var(--an-paper-2)', borderBottom: '3px solid var(--an-ink)' }}
      >
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="an-pill">
            <Icon name="back" size={15} /> 返回
          </button>
          <h1
            className="text-[var(--an-ink)] flex items-center gap-2"
            style={{ fontFamily: 'var(--an-font-display)', fontSize: 22 }}
          >
            <Icon name="search" size={20} /> 发现安科
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="an-shell" style={{ padding: '32px 24px' }}>
          <div className="an-bubble mb-5">收集、搜索与整理安科内容，统一从这里开始。</div>

          <div className="flex flex-wrap gap-3 mb-7">
            <div className="an-stat">
              本周更新 <b>{weekCount}</b> 部作品
            </div>
            <div className="an-stat">
              作品总数 <b>{totalCount}</b>
            </div>
            <div className="an-stat">支持站点 NGA / 骨碌碌</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {CARDS.map((card) => (
              <button
                key={card.key}
                onClick={handlers[card.key]}
                className="an-card an-card--tape an-card--hover relative text-left p-6"
                style={{ background: card.tint }}
              >
                <span className="an-badge" style={{ position: 'absolute', top: 10, right: 12 }}>
                  {card.key === 'find' ? '搜索' : '抓取'}
                </span>
                <span
                  className="inline-flex items-center justify-center w-12 h-12 rounded-full"
                  style={{ background: 'var(--an-card)', border: 'var(--an-line)' }}
                >
                  <Icon name={card.icon} size={24} />
                </span>
                <h2
                  className="text-[var(--an-ink)] mt-4"
                  style={{ fontFamily: 'var(--an-font-display)', fontSize: 22 }}
                >
                  {card.title}
                </h2>
                <p className="text-[var(--an-ink-soft)] text-[13px] leading-relaxed mt-2 min-h-[42px]">
                  {card.desc}
                </p>
                <span className="an-pill mt-5">打开 →</span>
              </button>
            ))}
          </div>

          <div className="an-toolbar mt-8 justify-between">
            <span className="an-chip">提示</span>
            <span className="text-[var(--an-ink-soft)] text-[13px] flex-1">
              「更新」功能已接入编辑器：借助已关联的 NGA 帖子，一键把新楼层追加到作品末尾。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
