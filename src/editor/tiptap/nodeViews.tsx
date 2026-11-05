// ============================================================
// 安科编辑器 —— 三个原子块的 NodeView（Tiptap / ProseMirror）
//
// 设计原则（对应改造方案 S6）：
//  1. DOM 与旧自研实现逐属性对齐 —— BBCode 转换层（读 data-type / data-size /
//     data-payload / data-title / .collapse-body）、CSS 选择器
//     （.anke-editor-content div[data-type=…]）零改动可用。
//  2. 渲染与状态函数复用既有模块，不重写：
//     · 骰子卡内层结构 → diceCard.ts renderDiceCard / getDicePayload / setDicePayload
//     · 折叠块拖动把手 → collapseBlock.ts ensureDragHandle
//     · 图片加载失败兜底 → imageBlock.ts attachImageErrorHandler
//  3. 交互从「直接改 DOM + dispatchInput」改为「提交 ProseMirror 事务」：
//     删除 → tr.delete，改属性 → tr.setNodeMarkup，选中 → NodeSelection。
//     文档模型与视图始终同步，从根源消除旧的 offset 错位类 bug。
//
// 原子块 DOM 形态（与旧实现一致）：
//   <div data-type="image-block" data-size data-width data-height
//        contenteditable="false" draggable="true" tabindex="-1"><img …></div>
//   <div data-type="dice-card" data-block-id data-payload draggable="true"
//        tabindex="-1" contenteditable="false">…renderDiceCard 生成的内层结构…</div>
//   <div data-type="collapse-block" data-title data-collapsed tabindex="-1" style>
//     <div class="collapse-head">…toggle / title / drag-handle…</div>
//     <div class="collapse-body" contenteditable="true">…可编辑块内容…</div>
//   </div>
// ============================================================

import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import type { NodeView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NGA_DEFAULT_IMAGE_SIZE, NGA_IMAGE_SIZES, type DiceBlockPayloadV2 } from '../../types'
import { attachImageErrorHandler } from './imageBlockDom'
import { ensureDragHandle } from './collapseDom'
import { getDicePayload, renderDiceCard, setDicePayload } from './diceRender'
import { rollDice } from '../../utils/diceEngine'
import { playDiceRollSound } from '../../utils/diceSound'
import { useSettingStore } from '../../store/settingStore'

// ------------------------------------------------------------
// 对外回调：NodeView 无法直接拿到 React props，用模块级注册表桥接。
// TiptapEditorPane 挂载时 setAnkeNodeViewHandlers({...}) 写入。
// （旧实现用 editor 根节点上的 CustomEvent 达到同样目的，此处等价且类型安全。）
// ------------------------------------------------------------
export interface AnkeNodeViewHandlers {
  /** 图片块选中 / 尺寸变化（null 表示取消选中） */
  onImageSelected?: (info: { width: number; height: number; src?: string; dataSize?: string } | null) => void
  /** 骰子掷出（动画结束后，携带最终 payload） */
  onDiceRolled?: (payload: DiceBlockPayloadV2) => void
  /** 点击骰子卡「编辑」按钮 */
  onEditDiceBlock?: (blockId: string, payload: DiceBlockPayloadV2) => void
}

let handlers: AnkeNodeViewHandlers = {}

export function setAnkeNodeViewHandlers(next: AnkeNodeViewHandlers): void {
  handlers = next
}

// ------------------------------------------------------------
// 事务小工具
// ------------------------------------------------------------

function posOf(props: NodeViewRendererProps): number | undefined {
  const p = props.getPos()
  return typeof p === 'number' ? p : undefined
}

/** 用事务改写当前节点属性（不重建节点、不进选区） */
function setNodeAttrs(props: NodeViewRendererProps, attrs: Record<string, unknown>): void {
  const pos = posOf(props)
  if (pos === undefined) return
  const { state, dispatch } = props.view
  const node = state.doc.nodeAt(pos)
  if (!node) return
  dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
}

/** 用事务删除当前节点（Backspace/Delete 之外的自定义删除入口） */
function deleteNode(props: NodeViewRendererProps): void {
  const pos = posOf(props)
  if (pos === undefined) return
  const { state, dispatch } = props.view
  const node = state.doc.nodeAt(pos)
  if (!node) return
  dispatch(state.tr.delete(pos, pos + node.nodeSize))
}

