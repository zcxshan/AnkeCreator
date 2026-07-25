import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  NGA_FONTS,
  NGA_COLORS,
  NGA_IMAGE_SIZES,
  NGA_DEFAULT_FONT,
  NGA_DEFAULT_FONT_SIZE,
  NGA_DEFAULT_COLOR,
  NGA_DEFAULT_IMAGE_SIZE,
  ngaColorToCSS,
  ngaFontToCSS,
  percentToCssFontSize,
} from '../../types';
import {
  execRemoveFormat,
  execInsertUnorderedList,
  execInsertOrderedList,
  isBoldActive,
  isItalicActive,
  isUnderlineActive,
  isStrikeActive,
  isBoldFullyActive,
  isItalicFullyActive,
  isUnderlineFullyActive,
  isStrikeFullyActive,
  isSupActive,
  isSubActive,
  getEffectiveColorName,
  getEffectiveFontSizePercent,
  getEffectiveFontFamilyValue,
  getCurrentBlockAlign,
  isInsideList,
  setBlockAlign,
  applyInlineStyleNoFocus,
  removeInlineStyleNoFocus,
  removeInlineTagNoFocus,
  applyTextDecorationPartNoFocus,
  removeTextDecorationPartNoFocus,
  insertMarkersAtRange,
  restoreSelectionFromMarkers,
  insertCollapseBlock,
  insertQuoteBlock,
  insertTable,
  insertCodeBlock,
  insertHorizontalRuleNGA,
  insertNgaLink,
  insertImageBlock,
  insertImageBlockWithSize,
  setImageBlockAlign,
  removeLinkAtCursor,
  getCurrentStyles,
  getInsertionPoint,
  dispatchInput,
} from './contenteditableUtils';
import { useEditorStore } from '../../store/editorStore';
import { useSettingStore } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';
import { useDiceStore } from '../../store/diceStore';
// 改动 2：夜间模式感知（字色下拉弹窗的黑色色块翻转）
import { useThemeStore } from '../../store/themeStore';
import { uploadImagesWithProgress, ensureLocalWarning, type UploadProgressEvent } from '../../utils/uploadImage';
import { UploadProgressDialog } from '../common/UploadProgressDialog';
import { DiceNGAImportDialog } from '../dice/DiceNGAImportDialog';
import {
  cssColorToNga,
  cssFontToNga,
  ptToSizePercent,
} from '../../utils/ngaHtmlToBBCode';

interface EditorToolbarProps {
  editorElRef: React.MutableRefObject<HTMLElement | null>;
  savedRangeRef?: React.MutableRefObject<Range | null>;
  onInsertImage: (src: string, size?: string) => void;
  onInsertDice: () => void;
  onShowToast?: (msg: string) => void;
  /** 撤销回调（走自定义历史栈，替代 execCommand('undo')） */
  onUndo?: () => void;
  /** 重做回调（走自定义历史栈，替代 execCommand('redo')） */
  onRedo?: () => void;
  /** 是否可撤销（控制按钮禁用态） */
  canUndo?: boolean;
  /** 是否可重做（控制按钮禁用态） */
  canRedo?: boolean;
  /** 需求2: 快捷键处理函数注册回调 */
  onShortcutReady?: (handlers: ShortcutHandlers) => void;
}

/** 需求2: 工具栏快捷键处理函数集合 */
export interface ShortcutHandlers {
  bold: () => void;
  italic: () => void;
  underline: () => void;
  strike: () => void;
  collapse: () => void;
}

const toolbarBtn: React.CSSProperties = {
  minWidth: 28,
  height: 24,
  padding: '0 6px',
  fontSize: 12,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text-primary)',
  borderRadius: 4,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  userSelect: 'none',
  lineHeight: 1,
  transition: 'background 0.12s ease',
};

const toolbarBtnHover = { background: 'var(--bg-hover)' };
// v25c 增强:深色 UI 下视觉更醒目
const toolbarBtnActive: React.CSSProperties = {
  background: 'var(--accent-soft)',
  borderColor: 'var(--accent)',
  color: 'var(--accent)',
  fontWeight: 700,
  // 双层 box-shadow: 内层 1px accent 增强边框感 + 外层柔和光晕
  boxShadow: 'inset 0 0 0 1px var(--accent), 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent)',
};

const selectNga: React.CSSProperties = {
  height: 24,
  padding: '0 6px',
  fontSize: 12,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  borderRadius: 4,
  cursor: 'pointer',
  lineHeight: 1,
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

// 字号区域成组样式（#7）：select + input + % 视觉关联
const fontSizeGroupStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 6px',
  borderRadius: 6,
  background: 'var(--bg-input, var(--bg-card))',
  border: '1px solid var(--border-color)',
  transition: 'border-color 0.15s',
};

const rowContainer: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  alignItems: 'center',
  padding: '4px 0',
};

const groupContainer: React.CSSProperties = {
  display: 'inline-flex',
  gap: 3,
  alignItems: 'center',
};

const popoverPanel: React.CSSProperties = {
  position: 'absolute',
  zIndex: 50,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  padding: 8,
  boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 220,
};

const popoverInput: React.CSSProperties = {
  height: 26,
  padding: '0 8px',
  fontSize: 12,
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  outline: 'none',
};

function ToolbarBtn({
  children,
  onClick,
  active,
  title,
  style,
  disabled,
  btnRef,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>;
}) {
  const [hover, setHover] = useState(false);
  const base = active
    ? { ...toolbarBtn, ...toolbarBtnActive }
    : { ...toolbarBtn, ...(hover && !disabled ? toolbarBtnHover : {}) };
  return (
    <button
      ref={btnRef}
      type="button"
      className="toolbar-btn active:scale-95"
      onMouseDown={(e) => e.preventDefault()}
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...base,
        ...(disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function GroupDivider() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 1,
        height: 16,
        background: 'var(--border-color)',
        margin: '0 6px',
      }}
    />
  );
}

function useEditor(
  ref: React.MutableRefObject<HTMLElement | null>,
): HTMLElement | null {
  const [, setTick] = useState(0);
  const lastRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === lastRef.current) return;
    lastRef.current = el;

    if (!el) return;
    const bump = () => setTick((t) => t + 1);
    el.addEventListener('input', bump);
    el.addEventListener('keyup', bump);
    el.addEventListener('mouseup', bump);
    el.addEventListener('focus', bump);
    el.addEventListener('blur', bump);
    return () => {
      el.removeEventListener('input', bump);
      el.removeEventListener('keyup', bump);
      el.removeEventListener('mouseup', bump);
      el.removeEventListener('focus', bump);
      el.removeEventListener('blur', bump);
    };
  }, [ref]);

  // v40: 订阅 cursorStyles 触发 re-render(替代 selectionchange 监听)
  //   原 useEditor 在 document 上监听 selectionchange + 50ms debounce + setTick,
  //   但 RichTextEditor 已在 document 上监听 selectionchange 并同步 cursorStyles 到 store,
  //   两次监听同一事件导致工具栏高亮闪烁/延迟。改为订阅 store,由 cursorStyles 变化驱动 re-render。
  useEditorStore((s) => s.cursorStyles);
  useEditorStore((s) => s.activeStyles);
  useEditorStore((s) => s.activeStylesLocked);

  return ref.current;
}

function useDismiss(open: boolean, onDismiss: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (ref.current && !ref.current.contains(t)) onDismiss();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onDismiss]);
  return ref;
}

