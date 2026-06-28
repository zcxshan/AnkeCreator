import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorHistoryStore } from './editorHistoryStore';

describe('useEditorHistoryStore - canUndo / canRedo 状态', () => {
  beforeEach(() => {
    // 清空 store 回到初始状态
    useEditorHistoryStore.setState({ current: '', past: [], future: [] });
  });

  it('初始状态 canUndo / canRedo 均为 false', () => {
    expect(useEditorHistoryStore.getState().canUndo()).toBe(false);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(false);
  });

  it("reset('a') 后 canUndo=false（reset 清空 past）", () => {
    useEditorHistoryStore.getState().reset('a');
    expect(useEditorHistoryStore.getState().canUndo()).toBe(false);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(false);
    expect(useEditorHistoryStore.getState().current).toBe('a');
  });

  it("push('b') 后 canUndo=true, canRedo=false（新编辑清空 future）", () => {
    useEditorHistoryStore.getState().reset('a');
    useEditorHistoryStore.getState().push('b');
    expect(useEditorHistoryStore.getState().canUndo()).toBe(true);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(false);
    expect(useEditorHistoryStore.getState().current).toBe('b');
  });

  it('undo() 后 canUndo=false, canRedo=true（撤销后内容回退，future 有项）', () => {
    useEditorHistoryStore.getState().reset('a');
    useEditorHistoryStore.getState().push('b');
    const restored = useEditorHistoryStore.getState().undo();
    expect(restored).toBe('a');
    expect(useEditorHistoryStore.getState().canUndo()).toBe(false);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(true);
    expect(useEditorHistoryStore.getState().current).toBe('a');
  });

  it('redo() 后 canUndo=true, canRedo=false（重做后内容前进，past 有项）', () => {
    useEditorHistoryStore.getState().reset('a');
    useEditorHistoryStore.getState().push('b');
    useEditorHistoryStore.getState().undo();
    const restored = useEditorHistoryStore.getState().redo();
    expect(restored).toBe('b');
    expect(useEditorHistoryStore.getState().canUndo()).toBe(true);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(false);
    expect(useEditorHistoryStore.getState().current).toBe('b');
  });

  it('push 相同内容不入栈（canUndo 状态不变）', () => {
    useEditorHistoryStore.getState().reset('a');
    useEditorHistoryStore.getState().push('b');
    const beforePast = useEditorHistoryStore.getState().past.length;
    // 再次 push 相同内容
    useEditorHistoryStore.getState().push('b');
    expect(useEditorHistoryStore.getState().past.length).toBe(beforePast);
    expect(useEditorHistoryStore.getState().current).toBe('b');
  });

  it('undo 在空栈时返回 null，状态不变', () => {
    useEditorHistoryStore.getState().reset('a');
    const restored = useEditorHistoryStore.getState().undo();
    expect(restored).toBeNull();
    expect(useEditorHistoryStore.getState().canUndo()).toBe(false);
    expect(useEditorHistoryStore.getState().canRedo()).toBe(false);
  });

  it('redo 在空栈时返回 null，状态不变', () => {
    useEditorHistoryStore.getState().reset('a');
    const restored = useEditorHistoryStore.getState().redo();
    expect(restored).toBeNull();
    expect(useEditorHistoryStore.getState().canRedo()).toBe(false);
  });
});
