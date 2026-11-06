import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Icon } from '../common/Icon';
import type { Chapter, SectionMeta, Volume } from '../../types';
import type { StoryNgaLink } from '../../types/nga';
import { validateBBCode, type BBCodeError } from '../../utils/bbcodeValidator';
import { countLocalImagePlaceholders } from '../../utils/ngaHtmlToBBCode';

export interface NgaSendDialogProps {
  open: boolean;
  onClose: () => void;
  volumes: Volume[];
  chapters: Chapter[];
  sections: SectionMeta[];
  defaultSectionId: string | null;
  ngaLink: StoryNgaLink | null;
  sending: boolean;
  isElectron: boolean;
  /** 打开「关联 NGA 帖子」弹窗 */
  onOpenLink: () => void;
  /** 读取指定节的 BBCode（优先用编辑器内存中的最新内容） */
  resolveBbcode: (sectionId: string) => Promise<string>;
  /** 真正的发送；返回是否成功（成功才关闭弹窗） */
  onSend: (sectionId: string, bbcode: string) => Promise<boolean>;
}

function buildSectionGroups(
  volumes: Volume[],
  chapters: Chapter[],
  sections: SectionMeta[],
  keyword: string,
): Array<{ key: string; label: string; items: SectionMeta[] }> {
  const kw = keyword.trim().toLowerCase();
  const matches = (s: SectionMeta) => !kw || s.title.toLowerCase().includes(kw);

  const sortedVolumes = [...volumes].sort((a, b) => a.order_index - b.order_index);
  const sortedChapters = [...chapters].sort((a, b) => a.order_index - b.order_index);
  const sortedSections = [...sections].sort((a, b) => a.order_index - b.order_index);

  const groups: Array<{ key: string; label: string; items: SectionMeta[] }> = [];

  for (const volume of sortedVolumes) {
    const volumeChapters = sortedChapters.filter((c) => c.volume_id === volume.id);
    for (const chapter of volumeChapters) {
      const items = sortedSections.filter((s) => s.chapter_id === chapter.id).filter(matches);
      if (items.length > 0) {
        groups.push({ key: chapter.id, label: `${volume.title} / ${chapter.title}`, items });
      }
    }
  }

  const orphanChapters = sortedChapters.filter((c) => !c.volume_id);
  for (const chapter of orphanChapters) {
    const items = sortedSections.filter((s) => s.chapter_id === chapter.id).filter(matches);
    if (items.length > 0) {
      groups.push({ key: chapter.id, label: chapter.title, items });
    }
  }

  // 兜底：未归属任何章/卷的节
  const chapterIds = new Set(sortedChapters.map((c) => c.id));
  const loose = sortedSections.filter((s) => !chapterIds.has(s.chapter_id)).filter(matches);
  if (loose.length > 0) groups.push({ key: 'loose', label: '未归类', items: loose });

  return groups;
}

