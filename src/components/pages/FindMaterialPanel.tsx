// ============================================================
// FindMaterialPanel：寻找素材面板
//
// 功能：
//  - 展示素材网站推荐列表（卡片式）
//  - 分类筛选（全部 / 图片 / 图标 / 字体 / 音效 / 教程 / 工具 / 其他）
//  - 增删改：添加新素材、编辑已有素材、删除素材
//  - 打开外链：在系统浏览器中打开素材网站
//
// 数据源：material_sites.json（主进程持久化，首次启动预填 11 个常用网站）
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import {
  listMaterialSites,
  createMaterialSite,
  updateMaterialSite,
  deleteMaterialSite,
} from '../../db';
import { MATERIAL_CATEGORIES, type MaterialSite, type MaterialCategory } from '../../types';
import { useToastStore } from '../../store/toastStore';
import { Icon } from '../common/Icon';
import { askConfirm } from '../common/confirmPrompt';

interface EditState {
  open: boolean;
  editingId: string | null; // null = 新建
  form: {
    name: string;
    url: string;
    category: MaterialCategory;
    description: string;
  };
}

const INITIAL_FORM = {
  name: '',
  url: '',
  category: '图片' as MaterialCategory,
  description: '',
};

const CATEGORY_COLORS: Record<MaterialCategory, string> = {
  图片: 'var(--tone-info)',
  图标: 'var(--tone-purple)',
  字体: 'var(--tone-pink)',
  音效: 'var(--tone-warn)',
  教程: 'var(--tone-success)',
  工具: 'var(--tone-indigo)',
  其他: 'var(--tone-neutral)',
};

