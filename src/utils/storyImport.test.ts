import { describe, it, expect } from 'vitest';
import { validateImportFormat, ensureDefaultVolumeAndChapter, normalizeImportPayload, parseImportText, type EnsureDefaultDeps } from './storyImport';

describe('validateImportFormat', () => {
  it('合法 JSON 返回 valid: true', () => {
    const data = {
      format: 'anke-creator-export',
      version: '1.0',
      data: {
        title: '测试',
        volumes: [{ id: 'v1', title: '第一卷', order_index: 0 }],
        chapters: [{ id: 'c1', title: '第一章', volume_id: 'v1', order_index: 0 }],
      },
    };
    const result = validateImportFormat(data);
    expect(result.valid).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  it('缺 format 字段返回错误', () => {
    const result = validateImportFormat({ version: '1.0', data: {} });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('format');
  });

  it('format 不是 anke-creator-export 返回错误', () => {
    const result = validateImportFormat({ format: 'other-format', version: '1.0', data: {} });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('格式');
  });

  it('缺 data 字段返回错误', () => {
    const result = validateImportFormat({ format: 'anke-creator-export', version: '1.0' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('data');
  });

  it('data 无 title 返回错误', () => {
    const result = validateImportFormat({ format: 'anke-creator-export', version: '1.0', data: { chapters: [] } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('标题');
  });

  it('兼容旧格式 anke-creator-story', () => {
    const data = {
      format: 'anke-creator-story',
      version: '1.0',
      data: { title: '旧格式作品', chapters: [] },
    };
    const result = validateImportFormat(data);
    expect(result.valid).toBe(true);
  });

  it('缺 volumes 时返回结构警告（仍 valid: true）', () => {
    const data = {
      format: 'anke-creator-export',
      version: '1.0',
      data: { title: 'x', chapters: [{ id: 'c1', title: 'ch', volume_id: null }] },
    };
    const result = validateImportFormat(data);
    expect(result.valid).toBe(true);
    expect(result.warnings?.some((w) => w.includes('volumes') && w.includes('第一卷'))).toBe(true);
  });

  it('volumes 为空数组时返回结构警告', () => {
    const data = {
      format: 'anke-creator-export',
      version: '1.0',
      data: { title: 'x', volumes: [], chapters: [{ id: 'c1', title: 'ch', volume_id: null }] },
    };
    const result = validateImportFormat(data);
    expect(result.warnings?.some((w) => w.includes('volumes'))).toBe(true);
  });

  it('缺 chapters 时返回结构警告', () => {
    const data = {
      format: 'anke-creator-export',
      version: '1.0',
      data: {
        title: 'x',
        volumes: [{ id: 'v1', title: '第一卷', order_index: 0 }],
      },
    };
    const result = validateImportFormat(data);
    expect(result.warnings?.some((w) => w.includes('chapters') && w.includes('第一章'))).toBe(true);
  });
});

// ============================================================
// ensureDefaultVolumeAndChapter 单测
// ============================================================

function makeMockDeps() {
  const calls = {
    volumes: [] as Array<{ story_id: string; title: string; order_index?: number; id: string }>,
    chapters: [] as Array<{ story_id: string; volume_id: string | null; title: string; order_index?: number; id: string }>,
    sections: [] as Array<{ chapter_id: string; title: string; content?: string; order_index?: number; id: string }>,
  };
  let volN = 0, chN = 0, secN = 0;
  const deps: EnsureDefaultDeps = {
    createVolume: async (d) => {
      const id = `vol-${++volN}`;
      calls.volumes.push({ ...d, id });
      return { id };
    },
    createChapter: async (d) => {
      const id = `ch-${++chN}`;
      calls.chapters.push({ ...d, id });
      return { id };
    },
    createSection: async (d) => {
      const id = `sec-${++secN}`;
      calls.sections.push({ ...d, id });
      return { id };
    },
  };
  return { deps, calls };
}

describe('ensureDefaultVolumeAndChapter', () => {
  it('JSON 无 volumes 字段时自动创建「第一卷」，chapter 归到其下（不产生未归卷）', async () => {
    const { deps, calls } = makeMockDeps();
    const data = {
      title: '测试',
      chapters: [
        {
          id: 'ch-old-1',
          title: '第一章',
          volume_id: null,
          sections: [{ id: 's1', title: '第1节', content: 'a' }],
        },
      ],
    };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.volumes).toHaveLength(1);
    expect(calls.volumes[0].title).toBe('第一卷');
    expect(calls.chapters).toHaveLength(1);
    expect(calls.chapters[0].volume_id).toBe(result.fallbackVolumeId);
    expect(calls.chapters[0].volume_id).not.toBeNull();
    expect(result.fallbackVolumeId).toBe('vol-1');
    expect(result.chapterIdMap['ch-old-1']).toBe('ch-1');
    expect(result.sectionIdMap['s1']).toBe('sec-1');
  });

  it('volumes 为空数组时也自动创建「第一卷」', async () => {
    const { deps, calls } = makeMockDeps();
    const data = {
      title: '测试',
      volumes: [],
      chapters: [{ id: 'c1', title: 'ch', volume_id: 'vol-x' }],
    };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.volumes).toHaveLength(1);
    expect(calls.volumes[0].title).toBe('第一卷');
    expect(calls.chapters[0].volume_id).toBe(result.fallbackVolumeId);
    expect(calls.chapters[0].volume_id).not.toBeNull();
  });

  it('chapter.volume_id 指向不存在的卷时，归到 JSON 自带的第一卷下', async () => {
    const { deps, calls } = makeMockDeps();
    const data = {
      title: '测试',
      volumes: [
        { id: 'vol-a', title: '第一卷', order_index: 0 },
        { id: 'vol-b', title: '第二卷', order_index: 1 },
      ],
      chapters: [
        { id: 'c1', title: '正常章', volume_id: 'vol-a' },
        { id: 'c2', title: '孤儿章', volume_id: 'vol-not-exist' },
      ],
    };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.volumes).toHaveLength(2);
    // fallback 应是 vol-a（order_index 最小）
    expect(result.fallbackVolumeId).toBe(result.volumeIdMap['vol-a']);
    // c2 应归到 fallback 而非 null
    const c2 = calls.chapters.find((c) => c.title === '孤儿章');
    expect(c2!.volume_id).toBe(result.fallbackVolumeId);
    // 所有人 chapter volume_id 非 null
    expect(calls.chapters.every((c) => c.volume_id !== null)).toBe(true);
  });

  it('chapter.volume_id 为 null 或 undefined 时归到 fallback 卷', async () => {
    const { deps, calls } = makeMockDeps();
    const data = {
      title: '测试',
      volumes: [{ id: 'v1', title: '第一卷', order_index: 0 }],
      chapters: [
        { id: 'c1', title: '正常章', volume_id: 'v1' },
        { id: 'c2', title: 'null卷章', volume_id: null },
        { id: 'c3', title: '缺卷字段章' },
      ],
    };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.chapters).toHaveLength(3);
    expect(calls.chapters.every((c) => c.volume_id === result.fallbackVolumeId)).toBe(true);
    expect(calls.chapters.every((c) => c.volume_id !== null)).toBe(true);
  });

  it('JSON 无 chapters 但有顶层 sections 时，自动建「第一章」并挂载 sections', async () => {
    const { deps, calls } = makeMockDeps();
    const data = {
      title: '测试',
      volumes: [{ id: 'v1', title: '第一卷', order_index: 0 }],
      sections: [
        { id: 'top-s1', title: '第1节', content: 'x' },
        { id: 'top-s2', title: '第2节', content: 'y' },
      ],
    };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.chapters).toHaveLength(1);
    expect(calls.chapters[0].title).toBe('第一章');
    expect(calls.chapters[0].volume_id).toBe(result.fallbackVolumeId);
    expect(calls.sections).toHaveLength(2);
    expect(calls.sections.every((s) => s.chapter_id === result.fallbackChapterId)).toBe(true);
    expect(result.sectionIdMap['top-s1']).toBe('sec-1');
    expect(result.sectionIdMap['top-s2']).toBe('sec-2');
  });

  it('JSON 既无 volumes 也无 chapters 时，自动建第一卷 + 第一章', async () => {
    const { deps, calls } = makeMockDeps();
    const data = { title: '空作品' };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.volumes).toHaveLength(1);
    expect(calls.volumes[0].title).toBe('第一卷');
    expect(calls.chapters).toHaveLength(1);
    expect(calls.chapters[0].title).toBe('第一章');
    expect(calls.chapters[0].volume_id).toBe(result.fallbackVolumeId);
    expect(result.fallbackVolumeId).toBe('vol-1');
    expect(result.fallbackChapterId).toBe('ch-1');
  });

  it('收集安科标准 JSON（vol-default）正常工作（回归测试）', async () => {
    const { deps, calls } = makeMockDeps();
    const data = {
      title: '安科-12345',
      volumes: [{ id: 'vol-default', title: '第一卷', order_index: 0 }],
      chapters: [
        {
          title: '第一章',
          volume_id: 'vol-default',
          order_index: 0,
          sections: [
            { title: '第 1 楼', order_index: 0, content: '<p>内容</p>' },
          ],
        },
      ],
    };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.volumes).toHaveLength(1);
    expect(calls.volumes[0].title).toBe('第一卷');
    expect(calls.chapters).toHaveLength(1);
    expect(calls.chapters[0].title).toBe('第一章');
    expect(calls.chapters[0].volume_id).toBe(result.volumeIdMap['vol-default']);
    expect(calls.chapters[0].volume_id).not.toBeNull();
    expect(calls.sections).toHaveLength(1);
    expect(calls.sections[0].title).toBe('第 1 楼');
    expect(calls.chapters.every((c) => c.volume_id !== null)).toBe(true);
  });

  it('多卷多章 JSON：保留原结构，fallback 取 order_index 最小的卷', async () => {
    const { deps, calls } = makeMockDeps();
    const data = {
      title: '多卷作品',
      volumes: [
        { id: 'v2', title: '第二卷', order_index: 1 },
        { id: 'v1', title: '第一卷', order_index: 0 },
      ],
      chapters: [
        { id: 'c1', title: '第一章', volume_id: 'v1', order_index: 0 },
        { id: 'c2', title: '第二章', volume_id: 'v2', order_index: 1 },
      ],
    };
    const result = await ensureDefaultVolumeAndChapter('story-1', data, deps);

    expect(calls.volumes).toHaveLength(2);
    // fallback 应是 v1（order_index=0）
    expect(result.fallbackVolumeId).toBe(result.volumeIdMap['v1']);
    // 各 chapter 归到各自原本的卷
    const c1 = calls.chapters.find((c) => c.title === '第一章');
    const c2 = calls.chapters.find((c) => c.title === '第二章');
    expect(c1!.volume_id).toBe(result.volumeIdMap['v1']);
    expect(c2!.volume_id).toBe(result.volumeIdMap['v2']);
  });
});