/** 简易防抖：返回 { run, cancel }，cancel 用于 NodeView destroy 时清理未触发的事务 */
function debounce(fn: () => void, ms: number): { run: () => void; cancel: () => void } {
  let timer: number | null = null
  const cancel = () => {
    if (timer != null) window.clearTimeout(timer)
    timer = null
  }
  return {
    run: () => {
      cancel()
      timer = window.setTimeout(() => {
        timer = null
        fn()
      }, ms)
    },
    cancel,
  }
}

// ============================================================
// 一、imageBlock —— 图片块
// ============================================================

/** 图片块基础内联样式（与 imageBlock.ts insertImageBlock 一致） */
function applyImageBlockStyles(block: HTMLElement): void {
  block.style.display = 'block'
  block.style.margin = '2px 4px'
  block.style.verticalAlign = 'middle'
  block.style.outline = 'none'
  block.style.userSelect = 'auto'
  block.style.cursor = 'grab'
}

/** 图片内联样式：按 NGA 尺寸预设推导（与 insertImageBlock / setImageBlockSize 一致） */
function applyImageStyles(img: HTMLImageElement, sizeValue: string): void {
  const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === sizeValue) ?? NGA_IMAGE_SIZES[0]
  img.style.maxWidth = '100%'
  img.style.display = 'inline-block'
  img.style.cursor = 'pointer'
  img.style.userSelect = 'auto'
  img.style.pointerEvents = 'none'
  img.style.width = sizeInfo.width ? `${sizeInfo.width}px` : 'auto'
  img.style.height = sizeInfo.height ? `${sizeInfo.height}px` : 'auto'
}

/**
 * 四角缩放手柄 + 删除按钮（仅在选中时挂载，与旧实现
 * imageBlock.ts renderImageBlockHandles 的 DOM 完全一致）。
 */
function renderImageHandles(
  block: HTMLElement,
  img: HTMLImageElement,
  onDelete: () => void,
  onResizeCommit: (width: number, height: number) => void,
): void {
  block.style.position = 'relative'

  const positions: Array<{ key: string; style: Partial<CSSStyleDeclaration>; cursor: string }> = [
    { key: 'nw', style: { top: '-6px', left: '-6px' }, cursor: 'nwse-resize' },
    { key: 'ne', style: { top: '-6px', right: '-6px' }, cursor: 'nesw-resize' },
    { key: 'sw', style: { bottom: '-6px', left: '-6px' }, cursor: 'nesw-resize' },
    { key: 'se', style: { bottom: '-6px', right: '-6px' }, cursor: 'nwse-resize' },
  ]

  const aspectRatio = (): number => {
    if (img.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight
    if (img.width && img.height) return img.width / img.height
    return 1.5
  }

  positions.forEach(({ key, style, cursor }) => {
    const handle = document.createElement('span')
    handle.setAttribute('data-role', 'image-handle')
    handle.setAttribute('data-handle', key)
    handle.contentEditable = 'false'
    Object.assign(handle.style, {
      position: 'absolute',
      width: '12px',
      height: '12px',
      background: 'var(--accent)',
      border: '2px solid var(--text-on-accent)',
      borderRadius: '50%',
      boxShadow: 'var(--shadow-md)',
      zIndex: '5',
      cursor,
      ...style,
    } as CSSStyleDeclaration)

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      startResize(e.clientX, e.clientY, key)
    })
    block.appendChild(handle)
  })

  const deleteBtn = document.createElement('button')
  deleteBtn.setAttribute('data-role', 'image-delete')
  deleteBtn.contentEditable = 'false'
  deleteBtn.textContent = '×'
  Object.assign(deleteBtn.style, {
    position: 'absolute',
    top: '-10px',
    right: '-10px',
    width: '24px',
    height: '24px',
    background: 'var(--danger)',
    color: 'var(--text-on-accent)',
    border: '2px solid var(--text-on-accent)',
    borderRadius: '50%',
    fontSize: '14px',
    lineHeight: '1',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'var(--shadow-md)',
    zIndex: '6',
    padding: '0',
  } as CSSStyleDeclaration)
  deleteBtn.addEventListener('mousedown', (e) => e.preventDefault())
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onDelete()
  })
  block.appendChild(deleteBtn)

  function startResize(startX: number, startY: number, handle: string): void {
    const startWidth = img.clientWidth || 400
    const ratio = aspectRatio()
    let latestWidth = startWidth
    let latestHeight = Math.round(startWidth / ratio)

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const deltaW = handle === 'se' || handle === 'ne' ? dx : -dx
      const absByH = Math.abs(dy) * ratio
      const absByW = Math.abs(dx)
      const effectiveDelta = absByH > absByW ? (dy > 0 ? absByH : -absByH) : deltaW

      let newWidth = startWidth + effectiveDelta
      newWidth = Math.max(80, Math.min(2000, newWidth))
      latestWidth = newWidth
      img.style.width = `${Math.round(newWidth)}px`
      img.style.height = 'auto'
      block.setAttribute('data-width', String(Math.round(newWidth)))
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      latestHeight = Math.round(latestWidth / ratio)
      img.style.height = `${latestHeight}px`
      block.setAttribute('data-height', String(latestHeight))
      onResizeCommit(Math.round(latestWidth), latestHeight)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
}

