/**
 * 输入接管策略：判断一段将要插入的文本是否需要被编辑器"接管"。
 * 纯空白输入（空格/连续空格/制表符）永远放行给浏览器原生处理，
 * 避免样式锁定状态下接管逻辑在原子块边缘等位置插入失败导致空格被吞。
 */
export function isWhitespaceOnly(text: string): boolean {
  return text.length > 0 && /^\s+$/.test(text);
}
