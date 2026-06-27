import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSectionHtml, formatPostTime, splitPostsIntoSections, collectAnkeToWorkJson, stripImageBlocks, DEFAULT_FORMAT_SETTINGS, type FormatSettings } from './ankeCollect';
import type { RawPost } from './ngaCrawler';

describe('formatPostTime', () => {
  it('格式化秒级时间戳为 YYYY-MM-DD HH:mm', () => {
    // 2024-06-24 12:34:00 UTC+8
    const ts = Math.floor(new Date(2024, 5, 24, 12, 34, 0).getTime() / 1000);
    expect(formatPostTime(ts)).toBe('2024-06-24 12:34');
  });
  it('0 或负数返回空字符串', () => {
    expect(formatPostTime(0)).toBe('');
    expect(formatPostTime(-1)).toBe('');
  });
  it('NaN 返回空字符串', () => {
    expect(formatPostTime(NaN)).toBe('');
  });
  it('单数月日补零', () => {
    const ts = Math.floor(new Date(2024, 0, 5, 9, 0, 0).getTime() / 1000);
    expect(formatPostTime(ts)).toBe('2024-01-05 09:00');
  });
});

describe('buildSectionHtml - 时间戳', () => {
  it('小节标题包含格式化的时间', () => {
    const ts = Math.floor(new Date(2024, 5, 24, 12, 34, 0).getTime() / 1000);
    const html = buildSectionHtml([{
      floor: 3, author: 'Alice', content: 'hi', time: ts,
    }]);
    expect(html).toContain('2024-06-24 12:34');
    expect(html).toContain('—— 3 楼');
  });
  it('没有时间戳时不显示时间字段（不报错）', () => {
    const html = buildSectionHtml([{
      floor: 3, author: 'Alice', content: 'hi',
    }]);
    expect(html).toContain('—— 3 楼');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('·  ·');
  });
});

describe('splitPostsIntoSections', () => {
  const posts: RawPost[] = [
    { floor: 1, author: 'A', content: 'p1', pid: '1' },
    { floor: 2, author: 'A', content: 'p2', pid: '2' },
    { floor: 3, author: 'A', content: 'p3', pid: '3' },
    { floor: 4, author: 'A', content: 'p4', pid: '4' },
    { floor: 5, author: 'A', content: 'p5', pid: '5' },
  ];

  it('mode=single 整段一节', () => {
    const sections = splitPostsIntoSections(posts, 'single');
    expect(sections).toHaveLength(1);
    expect(sections[0].posts).toHaveLength(5);
  });

  it('mode=one-per-floor 每楼一节', () => {
    const sections = splitPostsIntoSections(posts, 'one-per-floor');
    expect(sections).toHaveLength(5);
    expect(sections[0].posts).toHaveLength(1);
    expect(sections[4].posts[0].floor).toBe(5);
  });

  it('mode=every-n 每 2 楼一节', () => {
    const sections = splitPostsIntoSections(posts, 'every-n', 2);
    expect(sections).toHaveLength(3);  // [1,2] [3,4] [5]
    expect(sections[0].posts.map((p) => p.floor)).toEqual([1, 2]);
    expect(sections[1].posts.map((p) => p.floor)).toEqual([3, 4]);
    expect(sections[2].posts.map((p) => p.floor)).toEqual([5]);
  });

  it('mode=every-n N=1 退化为每楼一节', () => {
    const sections = splitPostsIntoSections(posts, 'every-n', 1);
    expect(sections).toHaveLength(5);
  });

  it('空 posts 返回空数组', () => {
    expect(splitPostsIntoSections([], 'single')).toEqual([]);
    expect(splitPostsIntoSections([], 'every-n', 5)).toEqual([]);
  });

  it('每个 section 包含 content (HTML) 但不含 bbcode 字段', () => {
    const sections = splitPostsIntoSections(posts, 'one-per-floor');
    expect(sections[0].content).toBeDefined();
    expect(sections[0].bbcode).toBeUndefined();
    expect(sections[0].content).toContain('<h4');
  });
});

