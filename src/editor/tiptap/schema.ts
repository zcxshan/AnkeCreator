// ============================================================
// 安科编辑器 —— Tiptap / ProseMirror schema（单一事实来源）
//
// 本文件只声明「文档模型」：node / mark / attribute 的解析与序列化规则。
// 不依赖 React，也不依赖浏览器全局对象，因此可同时被：
//   1) 运行时编辑器（TiptapEditorPane）
//   2) 离线审计脚本（scripts/audit-editor-html.mjs，happy-dom 环境）
// 复用，保证「审计所见」与「线上所见」是同一套规则。
//
// 设计依据：.trae/audit-phase1.json + .trae/audit-samples.log（真实数据 105 节）
//
// 核心原则：真实数据出现过的每一条 data-* / 结构形态都必须显式声明，
// 否则 ProseMirror 会静默丢弃 —— 这是「历史内容丢失」风险的唯一来源。
// ============================================================

import { Extension, Mark, Node, mergeAttributes, getSchema, type Extensions } from '@tiptap/core'
import type { TagParseRule } from '@tiptap/pm/model'
import { history, redo, undo } from '@tiptap/pm/history'
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TextAlign } from '@tiptap/extension-text-align'
import { Underline } from '@tiptap/extension-underline'

// ------------------------------------------------------------
// 公共工具
// ------------------------------------------------------------

/** 块级标签集合：用于判断一个 div 是否只是「内联内容的容器」 */
const BLOCK_TAG_RE = /^(p|div|ul|ol|li|blockquote|table|thead|tbody|tr|td|th|hr|pre|h[1-6]|section)$/i

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((c) => BLOCK_TAG_RE.test(c.tagName))
}

/** 读取属性，不存在时返回 null（避免 Tiptap 把 '' 与 undefined 混淆） */
function readAttr(el: Element | null, name: string): string | null {
  if (!el || !el.hasAttribute(name)) return null
  return el.getAttribute(name)
}

/**
 * 原子块 parse 规则优先级。
 *
 * 必须高于 paragraph 的 `div` 规则（默认优先级 50）——
 * 否则「不含块级子元素的 div」会先被 paragraph 抢走，
 * image-block / dice-card / collapse-block 会被整体误解析成段落。
 */
const ATOMIC_RULE_PRIORITY = 1000

/** 把 null 属性从 renderHTML 结果中剔除 */
function omitNull<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''))
}

// ------------------------------------------------------------
// 一、基础块节点
// ------------------------------------------------------------

/**
 * text —— 文本节点。
 *
 * 与 @tiptap/extension-text 完全等价（该扩展本体只有 name/group 两行），
 * 此处内联声明，避免为两行代码新增一个直接依赖。
 * ProseMirror 强制要求 schema 中存在名为 `text` 的节点，缺失会抛
 * `Every schema needs a 'text' type`。
 */
export const AnkeText = Node.create({
  name: 'text',
  group: 'inline',
})

/**
 * doc —— 文档根。
 * 顶层允许块级内容；真实数据中直接出现在顶层的裸文本 / <br> 由
 * ProseMirror 自动包进 paragraph（needsBlock 机制）。
 */
export const AnkeDoc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
})

/**
 * paragraph —— 段落。
 *
 * 真实数据：
 *   p    76 条（其中 2 条带 style="text-align:center"）
 *   div 1838 条，其中 508 条是原子块（image-block 500 / collapse-block 8），
 *            其余 1330 条是 NGA 论坛粘贴包裹用的普通 div
 *   div.clear 1 条（空占位）
 *
 * 因此 div 也要按段落解析；但「内部含块级子元素」的 div 不匹配（返回 false），
 * 交给 ProseMirror 摊平其子节点，与 BBCode 转换层的 processBlockChildren 行为一致。
 */
