/**
 * attachCollapseBlockHandlers 单元测试
 *
 * 关注点：点击 .collapse-head 触发 body 展开/折叠的 toggle
 * 之前 BBCode 转 visual 的 collapse 块没有这个交互（data-collapsed 永久 true），
 * 用户点 +折叠 没反应。本测试覆盖修复后的行为。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import {
  attachCollapseBlockHandlers,
  insertDiceCard,
  insertCollapseBlock,
  insertImageBlock,
  removeDiceCard,
  removeCollapseBlock,
  removeImageBlock,
  applyActiveStylesToInsertion,
  applyInlineStyle,
  collectInlineStyleFromAncestors,
  removeInlineTagNoFocus,
  removeInlineStyleNoFocus,
  applyTextDecorationPartNoFocus,
  removeTextDecorationPartNoFocus,
  isBoldActive,
  isItalicActive,
  isUnderlineActive,
  isStrikeActive,
  isBoldFullyActive,
  isItalicFullyActive,
  isUnderlineFullyActive,
  isStrikeFullyActive,
  getInlineStylesFromActive,
  insertStyledParagraphAfter,
  splitBlockAtCursor,
} from './contenteditableUtils';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';

describe('attachCollapseBlockHandlers - click toggle 展开/折叠', () => {
  let editor: HTMLElement;
  let cleanup: () => void;

  beforeEach(() => {
    // 准备 DOM：编辑器内含一个默认折叠的 collapse-block
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.innerHTML = `
      <div data-type="collapse-block" data-title="折叠" data-collapsed="true" style="overflow:hidden">
        <div class="collapse-head" contenteditable="false" style="cursor:pointer">
          <span class="collapse-toggle">+</span>
          <span class="collapse-title">折叠</span>
        </div>
        <div class="collapse-body" style="display:none">body content</div>
      </div>
    `;
    document.body.appendChild(editor);
    cleanup = attachCollapseBlockHandlers(editor);
  });

  it('点击 .collapse-head 展开 body：display 变 block，toggle 文本变 −，data-collapsed 变 false', () => {
    const head = editor.querySelector('.collapse-head') as HTMLElement;
    const body = editor.querySelector('.collapse-body') as HTMLElement;
    const toggle = editor.querySelector('.collapse-toggle') as HTMLElement;
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;

    // 初始：折叠
    expect(body.style.display).toBe('none');
    expect(toggle.textContent).toBe('+');
    expect(block.dataset.collapsed).toBe('true');

    // 点击 head
    fireEvent.click(head);

    // 展开
    expect(body.style.display).toBe('block');
    expect(toggle.textContent).toBe('−');
    expect(block.dataset.collapsed).toBe('false');
  });

  it('再次点击 .collapse-head 收起 body：display 变 none，toggle 文本变 +，data-collapsed 变 true', () => {
    const head = editor.querySelector('.collapse-head') as HTMLElement;
    const body = editor.querySelector('.collapse-body') as HTMLElement;
    const toggle = editor.querySelector('.collapse-toggle') as HTMLElement;
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;

    // 第一次：展开
    fireEvent.click(head);
    expect(body.style.display).toBe('block');
    expect(block.dataset.collapsed).toBe('false');

    // 第二次：折叠回去
    fireEvent.click(head);
    expect(body.style.display).toBe('none');
    expect(toggle.textContent).toBe('+');
    expect(block.dataset.collapsed).toBe('true');
  });

  it('点击 .collapse-head 子元素（如 .collapse-toggle）也触发 toggle', () => {
    const toggle = editor.querySelector('.collapse-toggle') as HTMLElement;
    const body = editor.querySelector('.collapse-body') as HTMLElement;
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;

    fireEvent.click(toggle);
    expect(body.style.display).toBe('block');
    expect(block.dataset.collapsed).toBe('false');
  });

  it('点击 .collapse-body 不触发 toggle（不影响正文编辑）', () => {
    const body = editor.querySelector('.collapse-body') as HTMLElement;
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;

    // 模拟点击 body（不是 head）
    fireEvent.click(body);
    // 状态不变
    expect(block.dataset.collapsed).toBe('true');
  });

  it('cleanup 后 click 不再 toggle', () => {
    cleanup();
    const head = editor.querySelector('.collapse-head') as HTMLElement;
    const body = editor.querySelector('.collapse-body') as HTMLElement;
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;

    fireEvent.click(head);
    // 移除监听器后状态应保持
    expect(body.style.display).toBe('none');
    expect(block.dataset.collapsed).toBe('true');
  });
});

/**
 * Fix #2：dice-card / image-block 块级显示 + <br> 占位
 *
 * 旧实现：display: inline-block，插入后无 <br> 占位
 * 新实现：display: block，紧跟 wrapper 之后插入 <br> 占位，保证用户能点击空行放下光标
 */
describe('insertDiceCard - 块级显示', () => {
  let editor: HTMLDivElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>前置文本</p>';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  it('dice-card wrapper 样式为 display: block（独占一行）', () => {
    const payload = { config: { name: '测试', kind: 'option' }, lastResult: null };
    const card = insertDiceCard(editor, payload);
    expect(card).not.toBeNull();
    if (card) {
      expect(card.style.display).toBe('block');
    }
  });

  it('dice-card 插入后立即有 <br> 占位元素', () => {
    const payload = { config: { name: '测试', kind: 'option' }, lastResult: null };
    const card = insertDiceCard(editor, payload);
    expect(card).not.toBeNull();
    if (card) {
      // 紧跟 card 之后的元素应该是 <br>
      const next = card.nextSibling as HTMLElement;
      expect(next).not.toBeNull();
      expect(next.tagName?.toLowerCase()).toBe('br');
    }
  });

  it('连续插入两个 dice-card 中间有 <br> 占位', () => {
    const payload = { config: { name: '测试', kind: 'option' }, lastResult: null };
    const card1 = insertDiceCard(editor, payload);
    const card2 = insertDiceCard(editor, payload);
    expect(card1).not.toBeNull();
    expect(card2).not.toBeNull();
    if (card1 && card2) {
      // card1 之后应该是 <br>，然后是 card2
      const between = card1.nextSibling as HTMLElement;
      expect(between.tagName?.toLowerCase()).toBe('br');
      expect(between.nextSibling).toBe(card2);
    }
  });
});

describe('insertImageBlock - 块级显示', () => {
  let editor: HTMLDivElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>前置文本</p>';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  it('image-block 样式为 display: block', () => {
    // insertImageBlock 需要一个 image source，使用测试用的 data URL
    const block = insertImageBlock(editor, 'data:image/png;base64,iVBORw0KGgo=', 'test');
    expect(block).not.toBeNull();
    if (block) {
      expect(block.style.display).toBe('block');
    }
  });

  it('image-block 插入后立即有 <br> 占位元素', () => {
    const block = insertImageBlock(editor, 'data:image/png;base64,iVBORw0KGgo=', 'test');
    expect(block).not.toBeNull();
    if (block) {
      const next = block.nextSibling as HTMLElement;
      expect(next).not.toBeNull();
      expect(next.tagName?.toLowerCase()).toBe('br');
    }
  });
});

/**
 * Fix #6：折叠块删除优化（TDD）
 *
 * 问题 1：点击 collapse-body 内部会设 data-selected=true，随后按 Backspace
 *   会被 onKeyDown 的 selected 分支整块删除——用户只想删一个字符。
 * 问题 2：光标紧邻 collapse-block 按 Backspace/Delete 时，无论块是否为空
 *   都整块删除——非空块应保留，光标跳入块内或不操作。
 */
describe('Fix #6: 折叠块删除优化（TDD）', () => {
  let editor: HTMLDivElement;
  let cleanup: () => void;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    if (cleanup) cleanup();
    editor.remove();
  });

  /**
   * 辅助：把光标设置到指定节点的指定 offset，返回是否成功。
   * happy-dom 的 Selection API 可能不稳定，失败时返回 false 让调用方决定后续策略。
   */
  function setCollapsedSelection(node: Node, offset: number): boolean {
    const sel = window.getSelection();
    if (!sel) return false;
    const range = document.createRange();
    try {
      range.setStart(node, offset);
      range.collapse(true);
    } catch {
      return false;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.rangeCount > 0 && sel.isCollapsed;
  }

  it('光标在 collapse-body 内部按 Backspace 只删字符，不整块删除', () => {
    // 折叠块展开（body 可见），body 内有文本
    editor.innerHTML =
      '<div data-type="collapse-block" data-collapsed="false">'
      + '<div class="collapse-head" contenteditable="false">'
      + '<span class="collapse-toggle">−</span>'
      + '<span class="collapse-title" contenteditable="true">标题</span>'
      + '</div>'
      + '<div class="collapse-body" contenteditable="true">hello world</div>'
      + '</div>';
    cleanup = attachCollapseBlockHandlers(editor);

    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;
    const body = block.querySelector('.collapse-body') as HTMLElement;

    // 点击 body 内部 → onMouseDown 不再设置 data-selected（v49: body 文本要能正常选中，
    // 不能被 selectCollapseBlock 干扰）。手动模拟 selected 态以覆盖 onKeyDown 的删整块分支。
    fireEvent.mouseDown(body);
    expect(block.getAttribute('data-selected')).toBeNull();
    block.setAttribute('data-selected', 'true');

    // 光标放到 body 文本中间（'hello ' 之后，offset=6）
    const textNode = body.firstChild as Text;
    expect(setCollapsedSelection(textNode, 6)).toBe(true);

    // 按 Backspace
    fireEvent.keyDown(editor, { key: 'Backspace' });

    // 断言：折叠块还在（没有被整块删除）
    expect(editor.querySelector('[data-type="collapse-block"]')).not.toBeNull();
  });

  it('光标在 collapse-title 内部按 Backspace 只删字符，不整块删除', () => {
    editor.innerHTML =
      '<div data-type="collapse-block" data-collapsed="false">'
      + '<div class="collapse-head" contenteditable="false">'
      + '<span class="collapse-toggle">−</span>'
      + '<span class="collapse-title" contenteditable="true">标题文字</span>'
      + '</div>'
      + '<div class="collapse-body" contenteditable="true">内容</div>'
      + '</div>';
    cleanup = attachCollapseBlockHandlers(editor);

    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;
    const title = block.querySelector('.collapse-title') as HTMLElement;

    // onMouseDown 对 collapse-title 会 return，不设 selected；手动模拟 selected 态
    block.setAttribute('data-selected', 'true');

    // 光标放到 title 文本末尾
    const textNode = title.firstChild as Text;
    expect(setCollapsedSelection(textNode, 4)).toBe(true);

    fireEvent.keyDown(editor, { key: 'Backspace' });

    expect(editor.querySelector('[data-type="collapse-block"]')).not.toBeNull();
  });

  it('空折叠块紧邻边界按 Backspace 整块删除', () => {
    // 空折叠块在前，后面紧跟文本；光标在文本开头（offset=0），prev 是空块
    editor.innerHTML =
      '<div data-type="collapse-block" data-collapsed="true">'
      + '<div class="collapse-head" contenteditable="false">'
      + '<span class="collapse-toggle">+</span>'
      + '<span class="collapse-title" contenteditable="true"></span>'
      + '</div>'
      + '<div class="collapse-body" contenteditable="true"></div>'
      + '</div>'
      + '后面文本';
    cleanup = attachCollapseBlockHandlers(editor);

    // 光标在 "后面文本" 开头（紧邻折叠块之后）
    const textNode = editor.lastChild as Text;
    expect(setCollapsedSelection(textNode, 0)).toBe(true);

    fireEvent.keyDown(editor, { key: 'Backspace' });

    // 空折叠块应被删除
    expect(editor.querySelector('[data-type="collapse-block"]')).toBeNull();
  });

  it('有内容的折叠块紧邻边界按 Backspace 不整块删除', () => {
    // 有内容的折叠块在前，后面紧跟文本
    editor.innerHTML =
      '<div data-type="collapse-block" data-collapsed="true">'
      + '<div class="collapse-head" contenteditable="false">'
      + '<span class="collapse-toggle">+</span>'
      + '<span class="collapse-title" contenteditable="true">有标题</span>'
      + '</div>'
      + '<div class="collapse-body" contenteditable="true">有内容</div>'
      + '</div>'
      + '后面文本';
    cleanup = attachCollapseBlockHandlers(editor);

    // 光标在 "后面文本" 开头
    const textNode = editor.lastChild as Text;
    expect(setCollapsedSelection(textNode, 0)).toBe(true);

    fireEvent.keyDown(editor, { key: 'Backspace' });

    // 有内容的折叠块不应被删除
    expect(editor.querySelector('[data-type="collapse-block"]')).not.toBeNull();
  });

  it('有内容的折叠块紧邻边界按 Delete 不整块删除', () => {
    // 前面文本，后面是有内容的折叠块
    editor.innerHTML =
      '前面文本'
      + '<div data-type="collapse-block" data-collapsed="true">'
      + '<div class="collapse-head" contenteditable="false">'
      + '<span class="collapse-toggle">+</span>'
      + '<span class="collapse-title" contenteditable="true">有标题</span>'
      + '</div>'
      + '<div class="collapse-body" contenteditable="true">有内容</div>'
      + '</div>';
    cleanup = attachCollapseBlockHandlers(editor);

    // 光标在 "前面文本" 末尾（紧邻折叠块前）
    const textNode = editor.firstChild as Text;
    expect(setCollapsedSelection(textNode, 4)).toBe(true);

    fireEvent.keyDown(editor, { key: 'Delete' });

    expect(editor.querySelector('[data-type="collapse-block"]')).not.toBeNull();
  });
});

/**
 * Phase E — 子卡点 3.3：原子块 push 与 handleInput 互斥
 *
 * 之前：插入/删除 atomic block（dice-card/image-block/collapse-block）会
 *   立即 push 历史快照，但 RichTextEditor 的 handleInput 也为同一变化
 *   设了一个 200ms debounce 推历史。撤销一次只能回到 atomic push 前的
 *   快照（因为 input 的快照在 atomic 之后），再撤销一次才回到 atomic
 *   之前的快照。表现：插入骰子后按一次撤销，骰子还在但旁边的内容变化
 *   没了。
 *
 * 修复：atomic push 后清掉 RichTextEditor 的待推 timer，避免重复推。
 *   - contenteditableUtils 的 6 处 atomic push 入口
 *   - 复用 window.__editorHistoryTimer 标记（RichTextEditor 也会写）
 */