describe('collectAnkeToWorkJson - 导出格式与导入兼容', () => {
  beforeEach(() => {
    // 注入 window.electronAPI mock
    (global as any).window = {
      electronAPI: {
        collectNga: vi.fn().mockResolvedValue({
          ok: true,
          items: [
            { floor: 1, author: 'Alice', content: 'p1', time: 1719201240, pid: '1' },
            { floor: 2, author: 'Bob', content: 'p2', time: 1719201300, pid: '2' },
            { floor: 3, author: 'Alice', content: 'p3', time: 1719201360, pid: '3' },
          ],
        }),
      },
    };
  });
  afterEach(() => {
    delete (global as any).window;
  });

  it('导出的 JSON 格式与 WorksListPage import 兼容', async () => {
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=1234',
      startFloor: 1,
      endFloor: 3,
      workTitle: '测试作品',
      sectionMode: 'every-n',
      floorsPerSection: 2,
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    // 顶层格式
    expect(exported.format).toBe('anke-creator-export');
    expect(exported.version).toBe('1.1');
    // data 字段
    expect(exported.data.title).toBe('测试作品');
    expect(exported.data.category).toBe('安科');
    // 默认带「第一卷」volume，chapter 关联到该 volume（避免导入后落到"未归卷"）
    expect(Array.isArray(exported.data.volumes)).toBe(true);
    expect(exported.data.volumes.length).toBe(1);
    expect(exported.data.volumes[0].title).toBe('第一卷');
    expect(exported.data.volumes[0].order_index).toBe(0);
    expect(typeof exported.data.volumes[0].id).toBe('string');
    expect(exported.data.volumes[0].id.length).toBeGreaterThan(0);
    // chapter 关联到 volume，标题为「第一章」（不再用作品标题当 chapter 标题）
    expect(exported.data.chapters[0].volume_id).toBe(exported.data.volumes[0].id);
    expect(exported.data.chapters[0].title).toBe('第一章');
    // 章节含 sections
    expect(Array.isArray(exported.data.chapters[0].sections)).toBe(true);
    // 模拟 import 端的 unwrap：format === 'anke-creator-export' 时取 data
    const data = exported.format === 'anke-creator-export' ? exported.data : exported;
    expect(data.title).toBe('测试作品');
    // sections 标题用 "第 X-Y 楼"（不是内容里）
    expect(data.chapters[0].sections[0].title).toBe('第 1-2 楼');
    expect(data.chapters[0].sections[0].title).not.toBe('第 1-10 楼'); // 3 楼分 2 节：1-2, 3
  });

  it('导出的 sections 只含 title / order_index / content，不含 bbcode', async () => {
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=1234',
      startFloor: 1,
      endFloor: 2,
      workTitle: 'BBCodeTest',
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    const data = exported.format === 'anke-creator-export' ? exported.data : exported;
    const sec = data.chapters[0].sections[0];
    // section 只保留 title / order_index / content 三个字段
    expect(Object.keys(sec).sort()).toEqual(['content', 'order_index', 'title']);
    expect(sec.content).toBeDefined();
    expect(sec.content).toContain('<h4');
    // 不含 bbcode 字段
    expect(sec.bbcode).toBeUndefined();
  });

  it('空标题时回退为 "安科-{tid}"', async () => {
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=9999',
      startFloor: 1,
      endFloor: 1,
      workTitle: '',
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    expect(exported.data.title).toBe('安科-9999');
  });

  it('URL 含 &authorid=XXX 时直接使用主进程返回的 items（不再本地 uid 过滤）', async () => {
    const collectNgaMock = vi.fn().mockResolvedValue({
      ok: true,
      items: [
        // 主进程已按 authorid 抓取"只看该作者"页面，返回的 items 已是该作者回复
        { floor: 1, author: 'Alice', uid: '100', content: 'p1', time: 1719201240, pid: '1' },
        { floor: 3, author: 'Alice', uid: '100', content: 'p3', time: 1719201360, pid: '3' },
      ],
    });
    (global as any).window.electronAPI = { collectNga: collectNgaMock };
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=1234&authorid=100',
      startFloor: 1,
      endFloor: 2,
      workTitle: '只看Alice',
    });
    expect(result.ok).toBe(true);
    // collectNga 被调用时 payload 含 authorid
    expect(collectNgaMock).toHaveBeenCalledTimes(1);
    const callPayload = collectNgaMock.mock.calls[0][0];
    expect(callPayload.authorid).toBe('100');
    const exported = result.jsonData as any;
    // 主进程返回的 items 全部保留（不再本地 uid 过滤）
    const allContent = JSON.stringify(exported.data.chapters[0].sections);
    expect(allContent).toContain('p1');
    expect(allContent).toContain('p3');
  });

  it('authorid 模式下 startFloor/endFloor 透传给主进程（渲染进程不裁剪）', async () => {
    const collectNgaMock = vi.fn().mockResolvedValue({
      ok: true,
      items: [
        { floor: 1, author: 'Alice', uid: '100', content: 'p1', time: 1719201240, pid: '1' },
        { floor: 3, author: 'Alice', uid: '100', content: 'p3', time: 1719201360, pid: '3' },
        { floor: 5, author: 'Alice', uid: '100', content: 'p5', time: 1719201420, pid: '5' },
      ],
    });
    (global as any).window.electronAPI = { collectNga: collectNgaMock };
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=1234',
      startFloor: 1,
      endFloor: 2,
      workTitle: 'authorid透传',
      authorid: '100',
    });
    expect(result.ok).toBe(true);
    // 透传给主进程的 payload
    expect(collectNgaMock).toHaveBeenCalledTimes(1);
    const callPayload = collectNgaMock.mock.calls[0][0];
    expect(callPayload.authorid).toBe('100');
    expect(callPayload.startFloor).toBe(1);
    expect(callPayload.endFloor).toBe(2);
    // 渲染进程不裁剪，主进程返回的 3 条全部保留
    const exported = result.jsonData as any;
    const allContent = JSON.stringify(exported.data.chapters[0].sections);
    expect(allContent).toContain('p1');
    expect(allContent).toContain('p3');
    expect(allContent).toContain('p5');
  });
});

