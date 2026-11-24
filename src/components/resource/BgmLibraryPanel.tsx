import { useState } from 'react';
import { useToastStore } from '../../store/toastStore';
import { useBgmLibraryStore, type BgmItem } from '../../store/bgmLibraryStore';
import { Icon } from '../common/Icon';

export interface BgmLibraryPanelProps {
  /** 窄栏模式：编辑器右侧资源库用 */
  compact?: boolean;
  /** 点击条目的回调（编辑器插入 BGM） */
  onPick?: (item: BgmItem) => void;
}

export function BgmLibraryPanel({ compact = false, onPick }: BgmLibraryPanelProps) {
  const items = useBgmLibraryStore((s) => s.items);
  const addByUrl = useBgmLibraryStore((s) => s.addByUrl);
  const remove = useBgmLibraryStore((s) => s.remove);
  const showToast = useToastStore((s) => s.showToast);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const handleAdd = () => {
    const result = addByUrl(name, url);
    if (!result.ok) {
      showToast(result.error ?? '添加失败', 'error');
      return;
    }
    setName('');
    setUrl('');
    showToast('已添加到 BGM 资源库', 'success');
  };

  const handleRemove = (item: BgmItem) => {
    remove(item.id);
    showToast('已删除 BGM', 'success');
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      <div
        className="space-y-2 p-2"
        style={{
          background: 'var(--an-card)',
          border: '2px solid var(--an-ink)',
          borderRadius: 'var(--an-radius-sm)',
          boxShadow: 'var(--an-shadow-pop)',
        }}
      >
        {!compact && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名称（可留空，自动取文件名）"
            className="w-full px-2 py-1.5 text-sm text-[var(--an-ink)]"
            style={{ background: 'var(--an-paper)', border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
          />
        )}
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="./mon_202403/17/xxx.mp3 或 https://..."
          className="w-full px-2 py-1.5 text-xs font-mono text-[var(--an-ink)]"
          style={{ background: 'var(--an-paper)', border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--an-ink-faint)]">
            仅支持通过 URL 添加，相对地址自动补全 NGA 头部
          </span>
          <button className="an-btn an-btn--sm an-btn--pink" onClick={handleAdd} disabled={!url.trim()}>
            添加
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center text-xs text-[var(--an-ink-faint)] py-6">
          还没有 BGM，先添加一个 URL 吧
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-2"
              style={{
                background: 'var(--an-card)',
                border: '2px solid var(--an-ink)',
                borderRadius: 'var(--an-radius-sm)',
              }}
            >
              <div className="flex items-center gap-2">
                <button
                  className="shrink-0 flex items-center justify-center"
                  title={onPick ? '插入到正文' : '试听'}
                  onClick={() => onPick?.(item)}
                  style={{
                    width: 26,
                    height: 26,
                    background: 'var(--an-pink-soft)',
                    border: '2px solid var(--an-ink)',
                    borderRadius: 8,
                    cursor: onPick ? 'pointer' : 'default',
                  }}
                >
                  <Icon name={onPick ? 'plus' : 'play'} size={13} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[var(--an-ink)] truncate">{item.name}</div>
                  <div className="text-[10px] text-[var(--an-ink-faint)] truncate font-mono">{item.url}</div>
                </div>
                <button
                  className="shrink-0 an-btn an-btn--sm an-btn--ghost"
                  onClick={() => handleRemove(item)}
                  title="删除"
                  aria-label="删除 BGM"
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
              {!compact && (
                <audio controls preload="none" src={item.url} className="w-full mt-2 h-8" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