export function EditorToolbar({
  editorElRef,
  savedRangeRef,
  onInsertImage,
  onInsertDice,
  onShowToast,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onShortcutReady,
}: EditorToolbarProps) {
  const editor = useEditor(editorElRef);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlBox, setShowUrlBox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [styleRowCollapsed, setStyleRowCollapsed] = useState(
    () => {
      if (typeof window === 'undefined') return false;
      return window.innerWidth < 768;
    }
  );

  // 订阅本地上传总开关：关闭时把"本地上传"按钮置灰
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const localUploadDisabledReason = '本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传';
  const isLocalUploadDisabled = !localUploadEnabled;

  // 状态
  const [smileyOpen, setSmileyOpen] = useState(false);
  const [smileyPack, setSmileyPack] = useState('');
  const [smileyFace, setSmileyFace] = useState('');
  const smileyRef = useDismiss(smileyOpen, () => setSmileyOpen(false));

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const linkRef = useDismiss(linkOpen, () => setLinkOpen(false));

  const [collapseOpen, setCollapseOpen] = useState(false);
  const [collapseTitle, setCollapseTitle] = useState('');
  const collapseRef = useDismiss(collapseOpen, () => setCollapseOpen(false));

  const [tableOpen, setTableOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const tableRef = useDismiss(tableOpen, () => setTableOpen(false));

  const [imageSizeOpen, setImageSizeOpen] = useState(false);
  const [imageSize, setImageSize] = useState<typeof NGA_DEFAULT_IMAGE_SIZE>(
    NGA_DEFAULT_IMAGE_SIZE,
  );
  const imageSizeRef = useDismiss(imageSizeOpen, () => setImageSizeOpen(false));

  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useDismiss(colorPickerOpen, () => setColorPickerOpen(false));
  // 改动 2：暗色模式下字色下拉弹窗的黑色色块要翻转为白色，避免与暗色背景混淆
  const isDark = useThemeStore((s) => s.mode === 'dark');

  // 字号 input 本地态：允许用户输入 < 20 或 > 500 临时值，失焦时自动钳位到 [20, 500]
  // 这样用户可以连续输入多位数字且不丢焦点（每次 onChange 不触发 focusEditor）
  const [fontSizeInputValue, setFontSizeInputValue] = useState<string>('');
  const fontSizeInputRef = useRef<HTMLInputElement>(null);

  // 上传进度弹窗状态
  const [uploadTasks, setUploadTasks] = useState<UploadProgressEvent[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // NGA 安价导入弹窗状态
  const [showNGAImport, setShowNGAImport] = useState(false);

  // 激活状态 —— v17 修复：cursorStyles 严格优先
  //   - activeStylesLocked=true 时：优先读 activeStyles（用户主动点击设置的样式意图，后续输入会延续）
  //   - activeStylesLocked=false 时：只读 cursorStyles（光标处实际样式），不再 fallback activeStyles
  //   - 效果：工具栏高亮 = 光标处实际样式，cursorStyles.bold=false 时 B 按钮不高亮
  // v26: 选区非折叠时,优先用 isXxxFullyActive() (ALL 语义) 覆盖 cursorStyles
  //   - 选区全部加粗 → B 按钮高亮
  //   - 选区部分加粗部分未加粗 → B 按钮不高亮(原 cursorStyles 可能是加粗,被覆盖)
  // v26:isCollapsedSelection 在文件下方定义为 function declaration (可被 hoisting)
  const activeStylesFromStore = useEditorStore((s) => s.activeStyles);
  const cursorStylesFromStore = useEditorStore((s) => s.cursorStyles);
  const activeStylesLocked = useEditorStore((s) => s.activeStylesLocked);

  // v26:每次 render 时实时计算选区 ALL 状态
  const selIsCollapsed = isCollapsedSelection();
  const isAllBold = !selIsCollapsed && isBoldFullyActive();
  const isAllItalic = !selIsCollapsed && isItalicFullyActive();
  const isAllUnderline = !selIsCollapsed && isUnderlineFullyActive();
  const isAllStrike = !selIsCollapsed && isStrikeFullyActive();

  const activeBold = activeStylesLocked
    ? (activeStylesFromStore.bold ?? false)
    : isAllBold || (cursorStylesFromStore.bold ?? false);
  const activeItalic = activeStylesLocked
    ? (activeStylesFromStore.italic ?? false)
    : isAllItalic || (cursorStylesFromStore.italic ?? false);
  const activeUnderline = activeStylesLocked
    ? (activeStylesFromStore.underline ?? false)
    : isAllUnderline || (cursorStylesFromStore.underline ?? false);
  const activeStrike = activeStylesLocked
    ? (activeStylesFromStore.strike ?? false)
    : isAllStrike || (cursorStylesFromStore.strike ?? false);
  const activeSup = activeStylesLocked
    ? (activeStylesFromStore.sup ?? false)
    : (cursorStylesFromStore.sup ?? false);
  const activeSub = activeStylesLocked
    ? (activeStylesFromStore.sub ?? false)
    : (cursorStylesFromStore.sub ?? false);

  // 颜色：activeStyles.color (CSS) → cssColorToNga → NGA name；fallback cursorStyles 反查
  // v17 修复：未锁定时只读 cursorStyles（去掉 activeStyles fallback，确保高亮严格对应光标处实际样式）
  const activeColorNgaName = (() => {
    if (activeStylesLocked) {
      // locked 时只读 activeStyles
      if (activeStylesFromStore.color) {
        const n = cssColorToNga(activeStylesFromStore.color);
        if (n) return n;
      }
      return NGA_DEFAULT_COLOR;
    }
    // 未锁定时只读 cursorStyles
    if (cursorStylesFromStore.color) {
      const n = cssColorToNga(cursorStylesFromStore.color);
      if (n) return n;
    }
    return NGA_DEFAULT_COLOR;
  })();
  // 字号：activeStyles.fontSize (CSS) → ptToSizePercent → 实际百分比
  // v17 修复：未锁定时只读 cursorStyles
  const activeFontSizePct = (() => {
    if (activeStylesLocked) {
      if (activeStylesFromStore.fontSize) {
        const pct = ptToSizePercent(activeStylesFromStore.fontSize);
        if (pct != null) return pct;
      }
      return NGA_DEFAULT_FONT_SIZE;
    }
    if (cursorStylesFromStore.fontSize) {
      const pct = ptToSizePercent(cursorStylesFromStore.fontSize);
      if (pct != null) return pct;
    }
    return NGA_DEFAULT_FONT_SIZE;
  })();
  // 字号 input 本地态：仅在 input 未聚焦时同步 store 变化 → 显示（避免打断用户输入）
  useEffect(() => {
    if (
      document.activeElement !== fontSizeInputRef.current &&
      String(activeFontSizePct) !== fontSizeInputValue
    ) {
      setFontSizeInputValue(String(activeFontSizePct));
    }
    // 仅依赖 activeFontSizePct 即可；fontSizeInputValue 自身变化不应触发此 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFontSizePct]);
  // 字体：activeStyles.fontFamily (CSS) → cssFontToNga → NGA value
  // v17 修复：未锁定时只读 cursorStyles
  const activeFontNga = (() => {
    if (activeStylesLocked) {
      if (activeStylesFromStore.fontFamily) {
        const n = cssFontToNga(activeStylesFromStore.fontFamily);
        if (n) return n;
      }
      return NGA_DEFAULT_FONT;
    }
    if (cursorStylesFromStore.fontFamily) {
      const n = cssFontToNga(cursorStylesFromStore.fontFamily);
      if (n) return n;
    }
    return NGA_DEFAULT_FONT;
  })();

  const activeAlign = editor ? getCurrentBlockAlign(editor) : 'left';
  const activeUL = editor ? isInsideList(editor, 'UL') : false;
  const activeOL = editor ? isInsideList(editor, 'OL') : false;

  const withEditor = (
    fn: (e: HTMLElement) => void,
    options: { skipFocus?: boolean } = {},
  ): void => {
    const el = editorElRef.current;
    if (!el) return;
    // 恢复保存的光标位置（编辑器失焦后光标位置丢失的问题）
    const saved = savedRangeRef?.current;
    if (saved && el.contains(saved.startContainer)) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(saved);
      }
    }
    // 工具栏的 input/select 修改样式时跳过 focus()，避免抢焦点导致用户输入中断
    if (!options.skipFocus) el.focus();
    fn(el);
  };

  // 工具栏样式按钮共用：恢复 savedRange + 应用 inline 样式 + 同步 activeStyles
  // 不抢焦点（让 input/select 不失焦），不依赖 withEditor（避免抢焦点）
  // v30 注释：B/I/U/S 按钮的 lock/unlock 时机
  //   - apply(cancel 状态 → active): 调 lockActiveStyles,让用户后续输入自动应用该样式
  //   - cancel(active 状态 → cancel): 调 unlockActiveStyles,让用户后续输入不再应用该样式
  //   - v18 spread 保留保证 lock/unlock 只影响当前样式的 activeStyles,
  //     不会清空其他样式的 activeStyles,符合"互不影响"需求
  // v41 Fix 2D: 先检查当前 window.getSelection() 是否有效且在编辑器内,
  //   只在无效时才用 savedRangeRef 恢复。
  //   原因: selectionchange 事件是异步的,程序化设置选区后立即点击按钮,
  //   savedRangeRef 可能还保存旧值(折叠光标),用旧值覆盖新选区会导致样式无法应用。
  const applyInlineStylePreservingFocus = (styles: Record<string, string>): void => {
    const el = editorElRef.current;
    if (!el) return;
    restoreSelectionIfValid();
    applyInlineStyleNoFocus(el, styles);
  };

  // v41 Fix 2B: 取消样式时恢复选区(与 applyInlineStylePreservingFocus 对称)
  //   用于 B/I/U/S 非折叠 DISABLE 路径:点击工具栏按钮会让编辑器失焦,
  //   需在调用 removeInlineTagNoFocus/removeInlineStyleNoFocus/removeTextDecorationPartNoFocus 前
  //   恢复 savedRange,确保操作应用到用户原始选中的文本。
  // v41 Fix 2D: 先检查当前选区是否有效,只在无效时才恢复 savedRange。
  const restoreSelectionIfValid = (): void => {
    const el = editorElRef.current;
    if (!el) return;
    const sel = window.getSelection();
    // 先检查当前选区是否有效且在编辑器内
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.startContainer) && el.contains(r.endContainer) && !r.collapsed) {
        return; // 当前选区有效,不需要恢复
      }
    }
    // 当前选区无效(折叠/不在编辑器内/无选区),用 savedRange 恢复
    const saved = savedRangeRef?.current;
    if (saved && el.contains(saved.startContainer)) {
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(saved);
      }
    }
  };

  // 判断当前编辑器选区是否折叠（无选区或光标处）
  // v26:改为 function declaration 以支持 hoisting(active state 计算在文件更早位置需要)
  function isCollapsedSelection(): boolean {
    const sel = window.getSelection();
    if (!sel) return true;
    if (sel.isCollapsed) return true;
    return false;
  }

  // 简单样式切换：在无选区时主动翻转 activeStyles，让下一次输入自动应用
  // v18 修复:用 spread 保留其他样式(B/I/U/S 互不影响)
  // v25c 新增:翻转后弹 Toast 提示(仅无选区时)
  // v38 修复: 取消样式时保持锁定 + 刷新 cursorStyles
  //   v37 错误: 取消样式时调用 unlockActiveStyles,导致 onBeforeInputNative 直接 return,
  //   v21 的 insertTextOutsideStyledSpan 不会触发(该函数仅在 activeStylesLocked=true 路径内调用),
  //   用户取消样式后输入字符仍被浏览器默认插入到粗体 span 内继承粗体(伪取消)。
  //   v38 修正: 取消样式时保持锁定,设置 activeStyles[key]=false 触发 hasExplicitCancel=true,
  //   让 onBeforeInputNative 走 v21 显式取消路径(insertTextOutsideStyledSpan 在父 span 外插入裸文本)。
  //   同时显式 setCursorStyles({ [key]: false }) 刷新视觉,让按钮立即退出高亮
  //   (与非折叠选区路径 L822/L857/L892/L931 对齐)。
  const toggleSimpleActiveStyle = (key: 'bold' | 'italic' | 'underline' | 'strike'): void => {
    if (!isCollapsedSelection()) return; // 有选区由 execCommand 处理
    const cur = useEditorStore.getState().activeStyles;
    const willEnable = !cur[key];
    useEditorStore.getState().setActiveStyles({ ...cur, [key]: willEnable });
    // v38: 启用和取消都保持锁定,让 onBeforeInputNative 接管
    // - 启用: hasStyle=true → 创建 span 包裹文本
    // - 取消: hasExplicitCancel=true → insertTextOutsideStyledSpan 跳出父 span 插入裸文本
    useEditorStore.getState().lockActiveStyles();
    if (!willEnable) {
      // v38: 显式刷新 cursorStyles,让按钮立即视觉退出高亮
      // (与有选区路径 L822/L857/L892/L931 的 setCursorStyles({key:false}) 对齐)
      const curCursor = useEditorStore.getState().cursorStyles;
      useEditorStore.getState().setCursorStyles({ ...curCursor, [key]: false });
    }
    // v25c 反馈
    const labelMap = { bold: '粗体', italic: '斜体', underline: '下划线', strike: '删除线' };
    const label = labelMap[key];
    showToast(willEnable ? `已开启${label}格式，新输入自动应用` : `已关闭${label}格式`);
  };

  const showToast = (msg: string) => {
    onShowToast?.(msg);
  };

  // 需求2: 快捷键按钮 ref — 通过 .click() 复用按钮 onClick 逻辑
  const boldBtnRef = useRef<HTMLButtonElement>(null);
  const italicBtnRef = useRef<HTMLButtonElement>(null);
  const underlineBtnRef = useRef<HTMLButtonElement>(null);
  const strikeBtnRef = useRef<HTMLButtonElement>(null);
  const collapseBtnRef = useRef<HTMLButtonElement>(null);

  // 需求2: 通过 onShortcutReady 把快捷键处理函数注册到 RichTextEditor
  useEffect(() => {
    if (!onShortcutReady) return;
    const triggerClick = (ref: React.RefObject<HTMLButtonElement>) => {
      if (ref.current) {
        ref.current.click();
      } else {
        // 工具栏折叠时先展开再延迟点击
        setStyleRowCollapsed(false);
        requestAnimationFrame(() => {
          ref.current?.click();
        });
      }
    };
    onShortcutReady({
      bold: () => triggerClick(boldBtnRef),
      italic: () => triggerClick(italicBtnRef),
      underline: () => triggerClick(underlineBtnRef),
      strike: () => triggerClick(strikeBtnRef),
      collapse: () => triggerClick(collapseBtnRef),
    });
  }, [onShortcutReady]);

  const handlePickFile = async () => {
    const hasElectronAPI =
      typeof (window as any).electronAPI !== 'undefined' &&
      typeof (window as any).electronAPI.selectImage === 'function';
    if (hasElectronAPI) {
      try {
        const sel: {
          buffer: string;
          filename: string;
          mimeType: string;
          filePath?: string;
        } | null = await (window as any).electronAPI.selectImage();
        if (!sel) return;
        // 把 base64 buffer 转回 File 再走统一进度流程
        const byteChars = atob(sel.buffer);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const file = new File([bytes], sel.filename, { type: sel.mimeType });
        await runUploadWithProgress([file], sel.filename, sel.filePath);
      } catch (e) {
        useToastStore
          .getState()
          .showToast(
            `图片上传失败：${(e as Error).message || '未知错误'}，请检查网络后重新选择`,
            'error',
          );
      }
      return;
    }
    fileInputRef.current?.click();
  };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    // 浏览器：File.path 不可用，不传 filePath
    runUploadWithProgress(files, files[0]?.name);
  };

  /**
   * 走统一进度流程：弹窗 + 串行上传 + 成功后插入图片
   * - 本地模式 + 未设置「不再提示」：先弹警告（全局 store），用户确认后才执行
   * - filePath：Electron selectImage 传过来的绝对路径（仅本地模式有效）
   */
  const runUploadWithProgress = async (
    files: File[],
    firstName?: string,
    filePath?: string,
  ) => {
    // 检查本地上传总开关（默认关闭，用户需在设置中显式开启）
    if (!useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    const confirmed = await ensureLocalWarning();
    if (!confirmed) {
      useToastStore.getState().showToast('已取消本地保存', 'info');
      return;
    }
    return doUpload(files, firstName, filePath);
  };

  /**
   * 实际执行上传：进度弹窗 + 串行上传 + 成功后插入
   */
  const doUpload = async (
    files: File[],
    firstName?: string,
    filePath?: string,
  ) => {
    setUploadTasks(
      files.map((f, i) => ({
        taskId: `${Date.now()}_${i}`,
        fileName: f.name || firstName || `image_${i}`,
        status: 'pending',
        progress: 0,
      })),
    );
    setUploadDialogOpen(true);
    const results = await uploadImagesWithProgress(
      files,
      (e) => {
        setUploadTasks((prev) =>
          prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
        );
      },
      filePath,
    );
    // 第一张成功：插入到编辑器
    const ok = results.find((r) => r.ok && r.url);
    if (ok && ok.url) {
      const name = files[0]?.name || firstName;
      handleInsertImageWithSize(ok.url, name);
      useToastStore.getState().showToast('图片已插入', 'success');
    } else {
      const firstErr = results.find((r) => !r.ok)?.error || '未知错误';
      useToastStore
        .getState()
        .showToast(
          `图片上传失败：${firstErr}，请检查网络后重新选择`,
          'error',
        );
    }
  };

  const handleInsertImageWithSize = (src: string, name?: string) => {
    if (!src) return;
    // 透传 name 到 insertImageBlock（alt 用可读名字）
    withEditor((ed) => insertImageBlock(ed, src, { size: imageSize, name }));
  };

  const handleUrlConfirm = () => {
    const url = urlInput.trim();
    if (!url) return;
    withEditor((ed) => insertImageBlockWithSize(ed, url, imageSize));
    setUrlInput('');
    setShowUrlBox(false);
  };

  // 字号改变：实时应用到选区 + 同步 activeStyles（与 color/fontFamily 一致）
  // skipFocus: 不抢 input 焦点（工具栏 input onChange 调用时使用）
  const handleFontSizeChange = (percent: number, opts: { skipFocus?: boolean } = {}): void => {
    const cssSize = percentToCssFontSize(percent);
    // 直接用 applyInlineStyleNoFocus 包裹选区文本（或同步 activeStyles 用于下一次输入）
    // 不走 withEditor → focus() 链路，避免抢 input 焦点
    applyInlineStylePreservingFocus({ fontSize: cssSize });
    useEditorStore.getState().setActiveStyles({ fontSize: cssSize });
    useEditorStore.getState().lockActiveStyles();
  };

  const handleSmileyConfirm = () => {
    const safePack = (smileyPack || '').trim() || '表情包';
    const safeFace = (smileyFace || '').trim() || '表情';
    const text = `[s:${safePack}:${safeFace}]`;
    withEditor((ed) => {
      // 关键：用 getInsertionPoint 而非 document.createRange()。
      // 原因：document.createRange() 创建的是 body 起点 (0,0) 的空 range，
      // 之前直接 range.insertNode 会把表情文本插到 body 末尾，用户视觉上看不到任何变化。
      // getInsertionPoint 会优先用 _lastEditorRange（用户在编辑器内的最后光标），
      // 退化到当前 sel，最后兜底到编辑器末尾。
      const range = getInsertionPoint(ed);
      const sel = window.getSelection();
      if (!sel) return;
      if (range.collapsed) {
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
      } else {
        // 替换选区
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
      }
      sel.removeAllRanges();
      sel.addRange(range);
      dispatchInput(ed);
    });
    setSmileyPack('');
    setSmileyFace('');
    setSmileyOpen(false);
    showToast('已插入表情');
  };

  const handleLinkConfirm = () => {
    const url = linkUrl.trim();
    if (!url) return;
    withEditor((ed) => insertNgaLink(ed, url, linkLabel));
    setLinkUrl('');
    setLinkLabel('');
    setLinkOpen(false);
  };

  const handleCollapseConfirm = () => {
    withEditor((ed) => insertCollapseBlock(ed, collapseTitle));
    setCollapseTitle('');
    setCollapseOpen(false);
  };

  const handleTableConfirm = () => {
    withEditor((ed) => insertTable(ed, tableRows, tableCols));
    setTableOpen(false);
  };

  return (
    <div
      className="mobile-toolbar-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '6px 12px',
        background: 'var(--bg-toolbar)',
        borderBottom: '1px solid var(--border-color)',
        position: 'relative',
      }}
    >
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleFile}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          opacity: 0,
          overflow: 'hidden',
          border: 0,
          padding: 0,
          pointerEvents: 'none',
        }}
      />

      {/* 折叠状态下：仅显示一个右对齐的展开按钮，不占用完整行高 */}
      {styleRowCollapsed && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 0' }}>
          <ToolbarBtn
            title="展开所有样式工具"
            onClick={() => setStyleRowCollapsed((v) => !v)}
            style={{ minWidth: 24, fontSize: 12 }}
          >
            ▸ 样式
          </ToolbarBtn>
        </div>
      )}

      {/* 第一行：B/I/U/del + 上下标 + 颜色/字号/字体 + 列表/对齐 */}
      {!styleRowCollapsed && (
      <div style={rowContainer}>
        <div style={groupContainer}>
          <ToolbarBtn
            btnRef={boldBtnRef}
            title="粗体 (Ctrl+B)"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('bold');
              } else {
                // v26 修复:用 ALL 语义 (isBoldFullyActive) 决定 toggle 方向
                // - 选区全粗体 → 取消全部
                // - 选区部分/全非粗体 → 应用全部
                const el = editorElRef.current;
                if (isBoldFullyActive()) {
                  // v18 修复:同时移除 <b>/<strong> 元素(老 DOM 残留)+ CSS font-weight
                  // v28 修复:确保 removeInlineTagNoFocus 已从 contenteditableUtils 导入(防止 ReferenceError)
                  // v41 Fix 2B: 恢复 savedRange,确保操作应用到用户原始选中的文本
                  restoreSelectionIfValid();
                  // v49 Phase C2 Fix: 使用 Comment 节点 bookmark 标记法,替代保存原始 container 引用
                  //   原因: v49 Fix 保存原始 textNode 引用,但 removeInlineStyle 内部的 normalize()
                  //   会合并相邻 textNode,导致保存的 container 不再在 DOM 中,选区恢复被跳过
                  //   Comment 节点不受 normalize() 影响,选区恢复更可靠
                  let markersB: { startMarker: Comment; endMarker: Comment } | null = null;
                  {
                    const selBm = window.getSelection();
                    if (selBm && selBm.rangeCount > 0) {
                      const rBm = selBm.getRangeAt(0);
                      if (el!.contains(rBm.startContainer) && el!.contains(rBm.endContainer)) {
                        try { markersB = insertMarkersAtRange(rBm); } catch {}
                      }
                    }
                  }
                  removeInlineTagNoFocus(el!, 'b', { skipFocus: true, skipSelectionRestore: true });
                  removeInlineTagNoFocus(el!, 'strong', { skipFocus: true, skipSelectionRestore: true });
                  removeInlineStyleNoFocus(el!, ['fontWeight'], { skipSelectionRestore: true });
                  // v49 Phase C2 Fix: 通过 markers 恢复选区(优先于各 removeXxx 内部的恢复)
                  if (markersB) {
                    try { restoreSelectionFromMarkers(markersB.startMarker, markersB.endMarker); } catch {}
                  }
                  // v49 Phase C2 Fix: 统一调用 dispatchInput (removeXxx 内部因 skipSelectionRestore=true 跳过了)
                  //   必须在 restoreSelectionFromMarkers 之后调用,确保 markers 已被移除,
                  //   React state 更新为不含 markers 的最终 HTML
                  try { dispatchInput(el!); } catch {}
                  // v18 修复:用 spread 保留其他样式(互不影响)
                  const cur = useEditorStore.getState().activeStyles;
                  useEditorStore.getState().setActiveStyles({ ...cur, bold: false });
                  // v19: 刷新 cursorStyles（unlock 后工具栏读 cursorStyles）
                  useEditorStore.getState().setCursorStyles({ bold: false });
                  // v41 Fix 2A: 保持锁定 + cursorStyles{bold:false} → onBeforeInputNative 走 hasExplicitCancel 路径
                  //   v38 回归: 非折叠 DISABLE 仍调 unlockActiveStyles,导致 onBeforeInputNative 早退,
                  //   新输入继承父 span 粗体(伪取消)。与 toggleSimpleActiveStyle L525 对齐。
                  useEditorStore.getState().lockActiveStyles();
                } else {
                  applyInlineStylePreservingFocus({ fontWeight: 'bold' });
                  if (el) {
                    // v18 修复:用 spread 保留其他样式
                    const cur = useEditorStore.getState().activeStyles;
                    useEditorStore.getState().setActiveStyles({ ...cur, bold: isBoldFullyActive() });
                  }
                  useEditorStore.getState().lockActiveStyles();
                }
              }
            }}
            active={activeBold}
            style={{ fontWeight: 700, fontSize: 13 }}
          >
            B
          </ToolbarBtn>
          <ToolbarBtn
            btnRef={italicBtnRef}
            title="斜体 (Ctrl+I)"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('italic');
              } else {
                // v26 修复:用 ALL 语义 (isItalicFullyActive) 决定 toggle 方向
                const el = editorElRef.current;
                if (isItalicFullyActive()) {
                  // v18 修复:同时移除 <i>/<em> 元素(老 DOM 残留)+ CSS font-style
                  // v41 Fix 2B: 恢复 savedRange
                  restoreSelectionIfValid();
                  // v48 Fix 1: 统一保存选区(同 B 按钮 DISABLE 路径)
                  // v49 Phase C2 Fix: 使用 Comment 节点 bookmark 标记法(同 B 按钮)
                  let markersI: { startMarker: Comment; endMarker: Comment } | null = null;
                  {
                    const selIm = window.getSelection();
                    if (selIm && selIm.rangeCount > 0) {
                      const rIm = selIm.getRangeAt(0);
                      if (el!.contains(rIm.startContainer) && el!.contains(rIm.endContainer)) {
                        try { markersI = insertMarkersAtRange(rIm); } catch {}
                      }
                    }
                  }
                  removeInlineTagNoFocus(el!, 'i', { skipFocus: true, skipSelectionRestore: true });
                  removeInlineTagNoFocus(el!, 'em', { skipFocus: true, skipSelectionRestore: true });
                  removeInlineStyleNoFocus(el!, ['fontStyle'], { skipSelectionRestore: true });
                  // v49 Phase C2 Fix: 通过 markers 恢复选区(同 B 按钮)
                  if (markersI) {
                    try { restoreSelectionFromMarkers(markersI.startMarker, markersI.endMarker); } catch {}
                  }
                  // v49 Phase C2 Fix: 同 B 按钮,统一 dispatchInput
                  try { dispatchInput(el!); } catch {}
                  // v18 修复:用 spread 保留其他样式(互不影响)
                  const cur = useEditorStore.getState().activeStyles;
                  useEditorStore.getState().setActiveStyles({ ...cur, italic: false });
                  // v19: 刷新 cursorStyles
                  useEditorStore.getState().setCursorStyles({ italic: false });
                  // v41 Fix 2A: 保持锁定(同 bold 分支)
                  useEditorStore.getState().lockActiveStyles();
                } else {
                  applyInlineStylePreservingFocus({ fontStyle: 'italic' });
                  if (el) {
                    // v18 修复:用 spread 保留其他样式
                    const cur = useEditorStore.getState().activeStyles;
                    useEditorStore.getState().setActiveStyles({ ...cur, italic: isItalicFullyActive() });
                  }
                  useEditorStore.getState().lockActiveStyles();
                }
              }
            }}
            active={activeItalic}
            style={{ fontStyle: 'italic', fontSize: 13 }}
          >
            I
          </ToolbarBtn>
          <ToolbarBtn
            btnRef={underlineBtnRef}
            title="下划线 (Ctrl+U)"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('underline');
              } else {
                // v26 修复:用 ALL 语义 (isUnderlineFullyActive) 决定 toggle 方向
                const el = editorElRef.current;
                if (isUnderlineFullyActive()) {
                  // v18 修复:同时移除 <u> 元素(老 DOM 残留)+ CSS text-decoration
                  // 细粒度：仅移除 underline，保留 line-through（如有）
                  // v41 Fix 2B: 恢复 savedRange
                  restoreSelectionIfValid();
                  // v48 Fix 1: 统一保存选区(同 B 按钮 DISABLE 路径)
                  // v49 Phase C2 Fix: 使用 Comment 节点 bookmark 标记法(同 B 按钮)
                  let markersU: { startMarker: Comment; endMarker: Comment } | null = null;
                  {
                    const selUm = window.getSelection();
                    if (selUm && selUm.rangeCount > 0) {
                      const rUm = selUm.getRangeAt(0);
                      if (el!.contains(rUm.startContainer) && el!.contains(rUm.endContainer)) {
                        try { markersU = insertMarkersAtRange(rUm); } catch {}
                      }
                    }
                  }
                  removeTextDecorationPartNoFocus(el!, 'underline', { skipFocus: true, skipSelectionRestore: true });
                  removeInlineTagNoFocus(el!, 'u', { skipFocus: true, skipSelectionRestore: true });
                  // v49 Phase C2 Fix: 通过 markers 恢复选区(同 B 按钮)
                  if (markersU) {
                    try { restoreSelectionFromMarkers(markersU.startMarker, markersU.endMarker); } catch {}
                  }
                  // v49 Phase C2 Fix: 同 B 按钮,统一 dispatchInput
                  try { dispatchInput(el!); } catch {}
                  // v18 修复:用 spread 保留其他样式(互不影响)
                  const cur = useEditorStore.getState().activeStyles;
                  useEditorStore.getState().setActiveStyles({ ...cur, underline: false });
                  // v19: 刷新 cursorStyles
                  useEditorStore.getState().setCursorStyles({ underline: false });
                  // v41 Fix 2A: 保持锁定(同 bold 分支)
                  useEditorStore.getState().lockActiveStyles();
                } else {
                  // 细粒度:追加 underline,保留 line-through(如有)
                  // v25d 重写后 applyTextDecorationPartNoFocus 一定能处理裸文本
                  // v41 Fix 2C: 恢复 savedRange(与 B/I ENABLE 路径对齐)
                  restoreSelectionIfValid();
                  applyTextDecorationPartNoFocus(el!, 'underline', { skipFocus: true });
                  if (el) {
                    // v18 修复:用 spread 保留其他样式
                    const cur = useEditorStore.getState().activeStyles;
                    useEditorStore.getState().setActiveStyles({ ...cur, underline: isUnderlineFullyActive() });
                  }
                  useEditorStore.getState().lockActiveStyles();
                }
              }
            }}
            active={activeUnderline}
            style={{ textDecoration: 'underline', fontSize: 13 }}
          >
            U
          </ToolbarBtn>
          <ToolbarBtn
            btnRef={strikeBtnRef}
            title="删除线 (Ctrl+Shift+S)"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('strike');
              } else {
                // v26 修复:用 ALL 语义 (isStrikeFullyActive) 决定 toggle 方向
                const el = editorElRef.current;
                if (isStrikeFullyActive()) {
                  // v18 修复:同时移除 <s>/<strike> 元素(老 DOM 残留)+ CSS line-through
                  // 细粒度：仅移除 line-through，保留 underline（如有）
                  // v41 Fix 2B: 恢复 savedRange
                  restoreSelectionIfValid();
                  // v48 Fix 1: 统一保存选区(同 B 按钮 DISABLE 路径)
                  // v49 Phase C2 Fix: 使用 Comment 节点 bookmark 标记法(同 B 按钮)
                  let markersS: { startMarker: Comment; endMarker: Comment } | null = null;
                  {
                    const selSm = window.getSelection();
                    if (selSm && selSm.rangeCount > 0) {
                      const rSm = selSm.getRangeAt(0);
                      if (el!.contains(rSm.startContainer) && el!.contains(rSm.endContainer)) {
                        try { markersS = insertMarkersAtRange(rSm); } catch {}
                      }
                    }
                  }
                  removeTextDecorationPartNoFocus(el!, 'line-through', { skipFocus: true, skipSelectionRestore: true });
                  removeInlineTagNoFocus(el!, 's', { skipFocus: true, skipSelectionRestore: true });
                  removeInlineTagNoFocus(el!, 'strike', { skipFocus: true, skipSelectionRestore: true });
                  // v49 Phase C2 Fix: 通过 markers 恢复选区(同 B 按钮)
                  if (markersS) {
                    try { restoreSelectionFromMarkers(markersS.startMarker, markersS.endMarker); } catch {}
                  }
                  // v49 Phase C2 Fix: 同 B 按钮,统一 dispatchInput
                  try { dispatchInput(el!); } catch {}
                  // v18 修复:用 spread 保留其他样式(互不影响)
                  const cur = useEditorStore.getState().activeStyles;
                  useEditorStore.getState().setActiveStyles({ ...cur, strike: false });
                  // v19: 刷新 cursorStyles
                  useEditorStore.getState().setCursorStyles({ strike: false });
                  // v41 Fix 2A: 保持锁定(同 bold 分支)
                  useEditorStore.getState().lockActiveStyles();
                } else {
                  // 细粒度:追加 line-through,保留 underline(如有)
                  // v25d 重写后 applyTextDecorationPartNoFocus 一定能处理裸文本
                  // v41 Fix 2C: 恢复 savedRange(与 B/I ENABLE 路径对齐)
                  restoreSelectionIfValid();
                  applyTextDecorationPartNoFocus(el!, 'line-through', { skipFocus: true });
                  if (el) {
                    // v18 修复:用 spread 保留其他样式
                    const cur = useEditorStore.getState().activeStyles;
                    useEditorStore.getState().setActiveStyles({ ...cur, strike: isStrikeFullyActive() });
                  }
                  useEditorStore.getState().lockActiveStyles();
                }
              }
            }}
            active={activeStrike}
            style={{ textDecoration: 'line-through' }}
          >
            S
          </ToolbarBtn>
          <ToolbarBtn
            title={isCollapsedSelection() ? '请先选中文本' : '上标 [sup]…[/sup]'}
            active={activeSup && !isCollapsedSelection()}
            disabled={isCollapsedSelection()}
            onClick={() => {
              // 一次性：仅在有选区时执行，不锁定 activeStyles（不影响下次输入）
              withEditor((ed) => document.execCommand('superscript', false));
              // 同步当前 sup/sub 状态（不锁定）
              const el = editorElRef.current;
              if (el) {
                useEditorStore.getState().setActiveStyles({
                  sup: isSupActive(),
                  sub: isSubActive(),
                });
              }
            }}
            style={{ fontSize: 11 }}
          >
            X²
          </ToolbarBtn>
          <ToolbarBtn
            title={isCollapsedSelection() ? '请先选中文本' : '下标 [sub]…[/sub]'}
            active={activeSub && !isCollapsedSelection()}
            disabled={isCollapsedSelection()}
            onClick={() => {
              // 一次性：仅在有选区时执行，不锁定 activeStyles（不影响下次输入）
              withEditor((ed) => document.execCommand('subscript', false));
              const el = editorElRef.current;
              if (el) {
                useEditorStore.getState().setActiveStyles({
                  sup: isSupActive(),
                  sub: isSubActive(),
                });
              }
            }}
            style={{ fontSize: 11 }}
          >
            X₂
          </ToolbarBtn>
        </div>

        <GroupDivider />

        <div style={groupContainer}>
          {/* 颜色：24 色，NGA 标准，带色块下拉 */}
          <div style={{ position: 'relative' }} ref={colorPickerRef}>
            <ToolbarBtn
              title="文字颜色"
              onClick={() => setColorPickerOpen((v) => !v)}
              active={colorPickerOpen}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  // 改动 2：暗色模式下当前色为黑色时，按钮上显示白色（与下拉弹窗一致）
                  background: (() => {
                    const found = NGA_COLORS.find((c) => c.value === activeColorNgaName);
                    if (!found) return isDark ? '#fff' : '#000';
                    if (found.value === 'black' && isDark) return '#ffffff';
                    return found.cssColor;
                  })(),
                  border: '1px solid var(--border-color)',
                  verticalAlign: 'middle',
                  marginRight: 2,
                }}
              />
              <span className="tb-label">颜色</span>
            </ToolbarBtn>
            {colorPickerOpen && (
              <div style={{ ...popoverPanel, top: 30, left: 0, minWidth: 220, flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                {NGA_COLORS.map((c, idx) => {
                  // 改动 2：最后一个色块（黑色）根据主题翻转：
                  // - 暗色模式：value='white', cssColor='#ffffff'（显示白色 + 应用白色）
                  // - 亮色模式：value='black', cssColor='#000000'（显示黑色 + 应用黑色）
                  // 用户原话：夜间模式点击白色色块输出的字色应该是白色
                  const isLast = idx === NGA_COLORS.length - 1;
                  const effectiveCssColor = isLast && isDark ? '#ffffff' : c.cssColor;
                  const displayColor = effectiveCssColor;
                  // 防御性边框：暗色背景下所有色块加亮色细边，避免相近色混淆
                  const baseBorder = isDark
                    ? 'rgba(255,255,255,0.25)'
                    : 'rgba(0,0,0,0.1)';
                  return (
                    <button
                      key={c.value}
                      onClick={() => {
                        // Word 模式：
                        // 1. 有选区：直接应用颜色（不切换），与 toggleColor 不同
                        // 2. 无选区：仅同步 activeStyles，下一次输入自动应用
                        // skipFocus: 弹窗关闭后让编辑器仍可保留当前选区视觉高亮
                        applyInlineStylePreservingFocus({ color: effectiveCssColor });
                        useEditorStore.getState().setActiveStyles({ color: effectiveCssColor });
                        useEditorStore.getState().lockActiveStyles();
                        setColorPickerOpen(false);
                      }}
                      title={isLast && isDark ? '白色' : c.label}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 4,
                        background: displayColor,
                        border:
                          c.value === activeColorNgaName
                            ? '2px solid var(--accent)'
                            : `1px solid ${baseBorder}`,
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {/* 字号：6 档百分比 + 自定义百分比（成组美化 #7） */}
          <div
            style={fontSizeGroupStyle}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            <span className="tb-label">字号</span>

            {/* 自定义字号百分比（input + range 滑动条 20-500%） */}
            <input
              ref={fontSizeInputRef}
              type="number"
              min={20}
              max={500}
              step={1}
              value={fontSizeInputValue}
              onChange={(e) => {
                const raw = e.target.value;
                // 立即更新本地态，允许任意整数（含 < 20 / > 500 / 空 / 非法）
                setFontSizeInputValue(raw);
                if (raw === '') return;
                const v = parseInt(raw, 10);
                if (isNaN(v)) return;
                // 仅在 20-500 范围内实时应用到选区；越界仅更新显示，失焦时再钳位
                if (v < 20 || v > 500) return;
                handleFontSizeChange(v, { skipFocus: true });
              }}
              style={{
                width: 48,
                fontSize: 12,
                padding: '3px 4px',
                borderRadius: 4,
                border: '1px solid var(--border-color, #e5e7eb)',
                background: 'var(--bg-card, #fff)',
                color: 'var(--text-primary, #111)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-bg, rgba(37,99,235,0.15))';
              }}
              onBlur={() => {
                // 失焦时把越界值钳到 20-500，再应用到选区
                let v = parseInt(fontSizeInputValue, 10);
                if (isNaN(v)) v = 20;
                const clamped = Math.max(20, Math.min(500, v));
                if (String(clamped) !== fontSizeInputValue) {
                  setFontSizeInputValue(String(clamped));
                }
                // 若原值越界（<20 或 >500），需要主动应用一次（onChange 中已跳过）
                // 若原值在范围内，onChange 已应用过；但这里统一再应用一次以保证状态一致
                if (clamped !== v || isNaN(parseInt(fontSizeInputValue, 10))) {
                  handleFontSizeChange(clamped, { skipFocus: true });
                } else {
                  // 即使没变也调用一次（确保锁定的 activeStyles 仍反映当前值）
                  handleFontSizeChange(clamped, { skipFocus: true });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              title="输入 20-500 的整数；按 Enter 确认；输入中允许任意整数，失焦时自动钳到 20%"
            />
            {/* 字号左右滑动条 */}
            <input
              type="range"
              min={20}
              max={500}
              step={1}
              value={activeFontSizePct}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (isNaN(v)) return;
                setFontSizeInputValue(String(v)); // 同步本地态
                handleFontSizeChange(v, { skipFocus: true });
              }}
              style={{
                width: 80,
                accentColor: 'var(--accent)',
                cursor: 'pointer',
                margin: '0 2px',
              }}
              title="拖动调整字号 20%-500%"
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted, #999)', marginRight: 2 }}>%</span>
          </div>

          {/* 字体：16 字体 */}
          <span className="tb-label">字体</span>
          <select
            value={activeFontNga}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const cssFamily = ngaFontToCSS(v);
              // Word 模式：直接应用字体（不切换），无选区时仅同步 activeStyles
              // skipFocus: 不抢 select 焦点，让 select 关闭后仍能看到选区变化
              applyInlineStylePreservingFocus({ fontFamily: cssFamily });
              useEditorStore.getState().setActiveStyles({ fontFamily: cssFamily });
              useEditorStore.getState().lockActiveStyles();
            }}
            style={{ ...selectNga, minWidth: 96 }}
            title="字体"
          >
            {NGA_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <GroupDivider />

        <div style={groupContainer}>
          <ToolbarBtn
            title="无序列表 [list]"
            onClick={() => withEditor(execInsertUnorderedList)}
            active={activeUL}
          >
            • <span className="tb-label">列表</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="有序列表 [list=1]"
            onClick={() => withEditor(execInsertOrderedList)}
            active={activeOL}
          >
            1. <span className="tb-label">列表</span>
          </ToolbarBtn>

          <ToolbarBtn
            title="左对齐"
            onClick={() => withEditor((ed) => setBlockAlign(ed, 'left'))}
            active={activeAlign === 'left'}
          >
            ⬅
          </ToolbarBtn>
          <ToolbarBtn
            title="居中"
            onClick={() => withEditor((ed) => setBlockAlign(ed, 'center'))}
            active={activeAlign === 'center'}
          >
            ↔
          </ToolbarBtn>
          <ToolbarBtn
            title="右对齐"
            onClick={() => withEditor((ed) => setBlockAlign(ed, 'right'))}
            active={activeAlign === 'right'}
          >
            ➡
          </ToolbarBtn>
        </div>
        <ToolbarBtn
          title="折叠所有样式工具"
          onClick={() => setStyleRowCollapsed((v) => !v)}
          style={{ marginLeft: 'auto', minWidth: 24, fontSize: 12 }}
        >
          ▾ 样式
        </ToolbarBtn>
      </div>
      )}

      {/* 第二行：图片(含尺寸)/骰子/表情/引用/折叠/表格/代码/链接/上下标/导入/分割线/撤销/重做/清格式 */}
      {!styleRowCollapsed && (
      <div style={rowContainer}>
        {/* 图片 + 尺寸下拉 */}
        <div style={{ position: 'relative' }} ref={imageSizeRef}>
          <ToolbarBtn
            title="插入图片（带尺寸）"
            onClick={() => setImageSizeOpen((v) => !v)}
            active={imageSizeOpen}
          >
            🖼 <span className="tb-label">图片</span>
          </ToolbarBtn>
          {imageSizeOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0, minWidth: 220 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                插入尺寸（导出时拼到 URL 后缀）
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {NGA_IMAGE_SIZES.map((s) => (
                  <label
                    key={s.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="image-size"
                      checked={imageSize === s.value}
                      onChange={() => setImageSize(s.value)}
                    />
                    {s.label}
                    {s.suffix && (
                      <code style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        {s.suffix}
                      </code>
                    )}
                  </label>
                ))}
              </div>
              {/* 对齐方式 */}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  对齐方式（作用于选中图片）
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <ToolbarBtn
                    onClick={() => withEditor((ed) => setImageBlockAlign(ed, 'left'))}
                    title="左对齐"
                  >
                    ⬅
                  </ToolbarBtn>
                  <ToolbarBtn
                    onClick={() => withEditor((ed) => setImageBlockAlign(ed, 'center'))}
                    title="居中"
                  >
                    ↔
                  </ToolbarBtn>
                  <ToolbarBtn
                    onClick={() => withEditor((ed) => setImageBlockAlign(ed, 'right'))}
                    title="右对齐"
                  >
                    ➡
                  </ToolbarBtn>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 8 }}>
                <ToolbarBtn
                  onClick={handlePickFile}
                  disabled={isLocalUploadDisabled}
                  title={isLocalUploadDisabled ? localUploadDisabledReason : '从本机选择图片'}
                >
                  本地上传
                </ToolbarBtn>
                <ToolbarBtn
                  onClick={() => {
                    setImageSizeOpen(false);
                    setShowUrlBox(true);
                  }}
                >
                  用 URL
                </ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        <ToolbarBtn title="插入骰子 (Ctrl+Shift+D)" onClick={onInsertDice}>
          🎲 <span className="tb-label">骰子</span>
        </ToolbarBtn>

        <ToolbarBtn
          title="从 NGA 文本导入选项（粘贴收集的安价文本，自动生成选项骰子）"
          onClick={() => setShowNGAImport(true)}
        >
          📥 <span className="tb-label">导入安价</span>
        </ToolbarBtn>

        <GroupDivider />

        {/* 表情 */}
        <div style={{ position: 'relative' }} ref={smileyRef}>
          <ToolbarBtn
            title="插入表情 [s:表情包名:表情]"
            onClick={() => setSmileyOpen((v) => !v)}
            active={smileyOpen}
          >
            😄 <span className="tb-label">表情</span>
          </ToolbarBtn>
          {smileyOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                表情包名 / 表情名
              </div>
              <input
                autoFocus
                value={smileyPack}
                onChange={(e) => setSmileyPack(e.target.value)}
                placeholder="表情包名（如 熊猫头）"
                style={popoverInput}
              />
              <input
                value={smileyFace}
                onChange={(e) => setSmileyFace(e.target.value)}
                placeholder="表情名（如 开心）"
                style={popoverInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSmileyConfirm();
                }}
              />
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <ToolbarBtn onClick={handleSmileyConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setSmileyOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        {/* 引用（行级，#f2eddf） */}
        <ToolbarBtn
          title="引用 (Ctrl+Shift+Q)"
          onClick={() => withEditor(insertQuoteBlock)}
        >
          ❝ <span className="tb-label">引用</span>
        </ToolbarBtn>

        {/* 折叠 */}
        <div style={{ position: 'relative' }} ref={collapseRef}>
          <ToolbarBtn
            btnRef={collapseBtnRef}
            title="折叠 (Ctrl+Shift+C)"
            onClick={() => setCollapseOpen((v) => !v)}
            active={collapseOpen}
          >
            ▾ <span className="tb-label">折叠</span>
          </ToolbarBtn>
          {collapseOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                折叠标题（可空）
              </div>
              <input
                autoFocus
                value={collapseTitle}
                onChange={(e) => setCollapseTitle(e.target.value)}
                placeholder="标题"
                style={popoverInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCollapseConfirm();
                }}
              />
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <ToolbarBtn onClick={handleCollapseConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setCollapseOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        {/* 表格（行/列 popover，默认 3x3） */}
        <div style={{ position: 'relative' }} ref={tableRef}>
          <ToolbarBtn
            title="插入表格（自定义行/列）"
            onClick={() => setTableOpen((v) => !v)}
            active={tableOpen}
          >
            ▦ <span className="tb-label">表格</span>
          </ToolbarBtn>
          {tableOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0, minWidth: 220 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                行 / 列（默认 3×3）
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12 }}>行</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={tableRows}
                  onChange={(e) =>
                    setTableRows(
                      Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)),
                    )
                  }
                  style={{ ...popoverInput, width: 60 }}
                />
                <label style={{ fontSize: 12 }}>列</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={tableCols}
                  onChange={(e) =>
                    setTableCols(
                      Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)),
                    )
                  }
                  style={{ ...popoverInput, width: 60 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <ToolbarBtn onClick={handleTableConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setTableOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        {/* 代码 */}
        <ToolbarBtn
          title="代码块 [code]…[/code]（#f1f1f1）"
          onClick={() => withEditor((ed) => insertCodeBlock(ed, ''))}
        >
          ⟨/⟩ <span className="tb-label">代码</span>
        </ToolbarBtn>

        {/* 链接 */}
        <div style={{ position: 'relative' }} ref={linkRef}>
          <ToolbarBtn
            title="插入链接 [url=链接]文字[/url]"
            onClick={() => setLinkOpen((v) => !v)}
            active={linkOpen}
          >
            🌐 <span className="tb-label">链接</span>
          </ToolbarBtn>
          {linkOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>链接地址</div>
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                style={popoverInput}
              />
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>显示文字（可空）</div>
              <input
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="显示文字（空则用 URL）"
                style={popoverInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLinkConfirm();
                }}
              />
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <ToolbarBtn onClick={handleLinkConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setLinkOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        <ToolbarBtn
          title="取消链接"
          onClick={() => withEditor(removeLinkAtCursor)}
        >
          ⛔ <span className="tb-label">取消链接</span>
        </ToolbarBtn>

        <GroupDivider />

        <div style={groupContainer}>
          <ToolbarBtn
            title="撤销 (Ctrl+Z)"
            disabled={!canUndo}
            onClick={() => onUndo?.()}
          >
            ↶ <span className="tb-label">撤销</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="重做 (Ctrl+Y)"
            disabled={!canRedo}
            onClick={() => onRedo?.()}
          >
            ↷ <span className="tb-label">重做</span>
          </ToolbarBtn>
        </div>

        <GroupDivider />

        <div style={groupContainer}>
          <ToolbarBtn
            title="分割线 [h][/h]"
            onClick={() => withEditor(insertHorizontalRuleNGA)}
          >
            — <span className="tb-label">分割线</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="清除格式"
            onClick={() => {
              // 用保存的 range 判断点击前的选区状态（工具栏点击会让编辑器失焦）
              const saved = savedRangeRef?.current;
              const collapsed = !saved || saved.collapsed;
              withEditor(execRemoveFormat);
              if (collapsed) {
                // 无选区：重置工具栏样式状态到默认
                useEditorStore.getState().clearActiveStyles();
                useEditorStore.getState().unlockActiveStyles();
                useEditorStore.getState().setCursorStyles({});
              }
              // 有选区：仅清选中文本格式，工具栏由 cursorStyles 后续自然同步
              // 同步 cursorStyles 到清格式后的光标处实际样式
              const el = editorElRef.current;
              if (el) {
                const cur = getCurrentStyles(el);
                useEditorStore.getState().setCursorStyles(cur);
              }
            }}
          >
            ⌫ <span className="tb-label">清格式</span>
          </ToolbarBtn>
        </div>

        {showUrlBox && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 8,
            }}
          >
            <input
              type="text"
              value={urlInput}
              placeholder="粘贴图片 URL..."
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUrlConfirm();
              }}
              style={{
                height: 24,
                padding: '0 8px',
                fontSize: 12,
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                minWidth: 240,
                background: 'var(--bg-card)',
              }}
            />
            <ToolbarBtn onClick={handleUrlConfirm}>插入</ToolbarBtn>
            <ToolbarBtn onClick={() => setShowUrlBox(false)}>取消</ToolbarBtn>
          </div>
        )}
      </div>
      )}

      {/* 上传进度弹窗 */}
      <UploadProgressDialog
        open={uploadDialogOpen}
        tasks={uploadTasks}
        onClose={() => setUploadDialogOpen(false)}
      />

      {/* 本地上传警告弹窗已移到 App 顶层统一管理（订阅 imageWarningStore） */}

      {/* NGA 安价导入弹窗 */}
      <DiceNGAImportDialog
        open={showNGAImport}
        onClose={() => setShowNGAImport(false)}
        onConfirm={(options) => {
          setShowNGAImport(false);
          // 打开骰子配置弹窗（由父组件 EditorPage 渲染）
          // - store 中预填选项（DiceConfigDialog 会自动读 store 中的 draft）
          // - faces 自动 = options.length
          useDiceStore.getState().openDialog({
            initialKind: 'option',
            initialOptions: options,
          });
        }}
      />
    </div>
  );
}
