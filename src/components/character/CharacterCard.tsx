import type { Character } from '../../types';

export function CharacterCard({
  character,
  onClick,
  onEdit,
  onDelete,
  isActive,
}: {
  character: Character;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isActive?: boolean;
}) {
  const personalityPreview = (character.personality || '').replace(/\s+/g, ' ').trim();
  const shortPersonality =
    personalityPreview.length > 40
      ? personalityPreview.slice(0, 40) + '...'
      : personalityPreview || '（暂无性格描述）';

  const topAttrs = Object.entries(character.attributes || {}).slice(0, 3);

  return (
    <div
      onClick={onClick}
      className="group relative rounded-lg border p-3 cursor-pointer transition flex flex-col"
      style={{
        background: isActive ? 'var(--accent-bg)' : 'var(--bg-card)',
        borderColor: isActive ? 'var(--accent)' : 'var(--border-color)',
        color: isActive ? 'var(--accent)' : 'var(--text-primary)',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.borderColor = 'var(--border-color)';
      }}
    >
      {/* 头像 */}
      <div
        className="w-24 h-24 mx-auto mb-2 rounded-full overflow-hidden flex items-center justify-center text-4xl select-none"
        style={{
          background: isActive ? 'var(--accent-bg)' : 'var(--bg-toolbar)',
          border: '1px solid var(--border-color)',
        }}
      >
        {character.avatar ? (
          <img
            src={character.avatar}
            alt={character.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
            <span style={{ color: isActive ? 'var(--text-on-accent)' : 'var(--text-secondary)' }}>
              {character.name?.slice(0, 1) || '👤'}
            </span>
          )}
      </div>

      {/* 姓名 */}
      <div className="text-center text-sm font-semibold truncate" title={character.name}>
        {character.name}
      </div>

      {/* 性格描述预览 */}
      <div
        className="text-xs mt-1 text-center line-clamp-2"
        style={{ color: isActive ? 'var(--text-on-accent)' : 'var(--text-secondary)' }}
      >
        {shortPersonality}
      </div>

      {/* 属性速览 */}
      {topAttrs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 justify-center">
          {topAttrs.map(([k, v]) => (
            <span
              key={k}
              className="text-[10px] px-1.5 py-0.5 rounded border"
              style={{
                background: isActive ? 'var(--accent-bg)' : 'var(--bg-toolbar)',
                borderColor: 'var(--border-color)',
                color: isActive ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              }}
            >
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}

      {/* 悬停时显示的操作按钮 */}
      {(onEdit || onDelete) && (
        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: isActive ? 'var(--accent-bg)' : 'var(--bg-toolbar)',
                color: isActive ? 'var(--text-on-accent)' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
              title="编辑"
            >
              ✎
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: isActive ? 'var(--accent-bg)' : 'var(--danger-soft)',
                color: isActive ? 'var(--text-on-accent)' : 'var(--danger)',
                border: '1px solid var(--border-color)',
              }}
              title="删除"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
