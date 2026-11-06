import { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useMetaStore } from '../../store/metaStore';
import { useSettingStore } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';
import { Icon, type IconName } from '../common/Icon';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { InputDialog } from '../common/InputDialog';
import { UploadProgressDialog } from '../common/UploadProgressDialog';
import {
  uploadImagesWithProgress,
  ensureLocalWarning,
  type UploadProgressEvent,
} from '../../utils/uploadImage';
import { NGA_DEFAULT_IMAGE_SIZE } from '../../types';
import type { RichTextEditorCommands } from '../../editor/tiptap/TiptapEditorPane';
import { RelationshipPanel } from './RelationshipPanel';
import { ImportCharacterTemplateButton } from '../character/CharacterEditor';

// ========== 紧凑型人物角色面板 ==========

export function CompactCharacterPanel({
  richTextEditorCommandsRef,
  onShowToast,
}: {
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const [panelTab, setPanelTab] = useState<'by-character' | 'by-variant' | 'relation'>('by-character');
  // 按名称搜索人物 / 差分（大小写不敏感）
  const [keyword, setKeyword] = useState('');

  return (
    <div className="flex flex-col h-full bg-[var(--bg-card)]">
      {/* === 主导航 Tab：按人物 / 按差分 / 关系 === */}
      <div
        className="shrink-0 flex border-b border-[var(--border-color)] bg-[var(--bg-toolbar)]"
      >
        {[
          { key: 'by-character', label: '按人物', icon: 'user' as IconName },
          { key: 'by-variant', label: '按差分', icon: 'layoutGrid' as IconName },
          { key: 'relation', label: '关系', icon: 'link' as IconName },
        ].map((t) => {
          const active = panelTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setPanelTab(t.key as 'by-character' | 'by-variant' | 'relation')}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'text-[var(--accent)] bg-[var(--bg-card)] border-b-2 border-b-[color:var(--accent)]'
                  : 'text-[var(--text-secondary)] bg-transparent border-b-2 border-b-transparent'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <Icon name={t.icon} size={16} />
                <span>{t.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 搜索：人物名 / 笔记 / 差分名 */}
      {panelTab !== 'relation' && (
        <div className="shrink-0 px-2 py-1.5 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)]">
            <Icon name="search" size={13} />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索人物 / 差分名"
              className="flex-1 min-w-0 bg-transparent text-[var(--text-primary)] text-[12px] outline-none"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="text-[var(--text-secondary)] text-[12px] shrink-0"
                aria-label="清空搜索"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {panelTab === 'by-character' && (
        <ByCharacterContent
          richTextEditorCommandsRef={richTextEditorCommandsRef}
          onShowToast={onShowToast}
          keyword={keyword}
        />
      )}

      {panelTab === 'by-variant' && (
        <ByVariantContent
          richTextEditorCommandsRef={richTextEditorCommandsRef}
          onShowToast={onShowToast}
          keyword={keyword}
        />
      )}

      {panelTab === 'relation' && activeStoryId && (
        <RelationshipPanel storyId={activeStoryId} />
      )}
    </div>
  );
}

/**
 * 「按人物」面板：原角色卡片列表 + 编辑区
 */
function ByCharacterContent({
  richTextEditorCommandsRef,
  onShowToast,
  keyword,
}: {
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
  keyword: string;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const characters = useMetaStore((s) => s.characters);
  const editingCharacterId = useMetaStore((s) => s.editingCharacterId);
  const createCharacter = useMetaStore((s) => s.createCharacter);
  const setEditingCharacter = useMetaStore((s) => s.setEditingCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);

  const editing = characters.find((c) => c.id === editingCharacterId) ?? null;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<{ ids: string[]; names: string[] } | null>(null);

  // useMemo: 缓存过滤+排序结果，避免每次 render 都重算（人物多时卡顿）
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return activeStoryId
      ? characters
          .filter((c) => c.story_id === activeStoryId)
          .filter(
            (c) =>
              !kw ||
              (c.name || '').toLowerCase().includes(kw) ||
              (c.notes || '').toLowerCase().includes(kw) ||
              (c.variants || []).some((v) => (v.name || '').toLowerCase().includes(kw)),
          )
          .slice()
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      : [];
  }, [activeStoryId, characters, keyword]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const clearSelection = () => setSelectedIds([]);
  const handleBatchDelete = async () => {
    if (!pendingBatchDelete) return;
    const target = pendingBatchDelete;
    setPendingBatchDelete(null);
    let deleted = 0;
    for (const id of target.ids) {
      await deleteCharacter(id);
      deleted++;
    }
    useToastStore.getState().showToast(`已批量删除 ${deleted} 个角色`, 'success');
    clearSelection();
  };

  const handleInsertVariant = (variantName: string, url: string) => {
    if (!richTextEditorCommandsRef.current) {
      onShowToast?.('没有可用的编辑器');
      return;
    }
    richTextEditorCommandsRef.current.insertImage(url, NGA_DEFAULT_IMAGE_SIZE);
    onShowToast?.(`已插入差分：${variantName}`);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-card)]">
      {/* 顶部工具条 */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-[var(--bg-toolbar)] border-[var(--border-color)]"
      >
        <div className="text-xs font-semibold text-[var(--text-primary)]">人物角色</div>
        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-1">
            <span className="text-[12px] text-[var(--text-secondary)]">已选 {selectedIds.length}</span>
            <button
              onClick={() => {
                const names = filtered.filter((c) => selectedIds.includes(c.id)).map((c) => c.name || '未命名');
                setPendingBatchDelete({ ids: [...selectedIds], names });
              }}
              className="text-[12px] px-2 py-1 rounded transition-colors ancke-btn ancke-btn-danger"
              title="删除所选"
            >
              <span className="inline-flex items-center gap-1">
                <Icon name="trash" size={12} />
                批量删除
              </span>
            </button>
            <button
              onClick={clearSelection}
              className="text-[12px] px-2 py-1 rounded transition-colors bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)]"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <ImportCharacterTemplateButton />
            <button
              onClick={() => activeStoryId && createCharacter(activeStoryId)}
              disabled={!activeStoryId}
              className="text-[12px] px-2 h-8 rounded-full font-semibold transition-transform hover:-translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--an-pink)', color: '#fff', border: '2px solid var(--an-ink)', boxShadow: '0 2px 0 var(--an-ink)' }}
            >
              + 新建角色
            </button>
          </div>
        )}
      </div>

      {/* 角色卡片列表 */}
      <div
        className="shrink-0 p-2 border-b max-h-48 overflow-y-auto border-[var(--border-color)]"
      >
        {!activeStoryId && (
          <div className="text-[12px] italic px-2 py-3 text-center text-[var(--text-secondary)]">请先选择一个故事</div>
        )}
        {activeStoryId && filtered.length === 0 && (
          <div className="text-[12px] italic px-2 py-3 text-center text-[var(--text-secondary)]">
            暂无角色，点击上方"新建"
          </div>
        )}
        {activeStoryId && filtered.length > 0 && (
          <div className="space-y-1.5">
            {filtered.map((ch) => {
              const isActive = ch.id === editingCharacterId;
              const isSel = selectedIds.includes(ch.id);
              const variants = ch.variants || [];
              return (
                <div
                  key={ch.id}
                  className="rounded-[12px] border-2 relative overflow-hidden transition-transform hover:-translate-y-0.5"
                  style={{
                    borderColor: isSel || isActive ? 'var(--an-pink)' : 'var(--an-ink)',
                    background: isSel || isActive ? 'var(--an-pink-soft)' : 'var(--an-card)',
                    boxShadow: '0 2px 0 var(--an-ink)',
                  }}
                >
                  {/* 选中态左侧色条 */}
                  {(isActive || isSel) && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[3px]"
                      style={{ background: 'var(--an-pink)' }}
                    />
                  )}
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelect(ch.id)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.preventDefault()}
                      className="cursor-pointer"
                      title="勾选以加入批量删除"
                    />
                    <button
                      onClick={() => setEditingCharacter(isActive ? null : ch.id)}
                      className="flex-1 flex items-center gap-2.5 text-left"
                    >
                      {ch.avatar ? (
                        <img
                          src={ch.avatar}
                          alt={ch.name}
                          loading="lazy"
                          className="w-9 h-9 rounded-full shrink-0 object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div
                          className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center"
                          style={{ background: 'var(--an-lilac-soft)', color: 'var(--an-ink)', border: '2px solid var(--an-ink)' }}
                        >
                          <Icon name="user" size={16} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{ch.name || '未命名'}</div>
                        <div className="text-[12px] truncate mt-0.5 text-[var(--text-secondary)]">
                          {(ch.personality || '暂无角色描述').slice(0, 30)}
                        </div>
                      </div>
                      {variants.length > 0 && (
                        <span
                          className="text-[12px] px-1.5 py-0.5 rounded-full shrink-0 bg-[var(--bg-tag,var(--bg-hover))] text-[var(--text-secondary)]"
                        >
                          差分 {variants.length}
                        </span>
                      )}
                    </button>
                  </div>
                  {/* 差分缩略图条 */}
                  {variants.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-2.5 pb-2">
                      {variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => handleInsertVariant(v.name, v.url)}
                          className="w-7 h-7 rounded border overflow-hidden shrink-0 transition relative border-[var(--border-color)] hover:outline hover:outline-2 hover:outline-[var(--accent)]"
                          title={`点击插入差分：${v.name}`}
                        >
                          <img
                            src={v.url}
                            alt={v.name}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={(e) => {
                              const img = e.currentTarget as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = img.parentElement?.querySelector('.img-fallback') as HTMLElement | null;
                              if (fallback) fallback.style.display = 'flex';
                              console.warn('[VariantImage] 加载失败:', v.url);
                            }}
                          />
                          <div
                            className="img-fallback absolute inset-0 hidden items-center justify-center text-[12px] font-semibold text-[var(--text-muted)]"
                          >
                            {(v.name || '?').charAt(0)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <CharacterEditorInline character={editing} onShowToast={onShowToast} richTextEditorCommandsRef={richTextEditorCommandsRef} />
        ) : (
          <div className="p-6">
            <div className="anke-card flex flex-col items-center gap-2 px-6 py-10 text-center border-dashed">
              <Icon name="palette" size={48} className="opacity-40" />
              <div className="text-xs text-[var(--text-secondary)]">选择或新建一个角色</div>
              <div className="text-[12px] text-[var(--text-secondary)]">点击上方列表中的角色进行编辑</div>
            </div>
          </div>
        )}
      </div>

      {pendingBatchDelete && (
        <ConfirmDialog
          open={true}
          title="批量删除角色"
          message={`确定删除以下 ${pendingBatchDelete.ids.length} 个角色？${pendingBatchDelete.names.length <= 5 ? `\n• ${pendingBatchDelete.names.join('\n• ')}` : ''}\n此操作不可撤销。`}
          danger
          onConfirm={handleBatchDelete}
          onCancel={() => setPendingBatchDelete(null)}
        />
      )}
    </div>
  );
}

/**
 * 「按差分」面板：作品所有人物的所有差分平铺/分组展示，点击插入到光标位置
 * - 顶部子导航：全部 / 按人物
 * - 「全部」：所有差分混合在 4 列网格
 * - 「按人物」：按人物分组，每个分区内是 4 列网格
 */
function ByVariantContent({
  richTextEditorCommandsRef,
  onShowToast,
  keyword,
}: {
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
  keyword: string;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const characters = useMetaStore((s) => s.characters);
  const [subTab, setSubTab] = useState<'all' | 'grouped'>('all');

  const kw = keyword.trim().toLowerCase();

  // useMemo: 缓存过滤+排序结果，避免每次 render 都重算（人物多时卡顿）
  const filteredChars = useMemo(() => {
    return activeStoryId
      ? characters
          .filter((c) => c.story_id === activeStoryId)
          .filter(
            (c) =>
              !kw ||
              (c.name || '').toLowerCase().includes(kw) ||
              (c.notes || '').toLowerCase().includes(kw) ||
              (c.variants || []).some((v) => (v.name || '').toLowerCase().includes(kw)),
          )
          .slice()
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      : [];
  }, [activeStoryId, characters, kw]);

  // 拍平所有差分（带所属人物名）—— 依赖 filteredChars，缓存避免每次 render 重算 flatMap
  const allVariants = useMemo(
    () =>
      filteredChars.flatMap((ch) =>
        (ch.variants || [])
          .filter((v) => !kw || (v.name || '').toLowerCase().includes(kw))
          .map((v) => ({
            ...v,
            characterName: ch.name || '未命名',
            characterId: ch.id,
          })),
      ),
    [filteredChars, kw],
  );

  // 按人物分组时只保留命中的差分
  const groupedChars = useMemo(
    () =>
      filteredChars
        .map((ch) => ({
          ...ch,
          variants: (ch.variants || []).filter(
            (v) => !kw || (v.name || '').toLowerCase().includes(kw),
          ),
        }))
        .filter((ch) => ch.variants.length > 0),
    [filteredChars, kw],
  );

  const handleInsert = (variantName: string, url: string, charName: string) => {
    if (!richTextEditorCommandsRef.current) {
      onShowToast?.('没有可用的编辑器');
      return;
    }
    richTextEditorCommandsRef.current.insertImage(url, NGA_DEFAULT_IMAGE_SIZE);
    onShowToast?.(`已插入差分：${charName} · ${variantName}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 子导航：全部 / 按人物 */}
      <div
        className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)]"
      >
        {[
          { key: 'all', label: `全部（${allVariants.length}）` },
          { key: 'grouped', label: '按人物' },
        ].map((t) => {
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key as 'all' | 'grouped')}
              className={`text-[12px] px-2.5 py-1 rounded-md transition-colors border ${
                active
                  ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--accent)]'
                  : 'bg-[var(--bg-toolbar)] text-[var(--text-secondary)] border-[var(--border-color)]'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 差分网格 */}
      <div className="flex-1 overflow-y-auto p-3">
        {!activeStoryId && (
          <div
            className="text-[12px] italic py-6 text-center text-[var(--text-secondary)]"
          >
            请先选择一个故事
          </div>
        )}
        {activeStoryId && allVariants.length === 0 && (
          <div
            className="text-[12px] italic py-6 text-center text-[var(--text-secondary)]"
          >
            暂无差分
          </div>
        )}

        {/* 全部子 tab：平铺网格 */}
        {activeStoryId && allVariants.length > 0 && subTab === 'all' && (
          <div className="grid grid-cols-4 gap-2">
            {allVariants.map((v) => (
              <VariantThumbnail
                key={v.id}
                variant={v}
                onClick={() => handleInsert(v.name, v.url, v.characterName)}
              />
            ))}
          </div>
        )}

        {/* 按人物子 tab：分组 */}
        {activeStoryId && allVariants.length > 0 && subTab === 'grouped' && (
          <div className="space-y-4">
            {groupedChars.map((ch) => (
                <div key={ch.id}>
                  <div
                    className="text-[12px] font-semibold mb-1.5 flex items-baseline gap-1.5 text-[var(--text-primary)]"
                  >
                    <span>{ch.name || '未命名'}</span>
                    <span
                      className="text-[12px] font-normal text-[var(--text-muted)]"
                    >
                      {ch.variants.length} 个差分
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {ch.variants.map((v) => (
                      <VariantThumbnail
                        key={v.id}
                        variant={{ ...v, characterName: ch.name || '未命名' }}
                        onClick={() => handleInsert(v.name, v.url, ch.name || '未命名')}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 差分缩略图：方形 + 下方差分名标签；hover 高亮 */
function VariantThumbnail({
  variant,
  onClick,
}: {
  variant: {
    id: string;
    name: string;
    url: string;
    characterName: string;
  };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border overflow-hidden transition border-[var(--border-color)] bg-[var(--bg-page)] hover:border-[var(--accent)] hover:shadow-[0_0_0_2px_var(--accent-soft)]"
      title={`点击插入：${variant.characterName} · ${variant.name}`}
    >
      <div className="aspect-square w-full relative overflow-hidden bg-[var(--bg-toolbar)]">
        <img
          src={variant.url}
          alt={variant.name}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            img.style.display = 'none';
            const fallback = img.parentElement?.querySelector('.img-fallback') as HTMLElement | null;
            if (fallback) fallback.style.display = 'flex';
            console.warn('[VariantImage] 加载失败:', variant.url);
          }}
        />
        <div
          className="img-fallback absolute inset-0 hidden items-center justify-center text-base font-semibold text-[var(--text-muted)]"
        >
          {(variant.name || '?').charAt(0)}
        </div>
      </div>
      <div
        className="text-[12px] px-1 py-0.5 truncate text-[var(--text-secondary)]"
      >
        {variant.name}
      </div>
    </button>
  );
}

// P1-3: 抽离属性行为独立 memo 组件，避免单个属性编辑触发全部属性行重渲染
// - editingVal 是 string 原始值，memo 比较生效
// - 回调用 useCallback 稳定化，避免引用变化导致重渲染
interface AttributeRowProps {
  attrKey: string;
  editingVal: string;
  onEditingChange: (key: string, val: string) => void;
  onCommit: (key: string, val: string) => void;
  onDelete: (key: string) => void;
}

const AttributeRow = memo(function AttributeRow({
  attrKey,
  editingVal,
  onEditingChange,
  onCommit,
  onDelete,
}: AttributeRowProps) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 rounded border border-[var(--border-color)]"
    >
      <span className="text-[12px] font-medium w-16 shrink-0 truncate text-[var(--text-primary)]">
        {attrKey}
      </span>
      <input
        value={editingVal}
        onChange={(e) => onEditingChange(attrKey, e.target.value)}
        onBlur={() => onCommit(attrKey, editingVal)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onCommit(attrKey, editingVal);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="flex-1 text-[12px] px-1.5 py-0.5 rounded border outline-none bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-primary)]"
      />
      <button
        onClick={() => onDelete(attrKey)}
        className="text-[12px] px-1 transition-colors text-[var(--danger)]"
        title="删除此属性"
      >x</button>
    </div>
  );
});

// 简易内嵌版角色编辑器
function CharacterEditorInline({
  character,
  onShowToast,
  richTextEditorCommandsRef,
}: {
  character: {
    id: string;
    name: string;
    personality?: string;
    notes?: string;
    avatar?: string;
    variants?: { id: string; name: string; url: string; order_index: number }[];
    attributes?: Record<string, string | number>;
  };
  onShowToast?: (msg: string) => void;
  richTextEditorCommandsRef?: React.MutableRefObject<RichTextEditorCommands | null>;
}) {
  const updateCharacter = useMetaStore((s) => s.updateCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);
  const setEditingCharacter = useMetaStore((s) => s.setEditingCharacter);
  const addVariant = useMetaStore((s) => s.addCharacterVariant);
  const updateVariant = useMetaStore((s) => s.updateCharacterVariant);
  const deleteVariant = useMetaStore((s) => s.deleteCharacterVariant);
  const reorderVariants = useMetaStore((s) => s.reorderCharacterVariants);

  // 属性相关状态
  const [attributes, setAttributes] = useState<Record<string, string | number>>(character.attributes || {});
  // 编辑中的属性值：key=属性名, value=正在输入的值；blur 后清空
  // 修复：原先在 .map() 回调里调 useState 违反 Rules of Hooks，会触发 React error #310
  const [editingAttrs, setEditingAttrs] = useState<Record<string, string>>({});

  const updateAttributes = (next: Record<string, string | number>) => {
    setAttributes(next);
    updateCharacter(character.id, { attributes: next });
  };

  // P1-3: 稳定的属性行回调，用 functional setState 避免闭包 stale，使 AttributeRow memo 生效
  // - handleAttrEditingChange: 输入时仅更新 editingAttrs（不影响 attributes，其他行不重渲染）
  // - handleAttrCommit: blur/Enter 时提交到 attributes + store，并清空 editingAttrs[key]
  // - handleAttrDelete: 从 attributes 删除 key + 同步 store
  const handleAttrEditingChange = useCallback((key: string, val: string) => {
    setEditingAttrs((prev) => ({ ...prev, [key]: val }));
  }, []);
  const handleAttrCommit = useCallback((key: string, val: string) => {
    setAttributes((prev) => {
      const next = { ...prev, [key]: val };
      updateCharacter(character.id, { attributes: next });
      return next;
    });
    setEditingAttrs((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [character.id, updateCharacter]);
  const handleAttrDelete = useCallback((key: string) => {
    setAttributes((prev) => {
      const next = { ...prev };
      delete next[key];
      updateCharacter(character.id, { attributes: next });
      return next;
    });
  }, [character.id, updateCharacter]);

  const [name, setName] = useState(character.name || '');
  const [personality, setPersonality] = useState(character.personality || '');
  const [notes, setNotes] = useState(character.notes || '');
  const [avatar, setAvatar] = useState(character.avatar || '');
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const variantFileRef = useRef<HTMLInputElement | null>(null);

  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantUrl, setNewVariantUrl] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<{ id: string; name: string } | null>(null);
  const [pendingNewAttr, setPendingNewAttr] = useState(false);
  const [newAttrName, setNewAttrName] = useState('');

  // 订阅本地上传总开关：关闭时把上传按钮置灰
  const imageStoreMode = useSettingStore((s) => s.imageStoreMode);
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const localUploadDisabledReason = '本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传';
  const isLocalUploadDisabled = !localUploadEnabled;

  // 上传进度弹窗状态
  const [uploadTasks, setUploadTasks] = useState<UploadProgressEvent[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  useEffect(() => {
    setName(character.name || '');
    setPersonality(character.personality || '');
    setNotes(character.notes || '');
    setAvatar(character.avatar || '');
    setAttributes(character.attributes || {});
    setEditingAttrs({});  // 切换人物时清空编辑状态
  }, [character.id]);

  const handleSave = () => {
    updateCharacter(character.id, { name, personality, notes, avatar });
  };

  const handleDelete = () => {
    setPendingDelete(true);
  };

  const handleAvatarFile = async (file: File) => {
    // 检查本地上传总开关（默认关闭）
    if (!useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告（统一由全局 store 管理）
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks([
      {
        taskId: `${Date.now()}_0`,
        fileName: file.name || 'avatar',
        status: 'pending',
        progress: 0,
      },
    ]);
    setUploadDialogOpen(true);
    const [res] = await uploadImagesWithProgress([file], (e) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
      );
    });
    if (res.ok && res.url) {
      setAvatar(res.url);
      updateCharacter(character.id, { avatar: res.url });
      useToastStore.getState().showToast('头像已更新', 'success');
    } else {
      useToastStore
        .getState()
        .showToast(`图片上传失败：${res.error || '未知错误'}，请检查网络后重新选择`, 'error');
    }
  };

  const handleVariantFile = async (file: File) => {
    // 检查本地上传总开关（默认关闭）
    if (!useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks([
      {
        taskId: `${Date.now()}_0`,
        fileName: file.name || 'variant',
        status: 'pending',
        progress: 0,
      },
    ]);
    setUploadDialogOpen(true);
    const [res] = await uploadImagesWithProgress([file], (e) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
      );
    });
    if (res.ok && res.url) {
      setNewVariantUrl(res.url);
      // 默认差分名 = 图片文件名（去后缀）
      const defaultName = file.name.replace(/\.[^.]+$/, '');
      if (defaultName) setNewVariantName(defaultName);
      useToastStore.getState().showToast('差分图片就绪', 'success');
    } else {
      useToastStore
        .getState()
        .showToast(`图片上传失败：${res.error || '未知错误'}，请检查网络后重新选择`, 'error');
    }
  };

  const handleAddVariant = () => {
    const url = newVariantUrl.trim();
    if (!url) return;
    const vname = newVariantName.trim() || `差分 ${(character.variants || []).length + 1}`;
    addVariant(character.id, { name: vname, url });
    setNewVariantName('');
    setNewVariantUrl('');
  };

  const moveVariant = (id: string, dir: -1 | 1) => {
    const list = [...(character.variants || [])];
    const i = list.findIndex((v) => v.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    reorderVariants(character.id, list.map((v) => v.id));
  };

  const INPUT_CLASS =
    'bg-[var(--bg-input)] border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <div className="p-3 space-y-3 bg-[var(--bg-card)]">
      {/* 头像 */}
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 w-16 h-16 rounded-lg flex items-center justify-center text-2xl overflow-hidden border bg-[var(--bg-page)] border-[var(--border-color)] ${
            isLocalUploadDisabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
          }`}
          onClick={() => {
            if (isLocalUploadDisabled) {
              useToastStore.getState().showToast(localUploadDisabledReason, 'error');
              return;
            }
            avatarFileRef.current?.click();
          }}
          title={isLocalUploadDisabled ? localUploadDisabledReason : '点击更换头像'}
        >
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span className="inline-flex items-center justify-center text-[var(--text-secondary)]">
              <Icon name="user" size={14} />
            </span>
          )}
        </div>
        <input
          ref={avatarFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAvatarFile(file);
            e.target.value = '';
          }}
        />
        <div className="flex-1 space-y-2">
          <div>
            <label className="block text-[12px] font-medium mb-1 text-[var(--text-secondary)]">姓名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSave}
              className={`w-full px-2 py-1.5 text-xs rounded-md border outline-none ${INPUT_CLASS}`}
              placeholder="角色姓名"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1 text-[var(--text-secondary)]">性格/特征</label>
            <input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              onBlur={handleSave}
              className={`w-full px-2 py-1.5 text-xs rounded-md border outline-none ${INPUT_CLASS}`}
              placeholder="例如：开朗、冷静、勇敢"
            />
          </div>
        </div>
      </div>

      {/* 描述 */}
      <div>
        <label className="block text-[12px] font-medium mb-1 text-[var(--text-secondary)]">备注/详情</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleSave}
          rows={4}
          className={`w-full px-2 py-2 text-xs rounded-md border outline-none resize-y leading-relaxed ${INPUT_CLASS}`}
          placeholder="背景、外貌、技能等详细描述..."
        />
      </div>

      {/* 属性展示（可编辑） */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[12px] font-medium text-[var(--text-secondary)]">角色属性</label>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-secondary)]">
              {Object.keys(attributes || {}).length} 项
            </span>
            <button
              onClick={() => setPendingNewAttr(true)}
              className="text-[12px] px-2 py-0.5 rounded transition-colors font-medium inline-flex items-center gap-0.5 bg-[var(--accent)] text-[var(--text-on-accent)]"
              title="添加新属性"
            >
              + 添加属性
            </button>
          </div>
        </div>
        {Object.keys(attributes || {}).length === 0 ? (
          <div className="text-[12px] italic text-center py-2 text-[var(--text-secondary)]">暂无属性，点击上方添加</div>
        ) : (
          <div className="space-y-1">
            {Object.entries(attributes || {}).map(([key, value]) => (
              <AttributeRow
                key={key}
                attrKey={key}
                editingVal={editingAttrs[key] ?? String(value)}
                onEditingChange={handleAttrEditingChange}
                onCommit={handleAttrCommit}
                onDelete={handleAttrDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* 差分管理 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[12px] font-medium text-[var(--text-secondary)]">
            人物差分（表情/姿势/服饰等图片变体）
          </label>
          <span className="text-[12px] text-[var(--text-secondary)]">
            {(character.variants || []).length} 个
          </span>
        </div>

        {(character.variants || []).length === 0 && (
          <div className="text-[12px] italic text-center py-1 mb-1 text-[var(--text-secondary)]">
            暂无差分
          </div>
        )}

        <div className="space-y-1 mb-2">
          {(character.variants || []).map((v, idx) => (
            <div
              key={v.id}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded border border-[var(--border-color)]"
            >
              <div
                className="w-8 h-8 rounded shrink-0 relative overflow-hidden bg-[var(--bg-input)] border border-[var(--border-color)]"
              >
                <img
                  src={v.url}
                  alt={v.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.style.display = 'none';
                    const fallback = img.parentElement?.querySelector('.img-fallback') as HTMLElement | null;
                    if (fallback) fallback.style.display = 'flex';
                    console.warn('[VariantImage] 加载失败:', v.url);
                  }}
                />
                <div
                  className="img-fallback absolute inset-0 hidden items-center justify-center text-[12px] font-semibold text-[var(--text-muted)]"
                >
                  {(v.name || '?').charAt(0)}
                </div>
              </div>
              <input
                value={v.name}
                onChange={(e) => updateVariant(v.id, { name: e.target.value })}
                placeholder="差分名称"
                className={`flex-1 min-w-0 px-1.5 py-1 text-[12px] rounded border outline-none ${INPUT_CLASS}`}
              />
              <input
                value={v.url}
                onChange={(e) => updateVariant(v.id, { url: e.target.value })}
                placeholder="图片 URL"
                className={`flex-1 min-w-0 px-1.5 py-1 text-[12px] rounded border outline-none ${INPUT_CLASS}`}
              />
              <button
                onClick={() => moveVariant(v.id, -1)}
                disabled={idx === 0}
                className="text-[12px] px-1 py-0.5 rounded border disabled:opacity-30 bg-[var(--bg-base)] text-[var(--text-secondary)] border-[var(--border-color)]"
                title="上移"
              >
                ↑
              </button>
              <button
                onClick={() => moveVariant(v.id, 1)}
                disabled={idx === (character.variants || []).length - 1}
                className="text-[12px] px-1 py-0.5 rounded border disabled:opacity-30 bg-[var(--bg-base)] text-[var(--text-secondary)] border-[var(--border-color)]"
                title="下移"
              >
                ↓
              </button>
              <button
                onClick={() => {
                  if (richTextEditorCommandsRef?.current) {
                    richTextEditorCommandsRef.current.insertImage(v.url, NGA_DEFAULT_IMAGE_SIZE);
                    onShowToast?.(`已插入差分：${v.name}`);
                  }
                }}
                disabled={!richTextEditorCommandsRef?.current}
                className="text-[12px] px-1 py-0.5 rounded border transition-colors disabled:opacity-30 bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--accent)]"
                title="插入到编辑器"
              >
                插入
              </button>
              <button aria-label="删除"
                onClick={() => {
                  setPendingDeleteVariant({ id: v.id, name: v.name });
                }}
                className="text-[12px] px-1 py-0.5 rounded bg-[var(--danger-soft)] text-[var(--danger)]"
                title="删除"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            value={newVariantName}
            onChange={(e) => setNewVariantName(e.target.value)}
            placeholder="差分名称（可空）"
            className={`w-28 px-1.5 py-1 text-[12px] rounded border outline-none ${INPUT_CLASS}`}
          />
          <input
            value={newVariantUrl}
            onChange={(e) => setNewVariantUrl(e.target.value)}
            placeholder="图片 URL 或上传"
            className={`flex-1 min-w-0 px-1.5 py-1 text-[12px] rounded border outline-none ${INPUT_CLASS}`}
          />
          <button aria-label="选择本地图片"
            onClick={() => {
              if (isLocalUploadDisabled) {
                useToastStore.getState().showToast(localUploadDisabledReason, 'error');
                return;
              }
              variantFileRef.current?.click();
            }}
            disabled={isLocalUploadDisabled}
            className={`text-[12px] px-1.5 py-1 rounded border bg-[var(--bg-sidebar)] text-[var(--text-primary)] border-[var(--border-color)] ${
              isLocalUploadDisabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
            }`}
            title={isLocalUploadDisabled ? localUploadDisabledReason : '上传'}
          >
            <Icon name="folder" size={14} />
          </button>
          <input
            ref={variantFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVariantFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={handleAddVariant}
            disabled={!newVariantUrl.trim()}
            className="text-[12px] px-2 py-1 rounded disabled:opacity-40 bg-[var(--success)] text-[var(--text-on-accent)]"
          >
            + 添加
          </button>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleDelete}
          className="px-2 py-1 text-[12px] rounded-md transition-colors bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-[var(--text-on-danger)]"
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="trash" size={14} />
            删除角色
          </span>
        </button>
        <button
          onClick={handleSave}
          className="px-2 py-1 text-[12px] rounded-md transition-colors bg-[var(--accent-bg)] text-[var(--accent)] border border-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--text-on-accent)]"
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="check" size={14} />
            保存
          </span>
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除角色"${name || '未命名'}"？此操作不可撤销。`}
          danger
          onConfirm={() => {
            deleteCharacter(character.id);
            setEditingCharacter(null);
            useToastStore.getState().showToast('已删除', 'success');
            setPendingDelete(false);
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}

      {pendingDeleteVariant && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除差分"${pendingDeleteVariant.name}"？`}
          danger
          onConfirm={() => {
            deleteVariant(pendingDeleteVariant.id);
            setPendingDeleteVariant(null);
          }}
          onCancel={() => setPendingDeleteVariant(null)}
        />
      )}

      {pendingNewAttr && (
        <InputDialog
          open={true}
          title="添加属性"
          placeholder="属性名（如：HP、力量、职业…）"
          defaultValue={newAttrName}
          confirmText="添加"
          onConfirm={(value: string) => {
            const k = value.trim();
            if (!k) {
              setPendingNewAttr(false);
              return;
            }
            if (attributes[k] !== undefined) {
              onShowToast?.(`属性"${k}"已存在`);
              return;
            }
            updateAttributes({ ...attributes, [k]: '' });
            setNewAttrName('');
            setPendingNewAttr(false);
          }}
          onCancel={() => {
            setNewAttrName('');
            setPendingNewAttr(false);
          }}
        />
      )}

      {/* 上传进度弹窗 */}
      <UploadProgressDialog
        open={uploadDialogOpen}
        tasks={uploadTasks}
        onClose={() => setUploadDialogOpen(false)}
      />
    </div>
  );
}
