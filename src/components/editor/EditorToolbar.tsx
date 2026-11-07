import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Superscript,
  Subscript,
  Dices,
  Image as ImageIcon,
  Import,
  Smile,
  Quote,
  ChevronDown,
  Table,
  Code,
  Link,
  Unlink,
  Undo2,
  Redo2,
  Minus,
  Eraser,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
} from 'lucide-react';
import {
  NGA_FONTS,
  NGA_COLORS,
  NGA_IMAGE_SIZES,
  NGA_DEFAULT_FONT,
  NGA_DEFAULT_FONT_SIZE,
  NGA_DEFAULT_COLOR,
  NGA_DEFAULT_IMAGE_SIZE,
  ngaColorToCSS,
  percentToCssFontSize,
} from '../../types';
import {
  // 选区 ALL 语义判定：供工具栏激活态（B/I/U/S 高亮）实时计算使用
  isBoldFullyActive,
  isItalicFullyActive,
  isUnderlineFullyActive,
  isStrikeFullyActive,
} from '../../editor/tiptap/selectionPredicates';
import { createAnkeToolbarCommands, type AnkeToolbarCommands } from '../../editor/tiptap/toolbarCommands';
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
  /** Tiptap（ProseMirror）编辑器实例 */
  editor?: Editor | null;
  /**
   * 兼容保留：调用方（TiptapEditorPane / 测试）仍会传入，
   * 迁移到 Tiptap 内核后本组件内部已不再使用该引用。
   */
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
  /** 样式面板折叠态（受控；不传时内部自行管理，默认移动端折叠） */
  collapsed?: boolean;
  /** 切换样式面板折叠态（受控时必传） */
  onToggleCollapsed?: () => void;
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
  minWidth: 30,
  height: 26,
  padding: '0 6px',
  fontSize: 12,
  border: '2px solid transparent',
  background: 'transparent',
  color: 'var(--an-ink)',
  borderRadius: 8,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  userSelect: 'none',
  lineHeight: 1,
  transition: 'background 0.12s ease, transform 0.12s ease',
};

const toolbarBtnHover = { background: 'var(--an-pink-soft)' };
// 选中态：贴纸胶囊（粉底 + 墨线 + 硬投影）
const toolbarBtnActive: React.CSSProperties = {
  background: 'var(--an-pink)',
  borderColor: 'var(--an-ink)',
  color: '#fff',
  fontWeight: 700,
  boxShadow: '0 2px 0 var(--an-ink)',
};

const selectNga: React.CSSProperties = {
  height: 26,
  padding: '0 6px',
  fontSize: 12,
  border: '2px solid var(--an-ink)',
  background: 'var(--an-card)',
  color: 'var(--an-ink)',
  borderRadius: 8,
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
  borderRadius: 999,
  background: 'var(--an-card)',
  border: '2px solid var(--an-ink)',
  transition: 'border-color 0.15s',
};

const rowContainer: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
  alignItems: 'center',
  padding: '5px 0',
};

const groupContainer: React.CSSProperties = {
  display: 'inline-flex',
  gap: 3,
  alignItems: 'center',
};

const popoverPanel: React.CSSProperties = {
  position: 'absolute',
  zIndex: 50,
  background: 'var(--an-card)',
  border: '2px solid var(--an-ink)',
  borderRadius: 'var(--an-radius-sm)',
  padding: 10,
  boxShadow: 'var(--an-shadow-pop), var(--an-shadow-soft)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 220,
};

const popoverInput: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  fontSize: 12,
  border: '2px solid var(--an-ink)',
  borderRadius: 8,
  background: 'var(--an-paper)',
  color: 'var(--an-ink)',
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
      className="inline-block w-[1px] h-[16px] bg-[var(--border-color)] my-[0px] mx-[6px]"
    />
  );
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

