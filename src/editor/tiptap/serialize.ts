// ============================================================
// 编辑器 HTML 序列化清洗
// ------------------------------------------------------------
// 背景（NGA 用户反馈 v3.5.4，工程文件膨胀到 23MB 崩溃）：
//   ProseMirror 会在渲染层动态插入临时占位 DOM（如 mark 边界的
//   <img class="ProseMirror-separator" contenteditable="false">、
//   行尾的 <br class="ProseMirror-trailingBreak"> 等）。这些元素
//   **不属于文档模型**，若随 view.dom.innerHTML 一并存库，下次
//   加载又会成为文档内容，PM 再在其周围插入新的临时节点 ——
//   无限增殖，直到工程文件膨胀、打开黑屏、数据丢失。
//
// 策略：
//   1. 序列化出口（onUpdate）清洗 —— 保证新写入的数据干净；
//   2. 内容入口（初始 content / setContent）清洗 —— 治愈存量污染；
//   3. 快速路径：HTML 中不含 "ProseMirror-" 子串时原样返回，
//      正常键入路径零额外开销。
// ============================================================

/** 判定是否可能含有 PM 临时元素的快速检查子串 */
const PM_MARKER = 'ProseMirror-';
const PM_PLACEHOLDER_MARKER = 'mark-placeholder';

/** 快速路径：两类标记均不存在时无需解析 */
function mayContainArtifacts(html: string): boolean {
  return html.includes(PM_MARKER) || html.includes(PM_PLACEHOLDER_MARKER);
}

/**
 * 剥离 ProseMirror 渲染层临时 DOM，返回干净的 HTML。
 *
 * 识别两类特征：
 *   1. class 含 "ProseMirror-" 前缀的元素（separator / trailingBreak / widget 等）
 *   2. 带 mark-placeholder 属性的元素（PM 标注占位的另一形态）
 *
 * @param html 编辑器序列化出的 HTML（或存量库中的内容 HTML）
 */
export function stripProseMirrorArtifacts(html: string): string {
  if (!html || !mayContainArtifacts(html)) return html;
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  let removed = 0;
  parsed.querySelectorAll('[class*="ProseMirror-"]').forEach((el) => {
    el.remove();
    removed += 1;
  });
  parsed.querySelectorAll('[mark-placeholder]').forEach((el) => {
    el.remove();
    removed += 1;
  });
  if (removed === 0) return html;
  return parsed.body.innerHTML;
}

/** 是否检测到存量污染（供加载侧判断是否需要回写治愈） */
export function hasProseMirrorArtifacts(html: string): boolean {
  return mayContainArtifacts(html);
}
