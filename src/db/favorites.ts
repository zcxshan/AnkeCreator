// ============================================================
// 收藏夹 facade（list / create / rename / delete-if-empty / 关联）
// 桌面端走主进程 IPC；浏览器降级走内存（仅会话内有效）
// ============================================================

import type { Favorite } from '../types';

// —— 内存降级（浏览器/Capacitor 环境） —— //
let memoryFavorites: Favorite[] = [];
let memoryAssociations: { story_id: string; favorite_id: string; added_at: string }[] = [];
let nextId = 1;
function memUuid(): string {
  return `mem-fav-${nextId++}-${Date.now().toString(36)}`;
}

function memNowISO(): string {
  return new Date().toISOString();
}

export async function listFavorites(): Promise<Favorite[]> {
  if (window.dbAPI?.listFavorites) {
    return window.dbAPI.listFavorites();
  }
  return [...memoryFavorites];
}

export async function createFavorite(data: { name: string }): Promise<Favorite> {
  if (!data.name || !data.name.trim()) {
    throw new Error('收藏夹名称不能为空');
  }
  if (window.dbAPI?.createFavorite) {
    return window.dbAPI.createFavorite(data);
  }
  const fav: Favorite = {
    id: memUuid(),
    name: data.name.trim(),
    created_at: memNowISO(),
    updated_at: memNowISO(),
  };
  memoryFavorites.push(fav);
  return fav;
}

export async function renameFavorite(id: string, name: string): Promise<Favorite | null> {
  if (!name || !name.trim()) {
    throw new Error('收藏夹名称不能为空');
  }
  if (window.dbAPI?.renameFavorite) {
    return window.dbAPI.renameFavorite(id, name);
  }
  const fav = memoryFavorites.find((f) => f.id === id);
  if (!fav) return null;
  fav.name = name.trim();
  fav.updated_at = memNowISO();
  return fav;
}

export async function deleteFavoriteIfEmpty(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (window.dbAPI?.deleteFavoriteIfEmpty) {
    return window.dbAPI.deleteFavoriteIfEmpty(id);
  }
  const count = memoryAssociations.filter((a) => a.favorite_id === id).length;
  if (count > 0) {
    return { ok: false, error: `收藏夹内还有 ${count} 个作品，请先移出再删除` };
  }
  const idx = memoryFavorites.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, error: '收藏夹不存在' };
  memoryFavorites.splice(idx, 1);
  return { ok: true };
}

export async function getFavoriteStoryCount(id: string): Promise<number> {
  if (window.dbAPI?.getFavoriteStoryCount) {
    return window.dbAPI.getFavoriteStoryCount(id);
  }
  return memoryAssociations.filter((a) => a.favorite_id === id).length;
}

export async function addStoryToFavorite(
  storyId: string,
  favoriteId: string,
): Promise<boolean> {
  if (window.dbAPI?.addStoryToFavorite) {
    return window.dbAPI.addStoryToFavorite(storyId, favoriteId);
  }
  if (memoryAssociations.some((a) => a.story_id === storyId && a.favorite_id === favoriteId)) {
    return false;
  }
  memoryAssociations.push({
    story_id: storyId,
    favorite_id: favoriteId,
    added_at: memNowISO(),
  });
  return true;
}

export async function removeStoryFromFavorite(
  storyId: string,
  favoriteId: string,
): Promise<boolean> {
  if (window.dbAPI?.removeStoryFromFavorite) {
    return window.dbAPI.removeStoryFromFavorite(storyId, favoriteId);
  }
  const before = memoryAssociations.length;
  memoryAssociations = memoryAssociations.filter(
    (a) => !(a.story_id === storyId && a.favorite_id === favoriteId),
  );
  return memoryAssociations.length < before;
}

export async function getFavoritesForStory(storyId: string): Promise<Favorite[]> {
  if (window.dbAPI?.getFavoritesForStory) {
    return window.dbAPI.getFavoritesForStory(storyId);
  }
  const ids = new Set(
    memoryAssociations.filter((a) => a.story_id === storyId).map((a) => a.favorite_id),
  );
  return memoryFavorites.filter((f) => ids.has(f.id));
}

export async function getStoryIdsInFavorite(favoriteId: string): Promise<string[]> {
  if (window.dbAPI?.getStoryIdsInFavorite) {
    return window.dbAPI.getStoryIdsInFavorite(favoriteId);
  }
  return memoryAssociations.filter((a) => a.favorite_id === favoriteId).map((a) => a.story_id);
}