/**
 * 工具栏激活态选择器（S12）：事务驱动重渲染。
 *
 * 背景：删除工具栏内本地 useEditor 后，工具栏失去了「选区变化 → 重渲染」的触发源。
 * TiptapEditorPane 只在 cursorStyles 真正变化时才写 store（`if (!same)`），
 * 因此把光标从普通段落移到列表项时 store 不更新，activeUL/activeOL/activeAlign
 * 以及依赖选区的上标/下标禁用态会变陈旧。
 *
 * 这里订阅 editor 事务，仅在下列切片变化时重渲染：
 *   - from/to   ：选区范围（保证选区折叠态/上标下标禁用态实时刷新）
 *   - isBulletList / isOrderedList / textAlign：列表与对齐高亮
 * 选择器定义在模块作用域，保持引用稳定，避免每次渲染重建订阅。
 */
function selectToolbarActiveState({ editor }: { editor: Editor | null }) {
  if (!editor) {
    return {
      from: 0,
      to: 0,
      isBulletList: false,
      isOrderedList: false,
      textAlign: 'left' as string,
    };
  }
  const sel = editor.state.selection;
  return {
    from: sel.from,
    to: sel.to,
    isBulletList: editor.isActive('bulletList'),
    isOrderedList: editor.isActive('orderedList'),
    textAlign:
      (editor.getAttributes('paragraph').textAlign as string | undefined) ??
      (editor.getAttributes('imageBlock').textAlign as string | undefined) ??
      'left',
  };
}

