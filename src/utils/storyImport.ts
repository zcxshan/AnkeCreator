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
    // 顶层 data.sections(老格式)与 chapters[].sections(新格式)并存时,
    // 以嵌套式为准,避免跨章数据污染
    // 实测某些导出文件(例如 23MB 的某音乐迷途之星)同时存在两种格式且内容完全一致
    if (Array.isArray(data?.sections) && data.sections.length > 0) {
      console.warn(
        `[storyImport] 检测到顶层 data.sections(${data.sections.length} 条)与 chapters[].sections 并存,` +
        `已忽略顶层以 chapters[].sections 为准。请检查导出端是否需要清理此冗余字段。`,
      );
    }
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

// ============================================================
// 导入归一化
//
// 兼容三种来源：
//   1. 当前应用导出：format = 'anke-creator-export'，实体在 data 下，
//      章节内嵌 sections（导出端 WorksListPage / collectAnkeToWorkJson）；
//   2. 旧版本导出：format = 'anke-creator-story'，实体在 data 下，
//      可能缺 volumes，sections 在顶层；
//   3. 内部 StoryBundle：format = 'anke-creator-story-v2'，实体在根上。
// 另外兼容没有 format 包装的旧文件。
// 归一化后统一为顶层 sections + 自带默认卷章，交给
// ensureDefaultVolumeAndChapter 落库。
// ============================================================

export interface NormalizedVolumeInput {
  id: string;
  title: string;
  order_index: number;
  extras: Record<string, unknown>;
}

export interface NormalizedChapterInput {
  id: string;
  volume_id: string;
  title: string;
  order_index: number;
  extras: Record<string, unknown>;
}

export interface NormalizedSectionInput {
  id: string;
  chapter_id: string;
  title: string;
  content: string | null;
  bbcode: string | null;
  order_index: number;
  extras: Record<string, unknown>;
}

export interface NormalizedStoryInput {
  title: string;
  description: string;
  category: string;
  cover_gradient: string;
  volumes: NormalizedVolumeInput[];
  chapters: NormalizedChapterInput[];
  sections: NormalizedSectionInput[];
  characters: Record<string, unknown>[];
  character_relations: Record<string, unknown>[];
  outlines: Record<string, unknown>[];
  dice_history: Record<string, unknown>[];
  extras: Record<string, unknown>;
}

export type NormalizeImportResult =
  | { ok: true; format: 'story-v2' | 'export' | 'story' | 'legacy'; data: NormalizedStoryInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function orderIndex(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function extrasOf(row: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!known.has(key)) extras[key] = value;
  }
  return extras;
}

const STORY_KEYS = new Set([
  'id', 'title', 'description', 'category', 'cover_gradient', 'status',
  'created_at', 'updated_at', 'word_count', 'stats',
]);
const VOLUME_KEYS = new Set(['id', 'title', 'order_index', 'story_id']);
const CHAPTER_KEYS = new Set(['id', 'title', 'order_index', 'volume_id', 'story_id', 'sections']);
const SECTION_KEYS = new Set([
  'id', 'title', 'content', 'bbcode', 'order_index', 'chapter_id', 'story_id',
  'word_count', 'created_at', 'updated_at', 'status',
]);
const ROOT_KEYS = new Set([
  'format', 'version', 'exportedAt', 'data', 'story', 'title', 'description',
  'category', 'cover_gradient', 'status', 'volumes', 'chapters', 'sections',
  'world_settings', 'characters', 'character_relations', 'outlines',
  'dice_history', 'dice_stats', 'stats', 'extras',
]);
// 旧文件没有 story 包装时 storyRow === root，需要同时排除根级实体字段，
// 避免 volumes/chapters/sections 等大数组被当作未知字段塞进 extras。
const STORY_EXTRAS_KEYS = new Set([...STORY_KEYS, ...ROOT_KEYS]);

