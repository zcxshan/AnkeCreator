/**
 * 块级功能验证测试（引用 / 表格 / 骰子）
 *
 * 折叠块已有 collapseBlock.test.ts 覆盖；列表/对齐依赖浏览器 execCommand，
 * 由真实浏览器验证。此处覆盖纯 DOM 可测的块级插入/交互。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { insertQuoteBlock } from '../collapseBlock';
import { insertTable } from '../commands';
import { insertDiceCard, rollDiceOnCard } from '../diceCard';
import { setLastEditorRange } from '../selection';
import { useSettingStore } from '../../store/settingStore';

let editor: HTMLDivElement;

beforeEach(() => {
  editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  document.body.appendChild(editor);
  useSettingStore.getState().setSoundEnabled?.(false);
});

afterEach(() => {
  editor.remove();
  setLastEditorRange(null);
  vi.useRealTimers();
});

function setHTML(html: string): void {
  editor.innerHTML = html;
}

function setCaretAfterText(): void {
  const tn = editor.querySelector('p')?.firstChild;
  if (!tn) throw new Error('no text node');
  const r = document.createRange();
  r.setStart(tn, (tn as Text).textContent!.length);
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  setLastEditorRange(r.cloneRange());
}

function selectWholeFirstP(): void {
  const p = editor.querySelector('p');
  if (!p) throw new Error('no p');
  const r = document.createRange();
  r.selectNodeContents(p);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  setLastEditorRange(r.cloneRange());
}

describe('引用块 insertQuoteBlock', () => {
  it('折叠光标：插入 blockquote[data-type="quote-block"] + trailing br，光标在块后', () => {
    setHTML('<p>正文</p>');
    setCaretAfterText();
    insertQuoteBlock(editor);
    const q = editor.querySelector('blockquote[data-type="quote-block"]');
    expect(q).not.toBeNull();
    // style 属性包含 border-left（CSS 变量使 style.borderLeft 无法解析，故查属性原文）
    expect(q!.getAttribute('style')).toContain('border-left');
    // trailing br 紧跟 blockquote（无论引用插在段内/段外，顺序不变）
    expect(q!.nextSibling?.nodeName).toBe('BR');
    // 光标在 blockquote 之后（blockquote 可能在 p 内，故断言父节点 + 位置）
    const sel = window.getSelection()!;
    const r = sel.getRangeAt(0);
    expect(r.startContainer).toBe(q!.parentNode);
    expect(r.startOffset).toBe(Array.from(q!.parentNode!.childNodes).indexOf(q!) + 1);
  });

  it('有选区：选中文本被包进引用块', () => {
    setHTML('<p>要被引用</p>');
    selectWholeFirstP();
    insertQuoteBlock(editor);
    const q = editor.querySelector('blockquote[data-type="quote-block"]');
    expect(q).not.toBeNull();
    expect(q!.textContent).toContain('要被引用');
  });

  it('在引用块内再次操作 → 取消引用（解包为纯文本）', () => {
    setHTML('<blockquote data-type="quote-block"><p>引用内容</p></blockquote>');
    const p = editor.querySelector('blockquote p')!;
    const r = document.createRange();
    r.setStart(p.firstChild!, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    setLastEditorRange(r.cloneRange());
    insertQuoteBlock(editor);
    expect(editor.querySelector('blockquote')).toBeNull();
    expect(editor.textContent).toContain('引用内容');
  });
});

describe('表格 insertTable', () => {
  it('插入 rows×cols 可编辑表格 + 光标定位到第一个单元格', () => {
    setHTML('<p>正文</p>');
    setCaretAfterText();
    insertTable(editor, 2, 3);
    const wrapper = editor.querySelector('div[data-type="table-block"]');
    expect(wrapper).not.toBeNull();
    const table = wrapper!.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('tr').length).toBe(2);
    expect(table!.querySelectorAll('td').length).toBe(6);
    expect(table!.getAttribute('contenteditable')).toBe('true');
    expect(table!.style.borderCollapse).toBe('collapse');
    // trailing 空段落
    expect(wrapper!.nextElementSibling?.tagName).toBe('P');
    // 光标在第一个 td
    const sel = window.getSelection()!;
    const firstTd = table!.querySelector('td')!;
    expect(firstTd.contains(sel.getRangeAt(0).startContainer)).toBe(true);
  });

  it('行列数钳制：0 行 → 1 行，超大 → 20', () => {
    setHTML('<p>x</p>');
    setCaretAfterText();
    insertTable(editor, 0, 99);
    const table = editor.querySelector('table')!;
    expect(table.querySelectorAll('tr').length).toBe(1);
    expect(table.querySelectorAll('td').length).toBe(20);
  });
});

describe('骰子卡片 insertDiceCard / rollDiceOnCard', () => {
  it('插入骰子卡片：data-type=dice-card + contenteditable=false + 可掷骰按钮', () => {
    setHTML('<p>正文</p>');
    setCaretAfterText();
    const payload = { config: { kind: 'numeric', count: 1, faces: 100, mode: 'simple' } };
    insertDiceCard(editor, payload);
    const card = editor.querySelector('div[data-type="dice-card"]');
    expect(card).not.toBeNull();
    expect(card!.getAttribute('contenteditable')).toBe('false');
    expect(card!.querySelector('button[data-role="roll"]')).not.toBeNull();
  });

  it('掷骰后：lastResult 写入 payload，掷骰按钮隐藏，结果数字出现', () => {
    vi.useFakeTimers();
    setHTML('<p>正文</p>');
    setCaretAfterText();
    const payload = { config: { kind: 'numeric', count: 1, faces: 6, mode: 'simple' } };
    insertDiceCard(editor, payload);
    const card = editor.querySelector('div[data-type="dice-card"]') as HTMLElement;
    rollDiceOnCard(editor, card);
    vi.advanceTimersByTime(1000);
    const updated = JSON.parse(card.dataset.payload || '{}');
    expect(updated.lastResult).toBeTruthy();
    // 掷骰后按钮隐藏（display:none，元素保留）
    const btn = card.querySelector<HTMLElement>('button[data-role="roll"]');
    expect(btn?.style.display).toBe('none');
  });
});
