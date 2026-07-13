// ============================================================
// ImageLibraryPage：图片库（全局，不绑定 story）
// 高内聚：本页自包含图片库的全部 UI + 状态 + handlers
// 低耦合：仅通过 src/db/imageLibrary.ts facade 通信
//
// 功能：
// - 文件夹导航（创建/重命名/删除/进入）
// - 图片上传（本地上传 via electronAPI.saveImageLocal / URL 上传）
// - 图片管理（删除/移动/复制 URL）
// - 图片显示：<img src={url}>（local:// 和 https:// 均可）
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { ImageLibraryFolder, ImageLibraryItem } from '../../types';
import {
  listImageLibraryFolders,
  createImageLibraryFolder,
  renameImageLibraryFolder,
  deleteImageLibraryFolder,
  listImageLibraryItems,
  addImageLibraryItem,
  deleteImageLibraryItem,
} from '../../db/imageLibrary';

interface Breadcrumb {
  id: string | null;
  name: string;
}

export function ImageLibraryPanel() {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<Breadcrumb[]>([{ id: null, name: '根目录' }]);
  const [folders, setFolders] = useState<ImageLibraryFolder[]>([]);
  const [items, setItems] = useState<ImageLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 弹窗状态
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<ImageLibraryFolder | null>(null);
  const [renameText, setRenameText] = useState('');
  const [showUrlUploadModal, setShowUrlUploadModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlFilename, setUrlFilename] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'folder' | 'item'; id: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fs, its] = await Promise.all([
        listImageLibraryFolders(currentFolderId),
        listImageLibraryItems(currentFolderId),
      ]);
      setFolders(fs);

      // 改动 8：扫描磁盘，合并 DB + 磁盘文件
      // - 当前在根目录（currentFolderId === null）时扫描整个 images/
      // - 在某文件夹中时只扫描 images/<folderName>/
      const currentFolder = currentFolderId
        ? fs.find((f) => f.id === currentFolderId) || null
        : null;
      let diskOnlyItems: ImageLibraryItem[] = [];
      try {
        const scan = await window.electronAPI?.scanImagesInDir?.(
          currentFolder ? { folderName: currentFolder.name } : undefined,
        );
        const files = scan?.files ?? [];
        // 已知 DB URL 集合
        const dbUrls = new Set(its.map((i) => i.url));
        // 已知磁盘上重复的（多个文件夹子目录可能产生重复 URL）：
        //   我们按 url 去重，保留第一个
        const seenUrls = new Set<string>();
        for (const f of files) {
          if (seenUrls.has(f.url)) continue;
          seenUrls.add(f.url);
          if (dbUrls.has(f.url)) continue;
          diskOnlyItems.push({
            id: `disk-${f.path}`,
            url: f.url,
            filename: f.filename,
            source: 'local',
            folderId: currentFolderId,
            // 渲染层用 created_at 排序，磁盘扫描项无原创建时间，用 mtime
            created_at: new Date(f.mtime).toISOString(),
            // 自定义字段：标记为磁盘扫描
            fromDisk: true,
          } as ImageLibraryItem & { fromDisk?: boolean });
        }
      } catch (e) {
        console.warn('扫描磁盘图片失败（继续显示 DB 记录）:', e);
      }
      setItems([...its, ...diskOnlyItems]);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleEnterFolder = (folder: ImageLibraryFolder) => {
    setCurrentFolderId(folder.id);
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleNavigateTo = (idx: number) => {
    const target = breadcrumb[idx];
    setCurrentFolderId(target.id);
    setBreadcrumb(breadcrumb.slice(0, idx + 1));
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createImageLibraryFolder({ name, parentId: currentFolderId });
      setShowNewFolderModal(false);
      setNewFolderName('');
      await refresh();
    } catch (e) {
      setError((e as Error).message || '创建文件夹失败');
    }
  };

  const handleRenameFolder = async () => {
    if (!renameTarget) return;
    const name = renameText.trim();
    if (!name) return;
    try {
      await renameImageLibraryFolder(renameTarget.id, name);
      setRenameTarget(null);
      setRenameText('');
      await refresh();
    } catch (e) {
      setError((e as Error).message || '重命名失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'folder') {
        await deleteImageLibraryFolder(deleteTarget.id);
      } else {
        await deleteImageLibraryItem(deleteTarget.id);
      }
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message || '删除失败');
    }
  };

  const handleLocalUpload = async () => {
    if (!window.electronAPI?.selectImage || !window.electronAPI?.saveImageLocal) {
      setError('本地上传仅支持桌面端 Electron 环境');
      return;
    }
    try {
      // 改动 6：批量选择多张图片
      const selected = await window.electronAPI.selectImage({ multiple: true });
      if (!selected) return;
      const list = Array.isArray(selected) ? selected : [selected];
      if (list.length === 0) return;

      // 改动 7：传 folderId + folderName 让保存到对应子目录
      const currentFolder = currentFolderId
        ? folders.find((f) => f.id === currentFolderId) || null
        : null;
      const folderId = currentFolder?.id ?? null;
      const folderName = currentFolder?.name;

      let successCount = 0;
      let failCount = 0;
      let firstError = '';
      for (const item of list) {
        const { buffer, filename } = item;
        const res = await window.electronAPI.saveImageLocal({
          buffer,
          filename,
          mimeType: item.mimeType,
          folderId,
          folderName,
        });
        if (res.ok && res.url) {
          await addImageLibraryItem({
            folderId: currentFolderId,
            url: res.url,
            filename,
            source: 'local',
          });
          successCount++;
        } else {
          failCount++;
          if (!firstError) firstError = res.error || '本地保存失败';
        }
      }
      if (failCount > 0) {
        setError(`${successCount} 张成功，${failCount} 张失败（${firstError}）`);
      } else {
        setError('');
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message || '本地上传失败');
    }
  };

  const handleUrlUpload = async () => {
    const text = urlInput.trim();
    if (!text) return;
    // 改动 6：支持多 URL（每行一个）
    const urls = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      // 第一个 URL 允许用 urlFilename 字段；其他从 URL 推断
      const filename =
        i === 0 && urlFilename.trim()
          ? urlFilename.trim()
          : (url.split('/').pop() || `image_${i + 1}`).split('?')[0] || `image_${i + 1}`;
      try {
        await addImageLibraryItem({
          folderId: currentFolderId,
          url,
          filename,
          source: 'url',
        });
        successCount++;
      } catch (e) {
        console.error('URL 上传失败:', url, e);
        failCount++;
      }
    }
    if (failCount > 0) {
      setError(`${successCount} 条成功，${failCount} 条失败`);
    } else {
      setError('');
    }
    setShowUrlUploadModal(false);
    setUrlInput('');
    setUrlFilename('');
    await refresh();
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => setError(''),
      () => setError('复制失败，请手动复制'),
    );
  };

  return (
    <div
      className="min-h-full w-full flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* 工具栏（返回按钮+标题由外壳 ResourceLibraryPage 提供） */}
      <div
        className="flex items-center justify-end gap-3 px-6 py-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <button
          onClick={() => setShowNewFolderModal(true)}
          className="px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; }}
        >
          📁 新建文件夹
        </button>
        <button
          onClick={handleLocalUpload}
          className="px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; }}
        >
          📷 本地上传
        </button>
        <button
          onClick={() => setShowUrlUploadModal(true)}
          className="px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; }}
        >
          🔗 URL 上传
        </button>
      </div>

      {/* 面包屑 */}
      <div className="flex items-center gap-1 px-6 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {breadcrumb.map((b, idx) => (
          <span key={`${b.id ?? 'root'}-${idx}`} className="flex items-center gap-1">
            {idx > 0 && <span className="mx-1">/</span>}
            <button
              onClick={() => handleNavigateTo(idx)}
              className="hover:underline"
              style={{ color: idx === breadcrumb.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-6 py-2 text-sm" style={{ color: 'var(--danger, #e53e3e)' }}>
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-secondary)' }}>
            加载中...
          </div>
        ) : folders.length === 0 && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span className="text-3xl mb-2">📭</span>
            空文件夹，点击上方按钮上传图片或新建子文件夹
          </div>
        ) : (
          <>
            {/* 文件夹区 */}
            {folders.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
                  文件夹（{folders.length}）
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {folders.map((f) => (
                    <div
                      key={f.id}
                      className="group relative rounded-lg p-3 cursor-pointer transition-all"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                      onClick={() => handleEnterFolder(f)}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                    >
                      <div className="text-2xl mb-1">📁</div>
                      <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</div>
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setRenameTarget(f); setRenameText(f.name); }}
                          className="px-1.5 py-0.5 text-xs rounded"
                          style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'folder', id: f.id, name: f.name }); }}
                          className="px-1.5 py-0.5 text-xs rounded"
                          style={{ background: 'var(--bg-hover)', color: 'var(--danger, #e53e3e)' }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 图片区 */}
            {items.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
                  图片（{items.length}）
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="group relative rounded-lg overflow-hidden cursor-pointer transition-all"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                      onClick={() => handleCopyUrl(item.url)}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                    >
                      <div className="aspect-square flex items-center justify-center overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                        <img
                          src={item.url}
                          alt={item.filename}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                            const parent = (e.currentTarget as HTMLImageElement).parentElement;
                            if (parent) parent.innerHTML = '<span style="font-size:24px">🖼️</span>';
                          }}
                        />
                      </div>
                      <div className="p-2">
                        <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{item.filename}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {item.source === 'local' ? '本地' : 'URL'}
                          {(item as any).fromDisk && (
                            <span
                              className="ml-1 px-1 rounded"
                              style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                              title="通过磁盘扫描识别（未在数据库中）"
                            >
                              📁 磁盘
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'item', id: item.id, name: item.filename }); }}
                          className="px-1.5 py-0.5 text-xs rounded"
                          style={{ background: 'var(--bg-hover)', color: 'var(--danger, #e53e3e)' }}
                        >
                          🗑️
                        </button>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        点击复制 URL
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 新建文件夹弹窗 */}
      {showNewFolderModal && (
        <Modal onClose={() => setShowNewFolderModal(false)} title="新建文件夹">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="文件夹名称"
            autoFocus
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateFolder(); }}
          />
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setShowNewFolderModal(false)} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>取消</button>
            <button onClick={handleCreateFolder} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>创建</button>
          </div>
        </Modal>
      )}

      {/* 重命名弹窗 */}
      {renameTarget && (
        <Modal onClose={() => { setRenameTarget(null); setRenameText(''); }} title="重命名文件夹">
          <input
            type="text"
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameFolder(); }}
          />
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => { setRenameTarget(null); setRenameText(''); }} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>取消</button>
            <button onClick={handleRenameFolder} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>确定</button>
          </div>
        </Modal>
      )}

      {/* URL 上传弹窗（改动 6：支持多 URL，每行一个） */}
      {showUrlUploadModal && (
        <Modal onClose={() => setShowUrlUploadModal(false)} title="URL 上传">
          <div className="space-y-3">
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                图片 URL（每行一个，可批量）
              </label>
              <textarea
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={'https://example.com/image1.png\nhttps://example.com/image2.png\nhttps://example.com/image3.png'}
                autoFocus
                rows={4}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  background: 'var(--bg-base)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                文件名（可选，仅第一个 URL 生效）
              </label>
              <input
                type="text"
                value={urlFilename}
                onChange={(e) => setUrlFilename(e.target.value)}
                placeholder="image.png"
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void handleUrlUpload(); }}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setShowUrlUploadModal(false)} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>取消</button>
            <button onClick={handleUrlUpload} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>上传</button>
          </div>
        </Modal>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)} title="确认删除">
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {deleteTarget.type === 'folder'
              ? `确定删除文件夹「${deleteTarget.name}」？文件夹内的所有子文件夹和图片将被一并删除。`
              : `确定删除图片「${deleteTarget.name}」？`}
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setDeleteTarget(null)} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>取消</button>
            <button onClick={handleDelete} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--danger, #e53e3e)', color: '#fff' }}>删除</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** 通用弹窗容器 */
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-lg max-w-md w-full mx-4 p-5"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