// ============================================================
// normalizeImportPayload / parseImportText 单测
// ============================================================

// fixture a：收集安科（ankeCollect.ts:314-405）的输出结构
const collectorPayload = {
  format: 'anke-creator-export',
  version: '1.1',
  exportedAt: '2026-11-05T00:00:00.000Z',
  appVersion: '0.1.0',
  data: {
    title: '收集作品',
    description: '源：NGA tid=123，第 1-10 楼',
    category: '安科',
    volumes: [{ id: 'vol-default', title: '第一卷', order_index: 0 }],
    chapters: [
      {
        title: '第一章',
        volume_id: 'vol-default',
        order_index: 0,
        sections: [{ title: '第1-10楼', order_index: 0, content: '<p>收集正文</p>' }],
      },
    ],
    characters: [],
    world_settings: [],
    outlines: [],
    character_relations: [],
    dice_history: [],
  },
};

// fixture b：旧版 anke-creator-story（data 包裹 + 顶层 sections + 无 volumes）
const legacyStoryPayload = {
  format: 'anke-creator-story',
  version: '1.0',
  data: {
    title: '旧版作品',
    chapters: [{ id: 'c1', title: '第一章', volume_id: 'v1', order_index: 0 }],
    sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>旧版正文</p>' }],
  },
};

