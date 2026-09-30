/**
 * 工具栏样式功能验证测试（粗体/斜体/下划线/删除线/字色/字号/字体）
 *
 * 覆盖两条核心路径：
 *  1. 选中文字后应用（applyInlineStyle / applyTextDecorationPartNoFocus）
 *  2. 先激活样式后输入自动应用（applyActiveStylesToInsertion，含取消语义）
 *
 * 背景：浏览器实测时子代理误用 <b>/<i>/<u> 标签判断成败，
 * 而实现采用 CSS span（font-weight/font-style/text-decoration）方案，
 * 因此本测试以最终 DOM（span style）为权威证据。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyInlineStyle,
  applyActiveStylesToInsertion,
  applyTextDecorationPartNoFocus,
  removeInlineStyle,
  removeTextDecorationPartNoFocus,
  applyColor,
  applyFontSize,
  applyFontFamily,
} from '../inlineStyle';
import { setLastEditorRange } from '../selection';

let editor: HTMLDivElement;

beforeEach(() => {
  editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  document.body.appendChild(editor);
});

afterEach(() => {
  editor.remove();
  setLastEditorRange(null);
});

function setHTML(html: string): void {
  editor.innerHTML = html;
}

function firstTextNode(): Text {
  const tn = editor.querySelector('p, div')?.firstChild;
  if (!tn) throw new Error('editor has no text node');
  return tn as Text;
}

/** 折叠光标：定位到某文本节点内 */
function setCaret(node: Node, offset: number): void {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  setLastEditorRange(r.cloneRange());
}

/** 非折叠选区：start 到 end */
function selectRange(startNode: Node, startOff: number, endNode: Node, endOff: number): void {
  const r = document.createRange();
  r.setStart(startNode, startOff);
  r.setEnd(endNode, endOff);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  setLastEditorRange(r.cloneRange());
}

function onlySpan(): HTMLElement | null {
  return editor.querySelector('span');
}

describe('路径1：选中文字后应用样式（applyInlineStyle）', () => {
  beforeEach(() => {
    setHTML('<p>甲乙丙</p>');
    const tn = firstTextNode();
    // 选中"乙"
    selectRange(tn, 1, tn, 2);
  });

  it('粗体：选中文字后应用 font-weight: bold', () => {
    const ok = applyInlineStyle(editor, { fontWeight: 'bold' });
    expect(ok).toBe(true);
    const span = onlySpan();
    expect(span).not.toBeNull();
    expect(span!.style.fontWeight).toBe('bold');
    expect(span!.textContent).toBe('乙');
  });

  it('斜体：选中文字后应用 font-style: italic', () => {
    applyInlineStyle(editor, { fontStyle: 'italic' });
    const span = onlySpan();
    expect(span!.style.fontStyle).toBe('italic');
    expect(span!.textContent).toBe('乙');
  });

  it('字色：选中文字后应用 color', () => {
    applyInlineStyle(editor, { color: '#ff0000' });
    const span = onlySpan();
    expect(span!.style.color).toBe('#ff0000');
    expect(span!.textContent).toBe('乙');
  });

  it('字号：选中文字后应用 font-size', () => {
    applyInlineStyle(editor, { fontSize: '30px' });
    const span = onlySpan();
    expect(span!.style.fontSize).toBe('30px');
    expect(span!.textContent).toBe('乙');
  });

  it('字体：选中文字后应用 font-family', () => {
    applyInlineStyle(editor, { fontFamily: 'SimHei' });
    const span = onlySpan();
    expect(span!.style.fontFamily).toBe('SimHei');
    expect(span!.textContent).toBe('乙');
  });

  it('粗体+斜体同时应用：单个 span 同时带两种样式', () => {
    applyInlineStyle(editor, { fontWeight: 'bold', fontStyle: 'italic' });
    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontWeight).toBe('bold');
    expect(spans[0].style.fontStyle).toBe('italic');
  });
});