export function NgaSendDialog(props: NgaSendDialogProps) {
  const {
    open,
    onClose,
    volumes,
    chapters,
    sections,
    defaultSectionId,
    ngaLink,
    sending,
    isElectron,
    onOpenLink,
    resolveBbcode,
    onSend,
  } = props;

  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(defaultSectionId);
  const [bbcode, setBbcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const groups = useMemo(
    () => buildSectionGroups(volumes, chapters, sections, keyword),
    [volumes, chapters, sections, keyword],
  );

  const selectedSection = sections.find((s) => s.id === selectedId) ?? null;
  const validation = useMemo(() => {
    const result: { errors: BBCodeError[]; warnings: string[] } = { errors: [], warnings: [] };
    if (!bbcode.trim()) return { ...result, valid: false };
    const v = validateBBCode(bbcode);
    return { valid: v.valid, errors: v.errors, warnings: v.warnings };
  }, [bbcode]);
  const localImages = useMemo(() => (bbcode ? countLocalImagePlaceholders(bbcode) : 0), [bbcode]);

  // 打开时重置搜索与默认选中
  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setSelectedId(defaultSectionId);
    setLoading(false);
    setLoadError(null);
    setConfirmOpen(false);
  }, [open, defaultSectionId]);

  // 选中节后加载 BBCode 预览
  useEffect(() => {
    if (!open || !selectedId) {
      setBbcode('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    resolveBbcode(selectedId)
      .then((text) => {
        if (!cancelled) setBbcode(text ?? '');
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message || '读取 BBCode 失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedId, resolveBbcode]);

  const canSend =
    !!ngaLink?.thread &&
    !!selectedSection &&
    !!bbcode.trim() &&
    !loading &&
    !sending &&
    validation.valid;

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          if (sending) return;
          onClose();
        }}
        contentClassName="flex flex-col overflow-hidden w-[min(880px,94vw)] h-[min(80vh,700px)] max-md:w-screen max-md:h-screen max-md:rounded-none"
      >
        <header
          className="shrink-0 flex items-center justify-between px-4 py-2.5"
          style={{ background: 'var(--an-paper-2)', borderBottom: '2px solid var(--an-ink)' }}
        >
          <div className="min-w-0">
            <div
              className="text-[var(--an-ink)] font-bold flex items-center gap-1.5"
              style={{ fontFamily: 'var(--an-font-display)', fontSize: 16 }}
            >
              <Icon name="upload" size={15} /> 发送至 NGA
            </div>
            <div className="text-[var(--an-ink-soft)] text-[12px] truncate mt-0.5">
              {ngaLink?.thread ? `目标帖子：${ngaLink.thread.url}` : '尚未关联 NGA 帖子'}
            </div>
          </div>
          <button
            aria-label="关闭"
            onClick={onClose}
            disabled={sending}
            className="w-8 h-8 flex items-center justify-center rounded-[10px] text-[var(--an-ink-soft)] hover:bg-[var(--an-pink-soft)] hover:text-[var(--an-ink)] disabled:opacity-40"
          >
            ✕
          </button>
        </header>

        {!ngaLink?.thread ? (
          <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-3 px-6 py-10">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-full"
              style={{ background: 'var(--an-lilac-soft)', border: '3px solid var(--an-ink)', color: 'var(--an-ink)' }}
            >
              <Icon name="link" size={28} />
            </div>
            <div className="text-[var(--an-ink)] text-sm font-bold">还没有关联 NGA 帖子</div>
            <div className="text-[var(--an-ink-soft)] text-xs">先关联一个主题帖，才能发送节内容</div>
            <button onClick={onOpenLink} className="an-btn an-btn--pink">
              去关联
            </button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex max-md:flex-col">
            {/* 左：选择节 */}
            <div
              className="w-[300px] max-md:w-full max-md:h-[46%] shrink-0 border-r-2 max-md:border-r-0 max-md:border-b-2 flex flex-col min-h-0"
              style={{ borderColor: 'var(--an-ink-faint)' }}
            >
              <div className="p-2 shrink-0">
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索节标题…"
                  className="w-full text-[var(--an-ink)] text-xs px-2.5 py-2 outline-none"
                  style={{ background: 'var(--an-card)', border: '2px solid var(--an-ink)', borderRadius: '999px' }}
                />
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                {groups.length === 0 ? (
                  <div className="text-[var(--text-secondary)] text-xs text-center py-6">
                    没有匹配的节
                  </div>
                ) : (
                  groups.map((group) => (
                    <div key={group.key} className="mb-1.5">
                      <div className="text-[var(--an-ink-faint)] text-[12px] px-1.5 py-1 truncate font-semibold">
                        {group.label}
                      </div>
                      {group.items.map((s) => {
                        const active = s.id === selectedId;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setSelectedId(s.id)}
                            className="w-full text-left px-2 py-1.5 rounded-[8px] text-xs truncate transition-colors"
                            style={{
                              color: 'var(--an-ink)',
                              background: active ? 'var(--an-pink-soft)' : 'transparent',
                              fontWeight: active ? 700 : 500,
                            }}
                            title={s.title}
                          >
                            {s.title}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 右：BBCode 预览 */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div
                className="shrink-0 flex items-center justify-between px-3 py-1.5"
                style={{ borderBottom: '2px solid var(--an-ink-faint)' }}
              >
                <div className="text-[var(--an-ink-soft)] text-[12px] truncate">
                  {selectedSection ? `预览：${selectedSection.title}` : '请选择一个节'}
                </div>
                <div className="text-[var(--an-ink-faint)] text-[12px] shrink-0">
                  {bbcode.length} 字
                </div>
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] text-xs">
                  正在读取 BBCode…
                </div>
              ) : loadError ? (
                <div className="flex-1 flex items-center justify-center text-[var(--danger)] text-xs px-4 text-center">
                  读取失败：{loadError}
                </div>
              ) : !selectedSection ? (
                <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] text-xs">
                  从左侧选择一个要发送的节
                </div>
              ) : (
                <>
                  <pre
                    className="flex-1 min-h-0 overflow-auto whitespace-pre-wrap break-words text-[var(--an-ink)] text-xs p-3 m-0 font-mono"
                    style={{ background: 'var(--an-paper-2)' }}
                  >
                    {bbcode || '（该节没有内容）'}
                  </pre>
                  {(localImages > 0 || validation.errors.length > 0 || validation.warnings.length > 0) && (
                    <div className="shrink-0 px-3 py-2 border-t border-[color:var(--border-color)] space-y-1">
                      {localImages > 0 && (
                        <div className="text-[var(--tone-warning,#b8860b)] text-[12px]">
                          本节含 {localImages} 张本地图片，NGA 端无法显示
                        </div>
                      )}
                      {validation.errors.slice(0, 3).map((err, idx) => (
                        <div key={idx} className="text-[var(--danger)] text-[12px]">
                          第 {err.line} 行：{err.message}
                        </div>
                      ))}
                      {validation.warnings.slice(0, 3).map((w, idx) => (
                        <div key={`w-${idx}`} className="text-[var(--text-secondary)] text-[12px]">
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <footer
          className="shrink-0 flex items-center justify-between px-4 py-2.5"
          style={{ background: 'var(--an-paper-2)', borderTop: '2px solid var(--an-ink)' }}
        >
          <div className="text-[var(--an-ink-soft)] text-[12px]">
            {!isElectron
              ? '发送至 NGA 仅在桌面版可用'
              : validation.errors.length > 0
                ? 'BBCode 校验未通过，修正后才能发送'
                : '确认后将进行二次确认'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={sending}
              className="an-btn an-btn--sm an-btn--ghost"
            >
              取消
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!canSend}
              className="an-btn an-btn--sm an-btn--pink"
            >
              {sending ? '发送中…' : '确认发送'}
            </button>
          </div>
        </footer>
      </Modal>

      <ConfirmDialog
        open={confirmOpen && !!selectedSection}
        zIndex={9600}
        title="确认发送至 NGA"
        confirmText="确认发送"
        danger
        message={`将把「${selectedSection?.title ?? ''}」发送到帖子\n${
          ngaLink?.thread?.url ?? ''
        }\n\n共 ${bbcode.length} 字${localImages > 0 ? `，含 ${localImages} 张本地图片` : ''}。发送后不可撤回。`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          if (!selectedSection || !bbcode) return;
          void onSend(selectedSection.id, bbcode).then((ok) => {
            if (ok) onClose();
          });
        }}
      />
    </>
  );
}
