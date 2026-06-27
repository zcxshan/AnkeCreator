import { describe, it, expect } from 'vitest';
import { validateImportFormat, ensureDefaultVolumeAndChapter, type EnsureDefaultDeps } from './storyImport';

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