describe('collectAnkeToWorkJson - 失败重试', () => {
  beforeEach(() => {
    (global as any).window = {
      electronAPI: {
        collectNga: vi.fn(),
      },
    };
  });
  afterEach(() => {
    delete (global as any).window;
  });

  // withRetry 已移除：后端 ngaCrawler 已对单页自动重试 3 次，
  // ankeCollect 层不再外层重试（避免重复爬全部页面且丢失 failedPages）
  it('collectNga 抛错时直接传播错误（不再外层重试）', async () => {
    (global as any).window.electronAPI.collectNga.mockRejectedValueOnce(
      new Error('网络错误'),
    );

    await expect(
      collectAnkeToWorkJson({
        url: 'https://nga.178.com/read.php?tid=1234',
        startFloor: 1,
        endFloor: 1,
        workTitle: '错误传播测试',
      }),
    ).rejects.toThrow('网络错误');

    // 只调用 1 次（后端负责单页重试，外层不再重试整个 collectNga）
    expect((global as any).window.electronAPI.collectNga).toHaveBeenCalledTimes(1);
  });

  it('collectNga 返回 ok:false 时透传错误（不再外层重试）', async () => {
    (global as any).window.electronAPI.collectNga.mockResolvedValueOnce({
      ok: false,
      error: '抓取失败：Cookie 过期',
    });

    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=1234',
      startFloor: 1,
      endFloor: 1,
      workTitle: 'ok:false 测试',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('抓取失败：Cookie 过期');
    // 只调用 1 次
    expect((global as any).window.electronAPI.collectNga).toHaveBeenCalledTimes(1);
  });
});