export function normalizeImportPayload(raw: unknown, fileName: string): NormalizeImportResult {
  if (!isRecord(raw)) {
    return { ok: false, error: `文件不是有效的安科作品 JSON：${fileName}` };
  }
  let root: Record<string, unknown> = raw;
  let format: 'story-v2' | 'export' | 'story' | 'legacy' = 'legacy';
  if (raw.format === 'anke-creator-story-v2') {
    format = 'story-v2';
  } else if (raw.format === 'anke-creator-export') {
    if (!isRecord(raw.data)) {
      return { ok: false, error: `导出文件缺少 data：${fileName}` };
    }
    root = raw.data;
    format = 'export';
  } else if (raw.format === 'anke-creator-story') {
    if (!isRecord(raw.data)) {
      return { ok: false, error: `旧版文件缺少 data：${fileName}` };
    }
    root = raw.data;
    format = 'story';
  } else if (typeof raw.format === 'string' && raw.format.length > 0) {
    return {
      ok: false,
      error: `不支持的文件格式：${raw.format}，仅支持 anke-creator-export / anke-creator-story / anke-creator-story-v2 或无包装旧文件`,
    };
  } else if (isRecord(raw.data) && ('title' in raw.data || 'story' in raw.data)) {
    root = raw.data;
    format = 'export';
  }
  const storyRow = isRecord(root.story) ? root.story : root;
  const title = text(storyRow.title).trim();
  if (!title) {
    return { ok: false, error: '文件缺少作品标题' };
  }
  const volumesRaw = asRows(root.volumes);
  const chaptersRaw = asRows(root.chapters);
  const sectionsRaw = asRows(root.sections);
  const volumes: NormalizedVolumeInput[] = volumesRaw.map((row, index) => ({
    id: text(row.id, `import-vol-${index + 1}`),
    title: text(row.title, `第${index + 1}卷`),
    order_index: orderIndex(row.order_index, index),
    extras: extrasOf(row, VOLUME_KEYS),
  }));
  if (volumes.length === 0) {
    volumes.push({ id: 'import-vol-1', title: '第一卷', order_index: 0, extras: {} });
  }
  const chapters: NormalizedChapterInput[] = chaptersRaw.map((row, index) => {
    const meta = { ...row };
    delete meta.sections;
    return {
      id: text(row.id, `import-ch-${index + 1}`),
      volume_id: text(row.volume_id, volumes[0].id),
      title: text(row.title, `第${index + 1}章`),
      order_index: orderIndex(row.order_index, index),
      extras: extrasOf(meta, CHAPTER_KEYS),
    };
  });
  if (chapters.length === 0) {
    chapters.push({
      id: 'import-ch-1',
      volume_id: volumes[0].id,
      title: '第一章',
      order_index: 0,
      extras: {},
    });
  }
  const fromTop = sectionsRaw.map((row, index) => ({ row, index, chapterId: text(row.chapter_id, chapters[0].id) }));
  const fromChapters = chaptersRaw.flatMap((chapter, chapterIndex) => {
    const nested = asRows(chapter.sections);
    const chapterId = chapters[chapterIndex]?.id ?? chapters[0].id;
    return nested.map((row, index) => ({ row, index, chapterId }));
  });
  const sourceSections = fromTop.length > 0 ? fromTop : fromChapters;
  const sections: NormalizedSectionInput[] = [];
  for (let flatIndex = 0; flatIndex < sourceSections.length; flatIndex += 1) {
    const { row, index, chapterId } = sourceSections[flatIndex];
    const content = typeof row.content === 'string' ? row.content : null;
    const bbcode = typeof row.bbcode === 'string' ? row.bbcode : null;
    if (!content && !bbcode) {
      return {
        ok: false,
        error: `第 ${flatIndex + 1} 节「${text(row.title, '未命名')}」缺少正文`,
      };
    }
    const knownChapter = chapters.some((chapter) => chapter.id === chapterId);
    sections.push({
      id: text(row.id, `import-sec-${flatIndex + 1}`),
      chapter_id: knownChapter ? chapterId : chapters[0].id,
      title: text(row.title, `第${flatIndex + 1}节`),
      content,
      bbcode,
      order_index: orderIndex(row.order_index, index),
      extras: extrasOf(row, SECTION_KEYS),
    });
  }
  const result: NormalizedStoryInput = {
    title,
    description: text(storyRow.description),
    category: text(storyRow.category, '未分类'),
    cover_gradient: text(storyRow.cover_gradient),
    volumes,
    chapters,
    sections,
    characters: asRows(root.characters),
    character_relations: asRows(root.character_relations),
    outlines: asRows(root.outlines),
    dice_history: asRows(root.dice_history),
    extras: {
      ...extrasOf(storyRow, STORY_EXTRAS_KEYS),
      ...extrasOf(root, ROOT_KEYS),
    },
  };
  return { ok: true, format, data: result };
}

export function parseImportText(rawText: string, fileName: string): NormalizeImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: `文件不是合法的 JSON：${fileName}` };
  }
  // 保留 validateImportFormat 对两种包装格式的既有校验语义
  if (
    isRecord(parsed) &&
    (parsed.format === 'anke-creator-export' || parsed.format === 'anke-creator-story')
  ) {
    const validation = validateImportFormat(parsed);
    if (!validation.valid) {
      return { ok: false, error: validation.error ?? `文件格式不正确：${fileName}` };
    }
  }
  return normalizeImportPayload(parsed, fileName);
}
