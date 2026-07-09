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
} from '../../types';
import {
  execBold,
  execItalic,
  execUnderline,
  execStrikeThrough,
  execRemoveFormat,
  execInsertUnorderedList,
  execInsertOrderedList,
  isBoldActive,
  isItalicActive,
  isUnderlineActive,
  isStrikeActive,
  isSupActive,
  isSubActive,
  getEffectiveColorName,
  getEffectiveFontSizePercent,
  getEffectiveFontFamilyValue,
  getCurrentBlockAlign,
  isInsideList,
  setBlockAlign,
  toggleFontFamily,
  toggleFontSize,
  toggleColor,
  applyColor,
  applyFontSize,
  applyFontFamily,
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
} from './contenteditableUtils';
import { useEditorStore } from '../../store/editorStore';
import { useSettingStore } from '../../store/settingStore';
import { useToastStore } from '../../store/toastStore';
import { useDiceStore } from '../../store/diceStore';
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
const toolbarBtnActive: React.CSSProperties = {
  background: 'var(--accent-soft)',
  borderColor: 'var(--accent)',
  color: 'var(--accent)',
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const base = active
    ? { ...toolbarBtn, ...toolbarBtnActive }
    : { ...toolbarBtn, ...(hover && !disabled ? toolbarBtnHover : {}) };
  return (
    <button
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

  useEffect(() => {
    const onSel = () => {
      const el = ref.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!el.contains(sel.anchorNode)) return;
      setTick((t) => t + 1);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [ref]);

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

  // 上传进度弹窗状态
  const [uploadTasks, setUploadTasks] = useState<UploadProgressEvent[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // NGA 安价导入弹窗状态
  const [showNGAImport, setShowNGAImport] = useState(false);

  // 激活状态 —— Word 行为：
  //   - activeStylesLocked=true 时：优先读 activeStyles（用户主动点击设置的样式意图，后续输入会延续）
  //   - activeStylesLocked=false 时：优先读 cursorStyles（光标处/选区起点的实时样式，由 onSelectionChange 同步）
  //   - 最后 fallback 到 NGA 默认
  const activeStylesFromStore = useEditorStore((s) => s.activeStyles);
  const cursorStylesFromStore = useEditorStore((s) => s.cursorStyles);
  const activeStylesLocked = useEditorStore((s) => s.activeStylesLocked);

  const activeBold = activeStylesLocked
    ? (activeStylesFromStore.bold ?? false)
    : (cursorStylesFromStore.bold ?? activeStylesFromStore.bold ?? false);
  const activeItalic = activeStylesLocked
    ? (activeStylesFromStore.italic ?? false)
    : (cursorStylesFromStore.italic ?? activeStylesFromStore.italic ?? false);
  const activeUnderline = activeStylesLocked
    ? (activeStylesFromStore.underline ?? false)
    : (cursorStylesFromStore.underline ?? activeStylesFromStore.underline ?? false);
  const activeStrike = activeStylesLocked
    ? (activeStylesFromStore.strike ?? false)
    : (cursorStylesFromStore.strike ?? activeStylesFromStore.strike ?? false);
  const activeSup = activeStylesLocked
    ? (activeStylesFromStore.sup ?? false)
    : (cursorStylesFromStore.sup ?? activeStylesFromStore.sup ?? false);
  const activeSub = activeStylesLocked
    ? (activeStylesFromStore.sub ?? false)
    : (cursorStylesFromStore.sub ?? activeStylesFromStore.sub ?? false);

  // 颜色：activeStyles.color (CSS) → cssColorToNga → NGA name；fallback cursorStyles 反查
  // 按 activeStylesLocked 切换优先级（locked 时只读 activeStyles，否则光标处实际样式优先）
  const activeColorNgaName = (() => {
    if (activeStylesLocked) {
      // locked 时只读 activeStyles，不 fallback 到 cursorStyles
      if (activeStylesFromStore.color) {
        const n = cssColorToNga(activeStylesFromStore.color);
        if (n) return n;
      }
      return NGA_DEFAULT_COLOR;
    }
    // 未锁定时优先 cursorStyles，fallback activeStyles
    if (cursorStylesFromStore.color) {
      const n = cssColorToNga(cursorStylesFromStore.color);
      if (n) return n;
    }
    if (activeStylesFromStore.color) {
      const n = cssColorToNga(activeStylesFromStore.color);
      if (n) return n;
    }
    return NGA_DEFAULT_COLOR;
  })();
  // 字号：activeStyles.fontSize (CSS) → ptToSizePercent → 实际百分比（不映射到档位，支持 0-1000% 任意整数）
  // 按 activeStylesLocked 切换优先级（locked 时只读 activeStyles，否则光标处实际样式优先）
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
    if (activeStylesFromStore.fontSize) {
      const pct = ptToSizePercent(activeStylesFromStore.fontSize);
      if (pct != null) return pct;
    }
    return NGA_DEFAULT_FONT_SIZE;
  })();
  // 字体：activeStyles.fontFamily (CSS) → cssFontToNga → NGA value；fallback cursorStyles
  // 按 activeStylesLocked 切换优先级（locked 时只读 activeStyles，否则光标处实际样式优先）
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
    if (activeStylesFromStore.fontFamily) {
      const n = cssFontToNga(activeStylesFromStore.fontFamily);
      if (n) return n;
    }
    return NGA_DEFAULT_FONT;
  })();

  const activeAlign = editor ? getCurrentBlockAlign(editor) : 'left';
  const activeUL = editor ? isInsideList(editor, 'UL') : false;
  const activeOL = editor ? isInsideList(editor, 'OL') : false;

  const withEditor = (fn: (e: HTMLElement) => void): void => {
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
    fn(el);
  };

  // 判断当前编辑器选区是否折叠（无选区或光标处）
  const isCollapsedSelection = (): boolean => {
    const sel = window.getSelection();
    if (!sel) return true;
    if (sel.isCollapsed) return true;
    return false;
  };

  // 简单样式切换：在无选区时主动翻转 activeStyles，让下一次输入自动应用
  const toggleSimpleActiveStyle = (key: 'bold' | 'italic' | 'underline' | 'strike'): void => {
    if (!isCollapsedSelection()) return; // 有选区由 execCommand 处理
    const cur = useEditorStore.getState().activeStyles;
    useEditorStore.getState().setActiveStyles({ [key]: !cur[key] } as any);
    // 锁定 activeStyles，防止 keyup 覆盖用户选择
    useEditorStore.getState().lockActiveStyles();
  };

  const showToast = (msg: string) => {
    onShowToast?.(msg);
  };

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

  const handleSmileyConfirm = () => {
    const safePack = (smileyPack || '').trim() || '表情包';
    const safeFace = (smileyFace || '').trim() || '表情';
    withEditor((ed) => {
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      const node = document.createTextNode(`[s:${safePack}:${safeFace}]`);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
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
            title="粗体 (Ctrl+B)"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('bold');
              } else {
                withEditor(execBold);
                // 有选区：执行 execBold 后，从当前光标位置同步 activeStyles.bold
                const el = editorElRef.current;
                if (el) {
                  useEditorStore.getState().setActiveStyles({ bold: isBoldActive() });
                }
                useEditorStore.getState().lockActiveStyles();
              }
            }}
            active={activeBold}
            style={{ fontWeight: 700, fontSize: 13 }}
          >
            B
          </ToolbarBtn>
          <ToolbarBtn
            title="斜体 (Ctrl+I)"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('italic');
              } else {
                withEditor(execItalic);
                const el = editorElRef.current;
                if (el) {
                  useEditorStore.getState().setActiveStyles({ italic: isItalicActive() });
                }
                useEditorStore.getState().lockActiveStyles();
              }
            }}
            active={activeItalic}
            style={{ fontStyle: 'italic', fontSize: 13 }}
          >
            I
          </ToolbarBtn>
          <ToolbarBtn
            title="下划线 (Ctrl+U)"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('underline');
              } else {
                withEditor(execUnderline);
                const el = editorElRef.current;
                if (el) {
                  useEditorStore.getState().setActiveStyles({ underline: isUnderlineActive() });
                }
                useEditorStore.getState().lockActiveStyles();
              }
            }}
            active={activeUnderline}
            style={{ textDecoration: 'underline', fontSize: 13 }}
          >
            U
          </ToolbarBtn>
          <ToolbarBtn
            title="删除线 [del]…[/del]"
            onClick={() => {
              if (isCollapsedSelection()) {
                toggleSimpleActiveStyle('strike');
              } else {
                withEditor(execStrikeThrough);
                const el = editorElRef.current;
                if (el) {
                  useEditorStore.getState().setActiveStyles({ strike: isStrikeActive() });
                }
                useEditorStore.getState().lockActiveStyles();
              }
            }}
            active={activeStrike}
            style={{ textDecoration: 'line-through' }}
          >
            S
          </ToolbarBtn>
          <ToolbarBtn
            title="上标 [sup]…[/sup]"
            active={activeSup}
            onClick={() => {
              if (isCollapsedSelection()) {
                // 折叠光标：翻转 activeStyles，下一次输入自动应用；sup/sub 互斥
                const cur = useEditorStore.getState().activeStyles;
                useEditorStore
                  .getState()
                  .setActiveStyles({ sup: !cur.sup, sub: false });
                useEditorStore.getState().lockActiveStyles();
              } else {
                withEditor((ed) => document.execCommand('superscript', false));
                // 有选区：执行后从当前光标位置同步 sup/sub 状态
                const el = editorElRef.current;
                if (el) {
                  useEditorStore.getState().setActiveStyles({
                    sup: isSupActive(),
                    sub: isSubActive(),
                  });
                }
                useEditorStore.getState().lockActiveStyles();
              }
            }}
            style={{ fontSize: 11 }}
          >
            X²
          </ToolbarBtn>
          <ToolbarBtn
            title="下标 [sub]…[/sub]"
            active={activeSub}
            onClick={() => {
              if (isCollapsedSelection()) {
                // 折叠光标：翻转 activeStyles，下一次输入自动应用；sup/sub 互斥
                const cur = useEditorStore.getState().activeStyles;
                useEditorStore
                  .getState()
                  .setActiveStyles({ sub: !cur.sub, sup: false });
                useEditorStore.getState().lockActiveStyles();
              } else {
                withEditor((ed) => document.execCommand('subscript', false));
                const el = editorElRef.current;
                if (el) {
                  useEditorStore.getState().setActiveStyles({
                    sup: isSupActive(),
                    sub: isSubActive(),
                  });
                }
                useEditorStore.getState().lockActiveStyles();
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
                  background: NGA_COLORS.find((c) => c.value === activeColorNgaName)?.cssColor || '#000',
                  border: '1px solid var(--border-color)',
                  verticalAlign: 'middle',
                  marginRight: 2,
                }}
              />
              <span className="tb-label">颜色</span>
            </ToolbarBtn>
            {colorPickerOpen && (
              <div style={{ ...popoverPanel, top: 30, left: 0, minWidth: 220, flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                {NGA_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => {
                      // Word 模式：
                      // 1. 有选区：直接应用颜色（不切换），与 toggleColor 不同
                      // 2. 无选区：仅同步 activeStyles，下一次输入自动应用
                      withEditor((ed) => applyColor(ed, c.cssColor));
                      useEditorStore.getState().setActiveStyles({ color: c.cssColor });
                      useEditorStore.getState().lockActiveStyles();
                      setColorPickerOpen(false);
                    }}
                    title={c.label}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      background: c.cssColor,
                      border: c.value === activeColorNgaName ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  />
                ))}
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

            {/* 自定义字号百分比 */}
            <input
              type="number"
              min={0}
              max={1000}
              step={1}
              value={activeFontSizePct}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') return;
                let v = parseInt(raw, 10);
                if (isNaN(v)) return;
                // 输入校验：小于0修正为0，大于1000修正为1000
                if (v < 0) v = 0;
                if (v > 1000) v = 1000;
                const cssSize = `${v}%`;
                // 输入期间仅更新 store 状态（不抢焦点，避免每次按键失焦）
                useEditorStore.getState().setActiveStyles({ fontSize: cssSize });
                useEditorStore.getState().lockActiveStyles();
              }}
              style={{
                width: 56,
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
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color, #e5e7eb)';
                e.currentTarget.style.boxShadow = 'none';
                // 失焦时一次性应用到编辑器选区（从 store 读取最新 fontSize）
                const fontSize = useEditorStore.getState().activeStyles.fontSize;
                if (fontSize) {
                  withEditor((ed) => applyFontSize(ed, fontSize));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              title="自定义字号百分比（0-1000）"
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
              withEditor((ed) => applyFontFamily(ed, cssFamily));
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

        <ToolbarBtn title="插入骰子" onClick={onInsertDice}>
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
          title="引用 [quote]（整行 #f2eddf 背景）"
          onClick={() => withEditor(insertQuoteBlock)}
        >
          ❝ <span className="tb-label">引用</span>
        </ToolbarBtn>

        {/* 折叠 */}
        <div style={{ position: 'relative' }} ref={collapseRef}>
          <ToolbarBtn
            title="折叠 [collapse=标题]…[/collapse]"
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
            onClick={() => withEditor(execRemoveFormat)}
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