export const AnkeParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML() {
    return [
      { tag: 'p' },
      {
        tag: 'div',
        getAttrs: (el) => (hasBlockChild(el as HTMLElement) ? false : {}),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0]
  },
})

/**
 * quoteBlock —— 引用块（业务块，但**不是原子块**）。
 *
 * 真实数据 276 条：
 *   <blockquote data-type="quote-block" style="…">富文本（含 b/br/a/image-block）</blockquote>
 *   仅 2 个属性：data-type / style，内部完全可编辑。
 *   legacy style：background:#f2eddf;padding:8px 12px;border-radius:4px;margin:6px 0;border-left:3px solid #c8b88a
 *   现行   style：background:var(--quote-bg);color:inherit;padding:8px 12px;border-left:3px solid var(--quote-border, #c8b88a);border-radius:4px;margin:6px 0;
 *
 * style 原样保留（零丢失）；NGA BBCode 转换层不读 style，只读内部内容，
 * 所以两种历史形态都能正常导出。
 */
export const AnkeQuoteBlock = Node.create({
  name: 'quoteBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      dataType: {
        default: 'quote-block',
        parseHTML: (el) => el.getAttribute('data-type') ?? 'quote-block',
        renderHTML: (attrs) => ({ 'data-type': attrs.dataType }),
      },
      style: {
        default: null,
        parseHTML: (el) => readAttr(el, 'style'),
        renderHTML: (attrs) => omitNull({ style: attrs.style }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'blockquote[data-type="quote-block"]' }, { tag: 'blockquote' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['blockquote', mergeAttributes(HTMLAttributes), 0]
  },
})

/**
 * horizontalRule —— 分割线。
 * 真实数据 2 条：<hr data-h="1">，BBCode 转成 [h][/h]。
 */
export const AnkeHorizontalRule = Node.create({
  name: 'horizontalRule',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      dataH: {
        default: '1',
        parseHTML: (el) => el.getAttribute('data-h') ?? '1',
        renderHTML: (attrs) => ({ 'data-h': attrs.dataH }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'hr' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['hr', mergeAttributes(HTMLAttributes)]
  },
})

/** hardBreak —— 软换行 <br>（真实数据 2748 条，最高频节点） */
export const AnkeHardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  linebreakReplacement: true,
  parseHTML() {
    return [{ tag: 'br' }]
  },
  renderHTML() {
    return ['br']
  },
})

/**
 * codeBlock —— 代码块。
 * BBCode 转换层只认 `pre.code-block`（取 textContent，保留换行）。
 * 真实数据 0 条，但工具栏有「代码块」按钮，必须支持。
 */
export const AnkeCodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'pre.code-block' }, { tag: 'pre' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes({ class: 'code-block' }, HTMLAttributes), 0]
  },
})

// ------------------------------------------------------------
// 二、行内节点
// ------------------------------------------------------------

/**
 * inlineImage —— 行内图片。
 *
 * 真实数据 508 个 <img>：其中 500 个位于 image-block 内（由 ImageBlock 节点承载），
 * 剩余 8 个是 NGA 表情 <img class="smile_ac" src="…/smile/ac15.png" alt="哭笑">。
 *
 * 注意：NGA 表情与普通 <img> 都必须保留 alt（BBCode 会读）。
 */
export const AnkeInlineImage = Node.create({
  name: 'inlineImage',
  group: 'inline',
  inline: true,
  atom: true,
  // 允许承载全部 mark。ProseMirror 的默认策略是「无 content 的叶子节点不允许任何
  // mark」（marks 缺省 → markSet = []），而真实数据里 <img> 位于带 style="color:…"
  // 的 <span> 内部（NGA 粘贴产物），不允许 mark 会导致该行内图片脱离外层格式段、
  // 往返后颜色段被拆成两段（第1/16 节复现）。'_' 是 ProseMirror 原生写法，
  // 表示允许全部 mark。
  marks: '_',
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => readAttr(el, 'src'),
        renderHTML: (attrs) => omitNull({ src: attrs.src }),
      },
      alt: {
        default: null,
        parseHTML: (el) => readAttr(el, 'alt'),
        renderHTML: (attrs) => omitNull({ alt: attrs.alt }),
      },
      className: {
        default: null,
        parseHTML: (el) => readAttr(el, 'class'),
        renderHTML: (attrs) => omitNull({ class: attrs.className }),
      },
      dataName: {
        default: null,
        parseHTML: (el) => readAttr(el, 'data-name'),
        renderHTML: (attrs) => omitNull({ 'data-name': attrs.dataName }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'img' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },
})