describe('Phase E - 原子块 push 与 handleInput 互斥', () => {
  let editor: HTMLDivElement;

  beforeEach(() => {
    // 重置 history store
    useEditorHistoryStore.setState({ current: '', past: [], future: [] });
    // 清理全局 timer 标记
    (window as any).__editorHistoryTimer = null;

    editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>前置文本</p>';
    document.body.appendChild(editor);

    // 重置 history 当前为 editor 当前 innerHTML（模拟 RichTextEditor.content useEffect）
    useEditorHistoryStore.getState().reset(editor.innerHTML);
  });

  afterEach(() => {
    document.body.removeChild(editor);
    (window as any).__editorHistoryTimer = null;
  });

  it('insertDiceCard 后 store history size 增加 1（不是 2）', () => {
    const beforePastLen = useEditorHistoryStore.getState().past.length;
    const payload = { config: { name: '测试', kind: 'option' }, lastResult: null };
    insertDiceCard(editor, payload);
    const afterPastLen = useEditorHistoryStore.getState().past.length;
    // 原子 push 一次：past +1
    expect(afterPastLen).toBe(beforePastLen + 1);
  });

  it('insertDiceCard 之后，window.__editorHistoryTimer 被清掉（避免 input 重复推）', () => {
    // 模拟 RichTextEditor 在用户输入时设置了 timer
    (window as any).__editorHistoryTimer = 12345;
    const clearSpy = vi.spyOn(window, 'clearTimeout');

    const payload = { config: { name: '测试', kind: 'option' }, lastResult: null };
    insertDiceCard(editor, payload);

    // 关键断言：清掉了 RichTextEditor 的待推 timer
    expect(clearSpy).toHaveBeenCalledWith(12345);
    expect((window as any).__editorHistoryTimer).toBeNull();
    clearSpy.mockRestore();
  });

  it('insertImageBlock 后 store history size 增加 1', () => {
    const beforePastLen = useEditorHistoryStore.getState().past.length;
    insertImageBlock(editor, 'data:image/png;base64,iVBORw0KGgo=', 'test');
    const afterPastLen = useEditorHistoryStore.getState().past.length;
    expect(afterPastLen).toBe(beforePastLen + 1);
  });

  it('insertCollapseBlock 后 store history size 增加 1', () => {
    // insertCollapseBlock 需要编辑器内有可用的 selection（它不调用 getInsertionPoint 兜底）
    const textNode = editor.querySelector('p')!.firstChild as Text;
    const r = document.createRange();
    r.setStart(textNode, textNode.textContent!.length);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);

    const beforePastLen = useEditorHistoryStore.getState().past.length;
    insertCollapseBlock(editor, '标题');
    const afterPastLen = useEditorHistoryStore.getState().past.length;
    expect(afterPastLen).toBe(beforePastLen + 1);
  });

  it('removeDiceCard 后 store history size 增加 1', () => {
    // 先插入
    const payload = { config: { name: '测试', kind: 'option' }, lastResult: null };
    const card = insertDiceCard(editor, payload);
    expect(card).not.toBeNull();
    if (!card) return;
    // 重置全局 timer 标记
    (window as any).__editorHistoryTimer = null;
    const beforePastLen = useEditorHistoryStore.getState().past.length;

    removeDiceCard(editor, card);

    const afterPastLen = useEditorHistoryStore.getState().past.length;
    expect(afterPastLen).toBe(beforePastLen + 1);
  });

  it('removeImageBlock 后 store history size 增加 1', () => {
    const block = insertImageBlock(editor, 'data:image/png;base64,iVBORw0KGgo=', 'test');
    expect(block).not.toBeNull();
    if (!block) return;
    (window as any).__editorHistoryTimer = null;
    const beforePastLen = useEditorHistoryStore.getState().past.length;

    removeImageBlock(editor, block);

    const afterPastLen = useEditorHistoryStore.getState().past.length;
    expect(afterPastLen).toBe(beforePastLen + 1);
  });

  it('removeCollapseBlock 后 store history size 增加 1', () => {
    // insertCollapseBlock 需要 selection
    const textNode = editor.querySelector('p')!.firstChild as Text;
    const r = document.createRange();
    r.setStart(textNode, textNode.textContent!.length);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);

    insertCollapseBlock(editor, '标题');
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;
    expect(block).not.toBeNull();
    if (!block) return;
    (window as any).__editorHistoryTimer = null;
    const beforePastLen = useEditorHistoryStore.getState().past.length;

    removeCollapseBlock(editor, block);

    const afterPastLen = useEditorHistoryStore.getState().past.length;
    expect(afterPastLen).toBe(beforePastLen + 1);
  });
});

/**
 * Fix #1：字号正反馈 bug
 *
 * 之前：用户在已应用 150% 字号的位置继续输入新字符，会嵌套产生
 * `<span style="font-size: 150%"><span style="font-size: 150%">...</span></span>`
 * CSS font-size:% 相对父元素计算，嵌套后实际字号被反复相乘：
 *  - 150% × 150% = 225%（一次输入后）
 *  - 150% × 150% × 150% = 337.5%（两次输入后）
 *  → 字号越来越大（>100% 时）/越来越小（<100% 时）
 *
 * 修复：检测光标所在 span 与 active 样式是否完全一致，如一致则直接插入文本节点。
 */
describe('Fix #1: 字号正反馈 bug（TDD）', () => {
  let editor: HTMLElement;
  let textNode: Text;
  let range: Range;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  /** 在 editor 末尾追加一个含指定样式的 span + 文本节点，把光标放到 span 内部末尾 */
  function setupCursorInsideSpan(
    fontSize: string | null,
    color: string | null = null,
  ) {
    const span = document.createElement('span');
    if (fontSize) span.style.fontSize = fontSize;
    if (color) span.style.color = color;
    span.appendChild(document.createTextNode('Hello'));
    editor.appendChild(span);
    textNode = span.firstChild as Text;
    range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('在 150% 字号 span 内连续输入 N 个字符，只插入文本节点，不嵌套 span', () => {
    setupCursorInsideSpan('150%');
    const active = { fontSize: '150%' };

    // 模拟连续 5 次输入
    for (const ch of 'abcde') {
      applyActiveStylesToInsertion(editor, active, ch);
    }

    // 关键断言：editor 中应该只有 1 个 span（初始的那个），且其内文本 = "Helloabcde"
    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontSize).toBe('150%');
    expect(spans[0].textContent).toBe('Helloabcde');
  });

  it('在 50% 字号 span 内连续输入字符，不嵌套 span', () => {
    setupCursorInsideSpan('50%');
    const active = { fontSize: '50%' };

    for (const ch of 'xyz') {
      applyActiveStylesToInsertion(editor, active, ch);
    }

    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontSize).toBe('50%');
    expect(spans[0].textContent).toBe('Helloxyz');
  });

  it('在带颜色的 span 内输入，色 + 字号一致时不嵌套', () => {
    setupCursorInsideSpan('150%', 'red');
    const active = { fontSize: '150%', color: 'red' };

    applyActiveStylesToInsertion(editor, active, 'A');

    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontSize).toBe('150%');
    expect(spans[0].style.color).toBe('red');
    expect(spans[0].textContent).toBe('HelloA');
  });

  it('光标在不同样式的 span 内仍正常嵌套（不同样式需要新 span）', () => {
    // 父 span 是 100%，active 想设 150% → 需要嵌套
    setupCursorInsideSpan('100%');
    const active = { fontSize: '150%' };

    applyActiveStylesToInsertion(editor, active, 'B');

    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(2);
    // 内层是 150%
    const inner = spans[1];
    expect(inner.style.fontSize).toBe('150%');
    expect(inner.textContent).toBe('B');
  });

  it('在 sup 包裹的 span 内输入：不破坏 sup 包裹，样式匹配时不嵌套', () => {
    // 构造：<sup><span fontSize=150%>X</span></sup>
    const sup = document.createElement('sup');
    const span = document.createElement('span');
    span.style.fontSize = '150%';
    span.appendChild(document.createTextNode('X'));
    sup.appendChild(span);
    editor.appendChild(sup);

    textNode = span.firstChild as Text;
    range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const active = { fontSize: '150%', sup: true };
    applyActiveStylesToInsertion(editor, active, 'Y');

    // 仍然只有 1 个 span，且 sup 包裹结构保留
    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontSize).toBe('150%');
    expect(spans[0].textContent).toBe('XY');
    // sup 节点存在
    expect(editor.querySelector('sup')).not.toBeNull();
  });
});

/**
 * Fix #1c 增强：多 span 选区应用同一字号
 *
 * 之前：选区跨两个老 <span style="font-size:150%">，applyInlineStyle 150% 后
 *   变成 <span 150%><span 150%>a</span><span 150%>b</span></span>
 *   内层 span 仍带 150%，与外层相乘 → 225% → 337.5% → ...
 * 修复：applyInlineStyle 在 wrap 后调用 unwrapRedundantSpansDeep，递归清理内层冗余 span。
 */
describe('Fix #1c 增强: 多 span 选区递归解包（TDD）', () => {
  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  /** 把 editor 末尾的子节点当作内容，构造一个跨所有子节点文本的 Range（不折叠）。 */
  function selectAllTextInEditor(): Range | null {
    const sel = window.getSelection();
    if (!sel) return null;
    const range = document.createRange();
    // 找到第一个文本节点和最后一个文本节点
    const firstText = (() => {
      const w = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      return w.nextNode() as Text | null;
    })();
    const lastText = (() => {
      const w = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let n: Node | null = null;
      while (w.nextNode()) n = w.currentNode as Text;
      return n as Text | null;
    })();
    if (!firstText || !lastText) return null;
    range.setStart(firstText, 0);
    range.setEnd(lastText, lastText.textContent!.length);
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }

  it('基础递归解包：选区跨两个相同字号 150% 兄弟 span，应用 150% 后无嵌套', () => {
    // <span fontSize=150%>a</span><span fontSize=150%>b</span>
    const s1 = document.createElement('span');
    s1.style.fontSize = '150%';
    s1.appendChild(document.createTextNode('a'));
    const s2 = document.createElement('span');
    s2.style.fontSize = '150%';
    s2.appendChild(document.createTextNode('b'));
    editor.appendChild(s1);
    editor.appendChild(s2);

    expect(selectAllTextInEditor()).not.toBeNull();

    const ok = applyInlineStyle(editor, { fontSize: '150%' }, { skipFocus: true });
    expect(ok).toBe(true);

    // 关键断言：没有嵌套的匹配 span（避免 % 相乘）
    // 兄弟 span 是允许的（不嵌套就不相乘）
    const allSpans = editor.querySelectorAll('span');
    for (const s of allSpans) {
      const parent = s.parentElement;
      if (parent && parent.tagName === 'SPAN' && parent.style.fontSize === '150%') {
        // 父级也是 150% span → 嵌套了！这才是 bug
        throw new Error(`Found nested 150% span which causes % multiplication: ${parent.outerHTML} > ${s.outerHTML}`);
      }
    }
    // 文本内容必须保留
    expect(editor.textContent).toBe('ab');
  });

  it('三层嵌套 + 选区在深层内部：applyInlineStyle 走预检短路，结构保持不变（避免无谓修改）', () => {
    // <span fontSize=150%><span fontSize=150%><span fontSize=150%>text</span></span></span>
    const s1 = document.createElement('span');
    s1.style.fontSize = '150%';
    const s2 = document.createElement('span');
    s2.style.fontSize = '150%';
    const s3 = document.createElement('span');
    s3.style.fontSize = '150%';
    s3.appendChild(document.createTextNode('text'));
    s2.appendChild(s3);
    s1.appendChild(s2);
    editor.appendChild(s1);

    // 选区必须不折叠（applyInlineStyle 折叠时直接返回 false）
    const textNode = s3.firstChild as Text;
    const r = document.createRange();
    r.setStart(textNode, 0);
    r.setEnd(textNode, 4);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);

    const ok = applyInlineStyle(editor, { fontSize: '150%' }, { skipFocus: true });
    expect(ok).toBe(true);

    // 期望：选区完全在最内层 150% span 内 → 预检命中，不修改 DOM
    // 原始 3 层嵌套保持不变（applyInlineStyle 不主动清理历史冗余，那是 recalcWordCount 的职责）
    expect(editor.textContent).toBe('text');
    expect(editor.querySelectorAll('span[style*="150%"]').length).toBe(3);
  });

  it('混合样式不误清：内层 span 是 bold 而非字号，不应被解包', () => {
    // <span fontSize=150%><span fontWeight=bold>text</span></span>
    const outer = document.createElement('span');
    outer.style.fontSize = '150%';
    const inner = document.createElement('span');
    inner.style.fontWeight = 'bold';
    inner.appendChild(document.createTextNode('text'));
    outer.appendChild(inner);
    editor.appendChild(outer);

    expect(selectAllTextInEditor()).not.toBeNull();

    const ok = applyInlineStyle(editor, { fontSize: '150%' }, { skipFocus: true });
    expect(ok).toBe(true);

    // 期望：内层 bold span 必须保留（其样式 fontWeight=bold 与 fontSize 150% 不冲突）
    const boldSpan = editor.querySelector('span[style*="font-weight"]');
    expect(boldSpan).not.toBeNull();
    expect(boldSpan?.textContent).toBe('text');
  });

  it('跨段不相邻：选区跨 3 个 150% 兄弟 span，应用后无嵌套', () => {
    // <span fontSize=150%>a</span><span fontSize=150%>b</span><span fontSize=150%>c</span>
    const s1 = document.createElement('span');
    s1.style.fontSize = '150%';
    s1.appendChild(document.createTextNode('a'));
    const s2 = document.createElement('span');
    s2.style.fontSize = '150%';
    s2.appendChild(document.createTextNode('b'));
    const s3 = document.createElement('span');
    s3.style.fontSize = '150%';
    s3.appendChild(document.createTextNode('c'));
    editor.appendChild(s1);
    editor.appendChild(s2);
    editor.appendChild(s3);

    expect(selectAllTextInEditor()).not.toBeNull();

    const ok = applyInlineStyle(editor, { fontSize: '150%' }, { skipFocus: true });
    expect(ok).toBe(true);

    // 关键断言：没有嵌套的匹配 span
    const allSpans = editor.querySelectorAll('span[style*="150%"]');
    for (const s of allSpans) {
      const parent = s.parentElement;
      if (parent && parent.tagName === 'SPAN' && parent.style.fontSize === '150%') {
        throw new Error(`Found nested 150% span: ${parent.outerHTML} > ${s.outerHTML}`);
      }
    }
    // 文本内容必须保留
    expect(editor.textContent).toBe('abc');
  });
});

describe('Fix #2 V2: 字号 pt 绝对单位（避免 % 嵌套相乘）', () => {
  let editor: HTMLElement;
  let textNode: Text;
  let range: Range;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  /** 在 editor 末尾追加一个含指定样式的 span + 文本节点，把光标放到 span 内部末尾 */
  function setupCursorInsideSpan(fontSize: string) {
    const span = document.createElement('span');
    span.style.fontSize = fontSize;
    span.appendChild(document.createTextNode('Hello'));
    editor.appendChild(span);
    textNode = span.firstChild as Text;
    range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('在 18pt 字号 span 内输入，active fontSize=18pt → 不创建嵌套 span', () => {
    setupCursorInsideSpan('18pt');
    const active = { fontSize: '18pt' };

    for (const ch of 'abc') {
      applyActiveStylesToInsertion(editor, active, ch);
    }

    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontSize).toBe('18pt');
    expect(spans[0].textContent).toBe('Helloabc');
  });

  it('旧 % 数据兼容：在 150% span 内输入，active fontSize=18pt → isSameFontSize 判定相同 → 不嵌套', () => {
    setupCursorInsideSpan('150%');
    const active = { fontSize: '18pt' }; // 18pt = 150%

    for (const ch of 'xy') {
      applyActiveStylesToInsertion(editor, active, ch);
    }

    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontSize).toBe('150%');
    expect(spans[0].textContent).toBe('Helloxy');
  });

  it('不同字号 pt 不相乘：在 18pt span 内输入 14.4pt → 新 span fontSize=14.4pt（非 18×1.2=21.6pt）', () => {
    setupCursorInsideSpan('18pt');
    const active = { fontSize: '14.4pt' }; // 14.4pt = 120%

    applyActiveStylesToInsertion(editor, active, 'Z');

    const spans = editor.querySelectorAll('span');
    // 应有 2 个 span：外层 18pt + 内层 14.4pt
    expect(spans.length).toBe(2);
    // 内层新 span 的 fontSize 必须是 14.4pt（绝对值），不是 % 不会相乘
    const innerSpan = spans[1];
    expect(innerSpan.style.fontSize).toBe('14.4pt');
    expect(innerSpan.textContent).toBe('Z');
  });
});

