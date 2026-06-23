// ============================================================
// 寻找安科页面（占位）
// ------------------------------------------------------------
// 后续功能：
//   - 搜索 NGA 安科区帖子
//   - 关键字过滤
//   - 直接打开帖子链接
//   - 收藏感兴趣的帖子
// ============================================================

interface FindAnkePageProps {
  onBack: () => void;
}

export function FindAnkePage({ onBack }: FindAnkePageProps) {
  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {/* 顶栏 */}
      <div
        className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-card)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }}
        >
          ← 返回
        </button>
        <div
          className="flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <span style={{ fontSize: '20px' }}>🔍</span>
          <h1 className="text-lg font-semibold m-0">寻找安科</h1>
        </div>
      </div>

      {/* 主体占位 */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div
          className="max-w-md text-center p-8 rounded-2xl"
          style={{
            background: 'var(--bg-card)',
            border: '1px dashed var(--border-color)',
          }}
        >
          <div className="text-5xl mb-4">🚧</div>
          <h2
            className="text-xl font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            功能开发中
          </h2>
          <p
            className="text-sm leading-relaxed m-0"
            style={{ color: 'var(--text-secondary)' }}
          >
            寻找安科模块正在规划中。
            <br />
            后续将支持：NGA 安科区帖子浏览、关键字搜索、收藏感兴趣的帖子。
          </p>
        </div>
      </div>
    </div>
  );
}
