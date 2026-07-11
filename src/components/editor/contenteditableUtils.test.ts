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

    // 点击 body 内部 → onMouseDown 设置 data-selected=true（这是核心 BUG 触发条件）
    fireEvent.mouseDown(body);
    expect(block.getAttribute('data-selected')).toBe('true');

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