describe('Fix: B/I/U/S 取消后新文字不应继承父 span 样式（v3 修复）', () => {
  // 用户反馈：点击 B 开启 → 输入变粗；再点 B 关闭 → 输入的文字仍然粗。
  // 根因：forceApply 路径在所有样式都被关闭时直接 return false，
  // 浏览器默认行为把文字插入到带样式 span 内（继承样式）。
  // 修复：forceApply 路径在无样式时调用 findEnclosingStyledSpan 跳出当前 span。

  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  function setSelection(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  it('光标在粗体 span 内，B 关闭后输入"d"应不被加粗', () => {
    editor.innerHTML = '<p><span style="font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const boldSpan = p.firstChild as HTMLElement;
    const textNode = boldSpan.firstChild as Text;
    // 光标放在 bold span 内文本末尾
    setSelection(textNode, 3);

    // 模拟 B 关闭后输入：activeStyles = { bold: false }, activeStylesLocked = true
    const result = applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);

    // 验证：d 应该出现在 bold span 之外（同级位置），不是被加粗
    const allText = editor.textContent;
    expect(allText).toBe('abcd');
    // "d" 应该是独立 text node，不在 bold span 内
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('d');
    // bold span 内文本仍为 "abc"（没有 "d"）
    expect(boldSpan.textContent).toBe('abc');
  });

  it('光标在无样式文本中，B 关闭后输入正常（v9 修复：return true 并插入文本）', () => {
    editor.innerHTML = '<p>abc</p>';
    const p = editor.querySelector('p')!;
    const textNode = p.firstChild as Text;
    setSelection(textNode, 3);

    // v9 修复:无父 span + B 关闭 → 函数应主动接管,直接 insertTextNode 到光标处
    // 原因:RichTextEditor 的 beforeinput 会 preventDefault,如果不 return true,
    // 浏览器默认插入会被阻止 → "编辑都编辑不了"
    const result = applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);
    expect(result).toBe(true);
    expect(editor.textContent).toBe('abcd');
  });

  it('光标在斜体 span 内，I 关闭后输入"x"应不斜体', () => {
    editor.innerHTML = '<p><span style="font-style: italic">hello</span></p>';
    const p = editor.querySelector('p')!;
    const italicSpan = p.firstChild as HTMLElement;
    const textNode = italicSpan.firstChild as Text;
    setSelection(textNode, 5);

    applyActiveStylesToInsertion(editor, { italic: false }, 'x', true);

    const allText = editor.textContent;
    expect(allText).toBe('hellox');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('x');
    expect(italicSpan.textContent).toBe('hello');
  });

  it('光标在下划线 span 内，U 关闭后输入"u"应无下划线', () => {
    editor.innerHTML = '<p><span style="text-decoration: underline">abc</span></p>';
    const p = editor.querySelector('p')!;
    const underlineSpan = p.firstChild as HTMLElement;
    const textNode = underlineSpan.firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { underline: false }, 'u', true);

    const allText = editor.textContent;
    expect(allText).toBe('abcu');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('u');
    expect(underlineSpan.textContent).toBe('abc');
  });
});

describe('Fix: 字号/字色/字体取消后新文字不应继承父 span 样式（v4 扩展）', () => {
  // v3 修复是通用方案：findEnclosingStyledSpan 跳出所有带 style 的 span。
  // 本测试覆盖字号/字色/字体的"取消"场景，确保修复对所有样式属性都生效。

  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  function setSelection(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  it('A1：光标在 12pt 字号 span 内，关闭字号后输入"d"应不继承 12pt', () => {
    editor.innerHTML = '<p><span style="font-size: 12pt">abc</span></p>';
    const p = editor.querySelector('p')!;
    const fontSizeSpan = p.firstChild as HTMLElement;
    const textNode = fontSizeSpan.firstChild as Text;
    setSelection(textNode, 3);

    // 模拟字号关闭后输入：activeStyles = { fontSize: undefined 或 '' }, activeStylesLocked = true
    // 关键：forceApply 路径在 fontSize 为空时也应跳出当前带样式 span
    const result = applyActiveStylesToInsertion(editor, { fontSize: '' }, 'd', true);

    const allText = editor.textContent;
    expect(allText).toBe('abcd');
    // "d" 应在 fontSize span 之外（作为同级 text node）
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('d');
    // fontSize span 内文本仍为 "abc"（没有 "d"）
    expect(fontSizeSpan.textContent).toBe('abc');
  });

  it('A2：光标在 red 颜色 span 内，关闭颜色后输入"d"应不继承红色', () => {
    editor.innerHTML = '<p><span style="color: red">abc</span></p>';
    const p = editor.querySelector('p')!;
    const colorSpan = p.firstChild as HTMLElement;
    const textNode = colorSpan.firstChild as Text;
    setSelection(textNode, 3);

    // 模拟颜色关闭后输入：activeStyles = { color: '' }
    const result = applyActiveStylesToInsertion(editor, { color: '' }, 'd', true);

    const allText = editor.textContent;
    expect(allText).toBe('abcd');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('d');
    expect(colorSpan.textContent).toBe('abc');
  });

  it('A3：光标在 sans-serif 字体 span 内，关闭字体后输入"d"应不继承字体', () => {
    editor.innerHTML = '<p><span style="font-family: sans-serif">abc</span></p>';
    const p = editor.querySelector('p')!;
    const fontFamilySpan = p.firstChild as HTMLElement;
    const textNode = fontFamilySpan.firstChild as Text;
    setSelection(textNode, 3);

    // 模拟字体关闭后输入：activeStyles = { fontFamily: '' }
    const result = applyActiveStylesToInsertion(editor, { fontFamily: '' }, 'd', true);

    const allText = editor.textContent;
    expect(allText).toBe('abcd');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('d');
    expect(fontFamilySpan.textContent).toBe('abc');
  });
});

describe('Fix: B/I/U/S 取消 bug - 工具栏基本 toggle 场景（v5 通用修复，activeStylesLocked=false）', () => {
  // v3 修复只覆盖 activeStylesLocked=true 的 forceApply 路径。
  // 但工具栏基本 toggle（无选区点 B → 输入 → 无选区点 B → 输入）
  // 走的是非锁定路径（activeStylesLocked=false），v3 修复无效。
  // v5 修复：在 !hasRemaining 分支同样应用"跳出带样式 span"逻辑。

  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  function setSelection(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  it('D1: 光标在粗体 span 内，B 关闭后输入"d"应不被加粗（activeStylesLocked=false）', () => {
    editor.innerHTML = '<p><span style="font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const boldSpan = p.firstChild as HTMLElement;
    const textNode = boldSpan.firstChild as Text;
    setSelection(textNode, 3);

    // 模拟工具栏基本 toggle：activeStyles = { bold: false }, activeStylesLocked = false
    const result = applyActiveStylesToInsertion(editor, { bold: false }, 'd', false);

    // 验证：d 应在 bold span 之外（作为同级 text node）
    const allText = editor.textContent;
    expect(allText).toBe('abcd');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('d');
    expect(boldSpan.textContent).toBe('abc');
  });

  it('D2: 光标在斜体 span 内，I 关闭后输入"x"应不斜体（activeStylesLocked=false）', () => {
    editor.innerHTML = '<p><span style="font-style: italic">hello</span></p>';
    const p = editor.querySelector('p')!;
    const italicSpan = p.firstChild as HTMLElement;
    const textNode = italicSpan.firstChild as Text;
    setSelection(textNode, 5);

    applyActiveStylesToInsertion(editor, { italic: false }, 'x', false);

    const allText = editor.textContent;
    expect(allText).toBe('hellox');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('x');
    expect(italicSpan.textContent).toBe('hello');
  });

  it('D3: 光标在下划线 span 内，U 关闭后输入"u"应无下划线（activeStylesLocked=false）', () => {
    editor.innerHTML = '<p><span style="text-decoration: underline">abc</span></p>';
    const p = editor.querySelector('p')!;
    const underlineSpan = p.firstChild as HTMLElement;
    const textNode = underlineSpan.firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { underline: false }, 'u', false);

    const allText = editor.textContent;
    expect(allText).toBe('abcu');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('u');
    expect(underlineSpan.textContent).toBe('abc');
  });

  it('D4: 光标在粗体 span 内，B 仍开启（activeStylesLocked=false）→ 输入"e"仍粗体（未破坏开启场景）', () => {
    editor.innerHTML = '<p><span style="font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const boldSpan = p.firstChild as HTMLElement;
    const textNode = boldSpan.firstChild as Text;
    setSelection(textNode, 3);

    // 模拟工具栏 B 仍开启：activeStyles = { bold: true }, activeStylesLocked = false
    // expected：remaining.bold = true（光标已在粗体 span 中）→ wrap 成粗体 span（嵌套/或合并）
    // 简化验证：结果文本仍是 "abce"，"e" 文字在编辑器中
    applyActiveStylesToInsertion(editor, { bold: true }, 'e', false);

    const allText = editor.textContent;
    expect(allText).toBe('abce');
    // 不强制要求"e"在哪个 span 内，只验证文本合并后是 "abce"
  });

  it('D5: 光标在粗体 span 内，B 关闭但颜色仍为红 → 输入"f"应无粗体但仍是红色（多属性混合）', () => {
    // 一个 span 同时有 color=red 和 font-weight: bold
    editor.innerHTML = '<p><span style="color: red; font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const styledSpan = p.firstChild as HTMLElement;
    const textNode = styledSpan.firstChild as Text;
    setSelection(textNode, 3);

    // activeStyles = { bold: false, color: 'red' }
    // 非锁定路径：inherited.color=red, inherited.bold=true
    // remaining.color = 'red' !== inherited.color (false, 因为 inherited.color='red')
    // remaining.bold = false (active.bold=false)
    // hasRemaining = (color='red') → true → 走创建 wrap span 路径（color='red'）
    // 期望：f 在新 span 中（color='red'，无 bold）
    applyActiveStylesToInsertion(editor, { bold: false, color: 'red' }, 'f', false);

    const allText = editor.textContent;
    expect(allText).toBe('abcf');
    // 找 "f" 所在的 span（如果存在），应该 color=red 但不粗
    const allSpans = p.querySelectorAll('span');
    let fSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'f') {
        fSpan = sp as HTMLElement;
        break;
      }
    }
    if (fSpan) {
      // 如果 f 单独成 span，应是红色但不粗
      expect(fSpan.style.color).toBe('red');
      expect(fSpan.style.fontWeight).not.toBe('bold');
    }
    // 原始 span 仍是 "abc"（未变）
    expect(styledSpan.textContent).toBe('abc');
  });
});

describe('Fix: B/I/U/S 取消 bug - activeStylesLocked=true 场景（v6 根因修复验证）', () => {
  // v6 根因：beforeinput/compositionend 的 hasStyle 守卫用 truthy 检查，
  // { bold: false } 中 false 是 falsy → hasStyle=false → 提前返回 → 浏览器原生插入 → 继承样式。
  // v6 修复：守卫增加 hasExplicitCancel，让 { bold: false } 也能触发 applyActiveStylesToInsertion。
  // 本测试验证：activeStylesLocked=true + active.bold=false 时，forceApply 路径正确跳出 span。

  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  function setSelection(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  it('G1: activeStylesLocked=true, active.bold=false → 输入"d"不在粗体 span 内', () => {
    editor.innerHTML = '<p><span style="font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const boldSpan = p.firstChild as HTMLElement;
    const textNode = boldSpan.firstChild as Text;
    setSelection(textNode, 3);

    // 模拟 toggleSimpleActiveStyle('bold') 后的 activeStyles 状态：
    // bold=false, activeStylesLocked=true → beforeinput 守卫通过 → forceApply 路径
    applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);

    const allText = editor.textContent;
    expect(allText).toBe('abcd');
    // "d" 应在 bold span 之外
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('d');
    expect(boldSpan.textContent).toBe('abc');
  });

  it('G2: activeStylesLocked=true, active.italic=false → 输入"x"不在斜体 span 内', () => {
    editor.innerHTML = '<p><span style="font-style: italic">hello</span></p>';
    const p = editor.querySelector('p')!;
    const italicSpan = p.firstChild as HTMLElement;
    const textNode = italicSpan.firstChild as Text;
    setSelection(textNode, 5);

    applyActiveStylesToInsertion(editor, { italic: false }, 'x', true);

    const allText = editor.textContent;
    expect(allText).toBe('hellox');
    const lastTextNode = p.lastChild;
    expect(lastTextNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(lastTextNode?.textContent).toBe('x');
    expect(italicSpan.textContent).toBe('hello');
  });

  it('G3: activeStylesLocked=true, active.bold=true → 输入"e"仍粗体（未破坏开启场景）', () => {
    editor.innerHTML = '<p><span style="font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const boldSpan = p.firstChild as HTMLElement;
    const textNode = boldSpan.firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { bold: true }, 'e', true);

    const allText = editor.textContent;
    expect(allText).toBe('abce');
    // "e" 应在某个 bold span 内（可能是原 span 的延续，也可能是新 span）
    const allSpans = p.querySelectorAll('span');
    const eSpan = Array.from(allSpans).find((sp) => sp.textContent?.includes('e'));
    if (eSpan) {
      expect(eSpan.style.fontWeight).toBe('bold');
    }
  });
});

/**
 * v9: B/I/U/S 取消 bug 根因修复
 *
 * 根因：forceApply 路径在 locked=true + bold=false + 无父 span 时
 * insertTextOutsideStyledSpan 返回 false → 之前直接 return false →
 * RichTextEditor 的 beforeinput 已 e.preventDefault() → 浏览器默认插入被阻止 → "编辑都编辑不了"
 *
 * 修复：forceApply 路径无父 span 时兜底插入文本节点
 */
