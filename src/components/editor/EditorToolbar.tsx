import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  NGA_FONTS,
  NGA_FONT_SIZES,
  NGA_COLORS,
  NGA_IMAGE_SIZES,
  NGA_DEFAULT_FONT,
  NGA_DEFAULT_FONT_SIZE,
  NGA_DEFAULT_COLOR,
  NGA_DEFAULT_IMAGE_SIZE,
} from '../../types';
import {
  execBold,
  execItalic,
  execUnderline,
  execStrikeThrough,
  execUndo,
  execRedo,
  execRemoveFormat,
  execInsertUnorderedList,
  execInsertOrderedList,
  isBoldActive,
  isItalicActive,
  isUnderlineActive,
  isStrikeActive,
  getEffectiveColorName,
  getEffectiveFontSizePercent,
  getEffectiveFontFamilyValue,
  getCurrentBlockAlign,
  isInsideList,
  setBlockAlign,
  toggleFontFamily,
  toggleFontSize,
  toggleColor,
  insertCollapseBlock,
  insertQuoteBlock,
  insertTable,
  insertCodeBlock,
  insertHorizontalRuleNGA,
  insertNgaLink,
  insertImageBlockWithSize,
  setImageBlockAlign,
  removeLinkAtCursor,
} from './contenteditableUtils';