export function EditorToolbar({
  editor: tiptapEditor = null,
  savedRangeRef,
  onInsertImage,
  onInsertDice,
  onShowToast,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onShortcutReady,
  collapsed: collapsedProp,
  onToggleCollapsed,
}: EditorToolbarProps) {
  const [urlInput, setUrlInput] = useState('');
  const [showUrlBox, setShowUrlBox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [styleRowCollapsedInternal, setStyleRowCollapsedInternal] = useState(
    () => {
      if (typeof window === 'undefined') return false;
      return window.innerWidth < 768;
    }
  );
  const styleRowCollapsed = collapsedProp ?? styleRowCollapsedInternal;
  const toggleStyleRow = () => {
    if (onToggleCollapsed) onToggleCollapsed();
    else setStyleRowCollapsedInternal((v) => !v);
  };

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

  // 激活态：列表 / 对齐（Tiptap 内核，等价于旧 DOM 判定）
  // S12：改为 useEditorState 订阅事务驱动重渲染，取数与 TiptapEditorPane 的 store
  // 更新策略解耦（store 仅在 cursorStyles 真正变化时写入，不能作为唯一重渲染源）。
  const toolbarActiveState = useEditorState({
    editor: tiptapEditor,
    selector: selectToolbarActiveState,
  });
  const activeUL = toolbarActiveState?.isBulletList ?? false;
  const activeOL = toolbarActiveState?.isOrderedList ?? false;
  const activeAlign = toolbarActiveState?.textAlign ?? 'left';

  // 判断当前编辑器选区是否折叠（无选区或光标处）
  // v26:改为 function declaration 以支持 hoisting(active state 计算在文件更早位置需要)
  function isCollapsedSelection(): boolean {
    const sel = window.getSelection();
    if (!sel) return true;
    if (sel.isCollapsed) return true;
    return false;
  }

  const showToast = (msg: string) => {
    onShowToast?.(msg);
  };

  // ------------------------------------------------------------
  // Tiptap 内核命令桥（改造方案 S8）：工具栏「命令层」分派点
  //   传入 editor（TiptapEditorPane）→ 走 ProseMirror 事务；
  //   首帧 editor 尚未初始化时（ttCmd 为 null）相关命令为空操作。
  //   UI / 图标 / 布局 / 折叠行为完全不变，只替换命令调用层。
  // ------------------------------------------------------------
  const ttCmd: AnkeToolbarCommands | null = tiptapEditor
    ? createAnkeToolbarCommands({ getEditor: () => tiptapEditor, onToast: showToast })
    : null;

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
        if (onToggleCollapsed) {
          if (styleRowCollapsed) onToggleCollapsed();
        } else {
          setStyleRowCollapsedInternal(false);
        }
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

  const handleInsertImageWithSize = (src: string, _name?: string) => {
    if (!src) return;
    // Tiptap 内核：走 RichTextEditorCommands.insertImage（内部 insertContent 事务）
    if (tiptapEditor) {
      onInsertImage(src, imageSize);
    }
  };

  const handleUrlConfirm = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (tiptapEditor) {
      onInsertImage(url, imageSize);
    }
    setUrlInput('');
    setShowUrlBox(false);
  };

  // 字号改变：实时应用到选区（Tiptap 事务）
  //   editor 尚未初始化的首帧：仅同步 activeStyles（不触碰 DOM 命令）
  const handleFontSizeChange = (percent: number, _opts: { skipFocus?: boolean } = {}): void => {
    if (ttCmd) {
      ttCmd.setFontSizePercent(percent);
      return;
    }
    const cssSize = percentToCssFontSize(percent);
    useEditorStore.getState().setActiveStyles({ fontSize: cssSize });
    useEditorStore.getState().lockActiveStyles();
  };

  const handleSmileyConfirm = () => {
    const safePack = (smileyPack || '').trim() || '表情包';
    const safeFace = (smileyFace || '').trim() || '表情';
    const text = `[s:${safePack}:${safeFace}]`;
    if (ttCmd) {
      ttCmd.insertText(text);
      setSmileyPack('');
      setSmileyFace('');
      setSmileyOpen(false);
      showToast('已插入表情');
      return;
    }
    setSmileyPack('');
    setSmileyFace('');
    setSmileyOpen(false);
    showToast('已插入表情');
  };

  const handleLinkConfirm = () => {
    const url = linkUrl.trim();
    if (!url) return;
    if (ttCmd) {
      ttCmd.insertLink(url, linkLabel);
    }
    setLinkUrl('');
    setLinkLabel('');
    setLinkOpen(false);
  };

  const handleCollapseConfirm = () => {
    if (ttCmd) {
      ttCmd.insertCollapse(collapseTitle);
    }
    setCollapseTitle('');
    setCollapseOpen(false);
  };

  const handleTableConfirm = () => {
    if (ttCmd) {
      ttCmd.insertTable(tableRows, tableCols);
    }
    setTableOpen(false);
  };

  return (
    <div
      className="flex flex-col py-[6px] px-[12px] bg-[var(--bg-toolbar)] border-b border-b-[color:var(--border-color)] relative mobile-toolbar-root"
    >
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleFile}
        className="absolute top-0 left-0 w-[1px] h-[1px] opacity-[0] overflow-hidden border-[0px] p-[0px] pointer-events-none"
      />

      {/* 折叠状态下：样式开关由外部（编辑区「导出图片」工具行）承载，这里不再占用整行 */}
      {styleRowCollapsed && collapsedProp === undefined && (
        <div className="flex justify-end py-[2px]">
          <ToolbarBtn
            title="展开所有样式工具"
            onClick={toggleStyleRow}
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
              if (ttCmd) {
                ttCmd.toggleSimpleMark('bold');
                return;
              }
            }}
            active={activeBold}
          >
            <Bold size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            btnRef={italicBtnRef}
            title="斜体 (Ctrl+I)"
            onClick={() => {
              if (ttCmd) {
                ttCmd.toggleSimpleMark('italic');
                return;
              }
            }}
            active={activeItalic}
          >
            <Italic size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            btnRef={underlineBtnRef}
            title="下划线 (Ctrl+U)"
            onClick={() => {
              if (ttCmd) {
                ttCmd.toggleSimpleMark('underline');
                return;
              }
            }}
            active={activeUnderline}
          >
            <Underline size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            btnRef={strikeBtnRef}
            title="删除线 (Ctrl+Shift+S)"
            onClick={() => {
              if (ttCmd) {
                ttCmd.toggleSimpleMark('strike');
                return;
              }
            }}
            active={activeStrike}
          >
            <Strikethrough size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            title={isCollapsedSelection() ? '请先选中文本' : '上标 [sup]…[/sup]'}
            active={activeSup && !isCollapsedSelection()}
            disabled={isCollapsedSelection()}
            onClick={() => {
              if (ttCmd) {
                ttCmd.toggleScriptMark('superscript');
                return;
              }
            }}
          >
            <Superscript size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            title={isCollapsedSelection() ? '请先选中文本' : '下标 [sub]…[/sub]'}
            active={activeSub && !isCollapsedSelection()}
            disabled={isCollapsedSelection()}
            onClick={() => {
              if (ttCmd) {
                ttCmd.toggleScriptMark('subscript');
                return;
              }
            }}
          >
            <Subscript size={14} />
          </ToolbarBtn>
        </div>

        <GroupDivider />

        <div style={groupContainer}>
          {/* 颜色：24 色，NGA 标准，带色块下拉 */}
          <div className="relative" ref={colorPickerRef}>
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
                  borderRadius: 'var(--radius-chip)',
                  // 改动 2：暗色模式下当前色为黑色时，按钮上显示白色（与下拉弹窗一致）
                  background: (() => {
                    const found = NGA_COLORS.find((c) => c.value === activeColorNgaName);
                    if (!found) return 'var(--text-primary)';
                    if (found.value === 'black' && isDark) return 'var(--text-primary)';
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
                    ? 'var(--on-accent-border)'
                    : 'var(--swatch-border)';
                  return (
                    <button
                      key={c.value}
                      onClick={() => {
                        if (ttCmd) {
                          ttCmd.setColor(effectiveCssColor);
                        }
                        setColorPickerOpen(false);
                      }}
                      title={isLast && isDark ? '白色' : c.label}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 'var(--radius-sm)',
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
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-bg)';
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
            <span className="text-[12px] text-[var(--text-muted)] mr-[2px]">%</span>
          </div>

          {/* 字体：16 字体 */}
          <span className="tb-label">字体</span>
          <select
            value={activeFontNga}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (ttCmd) {
                ttCmd.setFontFamily(v);
                return;
              }
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
            onClick={() => {
              if (ttCmd) {
                ttCmd.setList('bullet');
                return;
              }
            }}
            active={activeUL}
          >
            • <span className="tb-label">列表</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="有序列表 [list=1]"
            onClick={() => {
              if (ttCmd) {
                ttCmd.setList('ordered');
                return;
              }
            }}
            active={activeOL}
          >
            1. <span className="tb-label">列表</span>
          </ToolbarBtn>

          <ToolbarBtn
            title="左对齐"
            onClick={() => {
              if (ttCmd) {
                ttCmd.setAlign('left');
                return;
              }
            }}
            active={activeAlign === 'left'}
          >
            <ArrowLeft size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            title="居中"
            onClick={() => {
              if (ttCmd) {
                ttCmd.setAlign('center');
                return;
              }
            }}
            active={activeAlign === 'center'}
          >
            <ArrowLeftRight size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            title="右对齐"
            onClick={() => {
              if (ttCmd) {
                ttCmd.setAlign('right');
                return;
              }
            }}
            active={activeAlign === 'right'}
          >
            <ArrowRight size={14} />
          </ToolbarBtn>
        </div>
        <ToolbarBtn
          title="折叠所有样式工具"
          onClick={toggleStyleRow}
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
        <div className="relative" ref={imageSizeRef}>
          <ToolbarBtn
            title="插入图片（带尺寸）"
            onClick={() => setImageSizeOpen((v) => !v)}
            active={imageSizeOpen}
          >
            <ImageIcon size={14} /> <span className="tb-label">图片</span>
          </ToolbarBtn>
          {imageSizeOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0, minWidth: 220 }}>
              <div className="text-[12px] text-[var(--text-secondary)]">
                插入尺寸（导出时拼到 URL 后缀）
              </div>
              <div className="flex flex-col gap-[4px]">
                {NGA_IMAGE_SIZES.map((s) => (
                  <label
                    key={s.value}
                    className="flex items-center gap-[6px] text-[12px] text-[var(--text-primary)] cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="image-size"
                      checked={imageSize === s.value}
                      onChange={() => setImageSize(s.value)}
                    />
                    {s.label}
                    {s.suffix && (
                      <code className="text-[12px] text-[var(--text-secondary)]">
                        {s.suffix}
                      </code>
                    )}
                  </label>
                ))}
              </div>
              {/* 对齐方式 */}
              <div className="mt-[8px] pt-[8px] border-t border-t-[color:var(--border-color)]">
                <div className="text-[12px] text-[var(--text-secondary)] mb-[6px]">
                  对齐方式（作用于选中图片）
                </div>
                <div className="flex gap-[4px]">
                  <ToolbarBtn
                    onClick={() => {
                      if (ttCmd) {
                        ttCmd.setImageAlign('left');
                        return;
                      }
                    }}
                    title="左对齐"
                  >
                    <ArrowLeft size={14} />
                  </ToolbarBtn>
                  <ToolbarBtn
                    onClick={() => {
                      if (ttCmd) {
                        ttCmd.setImageAlign('center');
                        return;
                      }
                    }}
                    title="居中"
                  >
                    <ArrowLeftRight size={14} />
                  </ToolbarBtn>
                  <ToolbarBtn
                    onClick={() => {
                      if (ttCmd) {
                        ttCmd.setImageAlign('right');
                        return;
                      }
                    }}
                    title="右对齐"
                  >
                    <ArrowRight size={14} />
                  </ToolbarBtn>
                </div>
              </div>
              <div className="flex gap-[4px] justify-end mt-[8px]">
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
          <Dices size={14} /> <span className="tb-label">骰子</span>
        </ToolbarBtn>

        <ToolbarBtn
          title="从 NGA 文本导入选项（粘贴收集的安价文本，自动生成选项骰子）"
          onClick={() => setShowNGAImport(true)}
        >
          <Import size={14} /> <span className="tb-label">导入安价</span>
        </ToolbarBtn>

        <GroupDivider />

        {/* 表情 */}
        <div className="relative" ref={smileyRef}>
          <ToolbarBtn
            title="插入表情 [s:表情包名:表情]"
            onClick={() => setSmileyOpen((v) => !v)}
            active={smileyOpen}
          >
            <Smile size={14} /> <span className="tb-label">表情</span>
          </ToolbarBtn>
          {smileyOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0 }}>
              <div className="text-[12px] text-[var(--text-secondary)]">
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
              <div className="flex gap-[4px] justify-end">
                <ToolbarBtn onClick={handleSmileyConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setSmileyOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        {/* 引用（行级，#f2eddf） */}
        <ToolbarBtn
          title="引用 (Ctrl+Shift+Q)"
          onClick={() => {
            if (ttCmd) {
              ttCmd.toggleQuote();
              return;
            }
          }}
        >
          <Quote size={14} /> <span className="tb-label">引用</span>
        </ToolbarBtn>

        {/* 折叠 */}
        <div className="relative" ref={collapseRef}>
          <ToolbarBtn
            btnRef={collapseBtnRef}
            title="折叠 (Ctrl+Shift+C)"
            onClick={() => setCollapseOpen((v) => !v)}
            active={collapseOpen}
          >
            <ChevronDown size={14} /> <span className="tb-label">折叠</span>
          </ToolbarBtn>
          {collapseOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0 }}>
              <div className="text-[12px] text-[var(--text-secondary)]">
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
              <div className="flex gap-[4px] justify-end">
                <ToolbarBtn onClick={handleCollapseConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setCollapseOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        {/* 表格（行/列 popover，默认 3x3） */}
        <div className="relative" ref={tableRef}>
          <ToolbarBtn
            title="插入表格（自定义行/列）"
            onClick={() => setTableOpen((v) => !v)}
            active={tableOpen}
          >
            <Table size={14} /> <span className="tb-label">表格</span>
          </ToolbarBtn>
          {tableOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0, minWidth: 220 }}>
              <div className="text-[12px] text-[var(--text-secondary)]">
                行 / 列（默认 3×3）
              </div>
              <div className="flex gap-[8px] items-center">
                <label className="text-[12px]">行</label>
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
                <label className="text-[12px]">列</label>
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
              <div className="flex gap-[4px] justify-end">
                <ToolbarBtn onClick={handleTableConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setTableOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        {/* 代码 */}
        <ToolbarBtn
          title="代码块 [code]…[/code]（再次点击还原为普通段落）"
          onClick={() => {
            if (ttCmd) {
              ttCmd.setCodeBlock();
              return;
            }
          }}
        >
          <Code size={14} /> <span className="tb-label">代码</span>
        </ToolbarBtn>

        {/* 链接 */}
        <div className="relative" ref={linkRef}>
          <ToolbarBtn
            title="插入链接 [url=链接]文字[/url]"
            onClick={() => setLinkOpen((v) => !v)}
            active={linkOpen}
          >
            <Link size={14} /> <span className="tb-label">链接</span>
          </ToolbarBtn>
          {linkOpen && (
            <div style={{ ...popoverPanel, top: 30, left: 0 }}>
              <div className="text-[12px] text-[var(--text-secondary)]">链接地址</div>
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                style={popoverInput}
              />
              <div className="text-[12px] text-[var(--text-secondary)]">显示文字（可空）</div>
              <input
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="显示文字（空则用 URL）"
                style={popoverInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLinkConfirm();
                }}
              />
              <div className="flex gap-[4px] justify-end">
                <ToolbarBtn onClick={handleLinkConfirm}>插入</ToolbarBtn>
                <ToolbarBtn onClick={() => setLinkOpen(false)}>取消</ToolbarBtn>
              </div>
            </div>
          )}
        </div>

        <ToolbarBtn
          title="取消链接"
          onClick={() => {
            if (ttCmd) {
              ttCmd.unlink();
              return;
            }
          }}
        >
          <Unlink size={14} /> <span className="tb-label">取消链接</span>
        </ToolbarBtn>

        <GroupDivider />

        <div style={groupContainer}>
          <ToolbarBtn
            title="撤销 (Ctrl+Z)"
            disabled={!canUndo}
            onClick={() => onUndo?.()}
          >
            <Undo2 size={14} /> <span className="tb-label">撤销</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="重做 (Ctrl+Y)"
            disabled={!canRedo}
            onClick={() => onRedo?.()}
          >
            <Redo2 size={14} /> <span className="tb-label">重做</span>
          </ToolbarBtn>
        </div>

        <GroupDivider />

        <div style={groupContainer}>
          <ToolbarBtn
            title="分割线 [h][/h]"
            onClick={() => {
              if (ttCmd) {
                ttCmd.insertHorizontalRule();
                return;
              }
            }}
          >
            <Minus size={14} /> <span className="tb-label">分割线</span>
          </ToolbarBtn>
          <ToolbarBtn
            title="清除格式"
            onClick={() => {
              // 用保存的 range 判断点击前的选区状态（工具栏点击会让编辑器失焦）
              const saved = savedRangeRef?.current;
              const collapsed = !saved || saved.collapsed;
              if (ttCmd) {
                ttCmd.clearFormat();
              }
              if (collapsed) {
                // 无选区：重置工具栏样式状态到默认
                useEditorStore.getState().clearActiveStyles();
                useEditorStore.getState().unlockActiveStyles();
                useEditorStore.getState().setCursorStyles({});
              }
              // 有选区：仅清选中文本格式，工具栏由 cursorStyles 后续自然同步
            }}
          >
            <Eraser size={14} /> <span className="tb-label">清格式</span>
          </ToolbarBtn>
        </div>

        {showUrlBox && (
          <div
            className="inline-flex items-center gap-[4px] ml-[8px]"
          >
            <input
              type="text"
              value={urlInput}
              placeholder="粘贴图片 URL..."
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUrlConfirm();
              }}
              className="h-[24px] py-[0px] px-[8px] text-[12px] border border-[color:var(--border-color)] rounded-[var(--radius-sm)] min-w-[240px] bg-[var(--bg-card)]"
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
