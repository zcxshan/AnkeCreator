import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseGululuUrl,
  collectGululuToWorkJson,
  type GululuRawPost,
} from './gululuCollect';

// ============================================================
// parseGululuUrl
// ============================================================
describe('parseGululuUrl', () => {
  it('合法 URL /book/1285 解析出 opusId', () => {
    expect(parseGululuUrl('https://www.gululu.world/book/1285')).toEqual({ opusId: 1285 });
  });

  it('合法 URL 带尾部斜杠', () => {
    expect(parseGululuUrl('https://www.gululu.world/book/1285/')).toEqual({ opusId: 1285 });
  });

  it('合法 URL 带查询参数', () => {
    expect(parseGululuUrl('https://www.gululu.world/book/9999?foo=bar')).toEqual({ opusId: 9999 });
  });

  it('非骨碌碌域名但含 /book/数字 仍解析（URL 只看路径模式）', () => {
    // parseGululuUrl 只匹配 /book/(\d+) 模式，不校验域名
    expect(parseGululuUrl('https://example.com/book/42')).toEqual({ opusId: 42 });
  });

  it('非法 URL：无 /book/ 路径', () => {
    expect(parseGululuUrl('https://www.gululu.world/post/1285')).toBeNull();
  });

  it('非法 URL：opusId 非数字', () => {
    expect(parseGululuUrl('https://www.gululu.world/book/abc')).toBeNull();
  });

  it('空字符串', () => {
    expect(parseGululuUrl('')).toBeNull();
  });
});