function clearImageHandles(block: HTMLElement): void {
  block
    .querySelectorAll<HTMLElement>('[data-role="image-handle"], [data-role="image-delete"]')
    .forEach((h) => h.remove())
}

class ImageBlockNodeView implements NodeView {
  dom: HTMLElement
  private props: NodeViewRendererProps
  private img: HTMLImageElement
  private selected = false

  constructor(props: NodeViewRendererProps) {
    this.props = props
    const attrs = props.node.attrs

    const block = document.createElement('div')
    block.setAttribute('data-type', 'image-block')
    block.setAttribute('contenteditable', 'false')
    block.setAttribute('draggable', 'true')
    block.setAttribute('tabindex', '-1')
    applyImageBlockStyles(block)

    const img = document.createElement('img')
    img.style.display = 'inline-block'
    block.appendChild(img)

    this.dom = block
    this.img = img
    this.syncFromNode(props.node)
  }

  /** 把节点属性刷新到 DOM（构造与 update 共用） */
  private syncFromNode(node: PMNode): void {
    const attrs = node.attrs
    const size = String(attrs.size ?? NGA_DEFAULT_IMAGE_SIZE)
    const block = this.dom
    block.setAttribute('data-size', size)
    if (attrs.width != null && attrs.width !== '') block.setAttribute('data-width', String(attrs.width))
    else block.removeAttribute('data-width')
    if (attrs.height != null && attrs.height !== '') block.setAttribute('data-height', String(attrs.height))
    else block.removeAttribute('data-height')

    const img = this.img
    const src = String(attrs.src ?? '')
    const prevSrc = img.getAttribute('src') ?? ''
    if (src !== prevSrc) {
      img.setAttribute('src', src)
      // 换图后重新挂载加载失败兜底
      this.attachFallback(src)
    }
    if (attrs.alt != null) img.setAttribute('alt', String(attrs.alt))
    const original = String(attrs.dataOriginalSrc ?? src)
    img.setAttribute('data-original-src', original)
    if (attrs.dataName != null) img.setAttribute('data-name', String(attrs.dataName))
    else img.removeAttribute('data-name')
    if (attrs.onerror != null) img.setAttribute('onerror', String(attrs.onerror))
    else img.removeAttribute('onerror')

    applyImageStyles(img, size)
    // 已由 data-width/data-height 覆盖的精确尺寸（用户拖拽过）
    if (attrs.width != null && attrs.width !== '') img.style.width = `${attrs.width}px`
    if (attrs.height != null && attrs.height !== '') img.style.height = `${attrs.height}px`
    // 对齐：TextAlign 的全局属性作用在图片块自身（null 时不输出 style）
    if (attrs.textAlign) block.style.textAlign = String(attrs.textAlign)
    else block.style.removeProperty('text-align')
  }