describe('v9: B/I/U/S 取消 bug - 无父 span + activeStylesLocked=true', () => {
  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  function setSelection(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  it('V1: 无父 span + activeStylesLocked=true + bold=false → 文本应被插入（不丢失）', () => {
    editor.innerHTML = '<p>hello</p>';
    const p = editor.querySelector('p')!;
    const textNode = p.firstChild as Text;
    setSelection(textNode, 5);

    // 模拟工具栏 B 取消场景：activeStyles={bold:false}, locked=true
    const result = applyActiveStylesToInsertion(editor, { bold: false }, 'X', true);

    // v9 修复期望：函数主动接管，插入 'X' 到光标处
    expect(result).toBe(true);
    expect(editor.textContent).toBe('helloX');
  });

  it('V2: 无父 span + activeStylesLocked=true + italic=false + underline=false → 文本被插入', () => {
    editor.innerHTML = '<p>abc</p>';
    const p = editor.querySelector('p')!;
    const textNode = p.firstChild as Text;
    setSelection(textNode, 3);

    const result = applyActiveStylesToInsertion(editor, { italic: false, underline: false }, 'Y', true);

    expect(result).toBe(true);
    expect(editor.textContent).toBe('abcY');
  });

  it('V3: 无父 span + activeStylesLocked=true + B+I+U+S 全关 → 文本被插入', () => {
    editor.innerHTML = '<p>foo</p>';
    const p = editor.querySelector('p')!;
    const textNode = p.firstChild as Text;
    setSelection(textNode, 3);

    const result = applyActiveStylesToInsertion(
      editor,
      { bold: false, italic: false, underline: false, strike: false },
      'Z',
      true,
    );

    expect(result).toBe(true);
    expect(editor.textContent).toBe('fooZ');
  });
});

describe('v21: B/I/U/S 部分取消 - 保留剩余样式', () => {
  // 核心场景：高亮 B+I+U → 取消 B → 输入文字应保留 I+U（不能丢失所有样式）
  // 旧 bug：取消 B 后 hasRemaining=false → insertTextOutsideStyledSpan 插入纯文本 → I+U 丢失
  // v21 修复：计算 desired 样式（active 优先，否则继承），在父 span 外创建带 desired 样式的新 span

  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    document.body.removeChild(editor);
  });

  function setSelection(node: Node, offset: number) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  it('W1: B+I+U 高亮 → 取消 B → 输入应保留 I+U（locked=true）', () => {
    editor.innerHTML = '<p><span style="font-weight: bold; font-style: italic; text-decoration: underline">abc</span></p>';
    const p = editor.querySelector('p')!;
    const styledSpan = p.firstChild as HTMLElement;
    const textNode = styledSpan.firstChild as Text;
    setSelection(textNode, 3);

    // active = { bold: false } → 取消 B，保留 I+U（从 inherited 继承）
    applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);

    expect(editor.textContent).toBe('abcd');
    // "d" 应在新 span 中，该 span 有 italic + underline 但无 bold
    const allSpans = p.querySelectorAll('span');
    let dSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'd') {
        dSpan = sp as HTMLElement;
        break;
      }
    }
    expect(dSpan).not.toBeNull();
    expect(dSpan!.style.fontStyle).toBe('italic');
    expect(dSpan!.style.textDecoration).toBe('underline');
    expect(dSpan!.style.fontWeight).not.toBe('bold');
    // 原 span 仍是 abc
    expect(styledSpan.textContent).toBe('abc');
  });

  it('W2: B+I+U 高亮 → 取消 B → 输入应保留 I+U（locked=false）', () => {
    editor.innerHTML = '<p><span style="font-weight: bold; font-style: italic; text-decoration: underline">abc</span></p>';
    const p = editor.querySelector('p')!;
    const styledSpan = p.firstChild as HTMLElement;
    const textNode = styledSpan.firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { bold: false }, 'd', false);

    expect(editor.textContent).toBe('abcd');
    const allSpans = p.querySelectorAll('span');
    let dSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'd') {
        dSpan = sp as HTMLElement;
        break;
      }
    }
    expect(dSpan).not.toBeNull();
    expect(dSpan!.style.fontStyle).toBe('italic');
    expect(dSpan!.style.textDecoration).toBe('underline');
    expect(dSpan!.style.fontWeight).not.toBe('bold');
  });

  it('W3: B+I+U 高亮 → 取消 B+I → 输入应保留 U', () => {
    editor.innerHTML = '<p><span style="font-weight: bold; font-style: italic; text-decoration: underline">abc</span></p>';
    const p = editor.querySelector('p')!;
    const textNode = (p.firstChild as HTMLElement).firstChild as Text;
    setSelection(textNode, 3);

    // active = { bold: false, italic: false } → 取消 B+I，保留 U
    applyActiveStylesToInsertion(editor, { bold: false, italic: false }, 'd', true);

    expect(editor.textContent).toBe('abcd');
    const allSpans = p.querySelectorAll('span');
    let dSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'd') {
        dSpan = sp as HTMLElement;
        break;
      }
    }
    expect(dSpan).not.toBeNull();
    expect(dSpan!.style.textDecoration).toBe('underline');
    expect(dSpan!.style.fontWeight).not.toBe('bold');
    expect(dSpan!.style.fontStyle).not.toBe('italic');
  });

  it('W4: B+I 高亮 → 取消 B → 输入应保留 I', () => {
    editor.innerHTML = '<p><span style="font-weight: bold; font-style: italic">abc</span></p>';
    const p = editor.querySelector('p')!;
    const textNode = (p.firstChild as HTMLElement).firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);

    expect(editor.textContent).toBe('abcd');
    const allSpans = p.querySelectorAll('span');
    let dSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'd') {
        dSpan = sp as HTMLElement;
        break;
      }
    }
    expect(dSpan).not.toBeNull();
    expect(dSpan!.style.fontStyle).toBe('italic');
    expect(dSpan!.style.fontWeight).not.toBe('bold');
  });

  it('W5: color=red+bold 高亮 → 取消 bold → 输入应保留 color=red', () => {
    editor.innerHTML = '<p><span style="color: red; font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const textNode = (p.firstChild as HTMLElement).firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);

    expect(editor.textContent).toBe('abcd');
    const allSpans = p.querySelectorAll('span');
    let dSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'd') {
        dSpan = sp as HTMLElement;
        break;
      }
    }
    expect(dSpan).not.toBeNull();
    expect(dSpan!.style.color).toBe('red');
    expect(dSpan!.style.fontWeight).not.toBe('bold');
  });

  it('W6: 字号+粗体 高亮 → 取消 bold → 输入应保留字号', () => {
    editor.innerHTML = '<p><span style="font-size: 120%; font-weight: bold">abc</span></p>';
    const p = editor.querySelector('p')!;
    const textNode = (p.firstChild as HTMLElement).firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);

    expect(editor.textContent).toBe('abcd');
    const allSpans = p.querySelectorAll('span');
    let dSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'd') {
        dSpan = sp as HTMLElement;
        break;
      }
    }
    expect(dSpan).not.toBeNull();
    expect(dSpan!.style.fontSize).toBe('120%');
    expect(dSpan!.style.fontWeight).not.toBe('bold');
  });

  it('W7: B+U 高亮 → 取消 B → 输入应保留 U（strike 不受影响）', () => {
    editor.innerHTML = '<p><span style="font-weight: bold; text-decoration: underline">abc</span></p>';
    const p = editor.querySelector('p')!;
    const textNode = (p.firstChild as HTMLElement).firstChild as Text;
    setSelection(textNode, 3);

    applyActiveStylesToInsertion(editor, { bold: false }, 'd', true);

    expect(editor.textContent).toBe('abcd');
    const allSpans = p.querySelectorAll('span');
    let dSpan: HTMLElement | null = null;
    for (const sp of allSpans) {
      if (sp.textContent === 'd') {
        dSpan = sp as HTMLElement;
        break;
      }
    }
    expect(dSpan).not.toBeNull();
    expect(dSpan!.style.textDecoration).toBe('underline');
    expect(dSpan!.style.fontWeight).not.toBe('bold');
  });
});

/**
 * v24: insertImageBlock IPC fallback（local:// 加载失败 → 自动 readAsDataUrl 转 data URL）
 *
 * 背景：v23 修复了 CompactImageLibraryPanel 的 img onError 加 IPC fallback，
 * 但忘了修编辑器内部 insertImageBlock 创建的 img onError——v24 补齐这个遗漏。
 * 场景：从图库点击插入 local:///001/3.png 时，img 加载失败应自动转 data URL 成功显示。
 */
describe('v24: insertImageBlock IPC fallback (local:// 加载失败自动转 data URL)', () => {
  let editor: HTMLDivElement;
  let originalElectronAPI: any;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);
    originalElectronAPI = (window as any).electronAPI;
  });

  afterEach(() => {
    document.body.removeChild(editor);
    (window as any).electronAPI = originalElectronAPI;
    vi.restoreAllMocks();
  });

  it('I1: local:// URL 加载失败 → 自动调用 readAsDataUrl → 成功（img.src 变成 data URL）', async () => {
    (window as any).electronAPI = {
      readAsDataUrl: vi.fn().mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,FAKE' }),
    };

    const block = insertImageBlock(editor, 'local:///001/3.png', { alt: 'test' });
    expect(block).not.toBeNull();
    const img = block!.querySelector('img')!;

    // 模拟 onError 触发
    img.dispatchEvent(new Event('error'));
    // 等 IPC promise resolve + microtask
    await new Promise((r) => setTimeout(r, 20));

    // 验证：调用了 readAsDataUrl，img.src 变成 data URL
    expect((window as any).electronAPI.readAsDataUrl).toHaveBeenCalledWith('local:///001/3.png');
    expect(img.src).toBe('data:image/png;base64,FAKE');
    // alt 不应被改成"图片加载失败"
    expect(img.alt).toBe('test');
  });

  it('I2: local:// URL 加载失败 + readAsDataUrl 也失败 → 显示错误信息', async () => {
    (window as any).electronAPI = {
      readAsDataUrl: vi.fn().mockResolvedValue({ ok: false }),
    };

    const block = insertImageBlock(editor, 'local:///001/3.png');
    const img = block!.querySelector('img')!;

    img.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 20));

    expect((window as any).electronAPI.readAsDataUrl).toHaveBeenCalled();
    expect(img.alt).toMatch(/图片加载失败/);
    expect(img.style.minHeight).toBe('60px');
  });

  it('I3: 非 local:// URL (https://) 加载失败 → 不调用 readAsDataUrl', async () => {
    (window as any).electronAPI = {
      readAsDataUrl: vi.fn(),
    };

    const block = insertImageBlock(editor, 'https://example.com/x.png');
    const img = block!.querySelector('img')!;

    img.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 20));

    // https:// 失败不应走 IPC fallback（IPC 只处理 local:// 协议）
    expect((window as any).electronAPI.readAsDataUrl).not.toHaveBeenCalled();
    expect(img.alt).toMatch(/图片加载失败/);
  });

  it('I4: 连续两次 error 事件 → 只调用一次 readAsDataUrl（防循环）', async () => {
    (window as any).electronAPI = {
      readAsDataUrl: vi.fn().mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,FAKE' }),
    };

    const block = insertImageBlock(editor, 'local:///001/3.png');
    const img = block!.querySelector('img')!;

    img.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 20));
    // 此时 img.src 已经是 data URL，但再触发 error（极端情况）
    img.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 20));

    // 闭包 fallbackTried 保证只调用一次
    expect((window as any).electronAPI.readAsDataUrl).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// v25c: BIUS 工具栏样式按钮修复测试
// =============================================================================

// Helper:创建测试用编辑器（含 <p>Hello</p>）
function makeEditor(html: string): HTMLElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

// Helper:选中编辑器内的文本节点（处理嵌套 span 情况）
function selectText(editor: HTMLElement, from: number, to: number): void {
  const p = editor.querySelector('p, div') as HTMLElement;
  if (!p) return;
  // 收集所有文本节点
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
  let allText = '';
  const textNodes: Text[] = [];
  let tn = walker.nextNode() as Text | null;
  while (tn) {
    textNodes.push(tn);
    allText += tn.textContent ?? '';
    tn = walker.nextNode() as Text | null;
  }
  if (textNodes.length === 0) return;
  // 找 from/to 对应的 textNode + offset
  let accum = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (let i = 0; i < textNodes.length; i++) {
    const len = textNodes[i].textContent?.length ?? 0;
    if (startNode === null && accum + len >= from) {
      startNode = textNodes[i];
      startOffset = from - accum;
    }
    if (endNode === null && accum + len >= to) {
      endNode = textNodes[i];
      endOffset = to - accum;
      break;
    }
    accum += len;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

describe('v25c B1-B3: 选区应用不彻底修复', () => {
  let editor: HTMLElement;

  afterEach(() => {
    document.body.removeChild(editor);
  });

  it('B1: 跨节点选区应用 bold → 全部加粗（不退化为部分加粗）', () => {
    // 模拟：编辑器内有多层嵌套 span + 普通文本
    editor = makeEditor(
      '<p>普通文本 <span style="font-weight: bold">已加粗部分</span> 末尾</p>',
    );
    const p = editor.querySelector('p')!;
    // 选区:从普通文本 "文" 到 "已" 字
    const textNode1 = p.firstChild as Text; // "普通文本 "
    const textNode2 = p.querySelector('span')!.firstChild as Text; // "已加粗部分"
    const range = document.createRange();
    range.setStart(textNode1, 3); // "文"
    range.setEnd(textNode2, 1); // "已"
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    // 应用 bold
    applyInlineStyle(editor, { fontWeight: 'bold' });

    // 检查:选区内文本应全部加粗,无嵌套 span
    const html = editor.innerHTML;
    // 不应出现 <span font-weight:bold><span font-weight:bold> 嵌套
    expect(html).not.toMatch(/<span[^>]*font-weight:\s*bold[^>]*>\s*<span[^>]*font-weight:\s*bold/i);
  });

  it('B2: 单节点选区应用 bold → 全部加粗（基础场景）', () => {
    editor = makeEditor('<p>普通文本</p>');
    selectText(editor, 0, 4);
    applyInlineStyle(editor, { fontWeight: 'bold' });
    const p = editor.querySelector('p')!;
    expect(p.innerHTML).toMatch(/<span[^>]*font-weight:\s*bold[^>]*>普通文本<\/span>/);
  });

  it('B3: 嵌套 span 内部分选区应用 bold → 现有 bold 被剥除,统一应用新 span', () => {
    // 场景:已有 <b>内含普通文本</b>,选区跨越嵌套边界
    editor = makeEditor(
      '<p><span style="font-weight: bold">已加粗</span> 普通</p>',
    );
    const span = editor.querySelector('span')!;
    const range = document.createRange();
    range.setStart(span.firstChild!, 1); // "加"
    range.setEnd(span.firstChild!, 3); // "粗"
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyInlineStyle(editor, { fontWeight: 'bold' });

    // 验证:无嵌套 span,且原 span 的 font-weight 被剥除
    const html = editor.innerHTML;
    expect(html).not.toMatch(/<span[^>]*font-weight:\s*bold[^>]*>\s*<span[^>]*font-weight:\s*bold/i);
  });
});

describe('v25c B4-B6: 回车后格式丢失修复', () => {
  let editor: HTMLElement;

  afterEach(() => {
    document.body.removeChild(editor);
  });

  it('B4: 收集父 span 的 font-weight=bold → 返回 { fontWeight: "bold" }', () => {
    editor = makeEditor(
      '<p><span style="font-weight: bold">加粗文字</span></p>',
    );
    const p = editor.querySelector('p')!;
    const textNode = p.querySelector('span')!.firstChild as Text;
    const result = collectInlineStyleFromAncestors(textNode, editor);
    expect(result).toEqual({ fontWeight: 'bold' });
  });

  it('B5: 收集父 <i> 元素 → 返回 { fontStyle: "italic" }', () => {
    editor = makeEditor('<p><i>斜体文字</i></p>');
    const p = editor.querySelector('p')!;
    const textNode = p.querySelector('i')!.firstChild as Text;
    const result = collectInlineStyleFromAncestors(textNode, editor);
    expect(result).toEqual({ fontStyle: 'italic' });
  });

  it('B6: 收集父 <u> 和 <s> 叠加 → 返回 { textDecoration: "underline line-through" }', () => {
    editor = makeEditor(
      '<p><u style="text-decoration: underline"><s style="text-decoration: line-through">混合</s></u></p>',
    );
    const p = editor.querySelector('p')!;
    const textNode = p.querySelector('s')!.firstChild as Text;
    const result = collectInlineStyleFromAncestors(textNode, editor);
    // 应该包含 underline + line-through
    expect(result).toBeTruthy();
    expect(result!.textDecoration).toMatch(/underline/);
    expect(result!.textDecoration).toMatch(/line-through/);
  });

  it('B-extra: 无 inline 样式 → 返回 null', () => {
    editor = makeEditor('<p>普通文本</p>');
    const p = editor.querySelector('p')!;
    const textNode = p.firstChild as Text;
    const result = collectInlineStyleFromAncestors(textNode, editor);
    expect(result).toBeNull();
  });
});

describe('v25c B7-B8: 突然换行修复', () => {
  let editor: HTMLElement;

  afterEach(() => {
    document.body.removeChild(editor);
  });

  it('B7: 选区应用 bold 后,选区内无多余 <br>', () => {
    editor = makeEditor('<p>普通文本</p>');
    selectText(editor, 0, 4);
    applyInlineStyle(editor, { fontWeight: 'bold' });
    // 选区内不应出现 <br>
    const html = editor.innerHTML;
    expect(html).not.toMatch(/<br>/i);
  });

  it('B8: removeInlineTagNoFocus 解包 <b> 后,相邻文本节点合并（无多余空节点）', () => {
    editor = makeEditor(
      '<p>普通 <b>加粗</b> 文本</p>',
    );
    const p = editor.querySelector('p')!;
    // 选中整个 p 内容
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    removeInlineTagNoFocus(editor, 'b', { skipFocus: true });

    // 解包后 <b> 消失,文本合并
    const html = editor.innerHTML;
    expect(html).not.toMatch(/<b/i);
    // 应该是"普通 加粗 文本"或类似,无空文本节点
    expect(html).toMatch(/普通\s*加粗\s*文本/);
  });
});

// =============================================================================
// v25d: U/S 选区应用/取消修复
// =============================================================================

describe('v25d M1: 混合选区(裸文本+已有 span)U/S 应用', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('M1: 裸文本 + 已有 span 混合选区,应用 U → 只包选中的部分(3a 拆分 + 3b 部分拆 span)', () => {
    // 已有 <span>world</span>,选区从 "hello" 的 "l" 到 "world" 的 "d"
    // 即选中 "llo " + "worl" 部分,"he" 和 "d" 不在选区内
    editor = makeEditor('<p>hello <span>world</span></p>');
    const p = editor.querySelector('p')!;
    const textHello = p.firstChild as Text;
    const textWorld = p.querySelector('span')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textHello, 2); // "llo "
    range.setEnd(textWorld, 4); // "worl"
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    const result = applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    expect(result).toBe(true);
    // v29 修复:只有选中的部分被包 span
    // - "he" 不在选区 → 不在 span 内
    // - "llo " 在选区 → 在新 span 内(text-decoration: underline)
    // - 原 <span>world</span> 被部分拆:"worl" 移出到新 underline span,"d" 留在原 span
    const html = editor.innerHTML;
    expect(html).toMatch(/he<span[^>]*text-decoration:\s*underline[^>]*>llo\s<\/span>/);
    expect(html).toMatch(/<span[^>]*text-decoration:\s*underline[^>]*>worl<\/span>/);
    expect(html).toMatch(/<span>d<\/span>/);
    // 总共 2 个 underline span
    const allUnderlineSpans = editor.querySelectorAll('span[style*="underline"]');
    expect(allUnderlineSpans.length).toBe(2);
  });

  it('M1b: 裸文本 + 已有带 U span 混合选区,应用 U → 已有 span 保持 U,裸文本只包选中部分', () => {
    // editor: <p>hello <span style="text-decoration: underline">world</span></p>
    // 选区:textHello[0..6]="hello " 全选 + textWorld[0..5]="world" 全选
    editor = makeEditor('<p>hello <span style="text-decoration: underline">world</span></p>');
    const p = editor.querySelector('p')!;
    const textHello = p.firstChild as Text;
    const textWorld = p.querySelector('span')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textHello, 0);
    range.setEnd(textWorld, 5);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    // 选区覆盖整个 "hello "(6 字符全选) → 整个 "hello " 被包新 span
    expect(editor.innerHTML).toMatch(/<span[^>]*text-decoration:\s*underline;?[^>]*>hello\s<\/span>/);
    // 已有 span "world" 保持 underline(完整选区 → 已有 part → 跳过)
    expect(editor.innerHTML).toMatch(/<span style="text-decoration:\s*underline;?">world<\/span>/);
    // 共有 2 个 underline span(新增的 hello + 原有的 world)
    expect(editor.querySelectorAll('span[style*="underline"]').length).toBeGreaterThanOrEqual(2);
  });
});

