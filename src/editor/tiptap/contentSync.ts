// ============================================================
// 编辑器内容同步判定（纯函数，便于单测）
//
// 背景：编辑器既要响应用户输入（onUpdate 回传），又要响应外部内容变化
// （切节 / 导入 / 自动保存回写）。两条链路互相回声会造成：
//   1. 输入法组合期间 setContent 打断候选框；
//   2. 内容未变化时重复 setContent，把撤销栈清空；
//   3. 切节后 Ctrl+Z 撤销回上一节内容。
// 这里把判定逻辑抽成纯函数，编辑器组件只负责执行。
// ============================================================

/** 输入法组合期间跳过外部同步，避免打断候选框 */
export function shouldSkipExternalSync(isComposing: boolean): boolean {
  return isComposing;
}

export interface ExternalContentInput {
  isComposing: boolean
  next: string
  lastApplied: string
}

/** 外部内容是否需要写入编辑器（组合中 / 内容未变化时不写） */
export function shouldApplyExternalContent(input: ExternalContentInput): boolean {
  return !input.isComposing && input.next !== input.lastApplied;
}

/** 内容发生变化时视为撤销边界，需要重建 EditorState（清空撤销栈） */
export function shouldRecreateHistory(previousContent: string, nextContent: string): boolean {
  return previousContent !== nextContent;
}