  private attachFallback(src: string): void {
    if (src.startsWith('local://')) attachImageErrorHandler(this.img, src)
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'imageBlock') return false
    this.props = { ...this.props, node }
    this.syncFromNode(node)
    if (this.selected) this.renderHandles()
    return true
  }

  private renderHandles(): void {
    clearImageHandles(this.dom)
    renderImageHandles(
      this.dom,
      this.img,
      () => {
        deleteNode(this.props)
        this.notifySelected(null)
      },
      (width, height) => {
        setNodeAttrs(this.props, { width: String(width), height: String(height) })
        this.notifySelected({ width, height })
      },
    )
  }

  private notifySelected(size: { width: number; height: number } | null): void {
    if (!handlers.onImageSelected) return
    if (!size) {
      handlers.onImageSelected(null)
      return
    }
    const src = this.img.getAttribute('data-original-src') || this.img.getAttribute('src') || ''
    handlers.onImageSelected({
      width: size.width,
      height: size.height,
      src,
      dataSize: this.dom.getAttribute('data-size') || 'original',
    })
  }

  selectNode(): void {
    this.selected = true
    this.dom.setAttribute('data-selected', 'true')
    this.renderHandles()
    const img = this.img
    this.notifySelected({
      width: parseInt(this.dom.getAttribute('data-width') || '', 10) || img.clientWidth || 400,
      height: parseInt(this.dom.getAttribute('data-height') || '', 10) || img.clientHeight || 0,
    })
  }

  deselectNode(): void {
    this.selected = false
    this.dom.removeAttribute('data-selected')
    clearImageHandles(this.dom)
    this.notifySelected(null)
  }

  /** 手柄 / 删除按钮上的事件不交给 ProseMirror 处理 */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    return !!target?.closest?.('[data-role="image-handle"], [data-role="image-delete"]')
  }

  /** 块内部 DOM 由本 NodeView 自行维护，忽略 PM 的 mutation 检测 */
  ignoreMutation(): boolean {
    return true
  }
}

// ============================================================
// 二、diceCard —— 骰子卡
// ============================================================

/**
 * 在骰子卡内执行掷骰：动画复用旧实现（老虎机滚动 + 摇一摇 + 音效），
 * 结束后把结果写回节点属性（事务），而不是改 DOM 后 dispatchInput。
 */
function rollDiceInCard(block: HTMLElement, commit: (payload: DiceBlockPayloadV2) => void): void {
  const { payload } = getDicePayload(block)
  if (!payload || !payload.config) return
  if (payload.lastResult) return

  const cfg: any = payload.config
  const rollBtn = block.querySelector<HTMLButtonElement>('button[data-role="roll"]')
  const rollDisplay = block.querySelector<HTMLElement>('[data-slot="roll-display"]')
  const rollEmoji = block.querySelector<HTMLElement>('[data-slot="roll-emoji"]')
  const rollNumber = block.querySelector<HTMLElement>('[data-slot="roll-number"]')

  if (useSettingStore.getState().soundEnabled) void playDiceRollSound()

  block.classList.add('anke-dice-shaking')
  window.setTimeout(() => block.classList.remove('anke-dice-shaking'), 350)

  if (rollBtn) rollBtn.classList.add('anke-dice-btn-press')
  window.setTimeout(() => {
    if (rollBtn) {
      rollBtn.classList.remove('anke-dice-btn-press')
      rollBtn.style.display = 'none'
    }
  }, 180)

  if (rollDisplay) {
    rollDisplay.style.display = 'inline-flex'
    rollDisplay.classList.add('anke-dice-rolling')
  }
  if (rollEmoji) rollEmoji.classList.add('anke-dice-spin')

  const result: any = rollDice(cfg)
  const history: any[] = Array.isArray(payload.history) ? [...payload.history, result] : [result]
  const nextPayload = { ...payload, lastResult: result, history: history.slice(-20) } as DiceBlockPayloadV2

  const kind: string = cfg.kind || 'option'
  const maxValue =
    kind === 'numeric' ? Math.max(1, Math.floor(cfg.numericFaces ?? 100)) : Math.max(1, Math.floor(cfg.faces ?? 2))
  const displayText = kind === 'numeric' ? `${cfg.count ?? 1}d${maxValue}` : `D${maxValue}`

  const tickDelays = [50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 100, 100]
  let tickIdx = 0
  const tickFn = () => {
    const v = Math.floor(Math.random() * maxValue) + 1
    if (rollNumber) rollNumber.textContent = `[${displayText}=${v}]`
    if (tickIdx < tickDelays.length) {
      window.setTimeout(tickFn, tickDelays[tickIdx])
      tickIdx++
    }
  }
  tickFn()

  const total = tickDelays.reduce((a, b) => a + b, 0)
  window.setTimeout(() => {
    if (rollDisplay) {
      rollDisplay.classList.remove('anke-dice-rolling')
      rollDisplay.style.display = 'none'
    }
    if (rollEmoji) rollEmoji.classList.remove('anke-dice-spin')
    if (rollNumber) rollNumber.textContent = ''

    setDicePayload(block, nextPayload)
    renderDiceCard(block)
    commit(nextPayload)
  }, total)
}

