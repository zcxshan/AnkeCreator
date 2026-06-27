/**
 * WorksListPage 单元测试
 *
 * Phase A: 修复 countContent / countWordsFromHtml 错把 image-block 算成骰子
 *
 * 这些函数原本是模块内未导出的私有函数，这里在测试中通过命名空间 import
 * 验证骰点统计的正确性。
 */
import { describe, it, expect } from 'vitest';
import * as WLP from './WorksListPage';
import * as HP from './HomePage';

describe('countWordsFromHtml 骰点统计（WorksListPage）', () => {
  it('image-block 不应被算成骰子（与 dice-card 区分）', () => {
    const html =
      '<p>文本</p>' +
      '<div data-type="image-block">img1</div>' +
      '<div data-type="image-block">img2</div>' +
      '<div data-type="dice-card">dice1</div>';
    const { words, dice } = WLP.countWordsFromHtml(html);
    // 当前 BUG: dice = 3（2 image + 1 dice）
    // 期望: dice = 1（只数 dice-card）
    expect(dice).toBe(1);
    // 文本只数"文本"两字，img/骰子节点已被 REJECT 不计入 words
    expect(words).toBe(2);
  });

  it('只有 image-block 时骰点应为 0', () => {
    const html =
      '<div data-type="image-block">img1</div>' +
      '<div data-type="image-block">img2</div>';
    const { dice } = WLP.countWordsFromHtml(html);
    expect(dice).toBe(0);
  });

  it('只有 dice-card 时骰点应正确', () => {
    const html =
      '<div data-type="dice-card">d1</div>' +
      '<div data-type="dice-card">d2</div>';
    const { dice } = WLP.countWordsFromHtml(html);
    expect(dice).toBe(2);
  });
});

describe('countWordsFromHtml 骰点统计（HomePage，与 WorksListPage 同源修复）', () => {
  it('image-block 不应被算成骰子', () => {
    const html =
      '<p>文本</p>' +
      '<div data-type="image-block">img1</div>' +
      '<div data-type="image-block">img2</div>' +
      '<div data-type="dice-card">dice1</div>';
    const { dice } = HP.countWordsFromHtml(html);
    expect(dice).toBe(1);
  });

  it('只有 image-block 时骰点应为 0', () => {
    const html =
      '<div data-type="image-block">img1</div>' +
      '<div data-type="image-block">img2</div>';
    const { dice } = HP.countWordsFromHtml(html);
    expect(dice).toBe(0);
  });

  it('只有 dice-card 时骰点应正确', () => {
    const html =
      '<div data-type="dice-card">d1</div>' +
      '<div data-type="dice-card">d2</div>';
    const { dice } = HP.countWordsFromHtml(html);
    expect(dice).toBe(2);
  });
});

describe('countContent（WorksListPage）兼容两种格式', () => {
  it('image-block 为主的 HTML 骰点应为 0', () => {
    const html =
      '<div data-type="image-block">a</div>' +
      '<div data-type="image-block">b</div>';
    const { dice } = WLP.countContent(html);
    expect(dice).toBe(0);
  });

  it('image-block + dice-card 混合，骰点只数 dice-card', () => {
    const html =
      '<div data-type="image-block">a</div>' +
      '<div data-type="dice-card">d1</div>' +
      '<div data-type="image-block">b</div>';
    const { dice } = WLP.countContent(html);
    expect(dice).toBe(1);
  });
});

describe('countWordsAndDice（WorksListPage）JSON 骰点统计', () => {
  it('JSON 中 image-block 节点不算骰子', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'paragraph', text: 'hi' },
        { type: 'image-block' },
        { type: 'image-block' },
        { type: 'dice-card' },
      ],
    };
    const { words, dice } = WLP.countWordsAndDice(json);
    expect(dice).toBe(1);
    expect(words).toBe(2);
  });
});
