export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

const SUPPORTED_FORMATS = ['anke-creator-export', 'anke-creator-story'];

export function validateImportFormat(parsed: any): ValidationResult {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: '文件内容不是有效的 JSON 对象' };
  }
  if (!parsed.format) {
    return { valid: false, error: '缺少 format 字段，可能不是安科作品导出文件' };
  }
  if (!SUPPORTED_FORMATS.includes(parsed.format)) {
    return { valid: false, error: `不支持的格式：${parsed.format}，仅支持 anke-creator-export` };
  }
  if (!parsed.data) {
    return { valid: false, error: '缺少 data 字段' };
  }
  if (!parsed.data.title) {
    return { valid: false, error: '缺少标题字段' };
  }
  const warnings: string[] = [];
  if (!parsed.version) {
    warnings.push('缺少 version 字段，可能影响兼容性');
  }
  if (parsed.data.dice_history !== undefined && !Array.isArray(parsed.data.dice_history)) {
    warnings.push('dice_history 字段存在但不是数组，已忽略骰子记录导入');
  }
  // 结构警告：缺 volumes / chapters 时会在导入端自动兜底（见 ensureDefaultVolumeAndChapter）
  if (!Array.isArray(parsed.data.volumes) || parsed.data.volumes.length === 0) {
    warnings.push('缺少 volumes 字段或为空，将自动创建默认卷"第一卷"');
  }
  if (!Array.isArray(parsed.data.chapters) || parsed.data.chapters.length === 0) {
    warnings.push('缺少 chapters 字段或为空，将自动创建默认章"第一章"');
  }
  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

// ============================================================
// 导入 / 复制作品时的卷章结构兜底
//
// 背景：
//   早期或第三方导出的 JSON 可能缺少 volumes 字段，或 chapter 的 volume_id
//   指向不存在的卷。直接落库会导致 chapter.volume_id = null，进入 UI 的
//   "未归卷" 分组，与用户期望不符。
//
// 本函数负责：
//   1. 创建 volumes；若 JSON 无 volumes，自动创建「第一卷」。
//   2. 创建 chapters + sections；若 JSON 无 chapters，自动创建「第一章」，
//      并把顶层 data.sections（老格式）挂到该章下。
//   3. 任何 chapter 的 volume_id 缺失或无法映射时，归到 fallback 卷
//      （JSON 自带的第一卷，或自动创建的「第一卷」），而非 null。
//
// 设计为纯函数 + 依赖注入（createVolume/Chapter/Section），便于单测。
// ============================================================

export interface EnsureDefaultDeps {
  createVolume: (data: { story_id: string; title: string; order_index?: number }) => Promise<{ id: string }>;
  createChapter: (data: { story_id: string; volume_id: string | null; title: string; order_index?: number }) => Promise<{ id: string }>;
  createSection: (data: { chapter_id: string; title: string; content?: string; order_index?: number }) => Promise<{ id: string }>;
  bulkCreateVolumes?: (rows: Array<{ story_id: string; title: string; order_index?: number; _oldId?: string }>) => Promise<Array<{ id: string; _oldId?: string }>>;
  bulkCreateChapters?: (rows: Array<{ story_id: string; volume_id?: string | null; title: string; order_index?: number; _oldId?: string }>) => Promise<Array<{ id: string; _oldId?: string }>>;
  bulkCreateSections?: (rows: Array<{ chapter_id: string; title: string; content?: string | null; bbcode?: string | null; order_index?: number; _oldId?: string }>) => Promise<Array<{ id: string; _oldId?: string }>>;
}

export interface EnsureDefaultResult {
  volumeIdMap: Record<string, string>;
  chapterIdMap: Record<string, string>;
  sectionIdMap: Record<string, string>;
  fallbackVolumeId: string;
  fallbackChapterId: string;
}

export type EnsureProgressCallback = (current: number, total: number, message: string) => void;