class DiceCardNodeView implements NodeView {
  dom: HTMLElement
  private props: NodeViewRendererProps
  private lastPayload: string

  constructor(props: NodeViewRendererProps) {
    this.props = props
    const attrs = props.node.attrs
    const block = document.createElement('div')
    block.setAttribute('data-type', 'dice-card')
    block.setAttribute('draggable', 'true')
    block.setAttribute('tabindex', '-1')
    block.setAttribute('contenteditable', 'false')
    block.style.userSelect = 'auto'
    block.style.cursor = 'grab'
    block.style.outline = 'none'
    block.style.display = 'block'

    this.lastPayload = String(attrs.payload ?? '{}')
    block.setAttribute('data-payload', this.lastPayload)
    if (attrs.blockId) block.setAttribute('data-block-id', String(attrs.blockId))

    this.dom = block
    renderDiceCard(block)

    block.addEventListener('click', this.onClick, true)
    block.addEventListener('mousedown', (e) => {
      // 按钮不参与块级选中，其余区域允许 PM 建立 NodeSelection
      if ((e.target as HTMLElement)?.closest?.('button[data-role]')) e.stopPropagation()
    }, true)
  }

  private currentPayload(): { payload: any; payloadStr: string } {
    return getDicePayload(this.dom)
  }

  private onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null
    if (!target) return

    const editBtn = target.closest?.('button[data-role="edit"]')
    if (editBtn) {
      e.stopPropagation()
      e.preventDefault()
      const { payload } = this.currentPayload()
      const blockId = this.dom.getAttribute('data-block-id') || ''
      handlers.onEditDiceBlock?.(blockId, payload)
      return
    }

    const rollBtn = target.closest?.('button[data-role="roll"]')
    if (!rollBtn) return
    e.stopPropagation()
    e.preventDefault()
    rollDiceInCard(this.dom, (payload) => {
      const nextStr = JSON.stringify(payload)
      this.lastPayload = nextStr
      setNodeAttrs(this.props, {
        payload: nextStr,
        blockId: payload?.config?.id ?? this.dom.getAttribute('data-block-id') ?? null,
      })
      handlers.onDiceRolled?.(payload)
    })
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'diceCard') return false
    this.props = { ...this.props, node }
    const payloadStr = String(node.attrs.payload ?? '{}')
    if (node.attrs.blockId) this.dom.setAttribute('data-block-id', String(node.attrs.blockId))
    if (payloadStr !== this.lastPayload) {
      this.lastPayload = payloadStr
      this.dom.setAttribute('data-payload', payloadStr)
      renderDiceCard(this.dom)
    }
    return true
  }

  selectNode(): void {
    this.dom.setAttribute('data-selected', 'true')
  }

  deselectNode(): void {
    this.dom.removeAttribute('data-selected')
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    return !!target?.closest?.('button[data-role]')
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.dom.removeEventListener('click', this.onClick, true)
  }
}

// ============================================================
// 三、collapseBlock —— 折叠块
// ============================================================

/**
 * 折叠 toggle 的 ChevronRight 内联 SVG（lucide chevron-right path）。
 * 方向由 CSS 依据 block[data-collapsed] 旋转：展开指向下、折叠指向右。
 */
function createToggleIcon(): HTMLSpanElement {
  const icon = document.createElement('span')
  icon.className = 'collapse-toggle-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
  return icon
}

class CollapseBlockNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private props: NodeViewRendererProps
  private toggle: HTMLElement
  private titleEl: HTMLElement
  private body: HTMLElement
  private titleDebounce: { run: () => void; cancel: () => void }

  constructor(props: NodeViewRendererProps) {
    this.props = props

    const block = document.createElement('div')
    block.setAttribute('data-type', 'collapse-block')
    block.setAttribute('tabindex', '-1')
    block.style.display = 'block'
    block.style.margin = '8px 0'
    block.style.borderRadius = 'var(--radius-md)'
    block.style.overflow = 'hidden'
    block.style.outline = 'none'
    block.style.userSelect = 'auto'

    const head = document.createElement('div')
    head.className = 'collapse-head'
    Object.assign(head.style, {
      background: 'var(--collapse-head-bg)',
      padding: '8px 12px',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    } as CSSStyleDeclaration)

    const toggle = document.createElement('span')
    toggle.className = 'collapse-toggle'
    toggle.setAttribute('contenteditable', 'false')
    Object.assign(toggle.style, {
      cursor: 'pointer',
      userSelect: 'none',
      flexShrink: '0',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    } as CSSStyleDeclaration)
    toggle.appendChild(createToggleIcon())
    // 点击时不要抢走光标
    toggle.addEventListener('mousedown', (e) => e.preventDefault())

    // 旧内核语义对齐（collapseBlock.ts onClick）：点击 .collapse-head 整体切换展开/折叠，
    // 但点击 .collapse-title 只进入标题编辑（避免框选/编辑标题中途块突然折叠）、
    // 点击拖动把手只负责拖动。
    head.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('.collapse-title')) return
      if (target.closest('.collapse-drag-handle')) return
      e.preventDefault()
      this.flipCollapsed()
    })

    const titleEl = document.createElement('span')
    titleEl.className = 'collapse-title'
    titleEl.setAttribute('contenteditable', 'true')
    Object.assign(titleEl.style, {
      outline: 'none',
      flex: '1',
      minWidth: '0',
    } as CSSStyleDeclaration)

    head.appendChild(toggle)
    head.appendChild(titleEl)

    const body = document.createElement('div')
    body.className = 'collapse-body'
    body.setAttribute('contenteditable', 'true')
    Object.assign(body.style, {
      background: 'var(--collapse-body-bg)',
      padding: '10px 14px',
      display: 'block',
      whiteSpace: 'normal',
    } as CSSStyleDeclaration)

    block.appendChild(head)
    block.appendChild(body)
    // 仅拖动把手可拖整块（ensureDragHandle 会移除块级 draggable）
    ensureDragHandle(block)

    this.dom = block
    this.contentDOM = body
    this.toggle = toggle
    this.titleEl = titleEl
    this.body = body

    const commit = () => {
      const next = (this.titleEl.textContent || '').trim()
      const fallback = String(this.props.node.attrs.dataTitle ?? '折叠')
      const title = next || fallback
      if (!next) this.titleEl.textContent = title
      if (title !== this.props.node.attrs.dataTitle) setNodeAttrs(this.props, { dataTitle: title })
    }
    this.titleDebounce = debounce(commit, 300)
    titleEl.addEventListener('input', this.titleDebounce.run)
    titleEl.addEventListener('blur', commit)
    titleEl.addEventListener('keydown', (e) => {
      // 标题是独立编辑岛：回车提交并退出
      if (e.key === 'Enter') {
        e.preventDefault()
        ;(e.target as HTMLElement).blur()
      }
    })

    this.syncFromNode(props.node)
  }

  private syncFromNode(node: PMNode): void {
    const title = String(node.attrs.dataTitle ?? '折叠')
    this.dom.setAttribute('data-title', title)
    const collapsed = String(node.attrs.dataCollapsed ?? 'false')
    this.dom.setAttribute('data-collapsed', collapsed)
    this.toggle.setAttribute('data-collapsed', collapsed)
    this.body.style.display = collapsed === 'true' ? 'none' : 'block'
    // 标题正在编辑时不覆盖用户输入
    if (document.activeElement !== this.titleEl) this.titleEl.textContent = title
  }

  private flipCollapsed(): void {
    const next = this.dom.getAttribute('data-collapsed') === 'true' ? 'false' : 'true'
    setNodeAttrs(this.props, { dataCollapsed: next })
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'collapseBlock') return false
    this.props = { ...this.props, node }
    this.syncFromNode(node)
    return true
  }

  /** 头部（toggle / title / 把手）由本 NodeView 维护；body 是 contentDOM，交给 PM */
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target)
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Node | null
    if (!target) return false
    // 只在 body（contentDOM）内的事件交给 ProseMirror
    return !this.contentDOM.contains(target)
  }

  destroy(): void {
    this.titleDebounce.cancel()
  }
}

// ============================================================
// 四、导出：供 TiptapEditorPane 装配
// ============================================================
export interface AnkeNodeViewFactory {
  imageBlock: () => NodeViewRenderer
  diceCard: () => NodeViewRenderer
  collapseBlock: () => NodeViewRenderer
}

export const ankeNodeViews: AnkeNodeViewFactory = {
  imageBlock: () => (props) => new ImageBlockNodeView(props),
  diceCard: () => (props) => new DiceCardNodeView(props),
  collapseBlock: () => (props) => new CollapseBlockNodeView(props),
}
