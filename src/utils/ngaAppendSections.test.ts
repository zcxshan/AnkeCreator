import { describe, expect, it } from 'vitest';
import type { Chapter, SectionMeta, Volume } from '../types';
import {
  buildAppendRows,
  extractSectionsFromCollectJson,
  resolveAppendTarget,
} from './ngaAppendSections';

const now = '2026-01-01T00:00:00.000Z';

function volume(id: string, order_index: number): Volume {
  return { id, story_id: 's1', title: id, order_index, created_at: now, updated_at: now };
}
function chapter(id: string, volume_id: string | null, order_index: number): Chapter {
  return { id, story_id: 's1', volume_id, title: id, order_index, created_at: now, updated_at: now };
}
function section(id: string, chapter_id: string, order_index: number): SectionMeta {
  return { id, chapter_id, title: id, order_index, created_at: now, updated_at: now };
}

describe('extractSectionsFromCollectJson', () => {
  it('按章顺序提取全部节并忽略空内容', () => {
    const json = {
      data: {
        chapters: [
          {
            sections: [
              { title: '第 1-10 楼', content: '<p>a</p>' },
              { title: '空节', content: '   ' },
              { title: '', content: '<p>b</p>' },
            ],
          },
        ],
      },
    };
    const out = extractSectionsFromCollectJson(json);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('第 1-10 楼');
    expect(out[1].title).toBe('第 2 节');
  });

  it('结构异常时返回空数组', () => {
    expect(extractSectionsFromCollectJson(null)).toEqual([]);
    expect(extractSectionsFromCollectJson({})).toEqual([]);
    expect(extractSectionsFromCollectJson({ data: { chapters: 'x' } })).toEqual([]);
  });
});

describe('resolveAppendTarget', () => {
  it('选择最后一个卷中的最后一章，并给出连续 order_index', () => {
    const volumes = [volume('v1', 0), volume('v2', 1)];
    const chapters = [
      chapter('c1', 'v1', 0),
      chapter('c2', 'v2', 0),
      chapter('c3', 'v2', 1),
    ];
    const sections = [
      section('s1', 'c1', 0),
      section('s2', 'c3', 0),
      section('s3', 'c3', 1),
      section('s4', 'c3', 5),
    ];
    expect(resolveAppendTarget(volumes, chapters, sections)).toEqual({
      chapterId: 'c3',
      nextOrder: 6,
    });
  });

  it('没有卷归属的章时退化为全部章的最后一章', () => {
    const chapters = [chapter('c1', null, 0), chapter('c2', null, 1)];
    expect(resolveAppendTarget([], chapters, [section('s1', 'c2', 0)])).toEqual({
      chapterId: 'c2',
      nextOrder: 1,
    });
  });

  it('存在未归卷章时，追加到未归卷区最后（目录末尾），而不是卷内最后一章', () => {
    const volumes = [volume('v1', 0)];
    const chapters = [
      chapter('c1', 'v1', 0),
      chapter('c2', 'v1', 1),
      chapter('c-orphan', null, 2),
    ];
    expect(resolveAppendTarget(volumes, chapters, [section('s1', 'c2', 0)])).toEqual({
      chapterId: 'c-orphan',
      nextOrder: 0,
    });
  });

  it('最后一个卷为空时不选中它，取前一个有章的卷的末章', () => {
    const volumes = [volume('v1', 0), volume('v2', 1)];
    const chapters = [chapter('c1', 'v1', 0), chapter('c2', 'v1', 1)];
    expect(resolveAppendTarget(volumes, chapters, [section('s1', 'c2', 2)])).toEqual({
      chapterId: 'c2',
      nextOrder: 3,
    });
  });

  it('作品没有任何章时返回 null', () => {
    expect(resolveAppendTarget([volume('v1', 0)], [], [])).toBeNull();
  });
});

describe('buildAppendRows', () => {
  it('order_index 从 baseOrder 连续递增', () => {
    const rows = buildAppendRows(
      'c1',
      [
        { title: 'A', content: '<p>a</p>' },
        { title: 'B', content: '<p>b</p>' },
      ],
      3,
    );
    expect(rows.map((r) => r.order_index)).toEqual([3, 4]);
    expect(rows[0]).toMatchObject({ chapter_id: 'c1', title: 'A', content: '<p>a</p>' });
  });
});
