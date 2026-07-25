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
  listAllImageLibraryFolders,
  listAllImageLibraryItems,
  createImageLibraryFolder,
  renameImageLibraryFolder,
  deleteImageLibraryFolder,
  listImageLibraryItems,
  addImageLibraryItem,
  deleteImageLibraryItem,
  moveImageLibraryItem,
  updateImageLibraryItem,
  reorderImageLibraryItems,
} from '../../db/imageLibrary';
import { stripImageFilenameExtension } from '../../utils/imageFilename';

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
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'folder' | 'item'; id: string; name: string } | null>(null);
  // 改动 v3：图片重命名弹窗
  const [renameItemTarget, setRenameItemTarget] = useState<ImageLibraryItem | null>(null);
  const [renameItemText, setRenameItemText] = useState('');
  // 改动 v3：搜索框（按图片名过滤）
  const [searchQuery, setSearchQuery] = useState('');
  // 改动 v3：拖动到文件夹时的视觉反馈
  const [folderDropHover, setFolderDropHover] = useState<string | null>(null);
  // 改动 v3：拖动换顺序时正在拖动的 item id
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // v13 修复:在 listImageLibraryItems 前调一次 reconcile,修复被污染的旧数据
      // (handleLocalUpload 的 folders.find bug 导致部分图片物理在根,DB 标 001)
      // reconcile 后再 list,根目录不会再显示这些被误标为子目录的图片
      try {
        const reconcileRes = await window.electronAPI?.reconcileLibrary?.();
        if (reconcileRes?.changes && reconcileRes.changes.length > 0) {
          console.log('[资源库] reconcile 修正了', reconcileRes.changes.length, '个 item:', reconcileRes.changes);
        }
      } catch (e) {
        console.warn('[资源库] reconcile 失败（继续加载）:', e);
      }

      // 全量同步磁盘 data/images → DB（folders + items 一次性完成）
      // - 递归识别用户直接放入 data/images 的文件夹（含嵌套子目录）为 DB folder
      // - 磁盘有但 DB 没有的图片 → 自动入库为 local item
      // - DB 有但磁盘没有且 source='local' 的图片 → 从 DB 删除（source='url' 不动）
      // 替代原有的"扫描当前目录 + 串行 addImageLibraryItem"逻辑：
      // - 原逻辑只扫当前 currentFolderId 对应目录，新逻辑全量扫描整个 data/images
      // - 原逻辑只增不删，新逻辑同时处理新增和删除
      // - 原逻辑串行 N 次 IPC，新逻辑 1 次 IPC 在主进程内完成
      try {
        const syncRes = await window.electronAPI?.syncDiskToDb?.();
        if (
          syncRes?.ok &&
          (syncRes.foldersCreated > 0 ||
            syncRes.itemsAdded > 0 ||
            syncRes.itemsDeleted > 0)
        ) {
          console.log(
            `[资源库] syncDiskToDb: +${syncRes.foldersCreated} folders (reused ${syncRes.foldersReused}), +${syncRes.itemsAdded} items, -${syncRes.itemsDeleted} items`,
          );
        }
      } catch (e) {
        console.warn('[资源库] syncDiskToDb 失败（继续加载）:', e);
      }

      // 同步后拉取 folders + items（已含同步结果）
      const [fs, its] = await Promise.all([
        listImageLibraryFolders(currentFolderId),
        listImageLibraryItems(currentFolderId),
      ]);
      setFolders(fs);
      setItems(its);
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
        // v36: 子目录删除二次确认
        // 统计该文件夹及所有子文件夹下的图片数,告知用户将删除多少张图
        try {
          const allFolders = await listAllImageLibraryFolders();
          const allItems = await listAllImageLibraryItems();
          // 收集目标文件夹及其所有后代文件夹 id
          const folderIds = new Set<string>([deleteTarget.id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const f of allFolders) {
              if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
                folderIds.add(f.id);
                changed = true;
              }
            }
          }
          // 统计子项数
          const itemCount = allItems.filter((it) => it.folderId && folderIds.has(it.folderId)).length;
          const subFolderCount = folderIds.size - 1;  // 不含自己
          const msg =
            `确定要删除文件夹「${deleteTarget.name}」吗？\n` +
            `将删除 ${itemCount} 张图片` +
            (subFolderCount > 0 ? `、${subFolderCount} 个子文件夹` : '') +
            `（同时清理磁盘文件），此操作不可撤销。`;
          const ok = window.confirm(msg);
          if (!ok) {
            setDeleteTarget(null);
            return;
          }
        } catch (e) {
          console.warn('统计子目录信息失败，继续删除:', e);
        }
        await deleteImageLibraryFolder(deleteTarget.id);
      } else {
        // 找到 item（用于读取 url 来决定是否要删磁盘文件）
        const item = items.find((i) => i.id === deleteTarget.id);
        // 1. 删 DB 记录（磁盘扫描项在 DB 里没记录，会返回 false，但不会抛错）
        await deleteImageLibraryItem(deleteTarget.id);
        // 2. 删磁盘文件（仅 local:// 协议，URL 上传的图片跳过）
        // v25 修复：失败时不再静默 console.warn，改用 setError 弹窗提示
        const targetUrl = item?.url;
        if (targetUrl && targetUrl.startsWith('local://') && window.electronAPI?.deleteImageLocal) {
          try {
            const res = await window.electronAPI.deleteImageLocal({ url: targetUrl });
            if (!res?.ok) {
              setError(`图片记录已删除，但磁盘文件清理失败：${res?.error || '未知错误'}`);
            }
          } catch (e) {
            setError(`图片记录已删除，但磁盘文件清理异常：${(e as Error).message || '未知错误'}`);
          }
        }
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
      // v13 修复：直接用 currentFolderId + breadcrumb,不再 folders.find
      // 之前 bug：folders 是 currentFolderId 的子目录列表,在子目录列表里找 currentFolderId 永远找不到
      //           → folderId 变成 null → saveImageLocal 写入根目录
      //           → 但 addImageLibraryItem 仍用 currentFolderId (001) 写 DB
      //           → 物理在根,DB 标 001 (数据污染)
      // v14 修复:根目录时不传 folderName(否则会创建"根目录"子目录污染)
      // 只有在子目录时才需要 folderName(folderId 优先,fallback 到 folderName)
      const folderId = currentFolderId;
      const folderName = currentFolderId
        ? breadcrumb[breadcrumb.length - 1]?.name
        : undefined;

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
          // 改动 v3：filename 用磁盘真实文件名（与 data/images 下保存的一致），
          // 防止用户上传 foo.png 但磁盘存为 foo (1).png（重名时）导致 UI/磁盘不一致。
          const urlBasename = res.url.replace(/^local:\/\/[^/]*\//, '').replace(/^local:\/\//, '');
          // 改动 v5：UI 显示名去扩展名（磁盘/URL 仍保留扩展名）
          const displayName = stripImageFilenameExtension(urlBasename || filename);
          await addImageLibraryItem({
            folderId: currentFolderId,
            url: res.url,
            filename: displayName,
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
    // 支持两种格式（每行一个）：
    // 1) name:url   （自定义文件名）
    // 2) url        （省略名字时自动从 URL 推断）
    const lines = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 解析 name:url：第一个冒号后必须是 / 开头（如 https:// 中的 ://）才视为 URL 自带协议，
      // 否则视为 name:url 自定义分隔符。
      const colonIdx = line.indexOf(':');
      let name: string;
      let url: string;
      if (colonIdx > 0) {
        const after = line.slice(colonIdx + 1).trim();
        if (/^\/\//.test(after)) {
          // 冒号后是 // 开头（如 https://...）→ 整行视为纯 URL
          url = line;
          name = (url.split('/').pop() || `image_${i + 1}`).split('?')[0] || `image_${i + 1}`;
        } else {
          // 冒号后不是 // → 视为 name:url
          name = line.slice(0, colonIdx).trim();
          url = after;
        }
      } else {
        url = line;
        name = (url.split('/').pop() || `image_${i + 1}`).split('?')[0] || `image_${i + 1}`;
      }
      try {
        // 改动 v5：UI 显示名去扩展名（URL 仍保留）
        const displayName = stripImageFilenameExtension(name);
        await addImageLibraryItem({
          folderId: currentFolderId,
          url,
          filename: displayName,
          source: 'url',
        });
        // 改动 v5：同步写入 .urls.json（每个文件夹独立维护）
        // 失败不影响主流程（DB 已记录，UI 可用）
        // v13 修复：直接用 breadcrumb 拿 folderName,不再 folders.find
        // (folders 是 currentFolderId 的子目录列表,不是 currentFolderId 本身)
        // v14 修复:根目录时不传 folderName(否则会创建"根目录"子目录污染 .urls.json)
        const folderName = currentFolderId
          ? breadcrumb[breadcrumb.length - 1]?.name
          : undefined;
        try {
          // v11 修复:同时传 folderId 和 folderName,folderId 优先
          // 解决嵌套子目录(001/002)URL 记录错位写入 002/ 而非 001/002/ 的问题
          await window.electronAPI?.appendUrlRecord?.({
            folderId: currentFolderId,
            folderName,
            record: { url, filename: displayName, created_at: new Date().toISOString() },
          });
        } catch (e) {
          console.warn('写入 .urls.json 失败（不影响主流程）:', e);
        }
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
    await refresh();
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => setError(''),
      () => setError('复制失败，请手动复制'),
    );
  };

  // 改动 v3：图片重命名（DB + 磁盘同步）
  // 改动 v3.1：扩展名由磁盘文件决定，用户输入中的 .xxx 被自动剥离
  const handleRenameItem = async () => {
    if (!renameItemTarget) return;
    let newName = renameItemText.trim();
    if (!newName || newName === renameItemTarget.filename) {
      setRenameItemTarget(null);
      setRenameItemText('');
      return;
    }
    // 修复：剥离扩展名——如果用户输入 "newname.png"，自动剥成 "newname"
    // 扩展名由磁盘文件决定，不能改
    newName = stripImageFilenameExtension(newName);
    if (!newName) {
      setError('文件名不能为空');
      return;
    }
    try {
      const oldItem = renameItemTarget;
      // 1. local:// 图片：先重命名磁盘文件
      if (oldItem.source === 'local' && oldItem.url.startsWith('local://') && window.electronAPI?.renameImageLocal) {
        const res = await window.electronAPI.renameImageLocal({
          oldUrl: oldItem.url,
          newFilename: newName,
        });
        if (res.ok && res.newUrl) {
          // 2. 同步更新 DB（filename + url）
          await updateImageLibraryItem(oldItem.id, { filename: newName, url: res.newUrl });
        } else {
          setError(res.error || '磁盘重命名失败');
          return;
        }
      } else {
        // URL 图片：只改 DB 的 filename
        await updateImageLibraryItem(oldItem.id, { filename: newName });
      }
      setRenameItemTarget(null);
      setRenameItemText('');
      await refresh();
    } catch (e) {
      setError((e as Error).message || '重命名失败');
    }
  };

  // 改动 v3：拖动到文件夹
  const handleItemDragStart = (e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingItemId(itemId);
  };
  const handleItemDragEnd = () => {
    setDraggingItemId(null);
    setFolderDropHover(null);
  };
  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (folderDropHover !== folderId) setFolderDropHover(folderId);
  };
  const handleFolderDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setFolderDropHover(null);
  };
  const handleFolderDrop = async (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderDropHover(null);
    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId) return;
    const item = items.find((i) => i.id === itemId);
    if (!item || item.folderId === folderId) return;
    try {
      // moveImageLibraryItem 在 db-main.ts 中同步搬移磁盘文件（local:// 图片）
      // URL 图片只改 DB 记录（无磁盘文件）
      await moveImageLibraryItem(item.id, folderId);
      await refresh();
    } catch (e) {
      setError((e as Error).message || '移动失败');
    }
  };

  // v9 新增：拖动到根目录（在子目录时把图片拖到面包屑或专用 drop zone）
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    // 用特殊字符串 '__root__' 标记根目录 hover（避免和 folderId 冲突）
    if (folderDropHover !== '__root__') setFolderDropHover('__root__');
  };
  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderDropHover(null);
    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId) return;
    const item = items.find((i) => i.id === itemId);
    if (!item || item.folderId === null || item.folderId === undefined) return;
    try {
      // 拖到根目录：folderId 设为 null
      await moveImageLibraryItem(item.id, null);
      await refresh();
    } catch (e) {
      setError((e as Error).message || '移动到根目录失败');
    }
  };

  // 改动 v3：拖动换顺序（在图片卡之间）
  const handleItemDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleItemDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = e.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === targetId) return;
    const visible = filteredItems;
    const ids = visible.map((i) => i.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, sourceId);
    try {
      await reorderImageLibraryItems(ids, currentFolderId);
      await refresh();
    } catch (e) {
      setError((e as Error).message || '排序失败');
    }
  };

  // 改动 v3：搜索过滤（按图片名 includes）
  const filteredItems = searchQuery.trim()
    ? items.filter((i) => i.filename.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : items;

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* 工具栏（返回按钮+标题由外壳 ResourceLibraryPage 提供） */}
      <div
        className="flex items-center justify-end gap-3 px-6 py-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {/* 改动 v3：搜索框 */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 搜索图片名"
          className="px-3 py-1.5 rounded-lg text-sm w-48"
          style={{
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            outline: 'none',
          }}
        />
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

      {/* v9 新增：在子目录时显示"拖到根目录" drop zone
          解决"图片无法拖回根目录"的问题（之前只能拖到子文件夹） */}
      {currentFolderId !== null && (
        <div
          className="mx-6 mb-2 px-4 py-3 text-sm flex items-center gap-2 transition-colors"
          style={{
            color: 'var(--text-secondary)',
            border: folderDropHover === '__root__'
              ? '2px dashed var(--accent)'
              : '2px dashed var(--border-color)',
            background: folderDropHover === '__root__' ? 'var(--accent-soft, rgba(99,102,241,0.08))' : 'transparent',
            borderRadius: 6,
            cursor: 'pointer',
          }}
          onClick={() => handleNavigateTo(0)}
          onDragOver={handleRootDragOver}
          onDragLeave={handleFolderDragLeave}
          onDrop={handleRootDrop}
          title="点击返回根目录，或拖动图片到此处移回根目录"
        >
          <span>📁</span>
          <span>拖动图片到此处移回根目录（点击返回根目录）</span>
        </div>
      )}

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
                      style={{
                        background: 'var(--bg-card)',
                        border: folderDropHover === f.id
                          ? '2px solid var(--accent)'
                          : '1px solid var(--border-color)',
                      }}
                      onClick={() => handleEnterFolder(f)}
                      onMouseEnter={(e) => {
                        if (folderDropHover !== f.id) e.currentTarget.style.borderColor = 'var(--accent)';
                      }}
                      onMouseLeave={(e) => {
                        if (folderDropHover !== f.id) e.currentTarget.style.borderColor = 'var(--border-color)';
                      }}
                      onDragOver={(e) => handleFolderDragOver(e, f.id)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, f.id)}
                    >
                      <div className="text-2xl mb-1">📁</div>
                      <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</div>
                      <div className="absolute top-1 right-1 flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
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
            {filteredItems.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
                  图片（{filteredItems.length}{searchQuery.trim() ? ` / ${items.length}` : ''}）
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className="group relative rounded-lg overflow-hidden cursor-pointer transition-all"
                      draggable
                      onDragStart={(e) => handleItemDragStart(e, item.id)}
                      onDragEnd={handleItemDragEnd}
                      onDragOver={handleItemDragOver}
                      onDrop={(e) => handleItemDrop(e, item.id)}
                      style={{
                        background: 'var(--bg-card)',
                        border: draggingItemId === item.id
                          ? '2px dashed var(--accent)'
                          : '1px solid var(--border-color)',
                        opacity: draggingItemId && draggingItemId !== item.id ? 0.6 : 1,
                      }}
                      onClick={() => handleCopyUrl(item.url)}
                      onMouseEnter={(e) => {
                        if (draggingItemId !== item.id) e.currentTarget.style.borderColor = 'var(--accent)';
                      }}
                      onMouseLeave={(e) => {
                        if (draggingItemId !== item.id) e.currentTarget.style.borderColor = 'var(--border-color)';
                      }}
                    >
                      <div className="aspect-square flex items-center justify-center overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                        <img
                          src={item.url}
                          alt={item.filename}
                          className="w-full h-full object-cover"
                          draggable={false}
                          onError={async (e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            // v19: IPC 兜底 — local:// 协议失败时尝试通过 IPC 读取
                            if (item.url.startsWith('local://') && !img.dataset.fallbackTried) {
                              img.dataset.fallbackTried = '1';
                              try {
                                const res = await window.electronAPI?.readAsDataUrl?.(item.url);
                                if (res?.ok && res.dataUrl) {
                                  img.src = res.dataUrl;
                                  return;
                                }
                              } catch {}
                            }
                            img.style.display = 'none';
                            const parent = img.parentElement;
                            if (parent) parent.innerHTML = '<span style="font-size:24px">🖼️</span>';
                          }}
                        />
                      </div>
                      <div className="p-2">
                        <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }} title={item.filename}>{item.filename}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {item.source === 'local' ? '本地' : 'URL'}
                        </div>
                      </div>
                      <div className="absolute top-1 right-1 flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* 改动 v3：图片重命名按钮 */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setRenameItemTarget(item); setRenameItemText(item.filename); }}
                          className="px-1.5 py-0.5 text-xs rounded"
                          style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                          title="重命名"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'item', id: item.id, name: item.filename }); }}
                          className="px-1.5 py-0.5 text-xs rounded"
                          style={{ background: 'var(--bg-hover)', color: 'var(--danger, #e53e3e)' }}
                          title="删除"
                        >
                          🗑️
                        </button>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        点击复制 URL · 拖动换顺序 · 拖到文件夹移动
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

      {/* URL 上传弹窗：每行一个，格式 name:url 或纯 url */}
      {showUrlUploadModal && (
        <Modal onClose={() => setShowUrlUploadModal(false)} title="URL 上传">
          <div className="space-y-3">
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                图片 URL（每行一个，格式：图片名:URL，可批量；省略名字时自动从 URL 推断）
              </label>
              <textarea
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={
                  '图片1:https://example.com/1.png\n' +
                  '图片2:https://example.com/2.png\n' +
                  'https://example.com/3.png    # 不填名字则自动推断'
                }
                autoFocus
                rows={5}
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
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setShowUrlUploadModal(false)} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>取消</button>
            <button onClick={handleUrlUpload} className="px-4 py-1.5 rounded-lg text-sm" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>上传</button>
          </div>
        </Modal>
      )}

      {/* 改动 v3：图片重命名弹窗（DB + 磁盘同步） */}
      {renameItemTarget && (
        <Modal
          onClose={() => { setRenameItemTarget(null); setRenameItemText(''); }}
          title="重命名图片"
        >
          <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
            原文件名：{renameItemTarget.filename}
          </p>
          {(() => {
            // 修复：提取原扩展名并提示保留
            const orig = renameItemTarget.filename
            const dotIdx = orig.lastIndexOf('.')
            if (dotIdx > 0 && dotIdx < orig.length - 1) {
              const ext = orig.slice(dotIdx)
              return (
                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                  扩展名 <code style={{ background: 'var(--bg-hover)', padding: '1px 4px', borderRadius: 3 }}>{ext}</code> 将保留，输入框中包含的后缀会被自动忽略。
                </p>
              )
            }
            return null
          })()}
          <input
            type="text"
            value={renameItemText}
            onChange={(e) => setRenameItemText(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameItem(); }}
          />
          <div className="flex gap-2 justify-end mt-4">
            <button
              onClick={() => { setRenameItemTarget(null); setRenameItemText(''); }}
              className="px-4 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
            >
              取消
            </button>
            <button
              onClick={handleRenameItem}
              disabled={!renameItemText.trim() || renameItemText.trim() === renameItemTarget.filename}
              className="px-4 py-1.5 rounded-lg text-sm disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              确定
            </button>
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