// ------------------------------------------------------------
// 三、原子块（安科业务专属）
// ------------------------------------------------------------

/**
 * imageBlock —— 图片块（原子块，真实数据 500 条）。
 *
 * 两种历史形态（均带 data-type）：
 *   legacy 92  条：<div data-type="image-block" data-size="original"
 *                     style="display:inline-block;…user-select:none">
 *                    <img src onerror="…" alt="图片加载失败">
 *                  </div>
 *   现行   408 条：<div data-type="image-block" data-size contenteditable="false"
 *                     draggable="true" tabindex="-1" data-width data-height style>
 *                    <img src alt>
 *                  </div>
 *
 * data-size 全部 500 条都有 → BBCode 必读，必须保留。
 * 内层 <img> 的 src / alt / data-original-src / data-name / onerror 必须逐个显式声明，
 * 否则会被静默丢弃（尤其 onerror 承载图片加载失败回退）。
 * data-selected（瞬态选中态）与 style（UI 还原）视为「有意归一化」，由 NodeView 重建。
 */
export const AnkeImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  defining: true,
  addAttributes() {
    return {
      size: {
        default: 'original',
        parseHTML: (el) => el.getAttribute('data-size') ?? 'original',
        renderHTML: (attrs) => ({ 'data-size': attrs.size }),
      },
      width: {
        default: null,
        parseHTML: (el) => readAttr(el, 'data-width'),
        renderHTML: (attrs) => omitNull({ 'data-width': attrs.width }),
      },
      height: {
        default: null,
        parseHTML: (el) => readAttr(el, 'data-height'),
        renderHTML: (attrs) => omitNull({ 'data-height': attrs.height }),
      },
      src: {
        default: null,
        parseHTML: (el) => readAttr(el.querySelector('img'), 'src'),
        renderHTML: () => ({}),
      },
      alt: {
        default: null,
        parseHTML: (el) => readAttr(el.querySelector('img'), 'alt'),
        renderHTML: () => ({}),
      },
      dataOriginalSrc: {
        default: null,
        parseHTML: (el) => readAttr(el.querySelector('img'), 'data-original-src'),
        renderHTML: () => ({}),
      },
      dataName: {
        default: null,
        parseHTML: (el) => readAttr(el.querySelector('img'), 'data-name'),
        renderHTML: () => ({}),
      },
      onerror: {
        default: null,
        parseHTML: (el) => readAttr(el.querySelector('img'), 'onerror'),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="image-block"]', priority: ATOMIC_RULE_PRIORITY }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const img = omitNull({
      src: node.attrs.src,
      alt: node.attrs.alt,
      'data-original-src': node.attrs.dataOriginalSrc,
      'data-name': node.attrs.dataName,
      onerror: node.attrs.onerror,
    })
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'image-block',
        contenteditable: 'false',
        draggable: 'true',
        tabindex: '-1',
      }),
      ['img', mergeAttributes(img)],
    ]
  },
})

/**
 * diceCard —— 骰子卡（原子块）。
 *
 * 真实数据 0 条（历史内容没有骰子卡），但 BBCode 导入（ngaBBCodeToHtml）
 * 与工具栏「插入骰子」都会产生，因此必须支持。
 * 判定依赖：data-block-id 用于编辑定位；data-payload 是 BBCode 导出的唯一数据源。
 */
