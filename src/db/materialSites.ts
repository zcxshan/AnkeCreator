// ============================================================
// 素材网站 facade（list / create / update / delete）
// 桌面端走主进程 IPC；浏览器降级走内存
// ============================================================

import type { MaterialSite, MaterialCategory } from '../types';

// —— 内存降级（浏览器/Capacitor 环境） —— //
let memorySites: MaterialSite[] = [];
let nextId = 1;
function memUuid(): string {
  return `mem-mat-${nextId++}-${Date.now().toString(36)}`;
}
function memNowISO(): string {
  return new Date().toISOString();
}

export async function listMaterialSites(): Promise<MaterialSite[]> {
  if (window.dbAPI?.listMaterialSites) {
    return window.dbAPI.listMaterialSites();
  }
  return [...memorySites];
}

export async function createMaterialSite(data: {
  name: string;
  url: string;
  category: MaterialCategory;
  description?: string;
}): Promise<MaterialSite> {
  if (!data.name?.trim()) throw new Error('名称不能为空');
  if (!data.url?.trim()) throw new Error('URL 不能为空');
  if (window.dbAPI?.createMaterialSite) {
    return window.dbAPI.createMaterialSite(data);
  }
  const site: MaterialSite = {
    id: memUuid(),
    name: data.name.trim(),
    url: data.url.trim(),
    category: data.category,
    description: data.description?.trim() || undefined,
    created_at: memNowISO(),
    updated_at: memNowISO(),
  };
  memorySites.push(site);
  return site;
}

export async function updateMaterialSite(
  id: string,
  patch: Partial<Omit<MaterialSite, 'id' | 'created_at'>>,
): Promise<MaterialSite | null> {
  if (window.dbAPI?.updateMaterialSite) {
    return window.dbAPI.updateMaterialSite(id, patch);
  }
  const s = memorySites.find((x) => x.id === id);
  if (!s) return null;
  Object.assign(s, patch, { updated_at: memNowISO() });
  return s;
}

export async function deleteMaterialSite(id: string): Promise<boolean> {
  if (window.dbAPI?.deleteMaterialSite) {
    return window.dbAPI.deleteMaterialSite(id);
  }
  const idx = memorySites.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  memorySites.splice(idx, 1);
  return true;
}
