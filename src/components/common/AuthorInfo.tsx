import { Icon } from './Icon';

interface AuthorInfoProps {
  onClose: () => void;
}

export function AuthorInfo({ onClose }: AuthorInfoProps) {
  return (
    <div
      className="bg-[var(--bg-overlay)] fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-base)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-[480px] max-w-full rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className="border-b border-b-[color:var(--border-color)] px-4 py-3 flex items-center justify-between"
        >
          <div className="text-sm font-semibold">关于作者</div>
          <button aria-label="关闭"
            onClick={onClose}
            className="text-[var(--text-secondary)] text-lg leading-none w-6 h-6 flex items-center justify-center rounded transition"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6">
          <div className="flex flex-col items-center gap-4">
            {/* 头像 */}
            <div
              className="bg-[var(--bg-sidebar)] border-[2px] border-[color:var(--border-color)] w-20 h-20 rounded-full overflow-hidden"
            >
              <img
                src="./avatar.png"
                alt="星星的辰"
                className="w-full h-full object-cover"
              />
            </div>

            {/* 作者信息 */}
            <div className="text-center space-y-2 w-full">
              <div>
                <div className="text-base font-semibold">星星的辰</div>
                <div
                  className="text-[var(--text-secondary)] text-xs mt-1"
                >
                  AnkeCreator 开发者
                </div>
              </div>

              <div
                className="bg-[var(--bg-sidebar)] border border-[color:var(--border-color)] text-[var(--text-primary)] text-sm leading-relaxed px-4 py-3 rounded"
              >
                感谢使用安科作者助手！本工具旨在帮助创作者更高效地编写和导出安科内容。
                想要很多小红点desuwa！！！！！
                https://ngabbs.com/read.php?tid=47008305
              </div>

              {/* 联系方式 */}
              <div className="pt-2 space-y-1.5 text-xs">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[var(--text-secondary)]">邮箱：</span>
                  <span>秘密desuwa@example.com</span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[var(--text-secondary)]">GitHub：</span>
                  <span>github.com/秘密desuwa</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div
          className="border-t border-t-[color:var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-3 flex items-center justify-end"
        >
          <button
            onClick={onClose}
            className="bg-[var(--accent)] text-[var(--text-on-accent)] text-xs px-4 py-1.5 rounded transition"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