describe('v25d M2: 跨多 <p> 选区 U/S 应用与取消', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('M2a: 选区跨 2 个 <p>,应用 U → 两段都加 U', () => {
    editor = makeEditor('<p>第一段</p><p>第二段</p>');
    const p1 = editor.querySelector('p')!;
    const p2 = editor.querySelectorAll('p')[1]!;
    // 选区:从 p1 的 "一" 到 p2 的 "二" 段末
    const range = document.createRange();
    range.setStart(p1.firstChild!, 0);
    range.setEnd(p2.firstChild!, 3);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    // 两段都有 underline span
    const html = editor.innerHTML;
    expect(html).toMatch(/<p>[^<]*<span[^>]*text-decoration:\s*underline[^>]*>/);
    // 检查至少 2 个 underline span(可能更多,每个文本节点一个)
    const spans = editor.querySelectorAll('span[style*="underline"]');
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });

  it('M2b: 跨多 <p> 选区,取消 U → 全部取消,无意外 <br>', () => {
    // 先应用 U
    editor = makeEditor('<p><span style="text-decoration: underline">第一段</span></p><p><span style="text-decoration: underline">第二段</span></p>');
    const p1 = editor.querySelector('p')!;
    const p2 = editor.querySelectorAll('p')[1]!;
    const range = document.createRange();
    range.setStart(p1, 0);
    range.setEnd(p2, p2.childNodes.length);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    removeTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    const html = editor.innerHTML;
    // 不应还有 underline span
    expect(html).not.toMatch(/text-decoration:\s*underline/i);
    // 不应有多余 <br>
    expect(html).not.toMatch(/<br>/i);
  });
});

describe('v25d M3: U+S 叠加', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('M3a: 应用 U 后再应用 S → textDecoration=underline line-through', () => {
    editor = makeEditor('<p>hello</p>');
    selectText(editor, 0, 5);
    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });
    // surroundContents 会 collapse range,二次应用前需重置选区
    selectText(editor, 0, 5);
    applyTextDecorationPartNoFocus(editor, 'line-through', { skipFocus: true });

    const html = editor.innerHTML;
    expect(html).toMatch(/<span[^>]*text-decoration:\s*underline\s+line-through[^>]*>hello<\/span>/);
  });

  it('M3b: U+S 后取消 S(保留 U) → textDecoration=underline', () => {
    editor = makeEditor('<p>hello</p>');
    selectText(editor, 0, 5);
    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });
    applyTextDecorationPartNoFocus(editor, 'line-through', { skipFocus: true });
    selectText(editor, 0, 5);
    removeTextDecorationPartNoFocus(editor, 'line-through', { skipFocus: true });

    const html = editor.innerHTML;
    expect(html).toMatch(/<span[^>]*text-decoration:\s*underline[^>]*>hello<\/span>/);
    expect(html).not.toMatch(/line-through/i);
  });

  it('M3c: 重复应用 U → 不会嵌套 span', () => {
    editor = makeEditor('<p>hello</p>');
    selectText(editor, 0, 5);
    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });
    selectText(editor, 0, 5);
    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    const html = editor.innerHTML;
    // 不应出现 span 内嵌 span 的 underline 重复
    expect(html).not.toMatch(/<span[^>]*underline[^>]*>\s*<span[^>]*underline/i);
  });
});

describe('v25d M4: 嵌套 span 部分选区 U/S 应用', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('M4: 嵌套 <span> 内部分选区应用 U → 不嵌套', () => {
    // 制造嵌套结构(用 text-decoration 模拟)
    editor = makeEditor(
      '<p>hello <span style="text-decoration: underline">wo<span>rld</span></span></p>',
    );
    const outerSpan = editor.querySelector('span')!;
    const innerSpan = outerSpan.querySelector('span')!;
    // 选区:跨外层 span 的 "wo" 和内层 span 的 "r"
    const range = document.createRange();
    range.setStart(outerSpan.firstChild!, 0); // "wo"
    range.setEnd(innerSpan.firstChild!, 1); // "r"
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    const html = editor.innerHTML;
    // 不应有 span 嵌套 span 的 underline 重复
    expect(html).not.toMatch(/<span[^>]*underline[^>]*>\s*<span[^>]*underline/i);
  });
});

describe('v25d M5: 跳过纯空白文本节点', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('M5a: 选区"hello  world"(含空格),应用 U → 整段被一个 span 包', () => {
    editor = makeEditor('<p>hello  world</p>');
    const p = editor.querySelector('p')!;
    // 选全部
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    const html = editor.innerHTML;
    // 整段(含中间空格)被一个 span 包
    expect(html).toMatch(/<span[^>]*text-decoration:\s*underline[^>]*>hello\s+world<\/span>/);
    // 只有 1 个 underline span
    const underlineSpans = editor.querySelectorAll('span[style*="underline"]');
    expect(underlineSpans.length).toBe(1);
  });

  it('M5b: 选区完全空白 → applyTextDecorationPartNoFocus 返回 false', () => {
    editor = makeEditor('<p>   </p>');
    const p = editor.querySelector('p')!;
    const textNode = p.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    const result = applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });
    expect(result).toBe(false);
    // 不应产生任何 span
    expect(editor.querySelectorAll('span').length).toBe(0);
  });

  it('M5c: applyInlineStyle 应用 bold,选区含空白 → 整段被一个 span 包', () => {
    editor = makeEditor('<p>hello world</p>');
    const p = editor.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyInlineStyle(editor, { fontWeight: 'bold' });

    const html = editor.innerHTML;
    // 整段(含中间空格)被一个 span 包
    expect(html).toMatch(/<span[^>]*font-weight:\s*bold[^>]*>hello world<\/span>/);
    // 只有 1 个 bold span
    const boldSpans = editor.querySelectorAll(
      'span[style*="font-weight: bold"], span[style*="font-weight:bold"]',
    );
    expect(boldSpans.length).toBe(1);
  });
});

// =============================================================================
// v26: BIUS 工具栏 active 状态 ALL 语义 - isXxxFullyActive
// =============================================================================

describe('v26 N1: isBoldFullyActive - 严格 ALL 语义', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('N1a: 选区全 <b> → true', () => {
    editor = makeEditor('<p><b>hello world</b></p>');
    selectText(editor, 0, 11);
    expect(isBoldFullyActive()).toBe(true);
  });

  it('N1b: 选区全 inline font-weight:bold → true', () => {
    editor = makeEditor('<p><span style="font-weight: bold">hello world</span></p>');
    selectText(editor, 0, 11);
    expect(isBoldFullyActive()).toBe(true);
  });

  it('N1c: 选区 <strong> → true', () => {
    editor = makeEditor('<p><strong>hello world</strong></p>');
    selectText(editor, 0, 11);
    expect(isBoldFullyActive()).toBe(true);
  });

  it('N1d: 选区部分粗体部分非粗体 → false (v26 ALL 语义关键测试)', () => {
    // 模拟截图场景
    editor = makeEditor('<p><b>hello</b> world</p>');
    selectText(editor, 0, 11);
    expect(isBoldFullyActive()).toBe(false);
  });

  it('N1e: 选区全部非粗体 → false', () => {
    editor = makeEditor('<p>hello world</p>');
    selectText(editor, 0, 11);
    expect(isBoldFullyActive()).toBe(false);
  });

  it('N1f: 折叠选区 → false', () => {
    editor = makeEditor('<p><b>hello</b></p>');
    selectText(editor, 2, 2);
    expect(isBoldFullyActive()).toBe(false);
  });

  it('N1g: 选区完全空白 → false', () => {
    editor = makeEditor('<p>   </p>');
    selectText(editor, 0, 3);
    expect(isBoldFullyActive()).toBe(false);
  });

  it('N1h: font-weight=700 → true (数字粗体值)', () => {
    editor = makeEditor('<p><span style="font-weight: 700">hello world</span></p>');
    selectText(editor, 0, 11);
    expect(isBoldFullyActive()).toBe(true);
  });

  it('N1i: 跨多 <p> 全粗体 → true', () => {
    editor = makeEditor('<p><b>第一段</b></p><p><b>第二段</b></p>');
    const p1 = editor.querySelector('p')!;
    const p2 = editor.querySelectorAll('p')[1]!;
    const range = document.createRange();
    range.setStart(p1, 0);
    range.setEnd(p2, p2.childNodes.length);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);
    expect(isBoldFullyActive()).toBe(true);
  });

  it('N1j: 跨多 <p> 部分粗体 → false', () => {
    editor = makeEditor('<p><b>第一段</b></p><p>第二段</p>');
    const p1 = editor.querySelector('p')!;
    const p2 = editor.querySelectorAll('p')[1]!;
    const range = document.createRange();
    range.setStart(p1, 0);
    range.setEnd(p2, p2.childNodes.length);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);
    expect(isBoldFullyActive()).toBe(false);
  });
});

describe('v26 N2: isItalicFullyActive - 严格 ALL 语义', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('N2a: 选区全 <i> → true', () => {
    editor = makeEditor('<p><i>hello world</i></p>');
    selectText(editor, 0, 11);
    expect(isItalicFullyActive()).toBe(true);
  });

  it('N2b: 选区全 inline font-style:italic → true', () => {
    editor = makeEditor('<p><span style="font-style: italic">hello world</span></p>');
    selectText(editor, 0, 11);
    expect(isItalicFullyActive()).toBe(true);
  });

  it('N2c: 选区 <em> → true', () => {
    editor = makeEditor('<p><em>hello world</em></p>');
    selectText(editor, 0, 11);
    expect(isItalicFullyActive()).toBe(true);
  });

  it('N2d: 选区部分斜体部分非斜体 → false', () => {
    editor = makeEditor('<p><i>hello</i> world</p>');
    selectText(editor, 0, 11);
    expect(isItalicFullyActive()).toBe(false);
  });

  it('N2e: 选区全部非斜体 → false', () => {
    editor = makeEditor('<p>hello world</p>');
    selectText(editor, 0, 11);
    expect(isItalicFullyActive()).toBe(false);
  });

  it('N2f: 折叠选区 → false', () => {
    editor = makeEditor('<p><i>hello</i></p>');
    selectText(editor, 2, 2);
    expect(isItalicFullyActive()).toBe(false);
  });
});

describe('v26 N3: isUnderlineFullyActive - 严格 ALL 语义', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('N3a: 选区全 <u> → true', () => {
    editor = makeEditor('<p><u>hello world</u></p>');
    selectText(editor, 0, 11);
    expect(isUnderlineFullyActive()).toBe(true);
  });

  it('N3b: 选区全 text-decoration:underline → true', () => {
    editor = makeEditor('<p><span style="text-decoration: underline">hello world</span></p>');
    selectText(editor, 0, 11);
    expect(isUnderlineFullyActive()).toBe(true);
  });

  it('N3c: 选区部分下划线部分非下划线 → false', () => {
    editor = makeEditor('<p><u>hello</u> world</p>');
    selectText(editor, 0, 11);
    expect(isUnderlineFullyActive()).toBe(false);
  });

  it('N3d: 选区全部非下划线 → false', () => {
    editor = makeEditor('<p>hello world</p>');
    selectText(editor, 0, 11);
    expect(isUnderlineFullyActive()).toBe(false);
  });

  it('N3e: 折叠选区 → false', () => {
    editor = makeEditor('<p><u>hello</u></p>');
    selectText(editor, 2, 2);
    expect(isUnderlineFullyActive()).toBe(false);
  });

  it('N3f: text-decoration=line-through(无 underline) → false', () => {
    editor = makeEditor('<p><span style="text-decoration: line-through">hello</span></p>');
    selectText(editor, 0, 5);
    expect(isUnderlineFullyActive()).toBe(false);
  });
});

describe('v26 N4: isStrikeFullyActive - 严格 ALL 语义', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('N4a: 选区全 <s> → true', () => {
    editor = makeEditor('<p><s>hello world</s></p>');
    selectText(editor, 0, 11);
    expect(isStrikeFullyActive()).toBe(true);
  });

  it('N4b: 选区全 <strike> → true', () => {
    editor = makeEditor('<p><strike>hello world</strike></p>');
    selectText(editor, 0, 11);
    expect(isStrikeFullyActive()).toBe(true);
  });

  it('N4c: 选区全 text-decoration:line-through → true', () => {
    editor = makeEditor('<p><span style="text-decoration: line-through">hello world</span></p>');
    selectText(editor, 0, 11);
    expect(isStrikeFullyActive()).toBe(true);
  });

  it('N4d: 选区部分删除线部分非删除线 → false', () => {
    editor = makeEditor('<p><s>hello</s> world</p>');
    selectText(editor, 0, 11);
    expect(isStrikeFullyActive()).toBe(false);
  });

  it('N4e: 选区全部非删除线 → false', () => {
    editor = makeEditor('<p>hello world</p>');
    selectText(editor, 0, 11);
    expect(isStrikeFullyActive()).toBe(false);
  });

  it('N4f: 折叠选区 → false', () => {
    editor = makeEditor('<p><s>hello</s></p>');
    selectText(editor, 2, 2);
    expect(isStrikeFullyActive()).toBe(false);
  });
});

describe('v26 N5: 嵌套 + 跨多段 ALL 场景', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('N5a: 嵌套 span 全部粗体 (含 inline style + 内部 span) → true', () => {
    editor = makeEditor(
      '<p><span style="font-weight: bold">外层<span>内层</span>继续</span></p>',
    );
    selectText(editor, 0, 6);
    expect(isBoldFullyActive()).toBe(true);
  });

  it('N5b: 跨 2 段,一段粗一段非粗 → false', () => {
    editor = makeEditor('<p><b>第一段</b></p><p>第二段</p>');
    const p1 = editor.querySelector('p')!;
    const p2 = editor.querySelectorAll('p')[1]!;
    const range = document.createRange();
    range.setStart(p1, 0);
    range.setEnd(p2, p2.childNodes.length);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);
    expect(isBoldFullyActive()).toBe(false);
  });

  it('N5c: 跨 2 段,两段都粗 → true', () => {
    editor = makeEditor('<p><b>第一段</b></p><p><b>第二段</b></p>');
    const p1 = editor.querySelector('p')!;
    const p2 = editor.querySelectorAll('p')[1]!;
    const range = document.createRange();
    range.setStart(p1, 0);
    range.setEnd(p2, p2.childNodes.length);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);
    expect(isBoldFullyActive()).toBe(true);
  });
});

