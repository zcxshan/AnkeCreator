// ============================================================
// contenteditable 富文本工具集 — 列表缩进（Tab / Shift+Tab）
// ------------------------------------------------------------
// 参考 Word / 主流编辑器的列表缩进行为：
//   - Tab：当前 <li> 成为前一个兄弟 <li> 的子列表项
//   - Shift+Tab：当前 <li> 从嵌套列表退出一层（回到上一层同级）
// 光标保持不变（移动的是 <li> 节点，光标锚点仍在其内部文本节点上）
// ============================================================

function isListTag(el: HTMLElement | null): boolean {
  return !!el && (el.tagName === 'UL' || el.tagName === 'OL');
}

/** 在 prevLi 下创建与父列表同类型的子列表 */
function createChildList(prevLi: HTMLElement): HTMLElement {
  const list = prevLi.parentElement;
  const tag = list && list.tagName === 'OL' ? 'OL' : 'UL';
  const childList = document.createElement(tag);
  prevLi.appendChild(childList);
  return childList;
}

/** 缩进：把 li 变为前一个兄弟 li 的子列表项；返回是否成功 */
export function indentListItem(li: HTMLElement): boolean {
  const list = li.parentElement;
  if (!isListTag(list)) return false;
  const prev = li.previousElementSibling as HTMLElement | null;
  if (!prev || prev.tagName !== 'LI') return false;
  // 复用已存在的子列表，否则新建同类型子列表
  let childList = Array.from(prev.children).find(isListTag) as HTMLElement | null;
  if (!childList) childList = createChildList(prev);
  childList.appendChild(li);
  return true;
}

/** 退层：把 li 从嵌套列表移出，恢复为父 li 之后的同级项；返回是否成功 */
export function outdentListItem(li: HTMLElement): boolean {
  const list = li.parentElement;
  if (!isListTag(list)) return false;
  // 嵌套列表（ul/ol）的父节点是 LI（<li>A<ul><li>B</li></ul></li>）
  // 仅当父是 LI 才允许退层（顶层列表不响应 Shift+Tab）
  const parentLi = list.parentElement;
  if (!parentLi || parentLi.tagName !== 'LI') return false;
  const outerList = parentLi.parentElement;
  if (!isListTag(outerList)) return false;
  // 把 li 移到父 li 之后（成为外层列表的直接子项）
  outerList.insertBefore(li, parentLi.nextSibling);
  // 原列表空了 → 移除
  if (list.childElementCount === 0) list.remove();
  return true;
}
