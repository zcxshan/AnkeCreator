// ============================================================
// CompactImageLibraryPanel：编辑器右栏图片库面板（紧凑版）
// 高内聚：自包含文件夹导航 + 图片网格 + 插入回调
// 低耦合：仅通过 onInsertImage 回调与编辑器通信
//
// 功能：
// - 文件夹导航（进入/返回上级）
// - 图片网格展示，点击插入到编辑区
// - 紧凑布局适配右栏窄宽度
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { ImageLibraryFolder, ImageLibraryItem } from '../../types';
import {
  listImageLibraryFolders,
  listImageLibraryItems,
} from '../../db/imageLibrary';

interface CompactImageLibraryPanelProps {
  onInsertImage: (url: string) => void;
}

interface Breadcrumb {
  id: string | null;
  name: string;
}

export function CompactImageLibraryPanel({ onInsertImage }: CompactImageLibraryPanelProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<Breadcrumb[]>([{ id: null, name: '根目录' }]);
  const [folders, setFolders] = useState<ImageLibraryFolder[]>([]);
  const [items, setItems] = useState<ImageLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // reconcile 修正 items 的 folderId（与 ImageLibraryPage 一致）
      try {
        await window.electronAPI?.reconcileLibrary?.();
      } catch (e) {
        console.warn('[右栏图库] reconcile 失败（继续加载）:', e);
      }

      // 全量同步磁盘 data/images → DB（folders + items 一次性完成）
      // - 递归识别用户直接放入 data/images 的文件夹（含嵌套子目录）为 DB folder
      // - 磁盘有但 DB 没有的图片 → 自动入库为 local item
      // - DB 有但磁盘没有且 source='local' 的图片 → 从 DB 删除（source='url' 不动）
      try {
        const syncRes = await window.electronAPI?.syncDiskToDb?.();
        if (
          syncRes?.ok &&
          (syncRes.foldersCreated > 0 ||
            syncRes.itemsAdded > 0 ||
            syncRes.itemsDeleted > 0)
        ) {
          console.log(
            `[右栏图库] syncDiskToDb: +${syncRes.foldersCreated} folders (reused ${syncRes.foldersReused}), +${syncRes.itemsAdded} items, -${syncRes.itemsDeleted} items`,
          );
        }
      } catch (e) {
        console.warn('[右栏图库] syncDiskToDb 失败（继续加载）:', e);
      }

      // 同步后拉取 folders + items（已含同步结果）
      const [fs, its] = await Promise.all([
        listImageLibraryFolders(currentFolderId),
        listImageLibraryItems(currentFolderId),
      ]);
      setFolders(fs);
      setItems(its);
    } catch {
      // 静默失败
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

  const handleGoUp = () => {
    if (breadcrumb.length > 1) {
      handleNavigateTo(breadcrumb.length - 2);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 面包屑 + 返回上级 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {breadcrumb.length > 1 && (
          <button
            onClick={handleGoUp}
            className="px-1.5 py-0.5 text-xs rounded shrink-0"
            style={{ color: 'var(--text-secondary)' }}
            title="返回上级"
          >
            ←
          </button>
        )}
        <div className="flex items-center gap-0.5 overflow-x-auto text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>
          {breadcrumb.map((b, idx) => (
            <span key={`${b.id ?? 'root'}-${idx}`} className="flex items-center gap-0.5 shrink-0">
              {idx > 0 && <span>/</span>}
              <button
                onClick={() => handleNavigateTo(idx)}
                className="hover:underline truncate max-w-[80px]"
                style={{ color: idx === breadcrumb.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                {b.name}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center h-16 text-xs" style={{ color: 'var(--text-secondary)' }}>
            加载中...
          </div>
        ) : folders.length === 0 && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-16 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="text-xl mb-1">📭</span>
            空
          </div>
        ) : (
          <>
            {/* 文件夹区 */}
            {folders.length > 0 && (
              <div className="mb-2">
                <div className="flex flex-wrap gap-1.5">
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => handleEnterFolder(f)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                      style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    >
                      📁 {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 图片区 */}
            {items.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onInsertImage(item.url)}
                    className="group relative aspect-square rounded overflow-hidden border cursor-pointer transition-all"
                    style={{ background: 'var(--bg-hover)', borderColor: 'var(--border-color)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                    title={`插入：${item.filename}`}
                  >
                    <img
                      src={item.url}
                      alt={item.filename}
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={async (e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        // v23: IPC 兜底 — local:// 协议失败时尝试通过 IPC 读取（与 ImageLibraryPage 保持一致）
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
                        if (parent) parent.innerHTML = '<span style="font-size:16px">🖼️</span>';
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all">
                      <span className="text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                        点击插入
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