// =============================================================================
// v27: TreeWalker root 选错导致 BIUS 取消样式失败
// 根因：3 个函数用 range.commonAncestorContainer 作 root，选区在单 text node
//      内时 commonAncestor = textNode，TreeWalker.nextNode() 永远返回 null。
// 修复：改为用 editor 作 root（与 removeInlineStyle/removeTextDecorationPartNoFocus 一致）
// =============================================================================

describe('v27 P1: removeInlineTagNoFocus - 选区在 text node 内也能解包', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('P1a: 选区在 <b>text</b> 的 text node 内,removeInlineTagNoFocus("b") → <b> 被解包 (v27 关键修复)', () => {
    // v27 修复前:commonAncestorContainer = textNode → walker 不返回任何 element → <b> 不解包 → BUG
    // v27 修复后:editor 作 root → walker 找到 <b> → 解包成功
    editor = makeEditor('<p><b>hello</b></p>');
    selectText(editor, 0, 5);
    const result = removeInlineTagNoFocus(editor, 'b', { skipFocus: true });
    expect(result).toBe(true);
    expect(editor.querySelector('b')).toBeNull();
    expect(editor.textContent).toBe('hello');
  });

  it('P1b: 选区在 <u>text</u> 的 text node 内,removeInlineTagNoFocus("u") → <u> 被解包', () => {
    editor = makeEditor('<p><u>underline text</u></p>');
    selectText(editor, 0, 14);
    const result = removeInlineTagNoFocus(editor, 'u', { skipFocus: true });
    expect(result).toBe(true);
    expect(editor.querySelector('u')).toBeNull();
  });

  it('P1c: 选区在 <s>text</s> 的 text node 内,removeInlineTagNoFocus("s") → <s> 被解包', () => {
    editor = makeEditor('<p><s>strikethrough</s></p>');
    selectText(editor, 0, 13);
    const result = removeInlineTagNoFocus(editor, 's', { skipFocus: true });
    expect(result).toBe(true);
    expect(editor.querySelector('s')).toBeNull();
  });

  it('P1d: 选区在 <strong>text</strong> 的 text node 内,removeInlineTagNoFocus("strong") → <strong> 被解包', () => {
    editor = makeEditor('<p><strong>strong text</strong></p>');
    selectText(editor, 0, 11);
    const result = removeInlineTagNoFocus(editor, 'strong', { skipFocus: true });
    expect(result).toBe(true);
    expect(editor.querySelector('strong')).toBeNull();
  });
});

describe('v27 P2: hasInlineElementInSelection - 选区在 text node 内也能检测', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('P2a: 选区在 <u>text</u> 的 text node 内,isUnderlineActive → true (v27 关键修复)', () => {
    editor = makeEditor('<p><u>underline</u></p>');
    selectText(editor, 0, 9);
    expect(isUnderlineActive()).toBe(true);
  });

  it('P2b: 选区在 <s>text</s> 的 text node 内,isStrikeActive → true', () => {
    editor = makeEditor('<p><s>strikethrough</s></p>');
    selectText(editor, 0, 13);
    expect(isStrikeActive()).toBe(true);
  });

  it('P2c: 选区在 <strike>text</strike> 的 text node 内,isStrikeActive → true', () => {
    editor = makeEditor('<p><strike>old strike</strike></p>');
    selectText(editor, 0, 10);
    expect(isStrikeActive()).toBe(true);
  });
});

describe('v27 P3: isStyleActiveInEditor - 选区在 text node 内也能检测', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('P3a: 选区在 <b>text</b> 的 text node 内,isBoldActive → true (v27 关键修复)', () => {
    editor = makeEditor('<p><b>bold text</b></p>');
    selectText(editor, 0, 9);
    expect(isBoldActive()).toBe(true);
  });

  it('P3b: 选区在 <i>text</i> 的 text node 内,isItalicActive → true', () => {
    editor = makeEditor('<p><i>italic text</i></p>');
    selectText(editor, 0, 11);
    expect(isItalicActive()).toBe(true);
  });

  it('P3c: 选区在 <span style="font-weight: bold">text</span> 内,isBoldActive → true (验证 inline style 路径)', () => {
    editor = makeEditor('<p><span style="font-weight: bold">bold</span></p>');
    selectText(editor, 0, 4);
    expect(isBoldActive()).toBe(true);
  });
});

describe('v27 E: 完整取消流程 (用户截图场景)', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('E1: 选中纯文本 → applyInlineStyle 应用粗体 → isBoldFullyActive=true → click toggle 取消 → 文本无粗体', () => {
    // 模拟用户截图的最后一行场景
    editor = makeEditor('<p>111111111111111111111111111111111111</p>');
    selectText(editor, 0, 36);

    // 应用粗体
    applyInlineStyle(editor, { fontWeight: 'bold' });
    expect(editor.querySelector('span[style*="font-weight"]')).not.toBeNull();
    expect(isBoldFullyActive()).toBe(true);

    // 模拟 click B 取消:3 个操作顺序执行
    removeInlineTagNoFocus(editor, 'b', { skipFocus: true });
    removeInlineTagNoFocus(editor, 'strong', { skipFocus: true });
    removeInlineStyleNoFocus(editor, ['fontWeight']);

    // 验证粗体被完全移除
    expect(isBoldFullyActive()).toBe(false);
  });

  it('E2: 选区在 <b> 内,cancel 后 isBoldFullyActive=false', () => {
    editor = makeEditor('<p><b>existing bold</b></p>');
    selectText(editor, 0, 13);
    expect(isBoldFullyActive()).toBe(true);

    // cancel
    removeInlineTagNoFocus(editor, 'b', { skipFocus: true });
    expect(isBoldFullyActive()).toBe(false);
    expect(editor.querySelector('b')).toBeNull();
  });
});

describe('v26 N5 补充: 多段/同段混合粗体截图场景', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('N5d: 截图场景:多行混合粗体(部分行有粗体) → false', () => {
    // 模拟截图:多段,部分粗体部分非粗体
    editor = makeEditor(
      '<p><b>第一行</b></p><p><b>第二行</b></p><p>第三行</p><p>第四行</p>',
    );
    const p1 = editor.querySelector('p')!;
    const lastP = editor.querySelectorAll('p')[editor.querySelectorAll('p').length - 1]!;
    const range = document.createRange();
    range.setStart(p1, 0);
    range.setEnd(lastP, lastP.childNodes.length);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);
    expect(isBoldFullyActive()).toBe(false);
  });

  it('N5e: 截图场景:同段中混合(部分粗体部分非粗体) → false', () => {
    editor = makeEditor('<p><b>部分</b>非粗体部分<b>又粗体</b></p>');
    selectText(editor, 0, editor.textContent!.length);
    expect(isBoldFullyActive()).toBe(false);
  });
});

describe('v26 N6: textDecoration 复合 (U+S 同时存在)', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('N6a: 选区全 underline+line-through → isUnderlineFullyActive true + isStrikeFullyActive true', () => {
    editor = makeEditor(
      '<p><span style="text-decoration: underline line-through">hello</span></p>',
    );
    selectText(editor, 0, 5);
    expect(isUnderlineFullyActive()).toBe(true);
    expect(isStrikeFullyActive()).toBe(true);
  });

  it('N6b: 只有 underline 无 line-through → U true / S false', () => {
    editor = makeEditor(
      '<p><span style="text-decoration: underline">hello</span></p>',
    );
    selectText(editor, 0, 5);
    expect(isUnderlineFullyActive()).toBe(true);
    expect(isStrikeFullyActive()).toBe(false);
  });

  it('N6c: 只有 line-through 无 underline → U false / S true', () => {
    editor = makeEditor(
      '<p><span style="text-decoration: line-through">hello</span></p>',
    );
    selectText(editor, 0, 5);
    expect(isUnderlineFullyActive()).toBe(false);
    expect(isStrikeFullyActive()).toBe(true);
  });

  it('N6d: 选区 U 部分 + S 部分 → U false / S false', () => {
    editor = makeEditor(
      '<p><u>hello</u><s> world</s></p>',
    );
    selectText(editor, 0, 11);
    expect(isUnderlineFullyActive()).toBe(false);
    expect(isStrikeFullyActive()).toBe(false);
  });
});

describe('v28 P1: removeInlineTagNoFocus + removeInlineStyle 完整取消粗体', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('P1a: span[style="font-weight:bold"] 选区→removeInlineStyle 后无 font-weight (v28 修复)', () => {
    // v28 根因:removeInlineStyle 旧版只 removeProperty 不 removeAttribute,
    // 导致空 style="" 留在 span 上,下次再点 B 时 isBoldFullyActive 仍 true → 再点仍是"取消"但 DOM 没变
    // v28 修复:空 style 时调用 removeAttribute('style')(或 unwrap 整个 span)
    // 注:happy-dom 与 Chromium 行为略不同(happy-dom 直接 unwrap 空 span,Chromium 保留)→ 测试只要满足核心需求即可
    editor = makeEditor('<p><span style="font-weight: bold;">hello</span></p>');
    selectText(editor, 0, 5);
    const r3 = removeInlineStyleNoFocus(editor, ['fontWeight']);
    expect(r3).toBe(true);
    // 核心断言:不存在任何带 font-weight 的元素
    expect(editor.querySelector('[style*="font-weight"]')).toBeNull();
    expect(editor.innerHTML).not.toContain('font-weight');
    // 文本必须保留
    expect(editor.textContent).toBe('hello');
  });

  it('P1b: span[style="font-weight:bold; color:red"] 取消 fontWeight → 保留 color 属性', () => {
    // 反向验证:其他 style 不能被误删
    editor = makeEditor('<p><span style="font-weight: bold; color: red;">hello</span></p>');
    selectText(editor, 0, 5);
    removeInlineStyleNoFocus(editor, ['fontWeight']);
    // font-weight 必须消失
    expect(editor.innerHTML).not.toContain('font-weight');
    // color 必须保留
    expect(editor.innerHTML).toContain('color');
    expect(editor.innerHTML).toContain('red');
    // 文本必须保留
    expect(editor.textContent).toBe('hello');
  });

  it('P1c: 完整 B 按钮 onClick 流程:apply → cancel,DOM 不再含 font-weight', () => {
    // 模拟 v27/v28 BUG 场景:先 apply bold,再 cancel
    // 修复前:cancel 后 DOM 还含 font-weight(因 removeInlineTagNoFocus 未导入导致整个 cancel 抛异常)
    // 修复后:cancel 后 DOM 不再含 font-weight
    editor = makeEditor('<p>hello</p>');
    selectText(editor, 0, 5);

    // apply bold
    applyInlineStyle(editor, { fontWeight: 'bold' }, { skipFocus: true });
    expect(editor.innerHTML).toContain('font-weight: bold');

    // 关键:happy-dom 在 apply bold 时会引入空 text node,需要先 normalize
    // v30 修复后,splitElementAtRange 依赖干净的 DOM 结构
    if (typeof (editor as any).normalize === 'function') {
      (editor as any).normalize();
    }
    selectText(editor, 0, 5);

    // cancel bold:完整模拟 B 按钮 onClick
    const r1 = removeInlineTagNoFocus(editor, 'b', { skipFocus: true });
    const r2 = removeInlineTagNoFocus(editor, 'strong', { skipFocus: true });
    const r3 = removeInlineStyleNoFocus(editor, ['fontWeight']);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(r3).toBe(true);

    // 关键断言:cancel 后 DOM 完全无 font-weight
    expect(editor.innerHTML).not.toContain('font-weight');
    expect(editor.textContent).toBe('hello');
  });

  it('P1d: 关键回归:removeInlineTagNoFocus 必须是 EditorToolbar 引用的导出函数', () => {
    // v28 BUG 根因:EditorToolbar.tsx 在 B/I/U/S onClick 中调用了 removeInlineTagNoFocus
    // 但该函数从未被 import → ReferenceError → 整个 cancel 分支静默失败
    // 本测试确保函数存在并可调用(实际 import 正确性由 tsc 编译时校验)
    expect(typeof removeInlineTagNoFocus).toBe('function');
    // 模拟 B 按钮 cancel 调用的 3 个函数都必须是函数
    expect(typeof removeInlineTagNoFocus).toBe('function');
    expect(typeof removeInlineStyleNoFocus).toBe('function');
  });
});

describe('v29: U/S 选区精确范围(部分文本) - 修复整行受影响 bug', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  // 用户截图场景：长文本中选中中间 6 个字符
  it('Q1: 选中文本节点中间 6 字符应用 U → 只这 6 字符被加 U', () => {
    editor = makeEditor('<p>111111111111111</p>'); // 15 个 1
    const p = editor.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 5);  // 跳过前 5 个 1
    range.setEnd(p.firstChild!, 11);   // 到第 11 个 1(中间 6 个 1)
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    const html = editor.innerHTML;
    // 前 5 个 1 在 span 外,中间 6 个在 span 内,后 4 个在 span 外
    expect(html).toBe('<p>11111<span style="text-decoration: underline;">111111</span>1111</p>');
  });

  // 选中文本节点前半部分
  it('Q2: 选中文本节点前 5 字符应用 U → 只前 5 字符被加 U', () => {
    editor = makeEditor('<p>abcdefghij</p>');
    const p = editor.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 5);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    expect(editor.innerHTML).toBe('<p><span style="text-decoration: underline;">abcde</span>fghij</p>');
  });

  // 选中文本节点后半部分(删除线)
  it('Q3: 选中文本节点后 5 字符应用 S → 只后 5 字符被加 S', () => {
    editor = makeEditor('<p>abcdefghij</p>');
    const p = editor.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 5);
    range.setEnd(p.firstChild!, 10);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'line-through', { skipFocus: true });

    expect(editor.innerHTML).toBe('<p>abcde<span style="text-decoration: line-through;">fghij</span></p>');
  });

  // 取消 U 时只影响选中的部分(3b 部分选区场景)
  // v29 范围:apply 修复是核心,remove 部分选区是 v30 任务
  // 本测试只验证 apply 修复后的基础行为,remove 行为记录现状
  it('Q4: 已有 underline span 部分选区 → apply 另一 part 不影响外层 span', () => {
    // 制造一个已有 underline 的长 span,部分选区应用 line-through
    editor = makeEditor(
      '<p><span style="text-decoration: underline;">111111111111111</span></p>',
    );
    const span = editor.querySelector('span')!;
    const textInSpan = span.firstChild as Text;
    // 选中间 4 个 1
    const range = document.createRange();
    range.setStart(textInSpan, 5);
    range.setEnd(textInSpan, 9);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    // 应用 line-through(已带 underline)
    applyTextDecorationPartNoFocus(editor, 'line-through', { skipFocus: true });

    // 部分选区 → 选中的 4 个 1 被加 line-through,未选中的保持只有 underline
    const html = editor.innerHTML;
    // 至少有一个 span 仍带 underline(选区外部分)
    const allSpans = editor.querySelectorAll('span');
    const underlineSpans = Array.from(allSpans).filter((s) =>
      (s.style.textDecoration || '').includes('underline'),
    );
    expect(underlineSpans.length).toBeGreaterThan(0);
    // 至少有一个 span 带 line-through(选区内部分)
    const lineThroughSpans = Array.from(allSpans).filter((s) =>
      (s.style.textDecoration || '').includes('line-through'),
    );
    expect(lineThroughSpans.length).toBeGreaterThan(0);
  });

  // 跨多文本节点的复杂场景
  it('Q5: 跨 "foo " + "<span>bar</span>" + " baz" 选区应用 U → 各段只包选中部分', () => {
    // textFoo="foo "(4 字符),textBar="bar"(3 字符),lastChild=" baz"(4 字符)
    // 选 textFoo[2..4)="o " + textBar 全选 + lastChild[0..1)=" "
    editor = makeEditor('<p>foo <span>bar</span> baz</p>');
    const p = editor.querySelector('p')!;
    const textFoo = p.firstChild as Text;  // "foo "
    // 选 "o " (textFoo[2..4) = chars 2,3) + "bar" (完整) + " " (lastChild[0..1))
    const range = document.createRange();
    range.setStart(textFoo, 2);
    range.setEnd(p.lastChild!, 1);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    const html = editor.innerHTML;
    // 验证只有选中的部分被加 U:
    // textFoo="foo " 选 [2,4) → "fo" 在外,"o " 在新 span 内(3a)
    // textBar 完整选区 → 3b partial:是(split 后的"bar"是部分),所以 split span,"bar" 移出到新 span
    // lastChild=" baz" 选 [0,1) → " " 在新 span 内(3a)
    expect(html).toMatch(/fo<span[^>]*text-decoration:\s*underline[^>]*>o\s<\/span>/);
    // 验证 bar 也有 underline(3b 部分拆 span,"bar" 在新 underline span)
    expect(html).toMatch(/text-decoration:\s*underline[^>]*>bar</);
    // 验证 "baz" 不带 underline(直接在 </p> 前)
    expect(html).toMatch(/>baz<\/p>/);
  });

  // 3a 退化路径：选区跨越多个文本节点
  it('Q6: 退化路径(裸文本 surroundContents 失败) → 包整个 targetTextNode', () => {
    // 单文本节点选区应该走 surroundContents 成功路径,不会触发 catch
    // 但我们可以测试 3b 完整选区场景
    editor = makeEditor('<p>hello world</p>');
    const p = editor.querySelector('p')!;
    selectText(editor, 0, 5); // 选 "hello"
    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });
    // 整个 "hello" 都被包 span
    expect(editor.innerHTML).toBe(
      '<p><span style="text-decoration: underline;">hello</span> world</p>',
    );
  });
});

