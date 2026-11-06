import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { Icon } from '../common/Icon';
import { EMPTY_NGA_LINK, parseNgaThreadUrl, type StoryNgaLink } from '../../types/nga';

/** 作品 ↔ NGA 帖子关联弹窗：粘贴主题帖链接即可绑定 */
export function NgaLinkDialog({
  open,
  onClose,
  storyId,
  link,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  storyId: string | null;
  link: StoryNgaLink | null;
  onChange: (next: StoryNgaLink) => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(link?.thread?.url ?? '');
    setError('');
  }, [open, link?.thread?.url]);

  const save = async () => {
    if (!storyId) {
      setError('请先打开一个作品');
      return;
    }
    if (!window.electronAPI?.ngaSaveStoryLink) {
      setError('关联 NGA 帖子仅在桌面版可用');
      return;
    }
    const parsed = parseNgaThreadUrl(url);
    if (!parsed) {
      setError('请输入有效的 NGA 帖子链接（需包含 tid，例如 read.php?tid=123456）');
      return;
    }
    setSaving(true);
    const next: StoryNgaLink = {
      ...(link ?? EMPTY_NGA_LINK),
      thread: { ...parsed, linkedAt: new Date().toISOString() },
    };
    const res = await window.electronAPI.ngaSaveStoryLink(storyId, next);
    setSaving(false);
    if (!res?.ok) {
      setError(res?.error || '保存失败');
      return;
    }
    onChange(next);
    onClose();
  };

  const unlink = async () => {
    if (!storyId) return;
    if (!window.electronAPI?.ngaSaveStoryLink) {
      setError('关联 NGA 帖子仅在桌面版可用');
      return;
    }
    const next: StoryNgaLink = { ...(link ?? EMPTY_NGA_LINK), thread: null };
    const res = await window.electronAPI.ngaSaveStoryLink(storyId, next);
    if (!res?.ok) {
      setError(res?.error || '取消关联失败');
      return;
    }
    onChange(next);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      contentClassName="w-[min(520px,92vw)] p-5"
      labelledBy="nga-link-dialog-title"
    >
      <h3
        id="nga-link-dialog-title"
        className="text-[var(--an-ink)] text-base font-bold flex items-center gap-1.5"
        style={{ fontFamily: 'var(--an-font-display)' }}
      >
        <Icon name="link" size={15} />
        关联 NGA 帖子
      </h3>
      <p className="text-[12px] text-[var(--an-ink-soft)] mt-1.5 leading-relaxed">
        关联后，每一节都可以将正文以 NGA BBCode 直接发送到该主题帖。
      </p>
      <input
        autoFocus
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
        placeholder="https://bbs.nga.cn/read.php?tid=123456"
        className="mt-4 w-full px-3 py-2 text-xs outline-none focus:border-[var(--an-pink)]"
        style={{ borderRadius: 'var(--an-radius-sm)', background: 'var(--an-paper-2)', border: '2px solid var(--an-ink)', color: 'var(--an-ink)' }}
      />
      {error && <div className="mt-2 text-[12px] text-[var(--an-pink)] font-semibold">{error}</div>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          onClick={() => void unlink()}
          disabled={!link?.thread}
          className="an-btn an-btn--sm an-btn--ghost"
        >
          取消关联
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="an-btn an-btn--sm an-btn--ghost">
            取消
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="an-btn an-btn--sm an-btn--pink"
          >
            {saving ? '保存中…' : '保存关联'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
