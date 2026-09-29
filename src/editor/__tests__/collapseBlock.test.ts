/**
 * 折叠块交互修复（Task 8）
 *
 * 修复目标：
 *   1. 点击 .collapse-title 只进入编辑,不再触发折叠（标题是 .collapse-head 子元素,
 *      onClick 的 closest 判定会把"点标题编辑"误判成"点 head 折叠",导致框选/编辑中途
 *      块突然折叠 → 框选断裂、显示错误）。
 *   2. 折叠状态统一以 block.dataset.collapsed 为唯一数据源：
 *      - insertCollapseBlock 的 initCollapseBlockEvents（闭包 expanded）与
 *        attachCollapseBlockHandlers.onClick（dataset.collapsed）是两套状态机,
 *        不同步 → 显示错误、折叠状态无法序列化保存。
 *   3. 旧数据兼容：body display:none 但无 data-collapsed（旧版本导出的 HTML）,
 *      点击 head 应正确展开,而不是"再折叠一次"导致点击无反应。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { attachCollapseBlockHandlers, insertCollapseBlock } from '../collapseBlock';

describe('折叠块交互修复', () => {
  let editor: HTMLDivElement;
  let cleanup: () => void;

  beforeEach(() => {
    editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>前置文本</p>';
    document.body.appendChild(editor);
  });

  afterEach(() => {
    if (cleanup) cleanup();
    editor.remove();
  });

  it('点击 .collapse-title 不触发折叠(允许正常编辑标题)', () => {
    editor.innerHTML = `
      <div data-type="collapse-block" data-title="折叠">
        <div class="collapse-head">
          <span class="collapse-toggle">−</span>
          <span class="collapse-title" contenteditable="true">折叠</span>
        </div>
        <div class="collapse-body" contenteditable="true">内容</div>
      </div>
    `;
    cleanup = attachCollapseBlockHandlers(editor);
    const title = editor.querySelector('.collapse-title') as HTMLElement;
    const body = editor.querySelector('.collapse-body') as HTMLElement;
    const toggle = editor.querySelector('.collapse-toggle') as HTMLElement;
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;

    fireEvent.click(title);

    // 不应折叠
    expect(body.style.display).not.toBe('none');
    expect(toggle.dataset.collapsed).toBeUndefined();
    expect(block.dataset.collapsed).not.toBe('true');
  });

  it('insertCollapseBlock 后点击 toggle 折叠:data-collapsed=true + body display:none + toggle 状态同步,再点展开', () => {
    const textNode = editor.querySelector('p')!.firstChild as Text;
    const r = document.createRange();
    r.setStart(textNode, textNode.textContent!.length);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);

    const inputSpy = vi.fn();
    editor.addEventListener('input', inputSpy);

    // 真实应用在编辑器挂载时即挂载 attachCollapseBlockHandlers（折叠统一由此处理）
    cleanup = attachCollapseBlockHandlers(editor);
    insertCollapseBlock(editor, '标题');
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;
    const body = block.querySelector('.collapse-body') as HTMLElement;
    const toggle = block.querySelector('.collapse-toggle') as HTMLElement;

    // 初始：展开，toggle 为 ChevronRight 图标
    expect(block.dataset.collapsed).toBeUndefined();
    expect(body.style.display).toBe('block');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(toggle.dataset.collapsed).toBeUndefined();

    // 点击 toggle → 折叠（data-collapsed 同步,供序列化保存）
    fireEvent.click(toggle);
    expect(block.dataset.collapsed).toBe('true');
    expect(body.style.display).toBe('none');
    expect(toggle.dataset.collapsed).toBe('true');

    // 再点 toggle → 展开
    fireEvent.click(toggle);
    expect(block.dataset.collapsed).toBe('false');
    expect(body.style.display).toBe('block');
    expect(toggle.dataset.collapsed).toBe('false');

    // 折叠状态变化需触发 input,让外部 onChangeContent 保存到 HTML
    expect(inputSpy).toHaveBeenCalled();
  });

  it('旧数据兼容:body display:none 但无 data-collapsed → 点击 head 展开而非再折叠', () => {
    editor.innerHTML = `
      <div data-type="collapse-block" data-title="折叠">
        <div class="collapse-head">
          <span class="collapse-toggle">+</span>
          <span class="collapse-title">折叠</span>
        </div>
        <div class="collapse-body" style="display:none">内容</div>
      </div>
    `;
    cleanup = attachCollapseBlockHandlers(editor);
    const head = editor.querySelector('.collapse-head') as HTMLElement;
    const body = editor.querySelector('.collapse-body') as HTMLElement;
    const toggle = editor.querySelector('.collapse-toggle') as HTMLElement;
    const block = editor.querySelector('[data-type="collapse-block"]') as HTMLElement;

    // 视觉上已折叠（旧数据）
    expect(body.style.display).toBe('none');

    // 点击 head 应展开
    fireEvent.click(head);
    expect(body.style.display).toBe('block');
    expect(block.dataset.collapsed).toBe('false');
    expect(toggle.dataset.collapsed).toBe('false');
  });
});