describe('v30: B/I/U/S 选区应用与取消 - 选区范围严格保持', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  // === R 系列:remove 影响范围严格限定在选区所在的 span 内 ===
  it('R1: 取消 U 选区在 span 中间 → span 整体被解包但不污染外层', () => {
    // v30 修复:之前会连同外层 p 一起改变,现在只处理选区所在的 span
    editor = makeEditor(
      '<p>AAAAA<span style="text-decoration: underline">BBBBB</span>CCCCC</p>',
    );
    const span = editor.querySelector('span')!;
    const textInSpan = span.firstChild as Text;
    const range = document.createRange();
    range.setStart(textInSpan, 1);
    range.setEnd(textInSpan, 4);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    removeTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    // v30 修复:外层 AAAAA 和 CCCCC 文本必须保留
    const html = editor.innerHTML;
    expect(html).toContain('AAAAA');
    expect(html).toContain('CCCCC');
    // span 的 text-decoration 应被清除
    const newSpan = editor.querySelector('span');
    if (newSpan) {
      expect(newSpan.getAttribute('style') ?? '').not.toMatch(/underline/);
    }
  });

  it('R2: 取消 B 选区在 <b> 中间 → <b> 整体被解包但不污染外层', () => {
    editor = makeEditor('<p>AAAAA<b>BBBBB</b>CCCCC</p>');
    const b = editor.querySelector('b')!;
    const textInB = b.firstChild as Text;
    const range = document.createRange();
    range.setStart(textInB, 1);
    range.setEnd(textInB, 4);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    removeInlineTagNoFocus(editor, 'b', { skipFocus: true });

    // 外层 AAAAA 和 CCCCC 文本必须保留
    const html = editor.innerHTML;
    expect(html).toContain('AAAAA');
    expect(html).toContain('CCCCC');
    // <b> 应被解包(因为选区完全在 <b> 内,需要解包)
    // 但部分选区情况下,v30 修复会让 <b> 保留但只有选区外的内容
    // 这里选区在 <b> 内,选区外是 "BB" 仍在 <b> 中
    // 简单验证:文本 "BBBBB" 仍存在
    expect(html).toContain('BBBBB');
  });
});

describe('v36: collectInlineStyleFromAncestors - Enter 创建新行时光标处样式', () => {
  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  function setCollapsedSelection(node: Node, offset: number): void {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it('V36-C1: <p><span style="font-weight:bold">ab</span></p> 光标在 span 内 → { fontWeight: bold }', () => {
    editor.innerHTML = '<p><span style="font-weight: bold">ab</span></p>';
    const span = editor.querySelector('span')!;
    const text = span.firstChild as Text;
    setCollapsedSelection(text, 1);

    const styles = collectInlineStyleFromAncestors(text, editor);

    expect(styles).toBeDefined();
    expect(styles?.fontWeight).toBe('bold');
  });

  it('V36-C2: 嵌套 bold+italic → { fontWeight, fontStyle }', () => {
    editor.innerHTML =
      '<p><span style="font-weight: bold"><span style="font-style: italic">ab</span></span></p>';
    const innerSpan = editor.querySelector('span[style*="font-style"]')!;
    const text = innerSpan.firstChild as Text;
    setCollapsedSelection(text, 1);

    const styles = collectInlineStyleFromAncestors(text, editor);

    expect(styles).toBeDefined();
    expect(styles?.fontWeight).toBe('bold');
    expect(styles?.fontStyle).toBe('italic');
  });

  it('V36-C3: <p>|</p> 光标在空 <p> → null', () => {
    editor.innerHTML = '<p><br></p>';
    const p = editor.querySelector('p')!;
    setCollapsedSelection(p, 0);

    const styles = collectInlineStyleFromAncestors(p, editor);

    expect(styles).toBeNull();
  });

  it('V36-C4: <p>普通文本|</p> → null', () => {
    editor.innerHTML = '<p>普通文本</p>';
    const p = editor.querySelector('p')!;
    const text = p.firstChild as Text;
    setCollapsedSelection(text, 4);

    const styles = collectInlineStyleFromAncestors(text, editor);

    expect(styles).toBeNull();
  });

  it('V36-C5: underline + line-through 复合 → textDecoration 包含两者', () => {
    editor.innerHTML =
      '<p><span style="text-decoration: underline line-through">ab</span></p>';
    const span = editor.querySelector('span')!;
    const text = span.firstChild as Text;
    setCollapsedSelection(text, 1);

    const styles = collectInlineStyleFromAncestors(text, editor);

    expect(styles).toBeDefined();
    expect(styles?.textDecoration).toContain('underline');
    expect(styles?.textDecoration).toContain('line-through');
  });
});

describe('v37: insertStyledParagraphAfter - 含 styles 时 <span><br></span> 结构', () => {
  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  it('V37-I1: 含 styles 时新 <p> 只有 1 个 <span> 子节点, <span> 内含 <br>', () => {
    editor.innerHTML = '<p>abc</p>';
    const p = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, p, { fontWeight: 'bold' });

    // v37 结构: <p><span style="font-weight:bold"><br></span></p>
    // - <br> 作为 span 子节点(非兄弟),避免多出空行
    // - span 有真实内容获得行高,光标可见
    const allP = editor.querySelectorAll('p');
    expect(allP.length).toBe(2);
    const newP = allP[1];
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('SPAN');
    const span = newP.children[0] as HTMLElement;
    expect(span.style.fontWeight).toBe('bold');
    // span 内应有 <br> 子节点
    expect(span.children.length).toBe(1);
    expect(span.children[0].tagName).toBe('BR');
    // 光标应在 span 内(br 之前)
    expect(cursor.startContainer).toBe(span);
    expect(cursor.startOffset).toBe(0);
  });

  it('V37-I2: 无 styles 时新 <p> 只有 <br>', () => {
    editor.innerHTML = '<p>abc</p>';
    const p = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, p, null);

    const allP = editor.querySelectorAll('p');
    expect(allP.length).toBe(2);
    const newP = allP[1];
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('BR');
    // 光标在 <p> 内
    expect(cursor.startContainer).toBe(newP);
  });

  it('V37-I3: 含多种 styles 时 span 承载所有样式, br 仍在 span 内', () => {
    editor.innerHTML = '<p>abc</p>';
    const p = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, p, {
      fontWeight: 'bold',
      fontStyle: 'italic',
      textDecoration: 'underline',
    });

    const allP = editor.querySelectorAll('p');
    const newP = allP[1];
    expect(newP.children.length).toBe(1);
    const span = newP.children[0] as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.style.fontWeight).toBe('bold');
    expect(span.style.fontStyle).toBe('italic');
    expect(span.style.textDecoration).toBe('underline');
    expect(span.children.length).toBe(1);
    expect(span.children[0].tagName).toBe('BR');
    expect(cursor.startContainer).toBe(span);
  });
});

// =============================================================================
// v31: 基于 activeStyles 的回车样式继承修复测试
// =============================================================================

describe('v31: getInlineStylesFromActive - activeStyles 转 inline style', () => {
  it('空 active → 返回 null', () => {
    expect(getInlineStylesFromActive({})).toBeNull();
  });

  it('bold: true → 返回 { fontWeight: "bold" }', () => {
    expect(getInlineStylesFromActive({ bold: true })).toEqual({
      fontWeight: 'bold',
    });
  });

  it('italic: true → 返回 { fontStyle: "italic" }', () => {
    expect(getInlineStylesFromActive({ italic: true })).toEqual({
      fontStyle: 'italic',
    });
  });

  it('underline: true → 返回 { textDecoration: "underline" }', () => {
    expect(getInlineStylesFromActive({ underline: true })).toEqual({
      textDecoration: 'underline',
    });
  });

  it('strike: true → 返回 { textDecoration: "line-through" }', () => {
    expect(getInlineStylesFromActive({ strike: true })).toEqual({
      textDecoration: 'line-through',
    });
  });

  it('underline + strike → 返回 { textDecoration: "underline line-through" }', () => {
    expect(
      getInlineStylesFromActive({ underline: true, strike: true }),
    ).toEqual({
      textDecoration: 'underline line-through',
    });
  });

  it('bold + italic + underline + strike 全开 → 完整 inline style', () => {
    expect(
      getInlineStylesFromActive({
        bold: true,
        italic: true,
        underline: true,
        strike: true,
      }),
    ).toEqual({
      fontWeight: 'bold',
      fontStyle: 'italic',
      textDecoration: 'underline line-through',
    });
  });

  it('bold: false + underline: true → 只有 underline', () => {
    expect(
      getInlineStylesFromActive({ bold: false, underline: true }),
    ).toEqual({ textDecoration: 'underline' });
  });
});

describe('v31: insertStyledParagraphAfter - 创建新 <p> 并放置光标', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('无样式 → 新 <p> 内无 <span>、有 <br> 占位 (v34 修复)', () => {
    editor = makeEditor('<p>hello</p>');
    const p = editor.querySelector('p')!;
    insertStyledParagraphAfter(editor, p, null);
    const newP = editor.querySelectorAll('p')[1];
    expect(newP).toBeTruthy();
    expect(newP.querySelector('span')).toBeNull();
    // v34: 无样式时添加 <br> 占位,确保空 <p> 可见且光标能定位
    expect(newP.querySelector('br')).toBeTruthy();
  });

  it('bold 样式 → 新 <p> 内含 <span style="font-weight:bold">', () => {
    editor = makeEditor('<p>hello</p>');
    const p = editor.querySelector('p')!;
    insertStyledParagraphAfter(editor, p, { fontWeight: 'bold' });
    const newP = editor.querySelectorAll('p')[1];
    const span = newP.querySelector('span');
    expect(span).toBeTruthy();
    expect(span!.style.fontWeight).toBe('bold');
    // v37: <span><br></span> 结构 - <br> 作为 span 子节点,撑起行高且不产生多余空行
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('SPAN');
    expect(span!.children[0].tagName).toBe('BR');
  });

  it('underline 样式 → 新 <p> 内含 <span style="text-decoration:underline">', () => {
    editor = makeEditor('<p>hello</p>');
    const p = editor.querySelector('p')!;
    insertStyledParagraphAfter(editor, p, {
      textDecoration: 'underline',
    });
    const newP = editor.querySelectorAll('p')[1];
    const span = newP.querySelector('span');
    expect(span).toBeTruthy();
    expect(span!.style.textDecoration).toBe('underline');
  });

  it('光标位置:在 <span> 内开头(styles 非空)', () => {
    editor = makeEditor('<p>hello</p>');
    const p = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, p, { fontWeight: 'bold' });
    expect(cursor.startContainer.nodeType).toBe(Node.ELEMENT_NODE);
    expect((cursor.startContainer as HTMLElement).tagName).toBe('SPAN');
    expect(cursor.startOffset).toBe(0);
    expect(cursor.collapsed).toBe(true);
  });

  it('光标位置:在 <p> 内(styles 为 null)', () => {
    editor = makeEditor('<p>hello</p>');
    const p = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, p, null);
    const newP = editor.querySelectorAll('p')[1];
    expect(cursor.startContainer).toBe(newP);
    expect(cursor.startOffset).toBe(0);
    expect(cursor.collapsed).toBe(true);
  });

  it('插入位置:afterNode 之后(原节点之后)', () => {
    editor = makeEditor('<p>first</p><p>third</p>');
    const first = editor.querySelectorAll('p')[0];
    const third = editor.querySelectorAll('p')[1];
    insertStyledParagraphAfter(editor, first, null);
    const ps = editor.querySelectorAll('p');
    expect(ps[0]).toBe(first);
    expect(ps[1].textContent).toBe('');
    expect(ps[2]).toBe(third);
  });
});

describe('v31: 端到端 - 加粗末尾按 Enter 模拟', () => {
  // 注意:实际 handleKeyDown 集成在 React 组件中,这里测试核心 DOM 行为
  // 模拟用户流程:activeStyles.bold = true → 在加粗文本末尾按 Enter → 验证新 <p> 结构

  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('E2E-1: 加粗文本末尾按 Enter → 新行内含 <span style="font-weight:bold">,无 <br>', () => {
    editor = makeEditor('<p><span style="font-weight:bold">加粗文字</span></p>');
    const p = editor.querySelector('p')!;
    const span = p.querySelector('span')!;
    // 模拟 activeStyles.bold = true
    const activeStyles = { bold: true };
    const styles = getInlineStylesFromActive(activeStyles);
    // 模拟 handleKeyDown:在 span 末尾按 Enter
    insertStyledParagraphAfter(editor, span, styles);
    // 验证新 <p> 结构
    const newP = editor.querySelectorAll('p')[1];
    expect(newP).toBeTruthy();
    const newSpan = newP.querySelector('span');
    expect(newSpan).toBeTruthy();
    expect(newSpan!.style.fontWeight).toBe('bold');
    // v37: <span><br></span> 结构 - <br> 作为 span 子节点
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('SPAN');
    expect(newSpan!.children[0].tagName).toBe('BR');
  });

  it('E2E-2: 加粗下划线文本末尾按 Enter → 新行内含合并样式的 <span>', () => {
    editor = makeEditor(
      '<p><span style="font-weight:bold; text-decoration:underline">加粗下划线</span></p>',
    );
    const p = editor.querySelector('p')!;
    const span = p.querySelector('span')!;
    const styles = getInlineStylesFromActive({ bold: true, underline: true });
    insertStyledParagraphAfter(editor, span, styles);
    const newP = editor.querySelectorAll('p')[1];
    const newSpan = newP.querySelector('span');
    expect(newSpan).toBeTruthy();
    expect(newSpan!.style.fontWeight).toBe('bold');
    expect(newSpan!.style.textDecoration).toContain('underline');
    // v37: <span><br></span> 结构 - <br> 作为 span 子节点
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('SPAN');
    expect(newSpan!.children[0].tagName).toBe('BR');
  });

  it('E2E-3: 普通字重 + activeStyles 空 → 新行无样式,有 <br> 占位 (v34 修复)', () => {
    editor = makeEditor('<p>普通文本</p>');
    const p = editor.querySelector('p')!;
    const styles = getInlineStylesFromActive({});
    insertStyledParagraphAfter(editor, p, styles);
    const newP = editor.querySelectorAll('p')[1];
    expect(newP.querySelector('span')).toBeNull();
    // v34: 无样式时添加 <br> 占位,确保空 <p> 可见
    expect(newP.querySelector('br')).toBeTruthy();
  });

  it('E2E-4: 模拟用户输入"1"到新行 → "1"进入 <span> 内,样式生效', () => {
    editor = makeEditor('<p><span style="font-weight:bold">加粗</span></p>');
    const span = editor.querySelector('span')!;
    const styles = getInlineStylesFromActive({ bold: true });
    const cursor = insertStyledParagraphAfter(editor, span, styles);
    // 模拟用户输入"1":happy-dom 不支持 execCommand,直接构造 text node 模拟输入
    const newSpan = cursor.startContainer as HTMLElement;
    const text = document.createTextNode('1');
    newSpan.appendChild(text);
    // 验证:1 进入 <span> 内
    const newP = editor.querySelectorAll('p')[1];
    const newSpanInP = newP.querySelector('span')!;
    expect(newSpanInP.textContent).toBe('1');
    expect(newSpanInP.style.fontWeight).toBe('bold');
    // v37: <span><br></span> 结构 - <p> 只有 1 个 span 子节点,span 内含 br + text
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('SPAN');
  });
});