export function FindMaterialPanel() {
  const [sites, setSites] = useState<MaterialSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MaterialCategory | 'all'>('all');
  const [edit, setEdit] = useState<EditState>({
    open: false,
    editingId: null,
    form: { ...INITIAL_FORM },
  });
  const [saving, setSaving] = useState(false);
  const showToast = useToastStore((s) => s.showToast);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listMaterialSites();
      setSites(list);
    } catch (e) {
      console.error('[FindMaterialPanel] load failed:', e);
      setLoadError((e as Error)?.message || String(e));
      showToast('加载素材列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = filter === 'all' ? sites : sites.filter((s) => s.category === filter);

  const handleOpen = (url: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openExternal) {
      electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const openAdd = () => {
    setEdit({ open: true, editingId: null, form: { ...INITIAL_FORM } });
  };

  const openEdit = (site: MaterialSite) => {
    setEdit({
      open: true,
      editingId: site.id,
      form: {
        name: site.name,
        url: site.url,
        category: site.category,
        description: site.description || '',
      },
    });
  };

  const closeEdit = () => {
    if (saving) return;
    setEdit((prev) => ({ ...prev, open: false }));
  };

  const handleSave = async () => {
    const { name, url, category, description } = edit.form;
    if (!name.trim()) {
      showToast('名称不能为空', 'warning');
      return;
    }
    if (!url.trim()) {
      showToast('URL 不能为空', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (edit.editingId) {
        await updateMaterialSite(edit.editingId, {
          name: name.trim(),
          url: url.trim(),
          category,
          description: description.trim() || undefined,
        });
        showToast('已更新', 'success');
      } else {
        await createMaterialSite({
          name: name.trim(),
          url: url.trim(),
          category,
          description: description.trim() || undefined,
        });
        showToast('已添加', 'success');
      }
      setEdit({ open: false, editingId: null, form: { ...INITIAL_FORM } });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await askConfirm({
      title: '删除素材',
      message: `确定删除「${name}」吗？`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const ok = await deleteMaterialSite(id);
      if (ok) {
        showToast('已删除', 'success');
        await refresh();
      } else {
        showToast('删除失败：未找到该素材', 'warning');
      }
    } catch (e) {
      showToast('删除失败', 'error');
      console.error('[FindMaterialPanel] delete failed:', e);
    }
  };

  const filterChips: Array<{ key: MaterialCategory | 'all'; label: string }> = [
    { key: 'all', label: '全部' },
    ...MATERIAL_CATEGORIES.map((c) => ({ key: c, label: c })),
  ];

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden"
      style={{ background: 'var(--an-paper)', color: 'var(--an-ink)' }}
    >
      {/* 工具栏：标题 + 筛选 + 添加按钮 */}
      <div
        className="flex items-center gap-3 px-6 py-3 flex-wrap"
        style={{ background: 'var(--an-pink-soft)', borderBottom: 'var(--an-line)' }}
      >
        <h2 className="text-base font-bold flex items-center gap-2" style={{ fontFamily: 'var(--an-font-display)', color: 'var(--an-ink)' }}>
          <Icon name="search" size={16} /> 寻找素材
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {filterChips.map((chip) => {
            const active = filter === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => setFilter(chip.key)}
                className="px-3 h-8 text-xs rounded-full transition-transform hover:-translate-y-[1px]"
                style={{
                  background: active ? 'var(--an-pink)' : 'var(--an-card)',
                  color: active ? '#fff' : 'var(--an-ink)',
                  border: '2px solid var(--an-ink)',
                  boxShadow: '0 2px 0 var(--an-ink)',
                  fontWeight: active ? 700 : 500,
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={openAdd}
          className="font-semibold px-4 h-9 text-sm transition-transform hover:-translate-y-[1px] flex items-center gap-1.5"
          style={{ background: 'var(--an-pink)', color: '#fff', border: '2px solid var(--an-ink)', borderRadius: 999, boxShadow: '0 3px 0 var(--an-ink)' }}
        >
          <Icon name="plus" size={14} /> 添加
        </button>
      </div>

      {/* 列表区 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loadError ? (
          <div role="alert" className="flex flex-col items-center justify-center h-full gap-2">
            <Icon name="alert" size={28} className="text-[var(--tone-danger)]" />
            <div className="text-[var(--text-primary)] text-sm font-medium">素材列表加载失败</div>
            <div className="text-[var(--text-secondary)] text-xs">{loadError}</div>
            <button
              onClick={() => refresh()}
              className="mt-2 inline-flex items-center gap-1 px-4 py-1.5 text-sm rounded-md bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)]"
            >
              <Icon name="refresh" size={13} /> 重新加载
            </button>
          </div>
        ) : loading ? (
          <div role="status" aria-live="polite" className="flex items-center justify-center h-full">
            <div className="text-[var(--text-secondary)] text-sm">加载中...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Icon name="inbox" size={32} className="opacity-50" />
            <div className="text-[var(--text-secondary)] text-sm">
              {filter === 'all' ? '暂无素材，点击右上角添加' : `该分类下暂无素材`}
            </div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {filtered.map((site) => (
              <div
                key={site.id}
                className="p-4 transition-transform hover:-translate-y-0.5"
                style={{
                  background: 'var(--an-card)',
                  border: '2px solid var(--an-ink)',
                  borderRadius: 'var(--an-radius-md)',
                  boxShadow: '0 4px 0 var(--an-ink)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--an-pink)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--an-ink)';
                }}
              >
                {/* 卡片头部：名称 + 分类标签 */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <h3
                      className="text-sm font-bold truncate"
                      style={{ color: 'var(--an-ink)', fontFamily: 'var(--an-font-display)' }}
                      title={site.name}
                    >
                      {site.name}
                    </h3>
                    <span
                      className="px-2 py-0.5 text-xs rounded-full flex-shrink-0 font-semibold"
                      style={{
                        background: 'var(--an-card)',
                        color: CATEGORY_COLORS[site.category],
                        border: '2px solid var(--an-ink)',
                      }}
                    >
                      {site.category}
                    </span>
                  </div>
                </div>

                {/* 描述 */}
                {site.description && (
                  <p
                    className="text-xs mb-3 line-clamp-2"
                    style={{ color: 'var(--an-ink-soft)' }}
                  >
                    {site.description}
                  </p>
                )}

                {/* URL 显示 */}
                <div
                  className="text-[12px] mb-3 truncate font-mono"
                  style={{ color: 'var(--an-ink-faint)' }}
                  title={site.url}
                >
                  {site.url}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpen(site.url)}
                    className="flex-1 h-9 text-xs font-semibold transition-transform hover:-translate-y-[1px] flex items-center justify-center gap-1"
                    style={{ background: 'var(--an-mint)', color: '#123a2e', border: '2px solid var(--an-ink)', borderRadius: 999, boxShadow: '0 2px 0 var(--an-ink)' }}
                  >
                    <span className="inline-flex items-center gap-1"><Icon name="globe" size={13} /> 打开</span>
                  </button>
                  <button aria-label="编辑"
                    onClick={() => openEdit(site)}
                    className="w-9 h-9 flex items-center justify-center text-xs transition-transform hover:-translate-y-[1px]"
                    style={{ background: 'var(--an-sky-soft)', color: 'var(--an-ink)', border: '2px solid var(--an-ink)', borderRadius: 999, boxShadow: '0 2px 0 var(--an-ink)' }}
                  >
                    <Icon name="pen" size={13} />
                  </button>
                  <button aria-label="删除"
                    onClick={() => handleDelete(site.id, site.name)}
                    className="w-9 h-9 flex items-center justify-center text-xs transition-transform hover:-translate-y-[1px]"
                    style={{ background: 'var(--an-pink-soft)', color: '#8a1f43', border: '2px solid var(--an-ink)', borderRadius: 999, boxShadow: '0 2px 0 var(--an-ink)' }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑/新增弹窗 */}
      {edit.open && (
        <div
          className="bg-[var(--scrim)] fixed inset-0 flex items-center justify-center z-50"
          onClick={closeEdit}
        >
          <div
            className="bg-[var(--bg-base)] border border-[color:var(--border-color)] rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[var(--text-primary)] text-base font-semibold mb-4">
              {edit.editingId ? '编辑素材' : '添加素材'}
            </h3>

            {/* 名称 */}
            <div className="mb-3">
              <label className="text-[var(--text-secondary)] block text-xs mb-1.5">
                名称 <span className="text-[var(--tone-danger)]">*</span>
              </label>
              <input
                type="text"
                value={edit.form.name}
                onChange={(e) => setEdit((p) => ({ ...p, form: { ...p.form, name: e.target.value } }))}
                placeholder="如：Unsplash"
                className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3 py-2 text-sm rounded-md outline-none"
                autoFocus
              />
            </div>

            {/* URL */}
            <div className="mb-3">
              <label className="text-[var(--text-secondary)] block text-xs mb-1.5">
                URL <span className="text-[var(--tone-danger)]">*</span>
              </label>
              <input
                type="text"
                value={edit.form.url}
                onChange={(e) => setEdit((p) => ({ ...p, form: { ...p.form, url: e.target.value } }))}
                placeholder="https://example.com"
                className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3 py-2 text-sm rounded-md outline-none font-mono"
              />
            </div>

            {/* 分类 */}
            <div className="mb-3">
              <label className="text-[var(--text-secondary)] block text-xs mb-1.5">
                分类
              </label>
              <select
                value={edit.form.category}
                onChange={(e) =>
                  setEdit((p) => ({
                    ...p,
                    form: { ...p.form, category: e.target.value as MaterialCategory },
                  }))
                }
                className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3 py-2 text-sm rounded-md outline-none"
              >
                {MATERIAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* 描述 */}
            <div className="mb-4">
              <label className="text-[var(--text-secondary)] block text-xs mb-1.5">
                描述（可选）
              </label>
              <textarea
                value={edit.form.description}
                onChange={(e) =>
                  setEdit((p) => ({ ...p, form: { ...p.form, description: e.target.value } }))
                }
                placeholder="简要描述这个素材网站的用途"
                rows={3}
                className="bg-[var(--bg-input)] border border-[color:var(--border-color)] text-[var(--text-primary)] w-full px-3 py-2 text-sm rounded-md outline-none resize-none"
              />
            </div>

            {/* 按钮组 */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={closeEdit}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-md transition-all"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  opacity: saving ? 0.5 : 1,
                }}
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-md transition-all"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--text-on-accent)',
                  border: '1px solid var(--accent)',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