export const AnkeDiceCard = Node.create({
  name: 'diceCard',
  group: 'block',
  atom: true,
  defining: true,
  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (el) => readAttr(el, 'data-block-id'),
        renderHTML: (attrs) => omitNull({ 'data-block-id': attrs.blockId }),
      },
      payload: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-payload') ?? '{}',
        renderHTML: (attrs) => ({ 'data-payload': attrs.payload ?? '{}' }),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'div[data-type="dice-card"]', priority: ATOMIC_RULE_PRIORITY },
      // 兼容旧结构：<div class="dice-card">（BBCode 层同样有此后备判断）
      { tag: 'div.dice-card', priority: ATOMIC_RULE_PRIORITY },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'dice-card',
        draggable: 'true',
        tabindex: '-1',
      }),
    ]
  },
})

/**
 * 折叠块「直接子级」查询。
 *
 * 必须限定为直接子级：`querySelector` 会整棵子树搜索，若用于「是否折叠块」的
 * 判定，任何内部包含折叠块的包裹 div 都会被误判，进而按 contentElement 取到
 * 后代第一个 .collapse-body，把包裹 div 的其余内容整段丢弃（真实数据已复现）。
 */
function directChildByClass(el: Element, className: string): HTMLElement | null {
  return (Array.from(el.children).find((c) => c.classList.contains(className)) as
    | HTMLElement
    | undefined) ?? null
}

/** div 的直接子级是否构成折叠块形态（head + body 均为直接子级） */
function isCollapseShape(el: Element): boolean {
  return !!directChildByClass(el, 'collapse-head') && !!directChildByClass(el, 'collapse-body')
}

/**
 * collapseBlock —— 折叠块。
 *
 * 真实数据 8 条，属性：data-type / data-title / tabindex / draggable / style /
 *   data-collapse-init="1" / data-collapsed("true"|"false")
 * 内部结构：div.collapse-head（span.collapse-toggle[contenteditable=false] +
 *           span.collapse-title[contenteditable=true]）+ div.collapse-body（可编辑块内容）
 *
 * 关键点：body 内是**可编辑的块内容**，所以本节点不是 atom，content = 'block+'；
 * 头部（标题 / 箭头）属于 UI，由 NodeView 渲染，解析时通过 contentElement 指向
 * .collapse-body，避免把标题文本误当成正文。
 */
export const AnkeCollapseBlock = Node.create({
  name: 'collapseBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      dataTitle: {
        default: '折叠',
        parseHTML: (el) => {
          const fromAttr = el.getAttribute('data-title')
          if (fromAttr) return fromAttr
          const titleEl = el.querySelector('.collapse-title')
          return titleEl?.textContent?.trim() || '折叠'
        },
        renderHTML: (attrs) => ({ 'data-title': attrs.dataTitle }),
      },
      dataCollapsed: {
        default: 'false',
        parseHTML: (el) => el.getAttribute('data-collapsed') ?? 'false',
        renderHTML: (attrs) => ({ 'data-collapsed': attrs.dataCollapsed }),
      },
    }
  },
  parseHTML(): readonly TagParseRule[] {
    return [
      {
        tag: 'div[data-type="collapse-block"]',
        priority: ATOMIC_RULE_PRIORITY + 100,
        contentElement: (dom) => directChildByClass(dom, 'collapse-body') ?? dom,
      },
      // 兼容旧结构：data-type 被浏览器拖拽剥离后仅剩内部类名。
      // 不用 :has() 选择器（旧 WebView / happy-dom 支持不稳）；但必须用
      // 「直接子级」判定 —— 否则任何内部包含折叠块的包裹 div 都会被误判，
      // contentElement 取到后代第一个 .collapse-body，包裹 div 其余内容全丢。
      {
        tag: 'div',
        priority: ATOMIC_RULE_PRIORITY,
        contentElement: (dom) => directChildByClass(dom, 'collapse-body') ?? dom,
        getAttrs: (el) => (isCollapseShape(el) ? {} : false),
      },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    const title = node.attrs.dataTitle ?? '折叠'
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'collapse-block',
        tabindex: '-1',
        draggable: 'true',
        'data-collapse-init': '1',
      }),
      [
        'div',
        { class: 'collapse-head' },
        ['span', { class: 'collapse-toggle', contenteditable: 'false' }],
        ['span', { class: 'collapse-title', contenteditable: 'true' }, title],
      ],
      ['div', { class: 'collapse-body', contenteditable: 'true' }, 0],
    ]
  },
})

