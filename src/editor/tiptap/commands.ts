// ============================================================
// 安科编辑器 —— RichTextEditorCommands 适配层（Tiptap 版）
//
// 职责：把原有 12 个「命令式 DOM 操作」接口 1:1 映射到 ProseMirror 事务，
// 使外部调用方（EditorPage / CharacterEditor / 工具栏 / 搜索面板）
// 完全无需感知内核替换。
//
// 关键差异（相对旧内核）：
//   · 插入原子块 = insertContent（ProseMirror 自动处理段落分裂与光标落点），
//     不再手工 insertNode + 手工设置 Range；
//   · 更新原子块 = tr.setNodeMarkup（文档模型与视图同步），
//     不再「改 DOM + dispatchInput」造成的模型/视图漂移；
//   · 撤销/重做 = prosemirror-history（光标随 step 映射）。
//
// 刻意保留的复用：`scrollToDiceCard` 直接复用 diceCard.ts 的 DOM 匹配算法
// （它只依赖 data-payload 结构与选择器，与内核无关）。
// ============================================================

import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { NGA_DEFAULT_IMAGE_SIZE, NGA_IMAGE_SIZES, type DiceBlockPayloadV2 } from '../../types'
import { scrollToDiceCard as scrollToDiceCardByPayload } from '../diceCard'
import type { RichTextEditorCommands } from './TiptapEditorPane'

/** NodeView 挂载期间写入 DOM 的瞬态 UI（不应进入文档序列化结果） */
const TRANSIENT_UI_SELECTOR = '[data-role="image-handle"], [data-role="image-delete"]'

export interface AnkeCommandsDeps {
  getEditor: () => Editor | null
  /** 承载 .ProseMirror 的元素（getJSON 序列化源） */
  getContentEl: () => HTMLElement | null
  /** 外层滚动容器（快速跳转用） */
  getScrollEl: () => HTMLDivElement | null
}

/** 找到 imageBlock 在文档中的位置：NodeSelection 直选 / 选区祖先块 */
export function findImageBlockPos(editor: Editor): number | null {
  const { selection } = editor.state
  if (selection instanceof NodeSelection && selection.node.type.name === 'imageBlock') {
    return selection.from
  }
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'imageBlock') return $from.before(depth)
  }
  return null
}

/** 找到指定 id 的 diceCard 位置 */
function findDiceCardPos(editor: Editor, blockId: string): number | null {
  let found: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name === 'diceCard' && node.attrs.blockId === blockId) {
      found = pos
      return false
    }
    return true
  })
  return found
}

/** 按 NGA 预设推导 data-width / data-height（与 imageBlock.ts 口径一致） */
function sizeAttrs(size: string): { size: string; width: string | null; height: string | null } {
  const info = NGA_IMAGE_SIZES.find((s) => s.value === size) ?? NGA_IMAGE_SIZES[0]
  return {
    size: info.value,
    width: info.width ? String(info.width) : null,
    height: info.height ? String(info.height) : null,
  }
}

/**
 * 在当前光标处插入一个块级节点，并保证其后方存在可落光标的段落：
 * - 光标位于段落中间：insertContent 自动分裂段落，光标落在后半段起点；
 * - 光标位于文档末尾：补一个空段落并把光标放进去
 *   （对应旧实现插入原子块后补 <br> 占位的行为，避免「块后再无法输入」）。
 */
export function insertBlockAndKeepCaret(editor: Editor, nodeJSON: JSONContent): void {
  editor.chain().focus().insertContent(nodeJSON).run()

  const { state } = editor
  const $head = state.selection.$head
  if ($head.nodeAfter) return

  const paragraph = editor.schema.nodes.paragraph.createAndFill()
  if (!paragraph) return
  const pos = $head.pos
  const tr = state.tr.insert(pos, paragraph)
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
  editor.view.dispatch(tr)
}

export function createAnkeCommands(deps: AnkeCommandsDeps): RichTextEditorCommands {
  const getEditor = () => deps.getEditor()

  /** 改写当前选中 imageBlock 的属性 */
  const patchSelectedImage = (patch: Record<string, unknown>): void => {
    const editor = getEditor()
    if (!editor) return
    const pos = findImageBlockPos(editor)
    if (pos === null) return
    const node = editor.state.doc.nodeAt(pos)
    if (!node) return
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }),
    )
  }

  return {
    focus() {
      getEditor()?.commands.focus()
    },

    getJSON() {
      const el = deps.getContentEl()
      if (!el) return { type: 'doc', html: '' }
      // 克隆后剔除 NodeView 的瞬态 UI（缩放手柄 / 删除按钮），
      // 避免保存进 sections[].content 的 HTML 混入编辑器内部元素
      const clone = el.cloneNode(true) as HTMLElement
      clone.querySelectorAll(TRANSIENT_UI_SELECTOR).forEach((n) => n.remove())
      return { type: 'doc', html: clone.innerHTML }
    },

    insertImage(src: string, size?: string) {
      const editor = getEditor()
      if (!editor || !src) return
      const resolved = sizeAttrs(size ?? NGA_DEFAULT_IMAGE_SIZE)
      insertBlockAndKeepCaret(editor, {
        type: 'imageBlock',
        attrs: {
          size: resolved.size,
          width: resolved.width,
          height: resolved.height,
          src,
          alt: '本地图片',
          dataOriginalSrc: src,
        },
      })
    },

    insertDice(payload: DiceBlockPayloadV2) {
      const editor = getEditor()
      if (!editor) return
      const blockId = payload?.config?.id || Math.random().toString(36).slice(2, 10)
      insertBlockAndKeepCaret(editor, {
        type: 'diceCard',
        attrs: { blockId, payload: JSON.stringify(payload) },
      })
    },

    updateDiceBlock(blockId: string, payload: DiceBlockPayloadV2) {
      const editor = getEditor()
      if (!editor) return
      const pos = findDiceCardPos(editor, blockId)
      if (pos === null) return
      const node = editor.state.doc.nodeAt(pos)
      if (!node) return
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          blockId: payload?.config?.id || blockId,
          payload: JSON.stringify(payload),
        }),
      )
    },

    scrollToDiceCard(payloadSnapshot: string) {
      const el = deps.getContentEl()
      if (!el) return false
      return scrollToDiceCardByPayload(el, payloadSnapshot)
    },

    setSelectedImageSize(size: string) {
      patchSelectedImage(sizeAttrs(size))
    },

    updateSelectedImageSrc(src: string) {
      if (!src) return
      patchSelectedImage({ src, dataOriginalSrc: src })
    },

    updateSelectedImageDataSize(size: string) {
      patchSelectedImage(sizeAttrs(size))
    },

    scrollToTop() {
      deps.getScrollEl()?.scrollTo({ top: 0, behavior: 'smooth' })
    },

    scrollToBottom() {
      const el = deps.getScrollEl()
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    },

    getScrollTop() {
      return deps.getScrollEl()?.scrollTop ?? 0
    },

    setScrollTop(scrollTop: number) {
      const el = deps.getScrollEl()
      if (el) el.scrollTop = scrollTop
    },
  }
}