// ============================================================
// collectGululuToWorkJson
// ============================================================
describe('collectGululuToWorkJson', () => {
  beforeEach(() => {
    (global as any).window = {
      electronAPI: {
        collectGululu: vi.fn(),
      },
    };
  });
  afterEach(() => {
    delete (global as any).window;
  });

  // ---- 校验 ----
  it('非法 URL 直接返回 ok:false', async () => {
    const result = await collectGululuToWorkJson({
      url: 'https://example.com/post/123',
      startFloor: 1,
      endFloor: 3,
      workTitle: '测试',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('URL');
    // 不应调用 IPC
    expect((global as any).window.electronAPI.collectGululu).not.toHaveBeenCalled();
  });

  it('楼层范围不合法（start > end）返回 ok:false', async () => {
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 5,
      endFloor: 3,
      workTitle: '测试',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('楼层');
  });

  it('楼层范围不合法（start < 1）返回 ok:false', async () => {
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 0,
      endFloor: 3,
      workTitle: '测试',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('楼层');
  });

  // ---- 主进程失败 ----
  it('主进程返回 ok:false 透传 error', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: false,
      items: [],
      totalFloors: 0,
      error: 'Cookie 过期',
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 3,
      workTitle: '测试',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Cookie 过期');
  });

  it('主进程抛错时传播', async () => {
    (global as any).window.electronAPI.collectGululu.mockRejectedValueOnce(
      new Error('网络错误'),
    );
    await expect(
      collectGululuToWorkJson({
        url: 'https://www.gululu.world/book/1285',
        startFloor: 1,
        endFloor: 1,
        workTitle: '测试',
      }),
    ).rejects.toThrow('网络错误');
  });

  it('主进程不可用（electronAPI 为 undefined）返回 ok:false', async () => {
    delete (global as any).window.electronAPI;
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 1,
      workTitle: '测试',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('主进程');
  });

  // ---- 成功路径 ----
  it('成功输出 anke-creator-export v1.1 JSON', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: '作者', content: '<p>p1</p>', time: 1719201240, floorId: 1001 },
        { floor: 2, author: '作者', content: '<p>p2</p>', time: 1719201300, floorId: 1002 },
      ],
      totalFloors: 2,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 2,
      workTitle: '测试作品',
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    expect(exported.format).toBe('anke-creator-export');
    expect(exported.version).toBe('1.1');
    expect(exported.data.title).toBe('测试作品');
    expect(exported.data.category).toBe('安科');
    // 默认含「第一卷」volume
    expect(exported.data.volumes).toHaveLength(1);
    expect(exported.data.volumes[0].id).toBe('vol-default');
    // chapter 关联到 volume
    expect(exported.data.chapters[0].volume_id).toBe('vol-default');
    // sections 存在
    expect(Array.isArray(exported.data.chapters[0].sections)).toBe(true);
    expect(exported.data.chapters[0].sections.length).toBeGreaterThan(0);
    // dice_history 为空数组
    expect(exported.data.dice_history).toEqual([]);
  });

  it('section 标题使用"第 X-Y 楼"格式', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: '作者', content: '<p>p1</p>', pid: '1' },
        { floor: 2, author: '作者', content: '<p>p2</p>', pid: '2' },
      ],
      totalFloors: 2,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 2,
      workTitle: '节标题测试',
      sectionMode: 'every-n',
      floorsPerSection: 2,
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    expect(exported.data.chapters[0].sections[0].title).toContain('第');
    expect(exported.data.chapters[0].sections[0].title).toContain('楼');
  });

  // ---- 去重排序 ----
  it('重复 floor 去重', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>', floorId: 1 },
        { floor: 1, author: 'A', content: '<p>p1-dup</p>', floorId: 1 },
        { floor: 2, author: 'A', content: '<p>p2</p>', floorId: 2 },
      ],
      totalFloors: 2,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 2,
      workTitle: '去重测试',
    });
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items?.[0].floor).toBe(1);
    expect(result.items?.[1].floor).toBe(2);
    // 保留第一条
    expect(result.items?.[0].content).toBe('<p>p1</p>');
  });

  it('楼层按升序排序', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 3, author: 'A', content: '<p>p3</p>' },
        { floor: 1, author: 'A', content: '<p>p1</p>' },
        { floor: 2, author: 'A', content: '<p>p2</p>' },
      ],
      totalFloors: 3,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 3,
      workTitle: '排序测试',
    });
    expect(result.ok).toBe(true);
    expect(result.items?.map((p) => p.floor)).toEqual([1, 2, 3]);
  });

  // ---- 楼层范围裁剪 ----
  it('裁剪超出范围的楼层', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
        { floor: 2, author: 'A', content: '<p>p2</p>' },
        { floor: 3, author: 'A', content: '<p>p3</p>' },
        { floor: 4, author: 'A', content: '<p>p4</p>' },
      ],
      totalFloors: 4,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 2,
      endFloor: 3,
      workTitle: '裁剪测试',
    });
    expect(result.ok).toBe(true);
    expect(result.items?.map((p) => p.floor)).toEqual([2, 3]);
  });

  // ---- 占位补齐 ----
  it('缺失楼层插入占位', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
        { floor: 3, author: 'A', content: '<p>p3</p>' },
      ],
      totalFloors: 3,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 3,
      workTitle: '占位测试',
    });
    expect(result.ok).toBe(true);
    // 第 2 楼缺失，应被 insertPlaceholderPosts 补齐
    expect(result.items).toHaveLength(3);
    expect(result.items?.map((p) => p.floor)).toEqual([1, 2, 3]);
  });

  // ---- 三种 sectionMode ----
  it('sectionMode=single 整段一节', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
        { floor: 2, author: 'A', content: '<p>p2</p>' },
        { floor: 3, author: 'A', content: '<p>p3</p>' },
      ],
      totalFloors: 3,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 3,
      workTitle: 'single 测试',
      sectionMode: 'single',
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    expect(exported.data.chapters[0].sections).toHaveLength(1);
    expect(exported.data.chapters[0].sections[0].title).toContain('1-3');
  });

  it('sectionMode=one-per-floor 每楼一节', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
        { floor: 2, author: 'A', content: '<p>p2</p>' },
      ],
      totalFloors: 2,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 2,
      workTitle: 'one-per-floor 测试',
      sectionMode: 'one-per-floor',
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    expect(exported.data.chapters[0].sections).toHaveLength(2);
  });

  it('sectionMode=every-n 每 2 楼一节', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
        { floor: 2, author: 'A', content: '<p>p2</p>' },
        { floor: 3, author: 'A', content: '<p>p3</p>' },
        { floor: 4, author: 'A', content: '<p>p4</p>' },
      ],
      totalFloors: 4,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 4,
      workTitle: 'every-n 测试',
      sectionMode: 'every-n',
      floorsPerSection: 2,
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    // [1,2] [3,4] → 2 节
    expect(exported.data.chapters[0].sections).toHaveLength(2);
  });

  // ---- workTitle 回退 ----
  it('workTitle 留空时回退为"骨碌碌-{opusId}"', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
      ],
      totalFloors: 1,
      // 不返回 title
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 1,
      workTitle: '',
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    expect(exported.data.title).toBe('骨碌碌-1285');
  });

  it('workTitle 留空且主进程返回 title 时用主进程 title', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
      ],
      totalFloors: 1,
      title: '主进程标题',
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 1,
      workTitle: '',
    });
    expect(result.ok).toBe(true);
    const exported = result.jsonData as any;
    expect(exported.data.title).toBe('主进程标题');
  });

  // ---- 重试模式 ----
  it('retryFloorNums 透传给主进程', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 2, author: 'A', content: '<p>p2-retry</p>' },
      ],
      totalFloors: 2,
    });
    await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 2,
      workTitle: '重试测试',
      retryFloorNums: [2],
    });
    const callPayload = (global as any).window.electronAPI.collectGululu.mock.calls[0][0];
    expect(callPayload.retryFloorNums).toEqual([2]);
  });

  it('existingItems 补齐未重试成功的楼层', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 2, author: 'A', content: '<p>p2-retry</p>' },
      ],
      totalFloors: 2,
    });
    const existingItems: GululuRawPost[] = [
      { floor: 1, author: 'A', content: '<p>p1-old</p>' },
      { floor: 2, author: 'A', content: '<p>p2-old-failed</p>' },
    ];
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 2,
      workTitle: '重试补齐测试',
      retryFloorNums: [2],
      existingItems,
    });
    expect(result.ok).toBe(true);
    // 第 2 楼用新结果，第 1 楼用 existingItems 中的旧结果
    expect(result.items).toHaveLength(2);
    expect(result.items?.find((p) => p.floor === 2)?.content).toBe('<p>p2-retry</p>');
    expect(result.items?.find((p) => p.floor === 1)?.content).toBe('<p>p1-old</p>');
  });

  // ---- 空内容 ----
  it('指定范围内无内容返回 ok:false', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [],
      totalFloors: 0,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 3,
      workTitle: '空内容测试',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('无内容');
  });

  // ---- fileName ----
  it('fileName 非法字符替换为下划线', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
      ],
      totalFloors: 1,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 1,
      workTitle: '测试/作品:*?',
    });
    expect(result.ok).toBe(true);
    // 非法字符 /:*?"<>| 替换为 _
    expect(result.fileName).toBe('测试_作品___');
  });

  // ---- 统计信息 ----
  it('stats 包含 totalFloors 和 sectionCount', async () => {
    (global as any).window.electronAPI.collectGululu.mockResolvedValueOnce({
      ok: true,
      items: [
        { floor: 1, author: 'A', content: '<p>p1</p>' },
        { floor: 2, author: 'A', content: '<p>p2</p>' },
      ],
      totalFloors: 2,
    });
    const result = await collectGululuToWorkJson({
      url: 'https://www.gululu.world/book/1285',
      startFloor: 1,
      endFloor: 2,
      workTitle: '统计测试',
      sectionMode: 'one-per-floor',
    });
    expect(result.ok).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.stats?.totalFloors).toBe(2);
    expect(result.stats?.sectionCount).toBe(2);
  });
});