describe('路径1：选中文字后应用下划线/删除线（applyTextDecorationPartNoFocus）', () => {
  beforeEach(() => {
    setHTML('<p>甲乙丙</p>');
    const tn = firstTextNode();
    selectRange(tn, 1, tn, 2);
  });

  it('下划线：text-decoration 含 underline', () => {
    const ok = applyTextDecorationPartNoFocus(editor, 'underline');
    expect(ok).toBe(true);
    const span = onlySpan();
    expect(span!.style.textDecoration.split(/\s+/)).toContain('underline');
    expect(span!.textContent).toBe('乙');
  });

  it('删除线：text-decoration 含 line-through', () => {
    applyTextDecorationPartNoFocus(editor, 'line-through');
    const span = onlySpan();
    expect(span!.style.textDecoration.split(/\s+/)).toContain('line-through');
  });
});

describe('路径2：先激活样式后输入自动应用（applyActiveStylesToInsertion）', () => {
  beforeEach(() => {
    setHTML('<p>基线文字</p>');
    const tn = firstTextNode();
    setCaret(tn, tn.textContent!.length);
  });

  it('粗体：激活后输入 AA → span{font-weight:bold}', () => {
    const ok = applyActiveStylesToInsertion(editor, { bold: true }, 'AA', true);
    expect(ok).toBe(true);
    expect(editor.innerHTML).toContain('<span style="font-weight: bold;">AA</span>');
  });

  it('斜体：激活后输入 → font-style: italic', () => {
    applyActiveStylesToInsertion(editor, { italic: true }, 'AA', true);
    expect(editor.innerHTML).toContain('font-style: italic');
  });

  it('下划线：激活后输入 → text-decoration: underline', () => {
    applyActiveStylesToInsertion(editor, { underline: true }, 'AA', true);
    expect(editor.innerHTML).toContain('text-decoration: underline');
  });

  it('删除线：激活后输入 → text-decoration: line-through', () => {
    applyActiveStylesToInsertion(editor, { strike: true }, 'AA', true);
    expect(editor.innerHTML).toContain('text-decoration: line-through');
  });

  it('字色：激活后输入 → color 生效', () => {
    applyActiveStylesToInsertion(editor, { color: '#ff0000' }, 'AA', true);
    const span = editor.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('AA');
    // happy-dom 可能归一化为 #hex 或 rgb，两种都接受
    expect(['#ff0000', 'rgb(255, 0, 0)']).toContain(span!.style.color);
  });

  it('字号：激活后输入 → font-size 生效', () => {
    applyActiveStylesToInsertion(editor, { fontSize: '30px' }, 'AA', true);
    expect(editor.innerHTML).toContain('font-size: 30px');
  });

  it('字体：激活后输入 → font-family 生效', () => {
    applyActiveStylesToInsertion(editor, { fontFamily: 'SimHei' }, 'AA', true);
    expect(editor.innerHTML).toContain('font-family: SimHei');
  });

  it('多样式组合：粗体+斜体 → 单个 span 同时生效', () => {
    applyActiveStylesToInsertion(editor, { bold: true, italic: true }, 'AA', true);
    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].style.fontWeight).toBe('bold');
    expect(spans[0].style.fontStyle).toBe('italic');
  });

  it('嵌套去重：在已有粗体 span 内激活粗体再输入 → 不产生嵌套 span', () => {
    // 场景：光标在粗体 span 内，用户再次激活粗体（样式已被继承）
    setHTML('<p><span style="font-weight: bold;">基线</span></p>');
    const tn = editor.querySelector('span')!.firstChild as Text;
    setCaret(tn, tn.textContent!.length);
    const ok = applyActiveStylesToInsertion(editor, { bold: true }, 'AA', true);
    expect(ok).toBe(true);
    // 不再包一层（样式已继承），文本直接插入 span 内
    const spans = editor.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('基线AA');
  });
});