interface EditorToolbarProps {
  editorElRef: React.MutableRefObject<HTMLElement | null>;
  savedRangeRef?: React.MutableRefObject<Range | null>;
  onInsertImage: (src: string, size?: string) => void;
  onInsertDice: () => void;
  onShowToast?: (msg: string) => void;
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
  style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const base = active
    ? { ...toolbarBtn, ...toolbarBtnActive }
    : { ...toolbarBtn, ...(hover ? toolbarBtnHover : {}) };
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...style }}
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
}: EditorToolbarProps) {
  const editor = useEditor(editorElRef);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlBox, setShowUrlBox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // 激活状态
  const activeBold = editor ? isBoldActive() : false;
  const activeItalic = editor ? isItalicActive() : false;
  const activeUnderline = editor ? isUnderlineActive() : false;
  const activeStrike = editor ? isStrikeActive() : false;
  const activeColor = editor ? getEffectiveColorName(editor) ?? NGA_DEFAULT_COLOR : NGA_DEFAULT_COLOR;
  const activeFontSize = editor
    ? getEffectiveFontSizePercent(editor) ?? NGA_DEFAULT_FONT_SIZE
    : NGA_DEFAULT_FONT_SIZE;
  const activeFont = editor
    ? getEffectiveFontFamilyValue(editor) ?? NGA_DEFAULT_FONT
    : NGA_DEFAULT_FONT;
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

  const showToast = (msg: string) => {
    onShowToast?.(msg);
  };

  const handlePickFile = () => {
    const hasElectronAPI =
      typeof (window as any).electronAPI !== 'undefined' &&
      typeof (window as any).electronAPI.selectImage === 'function';
    if (hasElectronAPI) {
      (window as any).electronAPI
        .selectImage()
        .then((src: string | null) => {
          if (src) handleInsertImageWithSize(src);
        })
        .catch(() => {
          fileInputRef.current?.click();
        });
      return;
    }
    fileInputRef.current?.click();
  };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      handleInsertImageWithSize(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleInsertImageWithSize = (src: string) => {
    if (!src) return;
    withEditor((ed) => insertImageBlockWithSize(ed, src, imageSize));
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

      {/* 第一行：B/I/U/del + 上下标 + 颜色/字号/字体 + 列表/对齐 */}
      <div style={rowContainer}>
        <div style={groupContainer}>
          <ToolbarBtn
            title="粗体 (Ctrl+B)"
            onClick={() => withEditor(execBold)}
            active={activeBold}
            style={{ fontWeight: 700, fontSize: 13 }}
          >
            B
          </ToolbarBtn>
          <ToolbarBtn
            title="斜体 (Ctrl+I)"
            onClick={() => withEditor(execItalic)}
            active={activeItalic}
            style={{ fontStyle: 'italic', fontSize: 13 }}
          >
            I
          </ToolbarBtn>
          <ToolbarBtn
            title="下划线 (Ctrl+U)"
            onClick={() => withEditor(execUnderline)}
            active={activeUnderline}
            style={{ textDecoration: 'underline', fontSize: 13 }}
          >
            U
          </ToolbarBtn>
          <ToolbarBtn
            title="删除线 [del]…[/del]"
            onClick={() => withEditor(execStrikeThrough)}
            active={activeStrike}
            style={{ textDecoration: 'line-through' }}
          >
            S
          </ToolbarBtn>
          <ToolbarBtn
            title="上标 [sup]…[/sup]"
            onClick={() => withEditor((ed) => document.execCommand('superscript', false))}
            style={{ fontSize: 11 }}
          >
            X²
          </ToolbarBtn>
          <ToolbarBtn
            title="下标 [sub]…[/sub]"
            onClick={() => withEditor((ed) => document.execCommand('subscript', false))}
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
                  background: NGA_COLORS.find((c) => c.value === activeColor)?.cssColor || '#000',
                  border: '1px solid var(--border-color)',
                  verticalAlign: 'middle',
                  marginRight: 2,
                }}
              />
              颜色
            </ToolbarBtn>
            {colorPickerOpen && (
              <div style={{ ...popoverPanel, top: 30, left: 0, minWidth: 220, flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                {NGA_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => {
                      withEditor((ed) => toggleColor(ed, c.value));
                      setColorPickerOpen(false);
                    }}
                    title={c.label}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      background: c.cssColor,
                      border: c.value === activeColor ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 字号：6 档百分比 */}
          <select
            value={String(activeFontSize)}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (isNaN(v)) return;
              withEditor((ed) => toggleFontSize(ed, v));
            }}
            style={selectNga}
            title="字号"
          >
            {NGA_FONT_SIZES.map((s) => (
              <option key={s.percent} value={String(s.percent)}>
                {s.label}
              </option>
            ))}
          </select>

          {/* 字体：16 字体 */}
          <select
            value={activeFont}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              withEditor((ed) => toggleFontFamily(ed, v));
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
            • 列表
          </ToolbarBtn>
          <ToolbarBtn
            title="有序列表 [list=1]"
            onClick={() => withEditor(execInsertOrderedList)}
            active={activeOL}
          >
            1. 列表
          </ToolbarBtn>

          <ToolbarBtn
            title="左对齐"
            onClick={() => withEditor((ed) => setBlockAlign(ed, 'left'))}
            active={activeAlign === 'left'}
          >
            ⯇
          </ToolbarBtn>
          <ToolbarBtn
            title="居中"
            onClick={() => withEditor((ed) => setBlockAlign(ed, 'center'))}
            active={activeAlign === 'center'}
          >
            ⯅
          </ToolbarBtn>
          <ToolbarBtn
            title="右对齐"
            onClick={() => withEditor((ed) => setBlockAlign(ed, 'right'))}
            active={activeAlign === 'right'}
          >
            ⯈
          </ToolbarBtn>
        </div>
      </div>

      {/* 第二行：图片(含尺寸)/骰子/表情/引用/折叠/表格/代码/链接/上下标/导入/分割线/撤销/重做/清格式 */}
      <div style={rowContainer}>
        {/* 图片 + 尺寸下拉 */}
        <div style={{ position: 'relative' }} ref={imageSizeRef}>
          <ToolbarBtn
            title="插入图片（带尺寸）"
            onClick={() => setImageSizeOpen((v) => !v)}
            active={imageSizeOpen}
          >
            🖼 图片
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
                <ToolbarBtn onClick={handlePickFile}>本地上传</ToolbarBtn>
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
          🎲 骰子
        </ToolbarBtn>

        <GroupDivider />

        {/* 表情 */}
        <div style={{ position: 'relative' }} ref={smileyRef}>
          <ToolbarBtn
            title="插入表情 [s:表情包名:表情]"
            onClick={() => setSmileyOpen((v) => !v)}
            active={smileyOpen}
          >
            😄 表情
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
          ❝ 引用
        </ToolbarBtn>

        {/* 折叠 */}
        <div style={{ position: 'relative' }} ref={collapseRef}>
          <ToolbarBtn
            title="折叠 [collapse=标题]…[/collapse]"
            onClick={() => setCollapseOpen((v) => !v)}
            active={collapseOpen}
          >
            ▾ 折叠
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
            ▦ 表格
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
          ⟨/⟩ 代码
        </ToolbarBtn>

        {/* 链接 */}
        <div style={{ position: 'relative' }} ref={linkRef}>
          <ToolbarBtn
            title="插入链接 [url=链接]文字[/url]"
            onClick={() => setLinkOpen((v) => !v)}
            active={linkOpen}
          >
            🌐 链接
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
          ⛔ 取消链接
        </ToolbarBtn>

        <GroupDivider />

        <div style={groupContainer}>
          <ToolbarBtn
            title="撤销 (Ctrl+Z)"
            onClick={() => withEditor(execUndo)}
          >
            ↶ 撤销
          </ToolbarBtn>
          <ToolbarBtn
            title="重做 (Ctrl+Y)"
            onClick={() => withEditor(execRedo)}
          >
            ↷ 重做
          </ToolbarBtn>
        </div>

        <GroupDivider />

        <div style={groupContainer}>
          <ToolbarBtn
            title="分割线 [h][/h]"
            onClick={() => withEditor(insertHorizontalRuleNGA)}
          >
            — 分割线
          </ToolbarBtn>
          <ToolbarBtn
            title="清除格式"
            onClick={() => withEditor(execRemoveFormat)}
          >
            ⌫ 清格式
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
    </div>
  );
}