// fixture c：当前 WorksListPage.tsx:323-334 的导出结构
const worksListPagePayload = {
  format: 'anke-creator-export',
  version: '1.1',
  exportedAt: '2026-11-05T00:00:00.000Z',
  appVersion: '0.1.0',
  data: {
    id: 'story-1',
    title: '页面导出作品',
    description: '页面导出',
    category: '测试',
    volumes: [{ id: 'v1', story_id: 'story-1', title: '第一卷', order_index: 0 }],
    chapters: [
      {
        id: 'c1',
        story_id: 'story-1',
        volume_id: 'v1',
        title: '第一章',
        order_index: 0,
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', order_index: 0, content: '<p>页面正文</p>' }],
      },
    ],
    world_settings: [],
    characters: [],
    character_relations: [{ id: 'r1', source_id: 'a', target_id: 'b', relation: '朋友' }],
    outlines: [],
    dice_history: [{ id: 'd1', result: '1d100=42' }],
  },
};

describe('normalizeImportPayload', () => {
  it('接受内部 StoryBundle（anke-creator-story-v2）根格式', () => {
    const result = normalizeImportPayload(
      {
        format: 'anke-creator-story-v2',
        story: { title: '根格式' },
        volumes: [{ id: 'v1', title: '第一卷' }],
        chapters: [{ id: 'c1', volume_id: 'v1', title: '第一章' }],
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>正文</p>' }],
      },
      'story.json',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('story-v2');
    expect(result.data.title).toBe('根格式');
    expect(result.data.sections[0].content).toBe('<p>正文</p>');
  });

  it('接受收集安科输出（anke-creator-export，章内嵌 sections）', () => {
    const result = normalizeImportPayload(collectorPayload, 'collector.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('export');
    expect(result.data.title).toBe('收集作品');
    expect(result.data.volumes).toHaveLength(1);
    expect(result.data.chapters).toHaveLength(1);
    expect(result.data.chapters[0].id).toBe('import-ch-1');
    expect(result.data.sections).toHaveLength(1);
    expect(result.data.sections[0].chapter_id).toBe('import-ch-1');
    expect(result.data.sections[0].content).toBe('<p>收集正文</p>');
    expect(validateImportFormat(collectorPayload).valid).toBe(true);
  });

  it('接受旧版 anke-creator-story（data 包裹 + 顶层 sections）', () => {
    const result = normalizeImportPayload(legacyStoryPayload, 'legacy.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('story');
    expect(result.data.volumes[0].title).toBe('第一卷');
    expect(result.data.sections[0].chapter_id).toBe('c1');
    expect(result.data.sections[0].content).toBe('<p>旧版正文</p>');
    expect(validateImportFormat(legacyStoryPayload).valid).toBe(true);
  });

  it('接受当前 WorksListPage 导出结构', () => {
    const result = normalizeImportPayload(worksListPagePayload, 'page-export.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('export');
    expect(result.data.title).toBe('页面导出作品');
    expect(result.data.sections[0].content).toBe('<p>页面正文</p>');
    expect(result.data.character_relations).toHaveLength(1);
    expect(result.data.dice_history).toHaveLength(1);
  });

  it('接受没有 format 的旧文件', () => {
    const result = normalizeImportPayload(
      {
        title: '旧文件',
        story: { id: 'story-1', title: '旧文件' },
        volumes: [{ id: 'v1', title: '第一卷' }],
        chapters: [{ id: 'c1', volume_id: 'v1', title: '第一章' }],
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>旧正文</p>' }],
      },
      'old.json',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe('legacy');
    expect(result.data.title).toBe('旧文件');
  });

  it('没有卷或章时补默认卷章', () => {
    const result = normalizeImportPayload(
      { title: '补默认', sections: [{ title: '第1节', content: '<p>正文</p>' }] },
      'minimal.json',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.volumes).toHaveLength(1);
    expect(result.data.chapters).toHaveLength(1);
    expect(result.data.sections[0].chapter_id).toBe(result.data.chapters[0].id);
    expect(result.data.sections[0].order_index).toBe(0);
  });

  it('未知字段保留到 extras', () => {
    const result = normalizeImportPayload(
      {
        title: '保留字段',
        cover_gradient: 'linear-gradient(#fff, #000)',
        author_note: '作者备注',
        sections: [{ title: '第1节', content: '<p>正文</p>', layout_hint: 'wide' }],
      },
      'extra.json',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cover_gradient).toBe('linear-gradient(#fff, #000)');
    expect(result.data.extras).toMatchObject({ author_note: '作者备注' });
    expect(result.data.sections[0].extras.layout_hint).toBe('wide');
  });

  it('缺正文时报中文错误', () => {
    const result = normalizeImportPayload(
      { title: '坏节', sections: [{ title: '空节' }] },
      'bad-section.json',
    );
    expect(result).toEqual({ ok: false, error: '第 1 节「空节」缺少正文' });
  });

  it('拒绝未知 format', () => {
    const result = normalizeImportPayload(
      { format: 'anke-creator-export-v9', data: { title: '未知格式' } },
      'unknown.json',
    );
    expect(result).toEqual({
      ok: false,
      error: '不支持的文件格式：anke-creator-export-v9，仅支持 anke-creator-export / anke-creator-story / anke-creator-story-v2 或无包装旧文件',
    });
  });

  it('损坏 JSON 在 parseImportText 阶段报中文错误', () => {
    expect(parseImportText('{broken', 'broken.json')).toEqual({
      ok: false,
      error: '文件不是合法的 JSON：broken.json',
    });
  });
});
