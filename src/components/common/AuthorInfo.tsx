import { Icon } from './Icon';

interface AuthorInfoProps {
  onClose: () => void;
}

export function AuthorInfo({ onClose }: AuthorInfoProps) {
  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-6"
      style={{
        background: 'rgba(64, 50, 92, 0.42)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        className="an-card w-[500px] max-w-full flex flex-col overflow-hidden"
        style={{ borderRadius: 'var(--an-radius-lg)', boxShadow: 'var(--an-shadow-pop-lg), var(--an-shadow-soft)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ background: 'var(--an-pink-soft)', borderBottom: 'var(--an-line)' }}
        >
          <div
            className="text-[15px] font-bold flex items-center gap-2"
            style={{ fontFamily: 'var(--an-font-display)', color: 'var(--an-ink)' }}
          >
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full"
              style={{ background: 'var(--an-pink)', border: '2px solid var(--an-ink)' }}
            >
              <Icon name="sparkles" size={12} />
            </span>
            关于作者
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="an-btn an-btn--sm w-8 h-8 !p-0 flex items-center justify-center"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6">
          <div className="flex flex-col items-center gap-4">
            {/* 头像 */}
            <div
              className="w-24 h-24 rounded-full overflow-hidden -rotate-3"
              style={{
                border: '3px solid var(--an-ink)',
                boxShadow: '0 5px 0 var(--an-ink)',
                background: 'var(--an-lilac-soft)',
              }}
            >
              <img src="./avatar.png" alt="星星的辰" className="w-full h-full object-cover" />
            </div>

            {/* 作者信息 */}
            <div className="text-center space-y-3 w-full">
              <div>
                <div
                  className="text-xl font-bold"
                  style={{ fontFamily: 'var(--an-font-display)', color: 'var(--an-ink)' }}
                >
                  星星的辰
                </div>
                <span
                  className="an-badge mt-1 inline-block text-[12px]"
                  style={{ background: 'var(--an-mint)', color: '#123a2e' }}
                >
                  AnkeCreator 开发者
                </span>
              </div>

              <div
                className="text-sm leading-relaxed px-4 py-3 text-left"
                style={{
                  background: 'var(--an-lemon-soft)',
                  border: '3px solid var(--an-ink)',
                  borderRadius: 'var(--an-radius-sm)',
                  boxShadow: '0 3px 0 var(--an-ink)',
                  color: 'var(--an-ink)',
                }}
              >
                感谢使用安科作者助手！本工具旨在帮助创作者更高效地编写和导出安科内容。
                <br />
                想要很多小红点desuwa！！！！！
                <br />
                <a
                  href="https://ngabbs.com/read.php?tid=47008305"
                  target="_blank"
                  rel="noreferrer"
                  className="underline break-all"
                  style={{ color: '#2b6cff' }}
                >
                  https://ngabbs.com/read.php?tid=47008305
                </a>
              </div>

              {/* 联系方式 */}
              <div className="pt-1 grid grid-cols-1 gap-2 text-[13px]">
                <div
                  className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--an-sky-soft)', border: '2px solid var(--an-ink)' }}
                >
                  <span className="text-[var(--an-ink-soft)]">邮箱</span>
                  <span className="font-semibold">秘密desuwa@example.com</span>
                </div>
                <div
                  className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--an-lilac-soft)', border: '2px solid var(--an-ink)' }}
                >
                  <span className="text-[var(--an-ink-soft)]">GitHub</span>
                  <span className="font-semibold">github.com/秘密desuwa</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div
          className="px-4 py-3 flex items-center justify-end"
          style={{ background: 'var(--an-paper-2)', borderTop: 'var(--an-line)' }}
        >
          <button type="button" onClick={onClose} className="an-btn an-btn--mint an-btn--sm">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
