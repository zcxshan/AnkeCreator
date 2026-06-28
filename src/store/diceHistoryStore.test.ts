import { describe, it, expect, beforeEach } from 'vitest';
import { useDiceHistoryStore, buildDiceHistoryRecord } from './diceHistoryStore';

describe('useDiceHistoryStore - 按 storyId 分组', () => {
  beforeEach(() => {
    // 清空 store
    useDiceHistoryStore.setState({ records: [] });
  });

  it('addRecord 包含 storyId', () => {
    const rec = {
      id: '1',
      timestamp: Date.now(),
      diceName: '骰子A',
      diceType: '1d100',
      result: 'D100 = 50',
      resultDetail: '掷出 50',
      storyId: 'story-1',
      sectionId: 'sec-1',
      sectionTitle: '第一节',
      payloadSnapshot: '{}',
    };
    useDiceHistoryStore.getState().addRecord(rec);
    const records = useDiceHistoryStore.getState().records;
    expect(records[0].storyId).toBe('story-1');
  });

  it('getRecordsByStory 只返回指定 story 的记录', () => {
    useDiceHistoryStore.setState({
      records: [
        { id: '1', timestamp: 1, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
        { id: '2', timestamp: 2, storyId: 'story-2', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
        { id: '3', timestamp: 3, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
      ],
    });
    const records = useDiceHistoryStore.getState().getRecordsByStory('story-1');
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.storyId === 'story-1')).toBe(true);
  });

  it('getRecordsByStory 不存在的 story 返回空数组', () => {
    useDiceHistoryStore.setState({
      records: [
        { id: '1', timestamp: 1, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
      ],
    });
    const records = useDiceHistoryStore.getState().getRecordsByStory('non-existent');
    expect(records).toHaveLength(0);
  });

  it('不同 story 的记录互不干扰', () => {
    useDiceHistoryStore.getState().addRecord({
      id: '1', timestamp: 1, storyId: 'story-1', sectionId: 's1', sectionTitle: 't',
      diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}',
    });
    useDiceHistoryStore.getState().addRecord({
      id: '2', timestamp: 2, storyId: 'story-2', sectionId: 's1', sectionTitle: 't',
      diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}',
    });
    expect(useDiceHistoryStore.getState().getRecordsByStory('story-1')).toHaveLength(1);
    expect(useDiceHistoryStore.getState().getRecordsByStory('story-2')).toHaveLength(1);
  });
});

