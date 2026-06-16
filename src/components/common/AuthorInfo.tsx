interface AuthorInfoProps {
  onClose: () => void;
}

export function AuthorInfo({ onClose }: AuthorInfoProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-full rounded-lg shadow-2xl flex flex-col"
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div className="text-sm font-semibold">关于作者</div>
          <button
            onClick={onClose}
            className="text-lg leading-none w-6 h-6 flex items-center justify-center rounded transition"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6">
          <div className="flex flex-col items-center gap-4">
            {/* 头像 */}
            <div
              className="w-20 h-20 rounded-full overflow-hidden"
              style={{
                background: 'var(--bg-sidebar)',
                border: '2px solid var(--border-color)',
              }}
            >
              <img
                src="./avatar.png"
                alt="点点星辰"
                className="w-full h-full object-cover"
              />
            </div>

            {/* 作者信息 */}
            <div className="text-center space-y-2 w-full">
              <div>
                <div className="text-base font-semibold">点点星辰</div>
                <div
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  AnkeCreator 开发者
                </div>
              </div>

              <div
                className="text-sm leading-relaxed px-4 py-3 rounded"
                style={{
                  background: 'var(--bg-sidebar)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              >
                感谢使用安科作者助手！本工具旨在帮助创作者更高效地编写和导出安科内容。
              </div>

              {/* 联系方式 */}
              <div className="pt-2 space-y-1.5 text-xs">
                <div className="flex items-center justify-center gap-2">
                  <span style={{ color: 'var(--text-secondary)' }}>邮箱：</span>
                  <span>秘密desuwa@example.com</span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span style={{ color: 'var(--text-secondary)' }}>GitHub：</span>
                  <span>github.com/秘密desuwa</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div
          className="px-4 py-3 flex items-center justify-end"
          style={{
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-sidebar)',
          }}
        >
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded transition"
            style={{
              background: 'var(--accent)',
              color: 'var(--text-on-accent)',
            }}
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
