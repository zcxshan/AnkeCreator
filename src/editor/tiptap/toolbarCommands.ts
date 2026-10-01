// ============================================================
// 安科编辑器 —— 工具栏命令桥（Tiptap 内核）
//
// 背景（改造方案 S8）：工具栏原有的每个按钮都直接操作 DOM
// （document.execCommand / inlineStyle.ts 的手工 DOM 手术）。换成
// ProseMirror 内核后，DOM 由文档模型派生，直接改 DOM 会被内核覆盖，
// 因此这一层把工具栏的「用户意图」翻译成 ProseMirror 事务。
//
// 三个必须保留的语义（项目硬约束）：
//   1. activeStyles         —— 用户主动点击设置的样式意图
//   2. activeStylesLocked   —— Word 式持久锁定（锁定期间工具栏不被光标处样式覆盖）
//   3. cursorStyles         —— 光标处实际样式（未锁定时工具栏读它）
// 折叠光标下的「预选样式」由 ProseMirror 的 storedMarks 原生承担
// （toggleMark / setMark 在空选区上写 storedMarks），这是旧内核手工
// 翻转 activeStyles 才能做到的事情的结构化替代。
// ============================================================

import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorStore } from '../../store/editorStore'
import { ngaFontToCSS, percentToCssFontSize } from '../../types'
import { findImageBlockPos, insertBlockAndKeepCaret } from './commands'

/** 简单行内标记（B/I/U/S） */
type SimpleMarkKey = 'bold' | 'italic' | 'underline' | 'strike'
/** 上下标 */
type ScriptMarkKey = 'superscript' | 'subscript'
/** 对齐 */
type AlignValue = 'left' | 'center' | 'right'

const SIMPLE_LABEL: Record<SimpleMarkKey, string> = {
  bold: '粗体',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
}

export interface AnkeToolbarCommandDeps {
  getEditor: () => Editor | null
  /** Toast 提示（无选区时给出「已开启/已关闭」反馈，与旧内核一致） */
  onToast?: (msg: string) => void
}

export interface AnkeToolbarCommands {
  /** B/I/U/S：应用或取消标记（含折叠光标的 storedMarks 预选） */
  toggleSimpleMark: (key: SimpleMarkKey) => void
  /** 上标 / 下标（仅在有选区时可用，与工具栏禁用态一致） */
  toggleScriptMark: (key: ScriptMarkKey) => void
  /** 文字颜色（CSS 颜色值） */
  setColor: (cssColor: string) => void
  /** 字体（NGA font value → CSS font-family） */
  setFontFamily: (ngaFontValue: string) => void
  /** 字号（NGA 百分比 20–500 → CSS font-size） */
  setFontSizePercent: (percent: number) => void
  /** 段落对齐（左/中/右） */
  setAlign: (align: AlignValue) => void
  /** 无序 / 有序列表开关 */
  setList: (kind: 'bullet' | 'ordered') => void
  /** 选中图片块的对齐（无选中图片时不动作） */
  setImageAlign: (align: AlignValue) => void
  /** 引用块开关（在引用内则解引用，否则包裹当前块） */
  toggleQuote: () => void
  /** 折叠块（有选区则把选区内容放进折叠体） */
  insertCollapse: (title: string) => void
  insertTable: (rows: number, cols: number) => void
  /** 代码块（把当前文本块转成 pre.code-block） */
  setCodeBlock: () => void
  insertLink: (url: string, label?: string) => void
  unlink: () => void
  insertHorizontalRule: () => void
  /** 在光标处插入纯文本（表情 / 安价标记） */
  insertText: (text: string) => void
  /** 清除格式：去掉行内标记 + 还原列表/代码块块级结构 */
  clearFormat: () => void
}

