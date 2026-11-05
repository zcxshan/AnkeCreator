// ============================================================
// 安科编辑器 —— 编辑器 DOM 状态判定 / 选区缓存（Tiptap 内核）
//
// 从旧 contenteditable 模块机械搬迁（utils.ts 的 domShowsContent、
// selection.ts 的 setLastEditorRange），函数体与语义逐字保留。
// ============================================================

/**
 * 模块级"编辑器最后一次选区"
 * - 工具栏 / 弹窗 input 等位置会触发 selectionchange，selectionchange 监听里
 *   同步到这里（仅当光标在 editor 内时记录）
 */
let _lastEditorRange: Range | null = null;

/** 由 TiptapEditorPane 的 selectionchange 监听调用 */
export function setLastEditorRange(range: Range | null): void {
  _lastEditorRange = range;
}

/**
 * 判断编辑器 DOM 当前序列化内容是否已与目标 content 等价。
 *
 * 背景：浏览器对 innerHTML 的序列化不是幂等的（标签名转小写、空段落补 <br>、
 * 表格补 <tbody>、属性顺序调整等），因此「写入内联字符串再读回」得到的字符串
 * 可能与原始快照不一致。content effect 用它做守卫：
 *   - 快路径：el.innerHTML 与目标完全一致（用户输入/撤销重做写回后），跳过
 *   - 慢路径：目标内容解析后重新序列化，与 DOM 当前序列化对比；等价则视为
 *     "内容已显示"，跳过重写与历史栈 reset()，避免撤销后误清空 redo 栈
 * @param el 编辑器根元素（contenteditable）
 * @param content 目标内容（原始 HTML 字符串，可能为 '' 表示空内容）
 * @returns true 表示 DOM 已显示等价内容，调用方应跳过写入与历史重置
 */
export function domShowsContent(el: HTMLElement, content: string | null | undefined): boolean {
  const safeContent: string = content == null || content === '' ? '' : content;
  // 空内容在编辑器中以 <br> 占位显示（contenteditable 空 div 不显示光标）
  const displayHTML = safeContent === '' ? '<br>' : safeContent;
  if (el.innerHTML === displayHTML) return true;
  // 规范化比较：把目标内容按浏览器同样的规则解析再序列化，与 DOM 当前序列化对比
  const probe = document.createElement('div');
  probe.innerHTML = displayHTML;
  return el.innerHTML === probe.innerHTML;
}
