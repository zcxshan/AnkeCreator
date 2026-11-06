import { Icon, type IconName } from '../common/Icon';

interface PlaygroundHubPageProps {
  onBack: () => void;
  onOpenDice: () => void;
  onOpenWheel: () => void;
}

const CARDS: Array<{
  key: 'dice' | 'wheel';
  title: string;
  desc: string;
  icon: IconName;
  tint: string;
}> = [
  {
    key: 'dice',
    title: '玩骰子',
    desc: '快速掷骰、批量骰点与历史记录，支持音效反馈。',
    icon: 'dices',
    tint: 'var(--an-lilac-soft)',
  },
  {
    key: 'wheel',
    title: '玩转盘',
    desc: '随机转盘抽选选项，适合决定剧情走向或抽取角色。',
    icon: 'wheel',
    tint: 'var(--an-lemon-soft)',
  },
];

/** 「娱乐」模块：把玩骰子 / 玩转盘整合为统一入口 */
export function PlaygroundHubPage({ onBack, onOpenDice, onOpenWheel }: PlaygroundHubPageProps) {
  const handlers = { dice: onOpenDice, wheel: onOpenWheel };

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
            <Icon name="dices" size={20} /> 娱乐
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="an-shell" style={{ padding: '32px 24px' }}>
          <div className="an-bubble mb-7">骰子与转盘，随手决定故事的下一步。</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
            {CARDS.map((card) => (
              <button
                key={card.key}
                onClick={handlers[card.key]}
                className="an-card an-card--hover text-left p-7 aspect-square flex flex-col justify-between"
                style={{ background: card.tint }}
              >
                <span
                  className="inline-flex items-center justify-center w-16 h-16 rounded-full"
                  style={{ background: 'var(--an-card)', border: 'var(--an-line)' }}
                >
                  <Icon name={card.icon} size={34} />
                </span>
                <div>
                  <h2
                    className="text-[var(--an-ink)]"
                    style={{ fontFamily: 'var(--an-font-display)', fontSize: 28 }}
                  >
                    {card.title}
                  </h2>
                  <p className="text-[var(--an-ink-soft)] text-[13px] leading-relaxed mt-2">
                    {card.desc}
                  </p>
                </div>
                <span className="an-btn an-btn--sm an-btn--ghost self-start">进入 →</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