describe('路径2：取消样式（activeStyles 显式 false）', () => {
  it('在粗体 span 内取消粗体后输入 → 新文本跳出 span，不继承粗体', () => {
    setHTML('<p><span style="font-weight: bold;">基线</span></p>');
    const tn = editor.querySelector('span')!.firstChild as Text;
    setCaret(tn, tn.textContent!.length);
    const ok = applyActiveStylesToInsertion(editor, { bold: false }, 'BB', true);
    expect(ok).toBe(true);
    expect(editor.innerHTML).toContain('<span style="font-weight: bold;">基线</span>BB');
  });

  it('粗体+斜体高亮，取消粗体 → 新 span 保留斜体、去掉粗体', () => {
    setHTML('<p><span style="font-weight: bold; font-style: italic;">基线</span></p>');
    const tn = editor.querySelector('span')!.firstChild as Text;
    setCaret(tn, tn.textContent!.length);
    applyActiveStylesToInsertion(editor, { bold: false, italic: true }, 'BB', true);
    const spans = editor.querySelectorAll('span');
    // 原 span（粗体+斜体）与新 span（仅斜体）并存，新文本不在粗体内
    expect(spans.length).toBe(2);
    const newSpan = spans[spans.length - 1];
    expect(newSpan.textContent).toBe('BB');
    expect(newSpan.style.fontWeight).not.toBe('bold');
    expect(newSpan.style.fontStyle).toBe('italic');
  });
});

describe('取消已有样式（removeInlineStyle / removeTextDecorationPartNoFocus）', () => {
  it('取消粗体：移除 font-weight 并展平 span', () => {
    setHTML('<p><span style="font-weight: bold;">甲乙丙</span></p>');
    const tn = editor.querySelector('span')!.firstChild as Text;
    selectRange(tn, 0, tn, 3);
    removeInlineStyle(editor, ['fontWeight']);
    expect(editor.querySelector('span')).toBeNull();
    expect(editor.innerHTML).toContain('甲乙丙');
  });

  it('取消下划线：保留删除线（细粒度 text-decoration）', () => {
    setHTML('<p><span style="text-decoration: underline line-through;">甲乙丙</span></p>');
    const tn = editor.querySelector('span')!.firstChild as Text;
    selectRange(tn, 0, tn, 3);
    removeTextDecorationPartNoFocus(editor, 'underline');
    const span = editor.querySelector('span');
    expect(span).not.toBeNull();
    const parts = span!.style.textDecoration.split(/\s+/);
    expect(parts).not.toContain('underline');
    expect(parts).toContain('line-through');
  });

  it('取消全部装饰线 → span 展平', () => {
    setHTML('<p><span style="text-decoration: underline;">甲乙丙</span></p>');
    const tn = editor.querySelector('span')!.firstChild as Text;
    selectRange(tn, 0, tn, 3);
    removeTextDecorationPartNoFocus(editor, 'underline');
    expect(editor.querySelector('span')).toBeNull();
  });
});

describe('工具栏字色/字号/字体按钮（applyColor / applyFontSize / applyFontFamily）', () => {
  beforeEach(() => {
    setHTML('<p>甲乙丙</p>');
    const tn = firstTextNode();
    selectRange(tn, 1, tn, 2);
  });

  it('applyColor 设置颜色', () => {
    applyColor(editor, '#00ff00');
    const span = onlySpan();
    expect(span!.textContent).toBe('乙');
    expect(span!.style.color).not.toBe('');
  });

  it('applyColor 传空清除颜色并展平 span', () => {
    setHTML('<p><span style="color: #ff0000;">甲乙丙</span></p>');
    const tn = editor.querySelector('span')!.firstChild as Text;
    selectRange(tn, 0, tn, 3);
    applyColor(editor, '');
    expect(editor.querySelector('span')).toBeNull();
    expect(editor.innerHTML).toContain('甲乙丙');
  });

  it('applyFontSize 设置字号', () => {
    applyFontSize(editor, '24px');
    expect(onlySpan()!.style.fontSize).toBe('24px');
  });

  it('applyFontFamily 设置字体', () => {
    applyFontFamily(editor, '楷体');
    expect(onlySpan()!.style.fontFamily).toBe('楷体');
  });
});