describe('useDiceHistoryStore - clearByStory', () => {
  beforeEach(() => {
    useDiceHistoryStore.setState({ records: [] });
  });

  it('clearByStory 只删该 story 的记录，保留其他 story 的记录', () => {
    useDiceHistoryStore.setState({
      records: [
        { id: '1', timestamp: 1, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
        { id: '2', timestamp: 2, storyId: 'story-2', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
        { id: '3', timestamp: 3, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
        { id: '4', timestamp: 4, storyId: 'story-3', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
      ],
    });
    useDiceHistoryStore.getState().clearByStory('story-1');
    const records = useDiceHistoryStore.getState().records;
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.storyId !== 'story-1')).toBe(true);
    expect(records.map((r) => r.id).sort()).toEqual(['2', '4']);
  });

  it('clearByStory 不存在的 story 时记录不变', () => {
    useDiceHistoryStore.setState({
      records: [
        { id: '1', timestamp: 1, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
      ],
    });
    useDiceHistoryStore.getState().clearByStory('non-existent');
    expect(useDiceHistoryStore.getState().records).toHaveLength(1);
  });
});

describe('useDiceHistoryStore - addRecords (批量导入)', () => {
  beforeEach(() => {
    useDiceHistoryStore.setState({ records: [] });
  });

  it('addRecords 批量添加记录到现有 records 前面', () => {
    useDiceHistoryStore.setState({
      records: [
        { id: 'old-1', timestamp: 100, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
      ],
    });
    const incoming = [
      { id: 'new-1', timestamp: 200, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' },
      { id: 'new-2', timestamp: 300, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' },
    ];
    useDiceHistoryStore.getState().addRecords(incoming);
    const records = useDiceHistoryStore.getState().records;
    expect(records).toHaveLength(3);
    // 新记录排在前面（与 addRecord 行为一致）
    expect(records[0].id).toBe('new-1');
    expect(records[1].id).toBe('new-2');
    expect(records[2].id).toBe('old-1');
  });

  it('addRecords 为缺少 id 的记录生成新 id', () => {
    const incoming = [
      { id: '', timestamp: 200, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' },
      { timestamp: 300, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
    ];
    useDiceHistoryStore.getState().addRecords(incoming);
    const records = useDiceHistoryStore.getState().records;
    expect(records).toHaveLength(2);
    expect(records[0].id).toBeTruthy();
    expect(records[1].id).toBeTruthy();
    expect(records[0].id).not.toBe('');
  });

  it('addRecords 超过 200 条时 FIFO 淘汰最旧的', () => {
    // 预置 50 条旧记录，store 约定 newest 在前（index 0 = 最新）
    // old-49 (ts50) 在前，old-0 (ts1) 在末尾（最旧）
    const oldRecords = Array.from({ length: 50 }, (_, i) => ({
      id: `old-${49 - i}`, timestamp: 50 - i, storyId: 'story-1', sectionId: 's1', sectionTitle: 't',
      diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}',
    }));
    useDiceHistoryStore.setState({ records: oldRecords });
    // 导入 180 条新记录，newest 在前（new-179 ts279 在前，new-0 ts100 在末尾）
    // 与真实导入场景一致：incoming 来自 getRecordsByStory（store 顺序，newest 在前）
    const incoming = Array.from({ length: 180 }, (_, i) => ({
      id: `new-${179 - i}`, timestamp: 279 - i, storyId: 'story-1', sectionId: 's1', sectionTitle: 't',
      diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}',
    }));
    useDiceHistoryStore.getState().addRecords(incoming);
    const records = useDiceHistoryStore.getState().records;
    // 总数 50 + 180 = 230，应被截断到 200
    expect(records).toHaveLength(200);
    // 最旧的 30 条（old-0 ~ old-29，timestamp 1-30）应被淘汰
    expect(records.find((r) => r.id === 'old-0')).toBeUndefined();
    expect(records.find((r) => r.id === 'old-29')).toBeUndefined();
    // old-30（timestamp 31）应保留
    expect(records.find((r) => r.id === 'old-30')).toBeDefined();
    // 最新的 new-179 应排在最前
    expect(records[0].id).toBe('new-179');
  });

  it('addRecords 空数组不报错且不影响现有记录', () => {
    useDiceHistoryStore.setState({
      records: [
        { id: 'old-1', timestamp: 100, storyId: 'story-1', sectionId: 's1', sectionTitle: 't', diceName: 'n', diceType: 't', result: 'r', resultDetail: 'd', payloadSnapshot: '{}' } as any,
      ],
    });
    useDiceHistoryStore.getState().addRecords([]);
    expect(useDiceHistoryStore.getState().records).toHaveLength(1);
    expect(useDiceHistoryStore.getState().records[0].id).toBe('old-1');
  });
});

describe('buildDiceHistoryRecord - 含 storyId', () => {
  it('buildDiceHistoryRecord 返回的 record 包含 storyId 字段', () => {
    const payload = {
      config: { name: '测试', kind: 'option', faces: 6 },
      lastResult: { total: 3, rolls: [3], hitOptionContent: '选项3', timestamp: Date.now() },
    };
    const rec = buildDiceHistoryRecord({
      payload,
      storyId: 'story-1',
      sectionId: 'sec-1',
      sectionTitle: '第一节',
    });
    expect(rec).not.toBeNull();
    expect(rec?.storyId).toBe('story-1');
  });
});

describe('buildDiceHistoryRecord - 表达式模式', () => {
  it('表达式模式 diceType 应为表达式原文而非 1d100', () => {
    const payload = {
      config: {
        name: '复合骰',
        kind: 'numeric',
        expression: '2*3d100+1d10-5',
      },
      lastResult: {
        total: 303,
        displayText: '[2*3d100+1d10-5=2*(45+12+89)+7-5=303]',
        rolls: [45, 12, 89, 7],
        timestamp: Date.now(),
      },
    };
    const rec = buildDiceHistoryRecord({
      payload,
      storyId: 'story-1',
      sectionId: 'sec-1',
      sectionTitle: '第一节',
    });
    expect(rec).not.toBeNull();
    expect(rec?.diceType).toBe('2*3d100+1d10-5');
    expect(rec?.diceType).not.toBe('1d100');
  });

  it('表达式模式 result 应含完整展开文本', () => {
    const payload = {
      config: {
        name: '复合骰',
        kind: 'numeric',
        expression: '2*3d100+1d10-5',
      },
      lastResult: {
        total: 303,
        displayText: '[2*3d100+1d10-5=2*(45+12+89)+7-5=303]',
        rolls: [45, 12, 89, 7],
        timestamp: Date.now(),
      },
    };
    const rec = buildDiceHistoryRecord({
      payload,
      storyId: 'story-1',
      sectionId: 'sec-1',
      sectionTitle: '第一节',
    });
    expect(rec).not.toBeNull();
    expect(rec?.result).toContain('2*3d100+1d10-5');
    expect(rec?.resultDetail).toContain('303');
  });

  it('表达式模式 payloadSnapshot 保留 expression', () => {
    const payload = {
      config: {
        name: '复合骰',
        kind: 'numeric',
        expression: '2*3d100+1d10-5',
      },
      lastResult: {
        total: 303,
        displayText: '[2*3d100+1d10-5=2*(45+12+89)+7-5=303]',
        rolls: [45, 12, 89, 7],
        timestamp: Date.now(),
      },
    };
    const rec = buildDiceHistoryRecord({
      payload,
      storyId: 'story-1',
      sectionId: 'sec-1',
      sectionTitle: '第一节',
    });
    expect(rec).not.toBeNull();
    const snap = JSON.parse(rec!.payloadSnapshot);
    expect(snap.config.expression).toBe('2*3d100+1d10-5');
  });
});
