// ============================================================
// 图片库类型定义（全局，不绑定 story）
// 存储：<dataRoot>/data/image_library.json
// ============================================================

/** 图片库文件夹 */
export interface ImageLibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  created_at: string;
  updated_at: string;
}

/** 图片库条目（一张图片） */
export interface ImageLibraryItem {
  id: string;
  folderId: string | null;
  /** local://foo.png、local://<folder>/foo.png 或 https://... */
  url: string;
  filename: string;
  source: 'local' | 'url';
  /** 改动 v3：拖动换顺序字段，0-based 整数；缺失时按 created_at 排序 */
  order?: number;
  created_at: string;
}