export function createAnkeToolbarCommands(deps: AnkeToolbarCommandDeps): AnkeToolbarCommands {
  const getEditor = () => deps.getEditor()

  return {
    toggleSimpleMark(key) {
      const editor = getEditor()
      if (!editor) return
      const wasCollapsed = editor.state.selection.empty
      editor.chain().focus().toggleMark(key).run()

      const next = editor.isActive(key)
      const store = useEditorStore.getState()
      // 三态语义：同步「用户意图」并锁定，同时刷新光标处样式让按钮立即变色
      store.setActiveStyles({ [key]: next })
      store.setCursorStyles({ [key]: next })
      store.lockActiveStyles()

      if (wasCollapsed) {
        const label = SIMPLE_LABEL[key]
        deps.onToast?.(next ? `已开启${label}格式，新输入自动应用` : `已关闭${label}格式`)
      }
    },

    toggleScriptMark(key) {
      const editor = getEditor()
      if (!editor) return
      editor.chain().focus().toggleMark(key).run()
      // 与旧内核一致：一次性操作，不锁定（不影响后续输入）
      useEditorStore.getState().setActiveStyles({
        sup: editor.isActive('superscript'),
        sub: editor.isActive('subscript'),
      })
    },

    setColor(cssColor) {
      const editor = getEditor()
      if (!editor) return
      editor.chain().focus().setMark('textStyle', { color: cssColor }).run()
      const store = useEditorStore.getState()
      store.setActiveStyles({ color: cssColor })
      store.lockActiveStyles()
    },

    setFontFamily(ngaFontValue) {
      const editor = getEditor()
      if (!editor || !ngaFontValue) return
      const cssFamily = ngaFontToCSS(ngaFontValue)
      editor.chain().focus().setMark('textStyle', { fontFamily: cssFamily }).run()
      const store = useEditorStore.getState()
      store.setActiveStyles({ fontFamily: cssFamily })
      store.lockActiveStyles()
    },

    setFontSizePercent(percent) {
      const editor = getEditor()
      if (!editor) return
      const cssSize = percentToCssFontSize(percent)
      editor.chain().focus().setMark('textStyle', { fontSize: cssSize }).run()
      const store = useEditorStore.getState()
      store.setActiveStyles({ fontSize: cssSize })
      store.lockActiveStyles()
    },

    setAlign(align) {
      getEditor()?.chain().focus().setTextAlign(align).run()
    },

    setList(kind) {
      const editor = getEditor()
      if (!editor) return
      if (kind === 'bullet') editor.chain().focus().toggleBulletList().run()
      else editor.chain().focus().toggleOrderedList().run()
    },

    setImageAlign(align) {
      const editor = getEditor()
      if (!editor) return
      // 与旧实现一致：只有当前选中（或光标紧邻）图片块时才动作
      if (findImageBlockPos(editor) === null) return
      // TextAlign 已把 imageBlock 纳入 types，此处作用于图片块自身
      editor.chain().focus().setTextAlign(align).run()
    },

    toggleQuote() {
      const editor = getEditor()
      if (!editor) return
      if (editor.isActive('quoteBlock')) {
        // 解引用：quoteBlock 是 defining 节点，lift 无法穿透，
        // 直接把引用块替换成它的内容（与旧内核展开子节点的行为一致）
        const { state } = editor
        const { $from } = state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type.name !== 'quoteBlock') continue
          const pos = $from.before(depth)
          editor.view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, node.content))
          editor.commands.focus()
          return
        }
        return
      }
      editor.chain().focus().wrapIn('quoteBlock').run()
    },

    insertCollapse(title) {
      const editor = getEditor()
      if (!editor) return
      const safeTitle = (title || '').trim() || '折叠'
      const { state } = editor
      const { from, to, empty } = state.selection

      if (empty) {
        insertBlockAndKeepCaret(editor, {
          type: 'collapseBlock',
          attrs: { dataTitle: safeTitle },
          content: [{ type: 'paragraph' }],
        })
        return
      }

      // 有选区：把选区内容搬进折叠块 body（内容为行内时补一个段落）
      const { schema } = state
      const frag = state.doc.slice(from, to).content
      const first = frag.firstChild
      const body =
        first && first.isBlock ? frag : schema.nodes.paragraph.create(null, frag)
      const block = schema.nodes.collapseBlock.create({ dataTitle: safeTitle }, body)
      const tr = state.tr.replaceWith(from, to, block)
      const blockPos = tr.mapping.map(from)
      tr.setSelection(TextSelection.near(tr.doc.resolve(blockPos + 2)))
      editor.view.dispatch(tr)
      editor.commands.focus()
    },

    insertTable(rows, cols) {
      const editor = getEditor()
      if (!editor) return
      const r = Math.max(1, Math.min(20, Math.floor(rows)))
      const c = Math.max(1, Math.min(20, Math.floor(cols)))
      // 旧内核表格全部是 <td>（无表头），此处保持一致，BBCode 输出等价
      editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: false }).run()
    },

    setCodeBlock() {
      getEditor()?.chain().focus().setNode('codeBlock').run()
    },

    insertLink(url, label) {
      const editor = getEditor()
      if (!editor) return
      const safeUrl = (url || '').trim()
      if (!safeUrl) return
      const safeLabel = (label || '').trim() || safeUrl
      if (editor.state.selection.empty) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: safeLabel,
            marks: [{ type: 'link', attrs: { href: safeUrl } }],
          })
          .run()
        return
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: safeUrl }).run()
    },

    unlink() {
      getEditor()?.chain().focus().extendMarkRange('link').unsetLink().run()
    },

    insertHorizontalRule() {
      const editor = getEditor()
      if (!editor) return
      insertBlockAndKeepCaret(editor, { type: 'horizontalRule' })
    },

    insertText(text) {
      if (!text) return
      getEditor()?.chain().focus().insertContent(text).run()
    },

    clearFormat() {
      const editor = getEditor()
      if (!editor) return
      // 旧内核「清格式」会把 ul/ol 拆成普通段落、代码块还原为段落
      if (editor.isActive('bulletList')) editor.chain().focus().toggleBulletList().run()
      if (editor.isActive('orderedList')) editor.chain().focus().toggleOrderedList().run()
      if (editor.isActive('codeBlock')) editor.chain().focus().setNode('paragraph').run()
      editor.chain().focus().unsetAllMarks().run()
    },
  }
}