describe('收集安科 JSON 格式重构（Phase B + C）', () => {
  // ---- 共享 mock ----
  function setupWindowMock(items: any[]) {
    (global as any).window = {
      electronAPI: {
        collectNga: vi.fn().mockResolvedValue({
          ok: true,
          items,
        }),
      },
    };
  }
  afterEach(() => {
    delete (global as any).window;
  });

  // ---- Phase B: stripImageBlocks ----
  it('stripImageBlocks 移除所有 image-block 元素', () => {
    const html = '<p>文本</p><div data-type="image-block">img1</div><p>更多文本</p><div data-type="image-block">img2</div>';
    const result = stripImageBlocks(html);
    expect(result).not.toContain('image-block');
    expect(result).toContain('文本');
    expect(result).toContain('更多文本');
  });

  it('stripImageBlocks 保留 quote-block 等其它 data-type 元素', () => {
    const html = '<blockquote data-type="quote-block">引用</blockquote><div data-type="image-block"><img src="x"></div>';
    const result = stripImageBlocks(html);
    expect(result).toContain('quote-block');
    expect(result).toContain('引用');
    expect(result).not.toContain('image-block');
  });

  it('stripImageBlocks 对空字符串和非字符串安全', () => {
    expect(stripImageBlocks('')).toBe('');
    // 非字符串直接返回（避免 TypeError）
    expect(() => stripImageBlocks(undefined as unknown as string)).not.toThrow();
  });

  // ---- Phase B: 升级 version + dice_history + image-block 防御 ----
  it('collectAnkeToWorkJson 输出 version 1.1', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
      { floor: 2, author: 'B', content: 'p2', time: 1719201300, pid: '2' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 2,
      workTitle: '版本测试',
    });
    expect(result.ok).toBe(true);
    expect((result.jsonData as any).version).toBe('1.1');
  });

  it('collectAnkeToWorkJson 输出 dice_history 为空数组', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 1,
      workTitle: '骰点测试',
    });
    expect(result.ok).toBe(true);
    expect((result.jsonData as any).data.dice_history).toEqual([]);
  });

  it('collectAnkeToWorkJson 顶层 data 含 volumes/characters/world_settings/outlines/character_relations', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 1,
      workTitle: '完整性测试',
    });
    expect(result.ok).toBe(true);
    const data = (result.jsonData as any).data;
    // volumes 默认含一项「第一卷」（不再为空，避免导入后落到"未归卷"）
    expect(data.volumes).toEqual([
      { id: 'vol-default', title: '第一卷', order_index: 0 },
    ]);
    expect(data.characters).toEqual([]);
    expect(data.world_settings).toEqual([]);
    expect(data.outlines).toEqual([]);
    expect(data.character_relations).toEqual([]);
  });

  it('collectAnkeToWorkJson section.content 保留 image-block 和原帖图片 URL', async () => {
    // 模拟带 [img] 的 BBCode 帖子（bbcodeToHtml 会生成 image-block）
    setupWindowMock([
      { floor: 1, author: 'A', content: '前文 [img]https://x.com/a.png[/img] 后文', time: 1719201240, pid: '1' },
      { floor: 2, author: 'B', content: '更多 [img]https://x.com/b.png[/img] 内容', time: 1719201300, pid: '2' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 2,
      workTitle: 'image-block 保留',
      sectionMode: 'every-n',
      floorsPerSection: 1,
    });
    expect(result.ok).toBe(true);
    const sections = (result.jsonData as any).data.chapters[0].sections;
    expect(sections).toHaveLength(2);
    // section 1 保留 image-block 和原帖图片 URL
    expect(sections[0].content).toContain('image-block');
    expect(sections[0].content).toContain('https://x.com/a.png');
    // section 2 同样保留
    expect(sections[1].content).toContain('image-block');
    expect(sections[1].content).toContain('https://x.com/b.png');
  });

  // ---- Phase C: one-per-floor 不嵌 anke-section 包装 ----
  it('collectAnkeToWorkJson one-per-floor 模式：每楼一节，且不嵌 anke-section 包装', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: '一 [b]楼[/b]', time: 1719201240, pid: '1' },
      { floor: 2, author: 'B', content: '[url=https://x.com]二楼[/url]', time: 1719201300, pid: '2' },
      { floor: 3, author: 'C', content: '三楼 [i]斜体[/i]', time: 1719201360, pid: '3' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 3,
      workTitle: '每楼一节',
      sectionMode: 'one-per-floor',
    });
    expect(result.ok).toBe(true);
    const sections = (result.jsonData as any).data.chapters[0].sections;
    expect(sections).toHaveLength(3);
    for (const sec of sections) {
      // 单楼 section 不应嵌 <div class="anke-section"> 包装
      expect(sec.content).not.toContain('class="anke-section"');
      // 仍应包含楼号头
      expect(sec.content).toContain('<h4');
    }
  });

  it('collectAnkeToWorkJson every-n 模式（N>1）：多楼一节可嵌 anke-section 包装', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
      { floor: 2, author: 'B', content: 'p2', time: 1719201300, pid: '2' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 2,
      workTitle: '多楼一节',
      sectionMode: 'every-n',
      floorsPerSection: 2,
    });
    expect(result.ok).toBe(true);
    const sections = (result.jsonData as any).data.chapters[0].sections;
    expect(sections).toHaveLength(1);
    // 多楼合节保留 anke-section 包装以便 BBCode 同步时整体处理
    expect(sections[0].content).toContain('class="anke-section"');
  });
});