export async function ensureDefaultVolumeAndChapter(
  storyId: string,
  data: any,
  deps: EnsureDefaultDeps,
  onProgress?: EnsureProgressCallback,
): Promise<EnsureDefaultResult> {
  const { createVolume, createChapter, createSection, bulkCreateVolumes, bulkCreateChapters, bulkCreateSections } = deps;

  const volumes: any[] = Array.isArray(data?.volumes) ? data.volumes : [];
  const chapters: any[] = Array.isArray(data?.chapters) ? data.chapters : [];
  const totalSections = chapters.reduce((acc: number, ch: any) => acc + (Array.isArray(ch?.sections) ? ch.sections.length : 0), 0)
    + (Array.isArray(data?.sections) ? data.sections.length : 0);
  const totalCount = (volumes.length || 1) + (chapters.length || 1) + totalSections;
  let step = 0;
  const tick = (msg: string) => { step++; onProgress?.(step, totalCount, msg); };

  // ---- 1. volumes ----
  const volumeIdMap: Record<string, string> = {};
  let fallbackVolumeId: string | null = null;

  if (volumes.length > 0) {
    if (bulkCreateVolumes) {
      const rows = volumes.map((vol) => ({
        story_id: storyId,
        title: vol?.title ?? '未命名卷',
        order_index: vol?.order_index,
        _oldId: vol?.id,
      }));
      tick(`批量创建 ${rows.length} 个卷...`);
      const results = await bulkCreateVolumes(rows);
      const createdVolumes: Array<{ order_index: number; id: string }> = [];
      for (let i = 0; i < volumes.length; i++) {
        const r = results[i];
        if (volumes[i]?.id) volumeIdMap[volumes[i].id] = r.id;
        createdVolumes.push({ order_index: volumes[i]?.order_index ?? 0, id: r.id });
      }
      const sortedCreatedVols = [...createdVolumes].sort((a, b) => a.order_index - b.order_index);
      fallbackVolumeId = sortedCreatedVols[0]?.id || null;
    } else {
      const createdVolumes: Array<{ order_index: number; id: string }> = [];
      for (const vol of volumes) {
        tick(`创建卷：${vol?.title ?? '未命名卷'}...`);
        const newVol = await createVolume({
          story_id: storyId,
          title: vol?.title ?? '未命名卷',
          order_index: vol?.order_index,
        });
        if (vol?.id) volumeIdMap[vol.id] = newVol.id;
        createdVolumes.push({ order_index: vol?.order_index ?? 0, id: newVol.id });
      }
      const sortedCreatedVols = [...createdVolumes].sort((a, b) => a.order_index - b.order_index);
      fallbackVolumeId = sortedCreatedVols[0]?.id || null;
    }
  } else {
    tick('创建默认卷...');
    const defaultVol = await createVolume({
      story_id: storyId,
      title: '第一卷',
      order_index: 0,
    });
    fallbackVolumeId = defaultVol.id;
  }

  // ---- 2. chapters + sections ----
  const chapterIdMap: Record<string, string> = {};
  const sectionIdMap: Record<string, string> = {};
  let fallbackChapterId: string | null = null;

  if (chapters.length > 0) {
    if (bulkCreateChapters && bulkCreateSections) {
      // 收集所有 chapter rows
      const chRows = chapters.map((ch) => ({
        story_id: storyId,
        title: ch?.title ?? '未命名章',
        volume_id: ch?.volume_id ? (volumeIdMap[ch.volume_id] || fallbackVolumeId) : fallbackVolumeId,
        order_index: ch?.order_index,
        _oldId: ch?.id,
      }));
      tick(`批量创建 ${chRows.length} 个章...`);
      const chResults = await bulkCreateChapters(chRows);
      const createdChapters: Array<{ order_index: number; id: string }> = [];
      for (let i = 0; i < chapters.length; i++) {
        const r = chResults[i];
        if (chapters[i]?.id) chapterIdMap[chapters[i].id] = r.id;
        createdChapters.push({ order_index: chapters[i]?.order_index ?? 0, id: r.id });
      }
      const sortedCreatedChs = [...createdChapters].sort((a, b) => a.order_index - b.order_index);
      fallbackChapterId = sortedCreatedChs[0]?.id || null;

      // 收集所有 section rows
      const secRows: Array<{ chapter_id: string; title: string; content?: string | null; order_index?: number; _oldId?: string }> = [];
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const newChapterId = chResults[i].id;
        if (Array.isArray(ch?.sections)) {
          for (const sec of ch.sections) {
            secRows.push({
              chapter_id: newChapterId,
              title: sec?.title ?? '未命名节',
              content: sec?.content,
              order_index: sec?.order_index,
              _oldId: sec?.id,
            });
          }
        }
      }
      if (secRows.length > 0) {
        tick(`批量创建 ${secRows.length} 个节...`);
        const secResults = await bulkCreateSections(secRows);
        for (let i = 0; i < secRows.length; i++) {
          const r = secResults[i];
          if (secRows[i]._oldId) sectionIdMap[secRows[i]._oldId!] = r.id;
        }
      }
    } else {
      // fallback：逐条创建
      const createdChapters: Array<{ order_index: number; id: string }> = [];
      for (const ch of chapters) {
        tick(`创建章：${ch?.title ?? '未命名章'}...`);
        const mappedVolumeId = ch?.volume_id
          ? (volumeIdMap[ch.volume_id] || fallbackVolumeId)
          : fallbackVolumeId;
        const newChapter = await createChapter({
          story_id: storyId,
          title: ch?.title ?? '未命名章',
          volume_id: mappedVolumeId,
          order_index: ch?.order_index,
        });
        if (ch?.id) chapterIdMap[ch.id] = newChapter.id;
        createdChapters.push({ order_index: ch?.order_index ?? 0, id: newChapter.id });
        if (Array.isArray(ch?.sections)) {
          for (const sec of ch.sections) {
            tick(`创建节：${sec?.title ?? '未命名节'}...`);
            const newSection = await createSection({
              chapter_id: newChapter.id,
              title: sec?.title ?? '未命名节',
              content: sec?.content,
              order_index: sec?.order_index,
            });
            if (sec?.id) sectionIdMap[sec.id] = newSection.id;
          }
        }
      }
      const sortedCreatedChs = [...createdChapters].sort((a, b) => a.order_index - b.order_index);
      fallbackChapterId = sortedCreatedChs[0]?.id || null;
    }
  } else {
    tick('创建默认章...');
    const defaultCh = await createChapter({
      story_id: storyId,
      title: '第一章',
      volume_id: fallbackVolumeId,
      order_index: 0,
    });
    fallbackChapterId = defaultCh.id;
    if (Array.isArray(data?.sections)) {
      for (const sec of data.sections) {
        tick(`创建节：${sec?.title ?? '第1节'}...`);
        const newSection = await createSection({
          chapter_id: fallbackChapterId,
          title: sec?.title ?? '第1节',
          content: sec?.content,
          order_index: sec?.order_index,
        });
        if (sec?.id) sectionIdMap[sec.id] = newSection.id;
      }
    }
  }

  return {
    volumeIdMap,
    chapterIdMap,
    sectionIdMap,
    fallbackVolumeId: fallbackVolumeId!,
    fallbackChapterId: fallbackChapterId!,
  };
}