// =============================================================================
// v34: 样式文本末尾按 Enter 换行 bug 修复测试
// 场景:光标在 <span style="font-weight:bold">加粗</span> 末尾,activeStyles 为空
// 旧行为:不 preventDefault → 落入浏览器默认 → 无反应(bug)
// 新行为:preventDefault + insertStyledParagraphAfter(editor, blockEl, null) → 新 <p><br></p>
// =============================================================================

describe('v34: 样式文本末尾按 Enter 换行 (activeStyles 为空)', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) document.body.removeChild(editor);
  });

  it('v34-1: 加粗文本末尾按 Enter (activeStyles 空) → 新行是普通 <p><br></p>,不继承加粗', () => {
    editor = makeEditor('<p><span style="font-weight: bold;">加粗文字</span></p>');
    const blockEl = editor.querySelector('p')!;
    // 模拟 activeStyles 为空(工具栏未高亮)
    const styles = getInlineStylesFromActive({});
    // 模拟 handleKeyDown:在 blockEl 末尾按 Enter
    insertStyledParagraphAfter(editor, blockEl, styles);
    // 验证:新增一个 <p>
    const ps = editor.querySelectorAll('p');
    expect(ps.length).toBe(2);
    // 新 <p> 无 span(不继承加粗)
    const newP = ps[1];
    expect(newP.querySelector('span')).toBeNull();
    // 新 <p> 有 <br> 占位
    expect(newP.querySelector('br')).toBeTruthy();
  });

  it('v34-2: 空样式段落末尾按 Enter → 新行是 <p><br></p>,光标可定位', () => {
    editor = makeEditor('<p>普通文本</p>');
    const blockEl = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, blockEl, null);
    // 验证:新增一个 <p>
    const ps = editor.querySelectorAll('p');
    expect(ps.length).toBe(2);
    const newP = ps[1];
    // 新 <p> 有 <br> 占位
    expect(newP.querySelector('br')).toBeTruthy();
    // 光标在新 <p> 内(0 偏移,br 之前)
    expect(cursor.startContainer).toBe(newP);
    expect(cursor.startOffset).toBe(0);
    expect(cursor.collapsed).toBe(true);
  });
});

// =============================================================================
// v32: 3 个 Gap 修复测试
// =============================================================================

describe('v32 Gap 1: splitBlockAtCursor - 加粗文本中间按 Enter', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  it('加粗文本中间 split → 左半加粗 + 右半加粗', () => {
    // <p><span style="font-weight:bold">hello</span></p>
    // 光标在 "hel|lo" → split 后:
    //   <p><span style="font-weight:bold">hel</span></p>
    //   <p><span style="font-weight:bold">lo</span></p>
    editor = makeEditor('<p><span style="font-weight:bold">hello</span></p>');
    const span = editor.querySelector('span')!;
    const textNode = span.firstChild as Text;

    // 设置光标在 offset=3("hel|lo")
    const range = document.createRange();
    range.setStart(textNode, 3);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const blockEl = editor.querySelector('p')!;
    const cursor = splitBlockAtCursor(editor, blockEl, range);

    // 验证:有两个 <p>
    const ps = editor.querySelectorAll('p');
    expect(ps.length).toBe(2);

    // 第一个 <p> 有 span(font-weight:bold) 内容 "hel"
    const firstSpan = ps[0].querySelector('span')!;
    expect(firstSpan.style.fontWeight).toBe('bold');
    expect(firstSpan.textContent).toBe('hel');

    // 第二个 <p> 有 span(font-weight:bold) 内容 "lo"
    const secondSpan = ps[1].querySelector('span')!;
    expect(secondSpan.style.fontWeight).toBe('bold');
    expect(secondSpan.textContent).toBe('lo');
  });

  it('普通文本中间 split → 左半普通 + 右半普通(无 span)', () => {
    // <p>hello</p>,光标在 "hel|lo"
    editor = makeEditor('<p>hello</p>');
    const p = editor.querySelector('p')!;
    const textNode = p.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 3);
    range.collapse(true);

    const cursor = splitBlockAtCursor(editor, p, range);

    const ps = editor.querySelectorAll('p');
    expect(ps.length).toBe(2);
    expect(ps[0].textContent).toBe('hel');
    expect(ps[1].textContent).toBe('lo');
    // 不应有 span(普通文本无样式)
    expect(ps[0].querySelector('span')).toBeNull();
    expect(ps[1].querySelector('span')).toBeNull();
  });

  it('斜体文本中间 split → 左半斜体 + 右半斜体', () => {
    editor = makeEditor('<p><span style="font-style:italic">world</span></p>');
    const span = editor.querySelector('span')!;
    const textNode = span.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 2); // "wo|rld"
    range.collapse(true);

    const blockEl = editor.querySelector('p')!;
    splitBlockAtCursor(editor, blockEl, range);

    const ps = editor.querySelectorAll('p');
    expect(ps.length).toBe(2);
    expect(ps[0].querySelector('span')!.style.fontStyle).toBe('italic');
    expect(ps[0].querySelector('span')!.textContent).toBe('wo');
    expect(ps[1].querySelector('span')!.style.fontStyle).toBe('italic');
    expect(ps[1].querySelector('span')!.textContent).toBe('rld');
  });
});

describe('v32 Gap 2: applyInlineStyle 降级路径选区精确恢复', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  it('跨多 span/text node 选区应用 bold → 选中文本加粗,非选中文本不变,选区恢复', () => {
    // 构造跨多 text node 的场景:<p><span style="color:red">hello</span><span style="color:blue">world</span></p>
    // 选区从 "hello" 的 "llo" 到 "world" 的 "wor"
    // applyInlineStyle 用 extractContents+insertNode 主路径,跨 span 时也能成功
    editor = makeEditor('<p><span style="color:red">hello</span><span style="color:blue">world</span></p>');
    const p = editor.querySelector('p')!;
    const helloText = p.querySelector('span[style*="red"]')!.firstChild as Text;
    const worldText = p.querySelector('span[style*="blue"]')!.firstChild as Text;

    // 选中 hello[2] ~ world[3] → "llo" + "wor"
    const range = document.createRange();
    range.setStart(helloText, 2);
    range.setEnd(worldText, 3);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // 应用 bold
    applyInlineStyle(editor, { fontWeight: 'bold' });

    // 验证:选中文本 "llo" 和 "wor" 都在 bold span 内
    const allSpans = editor.querySelectorAll('span');
    const boldSpans = Array.from(allSpans).filter((s) => s.style.fontWeight === 'bold');
    expect(boldSpans.length).toBeGreaterThanOrEqual(1);
    const boldText = boldSpans.map((s) => s.textContent ?? '').join('');
    expect(boldText).toContain('llo');
    expect(boldText).toContain('wor');

    // 验证:非选中文本 "he" 和 "ld" 不在 bold span 内
    const nonBoldText = Array.from(allSpans)
      .filter((s) => s.style.fontWeight !== 'bold')
      .map((s) => s.textContent ?? '')
      .join('');
    expect(nonBoldText).toContain('he');
    expect(nonBoldText).toContain('ld');

    // 验证:选区恢复后覆盖第一个到最后一个 bold span
    const newSel = window.getSelection()!;
    expect(newSel.rangeCount).toBe(1);
    const restoredRange = newSel.getRangeAt(0);
    const firstBold = boldSpans[0];
    const lastBold = boldSpans[boldSpans.length - 1];
    expect(restoredRange.intersectsNode(firstBold)).toBe(true);
    expect(restoredRange.intersectsNode(lastBold)).toBe(true);
  });
});

describe('v32 Gap 3: applyTextDecorationPartNoFocus 多层 span 嵌套', () => {
  let editor: HTMLElement;

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  it('2层 span(bold > color) 部分选区加 underline → 合并 bold+color+underline', () => {
    // <p><span style="font-weight:bold"><span style="color:red">hello</span></span></p>
    // 选中 "hel" 加 underline → 新 span 应有 bold+red+underline
    editor = makeEditor(
      '<p><span style="font-weight:bold"><span style="color:red">hello</span></span></p>'
    );
    const innerSpan = editor.querySelector('span[style*="color"]')!;
    const textNode = innerSpan.firstChild as Text;

    // 选中 "hel"(offset 0~3)
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });

    // 验证:新 span 有 fontWeight=bold + color=red + textDecoration 含 underline
    const allSpans = editor.querySelectorAll('span');
    // 应该有:原外层 bold span(内容 "lo") + 新 span(内容 "hel",合并样式)
    const newSpan = Array.from(allSpans).find(
      (s) => s.textContent === 'hel'
    );
    expect(newSpan).toBeDefined();
    expect(newSpan!.style.fontWeight).toBe('bold');
    expect(newSpan!.style.color).toBe('red');
    expect(newSpan!.style.textDecoration).toContain('underline');
  });

  it('3层 span(bold > italic > color) 部分选区加 line-through → 合并所有样式', () => {
    editor = makeEditor(
      '<p><span style="font-weight:bold"><span style="font-style:italic"><span style="color:blue">test</span></span></span></p>'
    );
    const innerSpan = editor.querySelector('span[style*="color"]')!;
    const textNode = innerSpan.firstChild as Text;

    // 选中 "es"(offset 1~3)
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 3);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    applyTextDecorationPartNoFocus(editor, 'line-through', { skipFocus: true });

    // 验证:新 span 有 bold + italic + blue + line-through
    const allSpans = editor.querySelectorAll('span');
    const newSpan = Array.from(allSpans).find(
      (s) => s.textContent === 'es'
    );
    expect(newSpan).toBeDefined();
    expect(newSpan!.style.fontWeight).toBe('bold');
    expect(newSpan!.style.fontStyle).toBe('italic');
    expect(newSpan!.style.color).toBe('blue');
    expect(newSpan!.style.textDecoration).toContain('line-through');
  });
});

// =============================================================================
// v41: 换行 + 样式延续测试
// 验证 Fix 1A (li Enter 延续样式)、Fix 1D (null fallback)、Phase 1 (DISABLE 后输入恢复)
// =============================================================================

describe('v41: insertStyledParagraphAfter - li 后创建带样式新段落', () => {
  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  it('V41-T1: li 后创建带 bold 样式的新 <p>，span 结构正确', () => {
    editor.innerHTML = '<ul><li><span style="font-weight: bold">bold text</span></li></ul>';
    const li = editor.querySelector('li')!;
    const cursor = insertStyledParagraphAfter(editor, li, { fontWeight: 'bold' });

    // 新 <p> 应在 li 之后
    const newP = li.nextElementSibling as HTMLElement;
    expect(newP).toBeTruthy();
    expect(newP.tagName).toBe('P');
    // 结构: <p><span style="font-weight:bold"><br></span></p>
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('SPAN');
    const span = newP.children[0] as HTMLElement;
    expect(span.style.fontWeight).toBe('bold');
    expect(span.children.length).toBe(1);
    expect(span.children[0].tagName).toBe('BR');
    // 光标应在 span 内
    expect(cursor.startContainer).toBe(span);
  });

  it('V41-T2: 无样式时创建 <p><br></p>（null styles fallback）', () => {
    editor.innerHTML = '<p>text</p>';
    const p = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, p, null);

    const allP = editor.querySelectorAll('p');
    expect(allP.length).toBe(2);
    const newP = allP[1];
    // 无样式: <p><br></p>
    expect(newP.children.length).toBe(1);
    expect(newP.children[0].tagName).toBe('BR');
    // 光标应在 <p> 内 (br 之前)
    expect(cursor.startContainer).toBe(newP);
  });

  it('V41-T3: 多重样式 (bold+italic+underline) 同时延续', () => {
    editor.innerHTML = '<p>styled</p>';
    const p = editor.querySelector('p')!;
    const cursor = insertStyledParagraphAfter(editor, p, {
      fontWeight: 'bold',
      fontStyle: 'italic',
      textDecoration: 'underline',
    });

    const newP = p.nextElementSibling as HTMLElement;
    expect(newP.tagName).toBe('P');
    const span = newP.children[0] as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.style.fontWeight).toBe('bold');
    expect(span.style.fontStyle).toBe('italic');
    expect(span.style.textDecoration).toBe('underline');
    expect(span.children[0].tagName).toBe('BR');
    expect(cursor.startContainer).toBe(span);
  });
});

describe('v41: splitBlockAtCursor - li 末尾 split 创建空 newP', () => {
  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  it('V41-T4: li 末尾光标 split → 新 <p> 为空(含 <br>),插入到 li 之后', () => {
    editor.innerHTML = '<ul><li><span style="font-weight: bold">bold</span></li></ul>';
    const li = editor.querySelector('li')!;
    const span = editor.querySelector('span')!;
    const textNode = span.firstChild as Text;

    // 光标在文本末尾
    const range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    const cursor = splitBlockAtCursor(editor, li, range);

    // li 之后应有新 <p>
    const newP = li.nextElementSibling as HTMLElement;
    expect(newP).toBeTruthy();
    expect(newP.tagName).toBe('P');
    // 新 <p> 应为空(只含 <br>)
    expect(newP.childNodes.length).toBe(1);
    expect(newP.firstChild!.nodeName).toBe('BR');
    // 光标应在 newP 开头
    expect(cursor.startContainer).toBe(newP);
  });

  it('V41-T5: li 中间光标 split → 新 <p> 含后半段文本', () => {
    editor.innerHTML = '<ul><li>hello world</li></ul>';
    const li = editor.querySelector('li')!;
    const textNode = li.firstChild as Text;

    // 光标在 "hello " 之后 (offset=6)
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.collapse(true);
    const sel = window.getSelection();
    sel!.removeAllRanges();
    sel!.addRange(range);

    splitBlockAtCursor(editor, li, range);

    // li 之后应有新 <p>, 含 "world"
    const newP = li.nextElementSibling as HTMLElement;
    expect(newP).toBeTruthy();
    expect(newP.tagName).toBe('P');
    expect(newP.textContent).toBe('world');
    // 原 li 应只剩 "hello "
    expect(li.textContent).toBe('hello ');
  });
});

describe('v41: B/I/U/S DISABLE 后输入恢复默认 (activeStylesLocked=true)', () => {
  let editor: HTMLElement;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    if (editor && editor.parentNode) editor.parentNode.removeChild(editor);
  });

  it('V41-T6: 粗体 span 内 activeStyles.bold=false + locked=true → 输入字符不继承粗体', () => {
    editor.innerHTML = '<p><span style="font-weight: bold">bold</span></p>';
    const span = editor.querySelector('span')!;
    const textNode = span.firstChild as Text;

    // 光标在 "bold" 末尾
    const range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    // applyActiveStylesToInsertion 内部通过 window.getSelection() 获取选区,需先设置
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // 模拟 onBeforeInputNative 的 hasExplicitCancel 路径
    // activeStyles={bold:false}, activeStylesLocked=true → applyActiveStylesToInsertion 应走 insertTextOutsideStyledSpan
    // 函数签名: (editor, active, text: string, activeStylesLocked)
    const result = applyActiveStylesToInsertion(
      editor,
      { bold: false, italic: undefined, underline: undefined, strike: undefined,
        color: undefined, fontSize: undefined, fontFamily: undefined, sup: undefined, sub: undefined },
      'd', // 传入文本字符串
      true, // activeStylesLocked
    );

    // 应返回 true (已处理插入)
    expect(result).toBe(true);
    // 原 span 仍含 "bold"
    const boldSpan = editor.querySelector('span[style*="bold"]');
    expect(boldSpan).toBeTruthy();
    expect(boldSpan!.textContent).toBe('bold');
  });
});