// ------------------------------------------------------------
// 四、行内 mark
//
// 真实数据的行内样式以「标签形态」和「span style 形态」两种并存：
//   <b> 192 / <i> 8 / <del> 2
//   span{font-weight:bold} / span{font-style:italic} /
//   span{text-decoration:line-through|underline} / span{font-size:18pt} /
//   span{color:rgb(0,0,0)|var(--text-primary)}
//   u / sup / sub / font 在真实数据中为 0 次，但 BBCode 导入会产生，仍需支持。
//
// 序列化统一输出标签形态（b/i/s/u/sup/sub），因为 NGA BBCode 转换层对
// 「标签形态」与「span style 形态」产出完全相同的 BBCode（见 ngaHtmlToBBCode.ts
// 的 wrapInlineWithStyle 与 parseSpanStyle）。
// ------------------------------------------------------------

/** 判定 font-weight 是否表示加粗（与 BBCode 的 parseSpanStyle 保持同一口径） */
function weightIsBold(value: string): boolean {
  const v = value.trim().toLowerCase()
  return !!v && v !== 'normal' && v !== '400'
}

export const AnkeBold = Mark.create({
  name: 'bold',
  parseHTML() {
    return [
      { tag: 'b' },
      { tag: 'strong' },
      { style: 'font-weight', getAttrs: (value) => (weightIsBold(String(value)) ? {} : false) },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['b', mergeAttributes(HTMLAttributes), 0]
  },
})

export const AnkeItalic = Mark.create({
  name: 'italic',
  parseHTML() {
    return [
      { tag: 'i' },
      { tag: 'em' },
      {
        style: 'font-style',
        getAttrs: (value) => {
          const v = String(value).trim().toLowerCase()
          return !v || v === 'normal' ? false : {}
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['i', mergeAttributes(HTMLAttributes), 0]
  },
})

export const AnkeStrike = Mark.create({
  name: 'strike',
  parseHTML() {
    return [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' },
      {
        style: 'text-decoration',
        getAttrs: (value) => {
          const v = String(value).toLowerCase()
          return v.includes('line-through') || v.includes('strike') ? {} : false
        },
      },
      {
        style: 'text-decoration-line',
        getAttrs: (value) => {
          const v = String(value).toLowerCase()
          return v.includes('line-through') ? {} : false
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['s', mergeAttributes(HTMLAttributes), 0]
  },
})

/**
 * 下划线。
 * 注意：BBCode 的 parseSpanStyle 用 style.textDecoration 判断，
 * 而浏览器会把 `text-decoration:underline` 规范化成 `text-decoration-line`，
 * 因此两条 style 规则都要声明。
 */
export const AnkeUnderline = Mark.create({
  name: 'underline',
  parseHTML() {
    return [
      { tag: 'u' },
      {
        style: 'text-decoration',
        getAttrs: (value) => (String(value).toLowerCase().includes('underline') ? {} : false),
      },
      {
        style: 'text-decoration-line',
        getAttrs: (value) => (String(value).toLowerCase().includes('underline') ? {} : false),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes), 0]
  },
})

// ------------------------------------------------------------
// 五、撤销 / 重做（复用 prosemirror-history，替换自研 editorHistoryStore）
// ------------------------------------------------------------

export interface AnkeUndoRedoOptions {
  /** 最多保留多少步（步数越多内存占用越高） */
  depth: number
  /** 相邻输入合并为同一步的时间窗口（ms） */
  newGroupDelay: number
}

// 注册 undo / redo 命令类型（等价于官方 @tiptap/extensions 的模块增强）
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    undoRedo: {
      undo: () => ReturnType
      redo: () => ReturnType
    }
  }
}

/**
 * UndoRedo —— 与 Tiptap 官方 `@tiptap/extensions` 的 UndoRedo 行为一致，
 * 但直接依赖 `@tiptap/pm/history`（prosemirror-history），避免引入
 * 未列入 package.json 的直接依赖。
 *
 * 关键收益：撤销 / 重做由 ProseMirror 事务系统完成，
 * 光标位置随 step 一起映射（解决旧实现 undo 后光标丢失）。
 */
export const AnkeUndoRedo = Extension.create<AnkeUndoRedoOptions>({
  name: 'undoRedo',
  addOptions() {
    return { depth: 200, newGroupDelay: 400 }
  },
  addCommands() {
    return {
      undo:
        () =>
        ({ state, dispatch }) =>
          undo(state, dispatch),
      redo:
        () =>
        ({ state, dispatch }) =>
          redo(state, dispatch),
    }
  },
  addProseMirrorPlugins() {
    return [history({ depth: this.options.depth, newGroupDelay: this.options.newGroupDelay })]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => this.editor.commands.undo(),
      'Shift-Mod-z': () => this.editor.commands.redo(),
      'Mod-y': () => this.editor.commands.redo(),
    }
  },
})

// ------------------------------------------------------------
// 六、扩展装配
// ------------------------------------------------------------

/**
 * 组装安科编辑器使用的全部扩展。
 * 顺序即 mark 的渲染嵌套顺序（ProseMirror 按 schema marks 声明顺序嵌套）。
 *
 * 刻意不使用 StarterKit：它自带 heading / blockquote / codeBlock / bold 等
 * 与本项目真实数据形态不同的实现，会引入不必要的解析规则冲突。
 */
export function createAnkeExtensions(): Extensions {
  return [
    // 基础块
    AnkeDoc,
    AnkeText,
    AnkeParagraph,
    AnkeQuoteBlock,
    AnkeHorizontalRule,
    AnkeHardBreak,
    AnkeCodeBlock,

    // 列表（开源实现，替换自研 listIndent.ts）
    BulletList,
    OrderedList,
    ListItem,

    // 表格（开源实现，替换自研 commands.ts 的单元格导航）
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,

    // 行内节点
    AnkeInlineImage,

    // 原子块
    AnkeImageBlock,
    AnkeDiceCard,
    AnkeCollapseBlock,

    // 文本样式（color / fontFamily / fontSize 共用一个 <span style>）
    TextStyle,
    Color,
    FontFamily,
    FontSize,

    // 其它行内格式（开源实现）
    AnkeBold,
    AnkeItalic,
    AnkeStrike,
    AnkeUnderline,
    Subscript,
    Superscript,
    Link.configure({ openOnClick: false, HTMLAttributes: {} }),

    // 对齐 / 空态
    // imageBlock 也纳入 textAlign：图片块是块级节点，其自身 text-align
    // 决定内部 <img>（inline-block）在整行中的位置（对应旧内核
    // setImageBlockAlign 改父容器 text-align 的行为）。
    TextAlign.configure({ types: ['paragraph', 'imageBlock'] }),
    Placeholder.configure({ placeholder: '' }),

    // 撤销 / 重做（开源内核）
    AnkeUndoRedo,
  ]
}

/** 供离线审计脚本（happy-dom / Node）构建同一份 ProseMirror schema */
export function createAnkeSchema() {
  return getSchema(createAnkeExtensions())
}
