// ============================================================
// 撤销/重做 回归测试：浏览器 innerHTML 序列化非幂等
// 导致 content effect 误判"外部加载"而 reset() 清空撤销/重做栈
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { domShowsContent } from '../utils';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';

describe('undo/redo 与内容序列化规范化', () => {
  beforeEach(() => {
    useEditorHistoryStore.setState({ current: '', past: [], future: [] });
  });

  it('前提：浏览器 innerHTML 写回后读回的字符串与原始快照不一致（序列化非幂等）', () => {
    const div = document.createElement('div');
    // 含大写标签 + 无 tbody 的表格：Chromium/happy-dom 写回时都会规范化
    const raw = '<p>正文<BR></p><TABLE><TR><TD>x</TD></TR></TABLE>';
    div.innerHTML = raw;
    expect(div.innerHTML).not.toBe(raw);
  });

  it('domShowsContent：DOM 已显示等价内容（含规范化差异）时判定 true，否则 false', () => {
    const div = document.createElement('div');
    const raw = '<p>正文<BR></p><TABLE><TR><TD>x</TD></TR></TABLE>';
    div.innerHTML = raw; // 模拟 applyHistory 写回
    const normalized = div.innerHTML;

    // 规范化差异：content 为原始快照（raw）时，probe 按浏览器同规则归一化后与 DOM 等价
    // → 应判定"已显示"（修复核心：undo 写回原始快照不会误触发 reset 清空 redo 栈）
    expect(domShowsContent(div, raw)).toBe(true);
    expect(domShowsContent(div, normalized)).toBe(true);
    // 完全相同 → 通过
    expect(domShowsContent(div, div.innerHTML)).toBe(true);
    // 真正不同的内容 → 判定未显示（守卫放行，触发正常加载/reset 路径）
    expect(domShowsContent(div, '<p>完全不同的内容</p>')).toBe(false);
  });

  it('空内容占位符 <br>：DOM 为 <br> 时空字符串内容应判定已显示', () => {
    const div = document.createElement('div');
    div.innerHTML = '<br>';
    expect(domShowsContent(div, '')).toBe(true);
    expect(domShowsContent(div, '<br>')).toBe(true);
  });

  it('回归：undo 后写回 DOM 不得触发 reset 清空 redo 栈', () => {
    const div = document.createElement('div');
    const rawInitial = '<p>引用测试正文</p><p><BR></p><TABLE><TR><TD>x</TD></TR></TABLE>';
    div.innerHTML = rawInitial;
    const initial = div.innerHTML; // 加载后浏览器规范化过的权威内容

    useEditorHistoryStore.getState().reset(initial);
    useEditorHistoryStore.getState().push(initial + '<b>ab</b>');
    expect(useEditorHistoryStore.getState().canUndo()).toBe(true);

    const restored = useEditorHistoryStore.getState().undo();
    expect(restored).toBe(initial);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(true);

    // 模拟 applyHistory：写回 DOM 并取规范化值同步 store.current（修复行为）
    div.innerHTML = restored!;
    const normalized = div.innerHTML;
    useEditorHistoryStore.setState({ current: normalized });

    // content effect 守卫：规范化值应判定"已显示" → 不会调用 reset
    expect(domShowsContent(div, normalized)).toBe(true);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(true); // redo 栈保留
    expect(useEditorHistoryStore.getState().canUndo()).toBe(false);
  });
});
