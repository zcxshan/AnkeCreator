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
  图片: '#3b82f6',
  图标: '#8b5cf6',
  字体: '#ec4899',
  音效: '#f59e0b',
  教程: '#10b981',
  工具: '#6366f1',
  其他: '#6b7280',
};

export function FindMaterialPanel() {
  const [sites, setSites] = useState<MaterialSite[]>([]);
  const [loading, setLoading] = useState(true);
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
    try {
      const list = await listMaterialSites();
      setSites(list);
    } catch (e) {
      showToast('加载素材列表失败', 'error');
      console.error('[FindMaterialPanel] load failed:', e);
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
    if (!window.confirm(`确定删除「${name}」吗？`)) return;
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
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* 工具栏：标题 + 筛选 + 添加按钮 */}
      <div
        className="flex items-center gap-3 px-6 py-3 border-b flex-wrap"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <span>🔍</span> 寻找素材
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {filterChips.map((chip) => {
            const active = filter === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => setFilter(chip.key)}
                className="px-3 py-1 text-xs rounded-full transition-all"
                style={{
                  background: active ? 'var(--accent-bg)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color)'}`,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-1.5 text-sm rounded-lg transition-all flex items-center gap-1.5"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: '1px solid var(--accent)',
            fontWeight: 500,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          ➕ 添加
        </button>
      </div>

      {/* 列表区 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div
              className="text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              加载中...
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span style={{ fontSize: 32, opacity: 0.5 }}>📭</span>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {filter === 'all' ? '暂无素材，点击右上角添加' : `该分类下暂无素材`}
            </div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {filtered.map((site) => (
              <div
                key={site.id}
                className="rounded-lg p-4 transition-all"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                {/* 卡片头部：名称 + 分类标签 */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <h3
                      className="text-sm font-semibold truncate"
                      style={{ color: 'var(--text-primary)' }}
                      title={site.name}
                    >
                      {site.name}
                    </h3>
                    <span
                      className="px-2 py-0.5 text-xs rounded-full flex-shrink-0"
                      style={{
                        background: `${CATEGORY_COLORS[site.category]}20`,
                        color: CATEGORY_COLORS[site.category],
                        border: `1px solid ${CATEGORY_COLORS[site.category]}40`,
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
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {site.description}
                  </p>
                )}

                {/* URL 显示 */}
                <div
                  className="text-xs mb-3 truncate font-mono"
                  style={{ color: 'var(--text-tertiary)' }}
                  title={site.url}
                >
                  {site.url}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpen(site.url)}
                    className="flex-1 px-3 py-1.5 text-xs rounded-md transition-all flex items-center justify-center gap-1"
                    style={{
                      background: 'var(--accent-bg)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--accent)';
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--accent-bg)';
                      e.currentTarget.style.color = 'var(--accent)';
                    }}
                  >
                    🌐 打开
                  </button>
                  <button
                    onClick={() => openEdit(site)}
                    className="px-3 py-1.5 text-xs rounded-md transition-all"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hover)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(site.id, site.name)}
                    className="px-3 py-1.5 text-xs rounded-md transition-all"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#ef444420';
                      e.currentTarget.style.color = '#ef4444';
                      e.currentTarget.style.borderColor = '#ef4444';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    🗑️
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
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={closeEdit}
        >
          <div
            className="rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              {edit.editingId ? '编辑素材' : '添加素材'}
            </h3>

            {/* 名称 */}
            <div className="mb-3">
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                名称 <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={edit.form.name}
                onChange={(e) => setEdit((p) => ({ ...p, form: { ...p.form, name: e.target.value } }))}
                placeholder="如：Unsplash"
                className="w-full px-3 py-2 text-sm rounded-md outline-none"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
                autoFocus
              />
            </div>

            {/* URL */}
            <div className="mb-3">
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                URL <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={edit.form.url}
                onChange={(e) => setEdit((p) => ({ ...p, form: { ...p.form, url: e.target.value } }))}
                placeholder="https://example.com"
                className="w-full px-3 py-2 text-sm rounded-md outline-none font-mono"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* 分类 */}
            <div className="mb-3">
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
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
                className="w-full px-3 py-2 text-sm rounded-md outline-none"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
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
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                描述（可选）
              </label>
              <textarea
                value={edit.form.description}
                onChange={(e) =>
                  setEdit((p) => ({ ...p, form: { ...p.form, description: e.target.value } }))
                }
                placeholder="简要描述这个素材网站的用途"
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-md outline-none resize-none"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
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
                  color: '#fff',
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
