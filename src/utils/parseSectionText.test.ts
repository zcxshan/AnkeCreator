import { describe, it, expect } from 'vitest';
import { parseSectionText } from './parseSectionText';

describe('parseSectionText - 解析文本生成节结构', () => {
  // ============================================================
  // 正向场景
  // ============================================================

  it('P1: 中文标点 + 起止楼层', () => {
    const text = '第一节：1，10；第二节：11，20；第三节：21，30；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.sections![0]).toEqual({ title: '第一节', startFloor: 1, endFloor: 10 });
    expect(result.sections![1]).toEqual({ title: '第二节', startFloor: 11, endFloor: 20 });
    expect(result.sections![2]).toEqual({ title: '第三节', startFloor: 21, endFloor: 30 });
  });

  it('P2: 英文标点 + 起止楼层', () => {
    const text = 'Act1:1,5;Act2:6,10;Act3:11,15;';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.sections![0]).toEqual({ title: 'Act1', startFloor: 1, endFloor: 5 });
    expect(result.sections![1]).toEqual({ title: 'Act2', startFloor: 6, endFloor: 10 });
    expect(result.sections![2]).toEqual({ title: 'Act3', startFloor: 11, endFloor: 15 });
  });

  it('P3: 中英文标点混合', () => {
    const text = '第一节:1，5;第二节：6,10；第三节：11，15；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.sections![0]).toEqual({ title: '第一节', startFloor: 1, endFloor: 5 });
    expect(result.sections![1]).toEqual({ title: '第二节', startFloor: 6, endFloor: 10 });
    expect(result.sections![2]).toEqual({ title: '第三节', startFloor: 11, endFloor: 15 });
  });

  it('P4: 无终止楼层 - 中间节用下一节起始楼层减一', () => {
    const text = '第一节：1；第二节：11；第三节：21；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.sections![0]).toEqual({ title: '第一节', startFloor: 1, endFloor: 10 });
    expect(result.sections![1]).toEqual({ title: '第二节', startFloor: 11, endFloor: 20 });
    expect(result.sections![2]).toEqual({ title: '第三节', startFloor: 21, endFloor: 100 });
  });

  it('P5: 无终止楼层 - 最后一节取 maxFloor', () => {
    const text = '第一节：1；第二节：6；';
    const result = parseSectionText(text, 50);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(2);
    expect(result.sections![0]).toEqual({ title: '第一节', startFloor: 1, endFloor: 5 });
    expect(result.sections![1]).toEqual({ title: '第二节', startFloor: 6, endFloor: 50 });
  });

  it('P6: 末尾无分号也能解析', () => {
    const text = '第一节：1，10；第二节：11，20';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(2);
    expect(result.sections![1]).toEqual({ title: '第二节', startFloor: 11, endFloor: 20 });
  });

  it('P7: 节名包含空格与特殊字符', () => {
    const text = '第 一 节 [开头]：1，5；第二节 (中)：6，10；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections![0].title).toBe('第 一 节 [开头]');
    expect(result.sections![1].title).toBe('第二节 (中)');
  });

  it('P8: 单节定义', () => {
    const text = '唯一节：1，100；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(result.sections![0]).toEqual({ title: '唯一节', startFloor: 1, endFloor: 100 });
  });

  it('P9: 单节且无终止楼层 - 取 maxFloor', () => {
    const text = '唯一节：1；';
    const result = parseSectionText(text, 88);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(result.sections![0]).toEqual({ title: '唯一节', startFloor: 1, endFloor: 88 });
  });

  it('P10: 起始楼层为 0 时允许（NGA 主题帖第 0 楼）', () => {
    const text = '前言：0，5；正文：6，20；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections![0]).toEqual({ title: '前言', startFloor: 0, endFloor: 5 });
  });

  it('P11: 混合 - 部分节有终止楼层、部分没有', () => {
    const text = '第一节：1，5；第二节：6；第三节：21，30；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.sections![0]).toEqual({ title: '第一节', startFloor: 1, endFloor: 5 });
    expect(result.sections![1]).toEqual({ title: '第二节', startFloor: 6, endFloor: 20 });
    expect(result.sections![2]).toEqual({ title: '第三节', startFloor: 21, endFloor: 30 });
  });

  it('P12: maxFloor 未传时使用兜底值 9999', () => {
    const text = '第一节：1；';
    const result = parseSectionText(text, 0);
    expect(result.ok).toBe(true);
    expect(result.sections![0]).toEqual({ title: '第一节', startFloor: 1, endFloor: 9999 });
  });

  // ============================================================
  // 错误场景
  // ============================================================

  it('E1: 空文本 - 返回错误', () => {
    const result = parseSectionText('', 100);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('文本为空');
  });

  it('E2: 仅空白 - 返回错误', () => {
    const result = parseSectionText('   \n\t  ', 100);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('文本为空');
  });

  it('E3: 仅分号无内容 - 返回错误', () => {
    const result = parseSectionText(';;;', 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未解析到任何节定义');
  });

  it('E4: 缺少冒号分隔 - 返回错误', () => {
    const text = '第一节 1,10；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('缺少冒号');
  });

  it('E5: 节名为空 - 返回错误', () => {
    const text = '：1，10；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('节名为空');
  });

  it('E6: 楼层部分为空 - 返回错误', () => {
    const text = '第一节：；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('楼层部分为空');
  });

  it('E7: 起始楼层非数字 - 返回错误', () => {
    const text = '第一节：abc，10；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('起始楼层不是有效数字');
  });

  it('E8: 终止楼层非数字 - 返回错误', () => {
    const text = '第一节：1，xyz；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('终止楼层不是有效数字');
  });

  it('E9: 终止楼层小于起始楼层 - 返回错误', () => {
    const text = '第一节：10，5；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('终止楼层 5 小于起始楼层 10');
  });

  it('E10: 楼层部分有多余字段 - 返回错误', () => {
    const text = '第一节：1，10，20；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('有多余内容');
  });

  it('E11: 相邻节楼号重叠 - 返回错误', () => {
    // 第一节 1-15，第二节 10-20，重叠 10-15
    const text = '第一节：1，15；第二节：10，20；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('存在重叠');
  });

  it('E12: 推导的终止楼层与下一节起始重叠 - 返回错误', () => {
    // 第一节起始 1，无终止 → 推导为 0（下一节起始 1 - 1 = 0），但有 max(1, 0) = 1
    // 第二节起始 1，与第一节 endFloor=1 重叠
    const text = '第一节：1；第二节：1；';
    const result = parseSectionText(text, 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('存在重叠');
  });
});