describe('collectAnkeToWorkJson - formatSettings（高级格式设置）', () => {
  function setupWindowMock(items: any[]) {
    (global as any).window = {
      electronAPI: {
        collectNga: vi.fn().mockResolvedValue({
          ok: true,
          items,
        }),
      },
    };
  }
  afterEach(() => {
    delete (global as any).window;
  });

  it('不传 formatSettings 时使用默认格式（向后兼容）', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
      { floor: 10, author: 'B', content: 'p10', time: 1719201300, pid: '10' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 10,
      workTitle: '默认格式',
      sectionMode: 'every-n',
      floorsPerSection: 10,
    });
    expect(result.ok).toBe(true);
    const data = (result.jsonData as any).data;
    // 默认卷名
    expect(data.volumes[0].title).toBe('第一卷');
    // 默认章名
    expect(data.chapters[0].title).toBe('第一章');
    // 默认节名
    expect(data.chapters[0].sections[0].title).toBe('第 1-10 楼');
    // 默认无节内容范围标记
    expect(data.chapters[0].sections[0].content).not.toContain('anke-section-range');
  });

  it('formatSettings.volumeTitleFormat 自定义卷名（占位符 {volIndex}）', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 1,
      workTitle: '自定义卷名',
      sectionMode: 'one-per-floor',
      formatSettings: {
        ...DEFAULT_FORMAT_SETTINGS,
        volumeTitleFormat: '第{volIndex}卷·总集',
      },
    });
    expect(result.ok).toBe(true);
    const data = (result.jsonData as any).data;
    expect(data.volumes[0].title).toBe('第1卷·总集');
  });

  it('formatSettings.chapterTitleFormat 自定义章名（占位符 {chapterIndex}）', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 1,
      workTitle: '自定义章名',
      sectionMode: 'one-per-floor',
      formatSettings: {
        ...DEFAULT_FORMAT_SETTINGS,
        chapterTitleFormat: '序章{chapterIndex}',
      },
    });
    expect(result.ok).toBe(true);
    const data = (result.jsonData as any).data;
    expect(data.chapters[0].title).toBe('序章1');
  });

  it('formatSettings.sectionTitleFormat 自定义节名（占位符 {startFloor} {endFloor}）', async () => {
    setupWindowMock([
      { floor: 5, author: 'A', content: 'p5', time: 1719201240, pid: '5' },
      { floor: 6, author: 'B', content: 'p6', time: 1719201300, pid: '6' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 5,
      endFloor: 6,
      workTitle: '自定义节名',
      sectionMode: 'every-n',
      floorsPerSection: 2,
      formatSettings: {
        ...DEFAULT_FORMAT_SETTINGS,
        sectionTitleFormat: '楼{startFloor}~{endFloor}合集',
      },
    });
    expect(result.ok).toBe(true);
    const data = (result.jsonData as any).data;
    expect(data.chapters[0].sections[0].title).toBe('楼5~6合集');
  });

  it('formatSettings.sectionContentRangeFormat 自定义节内容范围标记', async () => {
    setupWindowMock([
      { floor: 1, author: 'A', content: 'p1', time: 1719201240, pid: '1' },
      { floor: 5, author: 'B', content: 'p5', time: 1719201300, pid: '5' },
    ]);
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 1,
      endFloor: 5,
      workTitle: '范围标记',
      sectionMode: 'every-n',
      floorsPerSection: 5,
      formatSettings: {
        ...DEFAULT_FORMAT_SETTINGS,
        sectionContentRangeFormat: '这节内容是{startFloor}楼到{endFloor}楼的内容',
      },
    });
    expect(result.ok).toBe(true);
    const data = (result.jsonData as any).data;
    const sec = data.chapters[0].sections[0];
    // 节内容以范围标记开头
    expect(sec.content).toContain('anke-section-range');
    expect(sec.content).toContain('这节内容是1楼到5楼的内容');
    // 范围标记应在帖子内容之前
    const rangeIdx = sec.content.indexOf('这节内容是1楼到5楼的内容');
    expect(rangeIdx).toBeGreaterThanOrEqual(0);
    // 验证范围标记 < 帖子内容（按字符串顺序）
    const postIdx = sec.content.indexOf('p1');
    expect(rangeIdx).toBeLessThan(postIdx);
  });

  it('formatSettings 4 个字段同时自定义，组合渲染', async () => {
    setupWindowMock([
      { floor: 10, author: 'A', content: 'p10', time: 1719201240, pid: '10' },
      { floor: 20, author: 'B', content: 'p20', time: 1719201300, pid: '20' },
    ]);
    const fmt: FormatSettings = {
      volumeTitleFormat: '卷{volIndex}',
      chapterTitleFormat: '章{chapterIndex}',
      sectionTitleFormat: '{startFloor}楼→{endFloor}楼',
      sectionContentRangeFormat: '范围 {startFloor}-{endFloor}',
    };
    const result = await collectAnkeToWorkJson({
      url: 'https://nga.178.com/read.php?tid=12345',
      startFloor: 10,
      endFloor: 20,
      workTitle: '组合',
      sectionMode: 'every-n',
      floorsPerSection: 11,
      formatSettings: fmt,
    });
    expect(result.ok).toBe(true);
    const data = (result.jsonData as any).data;
    expect(data.volumes[0].title).toBe('卷1');
    expect(data.chapters[0].title).toBe('章1');
    expect(data.chapters[0].sections[0].title).toBe('10楼→20楼');
    expect(data.chapters[0].sections[0].content).toContain('范围 10-20');
  });

  it('DEFAULT_FORMAT_SETTINGS 与原硬编码行为完全一致', () => {
    // 直接验证默认值的字面量，避免改默认值时漏改测试
    expect(DEFAULT_FORMAT_SETTINGS.volumeTitleFormat).toBe('第一卷');
    expect(DEFAULT_FORMAT_SETTINGS.chapterTitleFormat).toBe('第一章');
    expect(DEFAULT_FORMAT_SETTINGS.sectionTitleFormat).toBe('第 {startFloor}-{endFloor} 楼');
    expect(DEFAULT_FORMAT_SETTINGS.sectionContentRangeFormat).toBe('');
  });
});
